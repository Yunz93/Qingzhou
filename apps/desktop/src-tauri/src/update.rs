use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{ipc::Channel, AppHandle, Manager, WebviewWindow};
use tauri_plugin_updater::{Error as UpdateError, Update, UpdaterExt};

use crate::{connect_workbench, flush_workbench, verify_workbench, Backend, ExitState};

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<(Update, Vec<u8>)>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
    pub can_install: bool,
}

#[cfg(any(windows, test))]
fn matches_install_directory(executable: &std::path::Path, registered: &std::path::Path) -> bool {
    let Some(directory) = executable.parent() else {
        return false;
    };
    match (directory.canonicalize(), registered.canonicalize()) {
        (Ok(current), Ok(expected)) => current == expected,
        _ => false,
    }
}

#[cfg(windows)]
fn install_registry_key(config: &tauri::Config) -> Option<String> {
    // Tauri omits the bundler-only publisher from the embedded runtime config.
    // The NSIS installer defaults to the second component of the same identifier.
    let publisher = config.identifier.split('.').nth(1)?;
    let product = config.product_name.as_deref()?;
    Some(format!(r"Software\{publisher}\{product}"))
}

#[cfg(windows)]
fn can_install_update(app: &AppHandle) -> bool {
    use std::{ffi::OsString, path::Path};
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_32KEY},
        RegKey,
    };

    let Some(key) = install_registry_key(app.config()) else {
        return false;
    };
    // Read the same current-user value used by the NSIS installer's RestorePreviousInstallLocation.
    let target = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(key, KEY_READ | KEY_WOW64_32KEY)
        .and_then(|key| key.get_value::<OsString, _>(""));
    match (std::env::current_exe(), target) {
        (Ok(executable), Ok(registered)) if !registered.is_empty() => {
            matches_install_directory(&executable, Path::new(&registered))
        }
        _ => false,
    }
}

fn require_install_target(_app: &AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    if !can_install_update(_app) {
        return Err("请退出当前墨问，下载新版 Windows 便携包并解压到您使用的目录。".into());
    }
    Ok(())
}

async fn latest(app: &AppHandle) -> Result<Option<Update>, String> {
    if !app.config().plugins.0.contains_key("updater") {
        return Err("当前构建未配置签名更新源。".into());
    }
    crate::proxy::for_updater(app.updater_builder())
        .build()
        .map_err(|_| "无法初始化签名更新。请重启墨问后重试。".to_owned())?
        .check()
        .await
        .map_err(|error| match error {
            UpdateError::TargetNotFound(_) | UpdateError::TargetsNotFound(_) => {
                "该版本暂无适用于此设备的安装包。".to_owned()
            }
            _ => "无法检查更新，请检查网络后重试。".to_owned(),
        })
}

fn download_error(error: UpdateError) -> String {
    match error {
        UpdateError::Minisign(_)
        | UpdateError::Base64(_)
        | UpdateError::SignatureUtf8(_)
        | UpdateError::SignedVersionMismatch { .. }
        | UpdateError::MissingSignedVersion => "安装包签名校验失败。请重新下载安装。".into(),
        _ => "安装包下载失败。请检查网络后重试。".into(),
    }
}

fn install_error(error: UpdateError) -> String {
    match error {
        UpdateError::PreviousAppNotRestored(path) => {
            format!("更新失败，上一版墨问保留在 {}。", path.display())
        }
        UpdateError::BinaryNotFoundInArchive | UpdateError::InvalidUpdaterFormat => {
            "该安装包不适用于此设备，请重新检查更新。".into()
        }
        _ => "无法安装更新。请检查安装目录权限后重试。".into(),
    }
}

#[tauri::command]
pub async fn check_signed_update(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<UpdateInfo>, String> {
    verify_workbench(&app, &window)?;
    Ok(latest(&app).await?.map(|update| UpdateInfo {
        version: update.version,
        body: update.body.unwrap_or_default(),
        can_install: require_install_target(&app).is_ok(),
    }))
}

#[tauri::command]
pub async fn download_signed_update(
    app: AppHandle,
    window: WebviewWindow,
    version: String,
    progress: Channel<Value>,
) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    require_install_target(&app)?;
    let update = latest(&app)
        .await?
        .filter(|update| update.version == version)
        .ok_or("可安装的更新版本已变化，请重新检查。")?;
    let mut first = true;
    let data = update
        .download(
            |received, total| {
                if first {
                    first = false;
                    let _ = progress
                        .send(json!({ "event": "Started", "data": { "contentLength": total } }));
                }
                let _ = progress
                    .send(json!({ "event": "Progress", "data": { "chunkLength": received } }));
            },
            || {
                let _ = progress.send(json!({ "event": "Finished" }));
            },
        )
        .await
        .map_err(download_error)?;
    *app.state::<PendingUpdate>()
        .0
        .lock()
        .map_err(|_| "更新暂存不可用。")? = Some((update, data));
    Ok(())
}

#[tauri::command]
pub async fn install_signed_update(
    app: AppHandle,
    window: WebviewWindow,
    version: String,
) -> Result<(), String> {
    verify_workbench(&app, &window)?;
    require_install_target(&app)?;
    let (update, data) = app
        .state::<PendingUpdate>()
        .0
        .lock()
        .map_err(|_| "更新暂存不可用。")?
        .take()
        .filter(|(update, _)| update.version == version)
        .ok_or("请先下载并验证该更新。")?;
    app.state::<ExitState>()
        .0
        .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "墨问正在退出，请稍后重试。")?;
    let worker = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        flush_workbench(&worker)?;
        worker.state::<Backend>().shutdown()?;
        require_install_target(&worker)?;
        update.install(data).map_err(install_error)
    })
    .await
    .map_err(|_| "更新操作中断。请重新检查更新。".to_owned())
    .and_then(|result| result);
    if let Err(error) = result {
        app.state::<ExitState>().0.store(0, Ordering::Release);
        // The shutdown step leaves the current server in place if flushing fails.
        // Reconnect only when installation had already stopped it.
        let _ = connect_workbench(app, window, false, Vec::new()).await;
        return Err(error);
    }
    app.state::<ExitState>().0.store(2, Ordering::Release);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{download_error, install_error, matches_install_directory, UpdateError};
    use std::path::Path;

    #[cfg(windows)]
    #[test]
    fn uses_the_installer_key_from_the_embedded_app_config() {
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert_eq!(
            super::install_registry_key(context.config()).as_deref(),
            Some(r"Software\qingzhou\Mowen")
        );
    }

    #[test]
    fn a_side_by_side_copy_does_not_match_the_registered_installation() {
        let registered = Path::new(env!("CARGO_MANIFEST_DIR"));
        let portable = registered.join("src");
        assert!(matches_install_directory(
            &registered.join("qingzhou.exe"),
            registered
        ));
        assert!(!matches_install_directory(
            &portable.join("qingzhou.exe"),
            registered
        ));
        assert!(!matches_install_directory(
            &registered.join("qingzhou.exe"),
            &registered.join("missing-profile")
        ));
    }

    #[test]
    fn update_signature_failures_give_a_chinese_retry_message() {
        assert_eq!(
            download_error(UpdateError::MissingSignedVersion),
            "安装包签名校验失败。请重新下载安装。"
        );
        assert_eq!(
            download_error(UpdateError::Network("fixture".into())),
            "安装包下载失败。请检查网络后重试。"
        );
        assert!(
            install_error(UpdateError::PreviousAppNotRestored("旧版墨问.app".into()))
                .contains("旧版墨问.app")
        );
    }
}
