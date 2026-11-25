use std::ffi::c_void;
use std::ptr::null;

use windows_sys::{
    core::{w, PWSTR},
    Win32::{Foundation::GlobalFree, Networking::WinHttp::*},
};

use super::{bounded_lookup, http_proxy_url, Route, PROBE_URLS};

struct SystemString(PWSTR);

impl SystemString {
    fn read(&self) -> Option<String> {
        if self.0.is_null() {
            return None;
        }
        // WinHTTP returns a NUL-terminated buffer allocated with GlobalAlloc.
        let size = (0..).find(|index| unsafe { *self.0.add(*index) == 0 })?;
        String::from_utf16(unsafe { std::slice::from_raw_parts(self.0, size) }).ok()
    }
}

impl Drop for SystemString {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { GlobalFree(self.0.cast()) };
        }
    }
}

struct Session(*mut c_void);

impl Drop for Session {
    fn drop(&mut self) {
        unsafe { WinHttpCloseHandle(self.0) };
    }
}

pub(super) fn automatic_route() -> Option<Route> {
    let mut settings = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    let read = unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut settings) };
    let url = SystemString(settings.lpszAutoConfigUrl);
    let _manual = SystemString(settings.lpszProxy);
    let _bypass = SystemString(settings.lpszProxyBypass);
    if read == 0 || (url.0.is_null() && settings.fAutoDetect == 0) {
        return None;
    }
    let url = url.read().filter(|url| !url.is_empty());
    let discover = settings.fAutoDetect != 0;
    // WPAD and PAC downloads can block beyond WinHTTP's individual socket timeouts.
    bounded_lookup(move || resolve(url, discover))
}

fn resolve(url: Option<String>, discover: bool) -> Option<Route> {
    let raw = unsafe {
        WinHttpOpen(
            w!("Qingzhou"),
            WINHTTP_ACCESS_TYPE_NO_PROXY,
            null(),
            null(),
            0,
        )
    };
    if raw.is_null() {
        return None;
    }
    let session = Session(raw);
    unsafe { WinHttpSetTimeouts(session.0, 1000, 1000, 1000, 1000) };
    let mut settings = WINHTTP_AUTOPROXY_OPTIONS::default();
    let url = url.as_deref().map(wide);
    if let Some(url) = &url {
        settings.lpszAutoConfigUrl = url.as_ptr();
        settings.dwFlags |= WINHTTP_AUTOPROXY_CONFIG_URL;
    }
    if discover {
        settings.dwFlags |= WINHTTP_AUTOPROXY_AUTO_DETECT;
        settings.dwAutoDetectFlags = WINHTTP_AUTO_DETECT_TYPE_DHCP | WINHTTP_AUTO_DETECT_TYPE_DNS_A;
    }
    let mut direct = None;
    for probe in PROBE_URLS {
        let target = wide(probe);
        let mut info = WINHTTP_PROXY_INFO::default();
        let result =
            unsafe { WinHttpGetProxyForUrl(session.0, target.as_ptr(), &mut settings, &mut info) };
        let proxy = SystemString(info.lpszProxy);
        let _bypass = SystemString(info.lpszProxyBypass);
        if result != 0 {
            if info.dwAccessType == WINHTTP_ACCESS_TYPE_NO_PROXY {
                direct = Some(Route::Direct);
            } else if let Some(proxy) = proxy.read().as_deref().and_then(parse_proxy) {
                return Some(Route::Proxy(proxy));
            }
        }
    }
    direct
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

fn parse_proxy(value: &str) -> Option<tauri::Url> {
    let first = value.split(';').next()?.trim();
    let address = first.strip_prefix("PROXY ").unwrap_or(first);
    if address.eq_ignore_ascii_case("DIRECT") || address.contains([' ', '=']) {
        return None;
    }
    http_proxy_url(address)
}

#[cfg(test)]
mod tests {
    use super::{parse_proxy, resolve, Route};
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    #[test]
    fn accepts_the_first_http_proxy_in_winhttp_output() {
        assert_eq!(
            parse_proxy("127.0.0.1:8080;DIRECT").unwrap().as_str(),
            "http://127.0.0.1:8080/"
        );
        assert!(parse_proxy("DIRECT").is_none());
        assert!(parse_proxy("SOCKS foo:8080").is_none());
    }

    #[test]
    fn winhttp_evaluates_a_local_pac_script() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = String::new();
            BufReader::new(&stream).read_line(&mut request).unwrap();
            assert!(request.starts_with("GET /proxy.pac "), "{request}");
            let script = "function FindProxyForURL(url, host) { return 'PROXY 127.0.0.1:4181'; }";
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", script.len(), script).unwrap();
        });
        let route = resolve(Some(format!("http://{address}/proxy.pac")), false);
        assert!(
            matches!(route, Some(Route::Proxy(proxy)) if proxy.as_str() == "http://127.0.0.1:4181/")
        );
        server.join().unwrap();
    }
}
