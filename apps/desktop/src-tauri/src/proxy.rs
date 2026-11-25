use std::process::Command;

use hyper_util::client::proxy::matcher::Matcher;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(any(target_os = "macos", windows))]
const PROBE_URLS: &[&str] = &[
    "https://api.github.com/",
    "https://api.openai.com/",
    "https://pi.dev/",
    "https://registry.npmjs.org/",
];

#[cfg(any(target_os = "macos", windows))]
enum Route {
    Proxy(tauri::Url),
    Direct,
}

#[cfg(any(target_os = "macos", windows))]
fn http_proxy_url(address: &str) -> Option<tauri::Url> {
    let address = address.trim();
    let url = tauri::Url::parse(&format!("http://{address}")).ok()?;
    (url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none())
    .then_some(url)
}

#[cfg(any(target_os = "macos", windows))]
fn bounded_lookup(lookup: impl FnOnce() -> Option<Route> + Send + 'static) -> Option<Route> {
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::Builder::new()
        .name("system-proxy".into())
        .spawn(move || {
            let _ = send.send(lookup());
        })
        .ok()?;
    receive
        .recv_timeout(std::time::Duration::from_secs(2))
        .ok()
        .flatten()
}

fn explicit_proxy_configured() -> bool {
    const OVERRIDES: &[&str] = &[
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];
    OVERRIDES
        .iter()
        .any(|key| std::env::var_os(key).is_some_and(|value| !value.is_empty()))
}

#[cfg(any(target_os = "macos", windows))]
fn startup_route() -> Option<&'static Route> {
    use std::sync::OnceLock;

    static ROUTE: OnceLock<Option<Route>> = OnceLock::new();
    if explicit_proxy_configured() {
        return None;
    }
    ROUTE.get_or_init(automatic_route).as_ref()
}

pub fn apply_system_proxy(command: &mut Command) {
    if explicit_proxy_configured() {
        return;
    }

    #[cfg(any(target_os = "macos", windows))]
    match startup_route() {
        Some(Route::Proxy(proxy)) => {
            command
                .env("HTTPS_PROXY", proxy.as_str())
                .env("HTTP_PROXY", proxy.as_str());
            return;
        }
        Some(Route::Direct) => return,
        None => {}
    }

    let manual = Matcher::from_system();
    for (name, target) in [
        ("HTTPS_PROXY", "https://api.openai.com/"),
        ("HTTP_PROXY", "http://registry.npmjs.org/"),
    ] {
        if let Some(proxy) = manual.intercept(&http::Uri::from_static(target)) {
            if matches!(proxy.uri().scheme_str(), Some("http" | "https")) {
                command.env(name, proxy.uri().to_string());
            }
        }
    }
}

pub fn for_updater(
    builder: tauri_plugin_updater::UpdaterBuilder,
) -> tauri_plugin_updater::UpdaterBuilder {
    #[cfg(any(target_os = "macos", windows))]
    match startup_route() {
        Some(Route::Proxy(proxy)) => {
            let bypass = std::env::var("NO_PROXY")
                .or_else(|_| std::env::var("no_proxy"))
                .unwrap_or_default();
            let bypass =
                reqwest::NoProxy::from_string(&format!("127.0.0.1,localhost,::1,{bypass}"));
            if let Ok(proxy) = reqwest::Proxy::all(proxy.as_str()) {
                let proxy = proxy.no_proxy(bypass);
                return builder.configure_client(move |client| client.proxy(proxy.clone()));
            }
        }
        Some(Route::Direct) => return builder.no_proxy(),
        None => {}
    }
    builder
}

#[cfg(target_os = "macos")]
use macos::automatic_route;
#[cfg(windows)]
use windows::automatic_route;
