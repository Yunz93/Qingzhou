fn main() {
    const COMMANDS: &[&str] = &[
        "start_workbench",
        "ensure_backend",
        "open_logs",
        "pick_folder",
        "open_path",
        "open_external",
        "notify",
        "preview_navigation",
        "finish_draft_flush",
        "check_signed_update",
        "download_signed_update",
        "install_signed_update",
        #[cfg(feature = "desktop-e2e")]
        "exercise_native_control",
    ];
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    tauri_build::try_build(attributes).expect("failed to configure Qingzhou desktop");
}
