#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
#[cfg(all(feature = "desktop-e2e", target_os = "macos"))]
mod native_test;
mod proxy;
mod update;

use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;

use backend::{log_location, Backend, UiChange};
use tauri::ipc::CapabilityBuilder;
use tauri::menu::{MenuBuilder, MenuItem, SubmenuBuilder};
use tauri::webview::NewWindowResponse;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

const MAIN: &str = "main";
const PREVIEW: &str = "website-preview";

#[derive(Default)]
struct ExitState(AtomicU8);

#[derive(Default)]
struct DraftFlush(Mutex<Option<(uuid::Uuid, mpsc::Sender<bool>)>>);

#[tauri::command]
async fn start_workbench(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    connect_workbench(app, window, true, Vec::new())
        .await
        .map(|_| ())
}

#[tauri::command]
async fn ensure_backend(
    app: AppHandle,
    window: WebviewWindow,
    renew: bool,
    changes: Vec<UiChange>,
) -> Result<bool, String> {
    verify_workbench(&app, &window)?;
    connect_workbench(app, window, renew, changes).await
}

async fn connect_workbench(
    app: AppHandle,
    window: WebviewWindow,
    renew: bool,
    changes: Vec<UiChange>,
) -> Result<bool, String> {
    let worker = app.clone();
    let url = tauri::async_runtime::spawn_blocking(move || {
        worker.state::<Backend>().connect(&worker, renew, &changes)
    })
    .await
    .map_err(error_text)??;
    let Some(url) = url else {
        return Ok(false);
    };
    let origin = url.origin().ascii_serialization();
    let capability =
        CapabilityBuilder::new(format!("workbench-{}", url.port().unwrap_or_default()))
            .local(false)
            .webview(MAIN)
            .remote(format!("{origin}/*"))
            .permission("core:event:allow-listen")
            .permission("core:event:allow-unlisten")
            .permission("allow-ensure-backend")
            .permission("allow-open-logs")
            .permission("allow-pick-folder")
            .permission("allow-open-path")
            .permission("allow-open-external")
            .permission("allow-notify")
            .permission("allow-preview-navigation")
            .permission("allow-check-signed-update")
            .permission("allow-download-signed-update")
            .permission("allow-install-signed-update")
            .permission("allow-finish-draft-flush");
    #[cfg(all(feature = "desktop-e2e", target_os = "macos"))]
    let capability = if native_test::enabled() {
        capability.permission("allow-exercise-native-control")
    } else {
        capability
    };
    app.add_capability(capability).map_err(error_text)?;
    window.navigate(url).map_err(error_text)?;
    Ok(true)
}

fn verify_workbench(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    if window.label() == MAIN
        && app
            .state::<Backend>()
            .allows(&window.url().map_err(error_text)?)
    {
        return Ok(());
    }
    Err("仅在墨问主窗口中可使用此操作。".into())
}

#[tauri::command]
fn finish_draft_flush(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    saved: bool,
) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    let state = app.state::<DraftFlush>();
    let mut pending = state.0.lock().map_err(error_text)?;
    if pending
        .as_ref()
        .is_some_and(|(active, _)| uuid::Uuid::parse_str(&id) == Ok(*active))
    {
        if let Some((_, sender)) = pending.take() {
            let _ = sender.send(saved);
        }
    }
    Ok(())
}

fn flush_workbench(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN) else {
        return Ok(());
    };
    if !app
        .state::<Backend>()
        .allows(&window.url().map_err(error_text)?)
    {
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel();
    let id = uuid::Uuid::new_v4();
    let state = app.state::<DraftFlush>();
    *state.0.lock().map_err(error_text)? = Some((id, sender));
    let result = window.eval(format!(
        "Promise.resolve().then(() => window.__qingzhouFlushDrafts?.()).then(\
         () => window.__TAURI_INTERNALS__.invoke('finish_draft_flush', {{ id: '{id}', saved: true }}),\
         () => window.__TAURI_INTERNALS__.invoke('finish_draft_flush', {{ id: '{id}', saved: false }}))",
    ));
    let saved = result.is_ok() && receiver.recv_timeout(Duration::from_secs(12)) == Ok(true);
    state.0.lock().map_err(error_text)?.take();
    if saved {
        Ok(())
    } else {
        Err("暂时无法保存桌面草稿或偏好。请检查窗口中的保存提示后重试。".into())
    }
}

#[tauri::command]
async fn open_logs(app: AppHandle) -> Result<(), String> {
    open::that_detached(log_location(&app)?).map_err(error_text)
}

#[tauri::command]
async fn pick_folder(
    app: AppHandle,
    window: WebviewWindow,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    verify_workbench(&app, &window)?;
    let mut picker = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("选择文件夹");
    if let Some(path) = default_path.filter(|candidate| Path::new(candidate).is_dir()) {
        picker = picker.set_directory(path);
    }
    tauri::async_runtime::spawn_blocking(move || {
        picker
            .blocking_pick_folder()
            .and_then(|entry| entry.into_path().ok())
            .map(|path| path.to_string_lossy().into_owned())
    })
    .await
    .map_err(error_text)
}

#[tauri::command]
async fn open_path(app: AppHandle, window: WebviewWindow, path: String) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    if !Path::new(&path).is_absolute() || path.contains('\0') || !Path::new(&path).exists() {
        return Err("无法打开该路径。".into());
    }
    open::that_detached(path).map_err(error_text)
}

#[tauri::command]
async fn open_external(app: AppHandle, window: WebviewWindow, url: String) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    let url = parse_website(&url)?;
    if app.state::<Backend>().allows(&url) {
        return Err("请在墨问主窗口中打开这个地址。".into());
    }
    open::that_detached(url.as_str()).map_err(error_text)
}

#[tauri::command]
async fn notify(
    app: AppHandle,
    window: WebviewWindow,
    title: String,
    body: String,
) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(error_text)
}

#[tauri::command]
async fn preview_navigation(
    app: AppHandle,
    window: WebviewWindow,
    action: String,
    url: Option<String>,
) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    let existing = app.get_webview_window(PREVIEW);
    if action != "open" {
        let preview = existing.ok_or("网页预览已关闭。")?;
        return match action.as_str() {
            "back" => preview.eval("history.back()"),
            "forward" => preview.eval("history.forward()"),
            "reload" => preview.reload(),
            _ => return Err("无法执行该网页操作。".into()),
        }
        .map_err(error_text);
    }

    let target = parse_website(url.as_deref().unwrap_or_default())?;
    if app.state::<Backend>().allows(&target) {
        return Err("该地址仅可在墨问主窗口中打开。".into());
    }
    if let Some(preview) = existing {
        preview.navigate(target).map_err(error_text)?;
        return preview.set_focus().map_err(error_text);
    }

    let navigation_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(&app, PREVIEW, WebviewUrl::External(target))
        .title("墨问 · 网页预览")
        .inner_size(1024.0, 720.0)
        .incognito(true)
        .on_navigation(move |url| is_website(url) && !navigation_app.state::<Backend>().allows(url))
        .on_new_window(move |url, _| {
            if is_website(&url) && !popup_app.state::<Backend>().allows(&url) {
                let _ = open::that_detached(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(error_text)?;
    Ok(())
}

fn is_website(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

fn parse_website(input: &str) -> Result<Url, String> {
    Url::parse(input)
        .ok()
        .filter(is_website)
        .ok_or_else(|| "请输入有效的 HTTP 或 HTTPS 网址。".into())
}

fn is_bootstrap(url: &Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http", Some("tauri.localhost"))
    ) && matches!(url.path(), "" | "/" | "/index.html")
}

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let handle = app.clone();
    let popup_app = app.clone();
    let window = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("墨问")
        .inner_size(1280.0, 840.0)
        .min_inner_size(533.0, 600.0)
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if handle.state::<Backend>().allows(url) || is_bootstrap(url) {
                return true;
            }
            if is_website(url) {
                let _ = open::that_detached(url.as_str());
            }
            false
        })
        .on_new_window(move |url, _| {
            if is_website(&url) && !popup_app.state::<Backend>().allows(&url) {
                let _ = open::that_detached(url.as_str());
            }
            NewWindowResponse::Deny
        })
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if handle.state::<ExitState>().0.load(Ordering::Acquire) != 2 {
                api.prevent_close();
                handle.exit(0);
            }
        }
    });
    Ok(())
}

fn install_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
    let updates = MenuItem::with_id(app, "updates", "检查更新…", true, None::<&str>)?;
    let application = SubmenuBuilder::new(app, "墨问")
        .item(&settings)
        .item(&updates)
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "编辑")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    app.set_menu(
        MenuBuilder::new(app)
            .item(&application)
            .item(&edit)
            .build()?,
    )?;
    app.on_menu_event(|app, event| {
        let event_name = match event.id().as_ref() {
            "settings" => "qingzhou://open-settings",
            "updates" => "qingzhou://check-update",
            _ => return,
        };
        if let Some(window) = app.get_webview_window(MAIN) {
            let _ = window.emit(event_name, ());
        }
    });
    Ok(())
}

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn main() {
    let context = tauri::generate_context!();
    let builder = tauri::Builder::default();
    let builder = if context.config().plugins.0.contains_key("updater") {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };
    #[cfg(feature = "desktop-e2e")]
    let builder = if std::env::var("QINGZHOU_DESKTOP_E2E").as_deref() == Ok("1") {
        builder.plugin(tauri_plugin_wdio_webdriver::init())
    } else {
        builder
    };
    let app = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Backend::default())
        .manage(ExitState::default())
        .manage(DraftFlush::default())
        .manage(update::PendingUpdate::default())
        .setup(|app| {
            install_menu(app.handle())?;
            create_main_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_workbench,
            ensure_backend,
            open_logs,
            pick_folder,
            open_path,
            open_external,
            notify,
            preview_navigation,
            finish_draft_flush,
            update::check_signed_update,
            update::download_signed_update,
            update::install_signed_update,
            #[cfg(all(feature = "desktop-e2e", target_os = "macos"))]
            native_test::exercise_native_control,
        ])
        .build(context)
        .expect("failed to start Qingzhou desktop");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let exit = app.state::<ExitState>();
            if exit.0.load(Ordering::Acquire) == 2 {
                return;
            }
            api.prevent_exit();
            if exit
                .0
                .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
                .is_err()
            {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                match flush_workbench(&app).and_then(|()| app.state::<Backend>().shutdown()) {
                    Ok(()) => {
                        app.state::<ExitState>().0.store(2, Ordering::Release);
                        app.exit(0);
                    }
                    Err(error) => {
                        app.state::<ExitState>().0.store(0, Ordering::Release);
                        app.dialog()
                            .message(error)
                            .title("墨问未能退出")
                            .show(|_| {});
                    }
                }
            });
        }
    });
}
