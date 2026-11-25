use std::collections::HashMap;
use std::io::Read;
use std::ptr::{null, null_mut};
use std::time::Duration;

use core_foundation::{
    array::{CFArray, CFArrayRef},
    base::{CFType, TCFType},
    dictionary::{CFDictionary, CFDictionaryRef},
    error::CFErrorRef,
    number::CFNumber,
    string::{CFString, CFStringRef},
    url::{CFURLCreateWithString, CFURLRef, CFURL},
};
use reqwest::blocking::Client;

use super::{bounded_lookup, http_proxy_url, Route, PROBE_URLS};

type ProxyEntry = CFDictionary<CFString, CFType>;
type ProxyList = CFArray<ProxyEntry>;

#[link(name = "CFNetwork", kind = "framework")]
extern "C" {
    static kCFProxyTypeKey: CFStringRef;
    static kCFProxyHostNameKey: CFStringRef;
    static kCFProxyPortNumberKey: CFStringRef;
    static kCFProxyTypeHTTP: CFStringRef;
    static kCFProxyTypeHTTPS: CFStringRef;
    static kCFProxyTypeNone: CFStringRef;
    static kCFProxyTypeAutoConfigurationURL: CFStringRef;
    static kCFProxyAutoConfigurationURLKey: CFStringRef;
    static kCFProxyTypeAutoConfigurationJavaScript: CFStringRef;
    static kCFProxyAutoConfigurationJavaScriptKey: CFStringRef;
    fn CFNetworkCopySystemProxySettings() -> CFDictionaryRef;
    fn CFNetworkCopyProxiesForURL(url: CFURLRef, settings: CFDictionaryRef) -> CFArrayRef;
    fn CFNetworkCopyProxiesForAutoConfigurationScript(
        script: CFStringRef,
        target: CFURLRef,
        error: *mut CFErrorRef,
    ) -> CFArrayRef;
}

pub(super) fn automatic_route() -> Option<Route> {
    bounded_lookup(|| {
        // CFNetwork's Copy functions return owned references and can return null.
        let settings = unsafe { CFNetworkCopySystemProxySettings() };
        let settings = (!settings.is_null())
            .then(|| unsafe { ProxyEntry::wrap_under_create_rule(settings) })?;
        resolve_settings(&settings, PROBE_URLS)
    })
}

fn resolve_settings(settings: &ProxyEntry, probes: &[&str]) -> Option<Route> {
    let mut scripts = HashMap::new();
    let mut direct = None;
    for probe in probes {
        let target = url(probe)?;
        let entries = unsafe {
            CFNetworkCopyProxiesForURL(target.as_concrete_TypeRef(), settings.as_concrete_TypeRef())
        };
        if entries.is_null() {
            continue;
        }
        let entries = unsafe { ProxyList::wrap_under_create_rule(entries) };
        let Some(entry) = entries.get(0) else {
            continue;
        };
        let script = if proxy_type_is(&entry, unsafe { kCFProxyTypeAutoConfigurationURL }) {
            let Some(pac) = entry
                .find(unsafe { kCFProxyAutoConfigurationURLKey })
                .and_then(|value| value.downcast::<CFURL>())
            else {
                continue;
            };
            let pac = pac.get_string().to_string();
            scripts
                .entry(pac.clone())
                .or_insert_with(|| download_script(&pac))
                .clone()
        } else if proxy_type_is(&entry, unsafe { kCFProxyTypeAutoConfigurationJavaScript }) {
            entry
                .find(unsafe { kCFProxyAutoConfigurationJavaScriptKey })
                .and_then(|value| value.downcast::<CFString>())
        } else {
            None
        };
        let Some(script) = script else { continue };
        match resolve_script(&script, &target) {
            proxy @ Some(Route::Proxy(_)) => return proxy,
            Some(Route::Direct) => direct = Some(Route::Direct),
            None => {}
        }
    }
    direct
}

fn download_script(address: &str) -> Option<CFString> {
    const MAX_SCRIPT_BYTES: u64 = 1024 * 1024;
    let source = tauri::Url::parse(address).ok()?;
    if !matches!(source.scheme(), "http" | "https") {
        return None;
    }
    // Fetch the PAC directly before a proxy has been selected. CFNetwork still evaluates the script.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let response = Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(1500))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .ok()?
        .get(source)
        .send()
        .ok()?
        .error_for_status()
        .ok()?;
    let mut script = String::new();
    let size = response
        .take(MAX_SCRIPT_BYTES + 1)
        .read_to_string(&mut script)
        .ok()?;
    (size as u64 <= MAX_SCRIPT_BYTES).then(|| CFString::new(&script))
}

fn url(address: &str) -> Option<CFURL> {
    let text = CFString::new(address);
    let value = unsafe { CFURLCreateWithString(null(), text.as_concrete_TypeRef(), null()) };
    (!value.is_null()).then(|| unsafe { CFURL::wrap_under_create_rule(value) })
}

fn proxy_type_is(entry: &ProxyEntry, expected: CFStringRef) -> bool {
    let Some(value) = entry
        .find(unsafe { kCFProxyTypeKey })
        .and_then(|value| value.downcast::<CFString>())
    else {
        return false;
    };
    // The caller provides a process-lifetime CFNetwork type constant.
    value == unsafe { CFString::wrap_under_get_rule(expected) }
}

fn resolve_script(script: &CFString, target: &CFURL) -> Option<Route> {
    let entries = unsafe {
        CFNetworkCopyProxiesForAutoConfigurationScript(
            script.as_concrete_TypeRef(),
            target.as_concrete_TypeRef(),
            null_mut(),
        )
    };
    let entries =
        (!entries.is_null()).then(|| unsafe { ProxyList::wrap_under_create_rule(entries) })?;
    let entry = entries.get(0)?;
    if proxy_type_is(&entry, unsafe { kCFProxyTypeNone }) {
        return Some(Route::Direct);
    }
    if !proxy_type_is(&entry, unsafe { kCFProxyTypeHTTP })
        && !proxy_type_is(&entry, unsafe { kCFProxyTypeHTTPS })
    {
        return None;
    }
    let host = entry
        .find(unsafe { kCFProxyHostNameKey })?
        .downcast::<CFString>()?
        .to_string();
    let port = entry
        .find(unsafe { kCFProxyPortNumberKey })?
        .downcast::<CFNumber>()?
        .to_i64()?;
    let address = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    http_proxy_url(&address).map(Route::Proxy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    #[test]
    fn resolves_system_pac_settings_with_the_native_script_engine() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = String::new();
                BufReader::new(&stream).read_line(&mut request).unwrap();
                assert!(request.starts_with("GET /proxy.pac "), "{request}");
                let script = "function FindProxyForURL(url, host) { return host === 'api.github.com' ? 'PROXY 127.0.0.1:4181; DIRECT' : 'DIRECT'; }";
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", script.len(), script).unwrap();
            }
        });
        let settings = ProxyEntry::from_CFType_pairs(&[
            (
                CFString::new("ProxyAutoConfigEnable"),
                CFNumber::from(1).as_CFType(),
            ),
            (
                CFString::new("ProxyAutoConfigURLString"),
                CFString::new(&format!("http://{address}/proxy.pac")).as_CFType(),
            ),
        ]);
        assert!(
            matches!(resolve_settings(&settings, &PROBE_URLS[..2]), Some(Route::Proxy(proxy)) if proxy.as_str() == "http://127.0.0.1:4181/")
        );
        assert!(matches!(
            resolve_settings(&settings, &["https://pi.dev/"]),
            Some(Route::Direct)
        ));
        server.join().unwrap();
    }
}
