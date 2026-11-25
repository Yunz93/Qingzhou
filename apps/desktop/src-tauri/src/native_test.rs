use std::sync::mpsc;
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSEvent, NSEventModifierFlags, NSEventType, NSOpenPanel, NSTextInputClient,
    NSView, NSWindow,
};
use objc2_foundation::{NSNotFound, NSPoint, NSRange, NSString};
use tauri::{AppHandle, WebviewWindow};

use crate::{error_text, verify_workbench};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Control {
    SettingsShortcut,
    CancelFolderPicker,
    BeginDraftComposition,
    CommitDraftComposition,
}

pub fn enabled() -> bool {
    std::env::var("QINGZHOU_DESKTOP_E2E").as_deref() == Ok("1")
}

#[tauri::command]
pub async fn exercise_native_control(
    app: AppHandle,
    window: WebviewWindow,
    control: Control,
) -> Result<bool, String> {
    verify_workbench(&app, &window)?;
    if !enabled() {
        return Err("原生测试入口已禁用。".into());
    }
    let target = window.clone();
    let (send, receive) = mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = send.send(match control {
                Control::SettingsShortcut => settings_shortcut(),
                Control::CancelFolderPicker => cancel_folder_picker(&target),
                Control::BeginDraftComposition => draft_composition(&target, false),
                Control::CommitDraftComposition => draft_composition(&target, true),
            });
        })
        .map_err(error_text)?;
    tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(Duration::from_secs(5)))
        .await
        .map_err(error_text)?
        .map_err(error_text)
}

fn settings_shortcut() -> bool {
    let Some(main) = MainThreadMarker::new() else {
        return false;
    };
    let Some(menu) = NSApplication::sharedApplication(main).mainMenu() else {
        return false;
    };
    let comma = NSString::from_str(",");
    let event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
        NSEventType::KeyDown, NSPoint::new(0.0, 0.0), NSEventModifierFlags::Command, 0.0, 0,
        None, &comma, &comma, false, 0x2B,
    );
    event.is_some_and(|event| menu.performKeyEquivalent(&event))
}

fn cancel_folder_picker(window: &WebviewWindow) -> bool {
    let Some(window) = appkit_window(window) else {
        return false;
    };
    let Some(panel) = window
        .attachedSheet()
        .and_then(|sheet| sheet.downcast::<NSOpenPanel>().ok())
    else {
        return false;
    };
    // The attached sheet is an active NSOpenPanel owned by the application.
    unsafe { panel.cancel(None) };
    true
}

fn draft_composition(window: &WebviewWindow, commit: bool) -> bool {
    let Some(window) = appkit_window(window) else {
        return false;
    };
    let Some(context) = window
        .firstResponder()
        .and_then(|responder| responder.downcast::<NSView>().ok())
        .and_then(|view| view.inputContext())
    else {
        return false;
    };
    let client = context.client();
    // NSString is an NSTextInputClient-supported payload. NSNotFound targets the current selection or marked text.
    let replacement = NSRange::new(NSNotFound as usize, 0);
    if commit {
        let text = NSString::from_str("你好");
        unsafe { client.insertText_replacementRange(&text, replacement) };
    } else {
        let text = NSString::from_str("nihao");
        unsafe {
            client.setMarkedText_selectedRange_replacementRange(
                &text,
                NSRange::new(text.length(), 0),
                replacement,
            )
        };
    }
    true
}

fn appkit_window(window: &WebviewWindow) -> Option<&NSWindow> {
    let raw = window.ns_window().ok()?;
    // Tauri retains the NSWindow and the test's controls run on the AppKit main thread.
    unsafe { raw.cast::<NSWindow>().as_ref() }
}
