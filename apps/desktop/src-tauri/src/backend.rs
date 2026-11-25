use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Url};
use uuid::Uuid;

const START_TIMEOUT: Duration = Duration::from_secs(30);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(serde::Deserialize, serde::Serialize)]
pub struct UiChange {
    key: String,
    value: Option<String>,
}

#[derive(Default)]
pub struct Backend {
    process: Mutex<Option<Running>>,
    origin: Mutex<Option<Url>>,
}

struct Running {
    child: Child,
    events: Receiver<String>,
    origin: Url,
}

impl Backend {
    pub fn allows(&self, url: &Url) -> bool {
        self.origin.lock().is_ok_and(|current| {
            current
                .as_ref()
                .is_some_and(|origin| origin.origin() == url.origin())
        })
    }

    pub fn connect(
        &self,
        app: &AppHandle,
        renew: bool,
        changes: &[UiChange],
    ) -> Result<Option<Url>, String> {
        let mut slot = self.process.lock().map_err(|_| "本地服务状态不可用。")?;
        let ticket = Uuid::new_v4().simple().to_string();

        if let Some(process) = slot.as_mut() {
            if process.child.try_wait().map_err(display)?.is_some() {
                *slot = None;
            }
        }
        let process = match slot.as_mut() {
            Some(process) => {
                if !renew && self.allows(&process.origin) {
                    return Ok(None);
                }
                process.send(&format!("ticket {ticket}"))?;
                process.wait_for("QINGZHOU_TICKET_READY", START_TIMEOUT)?;
                process
            }
            None => slot.insert(Running::start(app, &ticket)?),
        };
        process.restore_ui(changes)?;
        let url = bootstrap_url(&process.origin, &ticket);
        *self.origin.lock().map_err(|_| "本地服务地址不可用。")? = Some(process.origin.clone());
        Ok(Some(url))
    }

    pub fn shutdown(&self) -> Result<(), String> {
        let mut slot = self.process.lock().map_err(|_| "本地服务状态不可用。")?;
        let Some(process) = slot.as_mut() else {
            return Ok(());
        };
        if process.child.try_wait().map_err(display)?.is_none() {
            process.send("shutdown")?;
            process.wait_for("QINGZHOU_STOPPED", SHUTDOWN_TIMEOUT)?;
        }
        *slot = None;
        *self.origin.lock().map_err(|_| "本地服务地址不可用。")? = None;
        Ok(())
    }
}

impl Running {
    fn start(app: &AppHandle, ticket: &str) -> Result<Self, String> {
        let logs = log_location(app)?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(logs.join("service.log"))
            .map_err(display)?;
        let mut stdout_log = log.try_clone().map_err(display)?;
        let mut command = service_command(app).inspect_err(|error| {
            let _ = writeln!(stdout_log, "[qingzhou] {error}");
        })?;
        command.env("QINGZHOU_DESKTOP_TICKET", ticket);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(log);
        let mut child = command
            .spawn()
            .map_err(|error| format!("无法启动本地服务：{error}"))?;
        let stdout = child.stdout.take().expect("child stdout is piped");
        let (tx, events) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.starts_with("QINGZHOU_") {
                    let _ = tx.send(line);
                } else {
                    let _ = writeln!(stdout_log, "{line}");
                }
            }
        });

        let ready = events.recv_timeout(START_TIMEOUT).ok();
        let origin = ready
            .as_ref()
            .and_then(|line| {
                line.strip_prefix("QINGZHOU_READY ")
                    .and_then(|address| Url::parse(address).ok())
            })
            .filter(|url| {
                url.scheme() == "http"
                    && url.host_str() == Some("127.0.0.1")
                    && url.port().is_some()
            });
        match origin {
            Some(origin) => Ok(Self {
                child,
                events,
                origin,
            }),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                if ready.as_deref() == Some("QINGZHOU_PROFILE_BUSY") {
                    return Err("这个轻舟资料目录已被另一个实例打开。请关闭该实例后重试。".into());
                }
                Err("本地服务未能启动。请查看启动日志后重试。".into())
            }
        }
    }

    fn send(&mut self, command: &str) -> Result<(), String> {
        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or("无法连接本地服务控制通道。")?;
        writeln!(stdin, "{command}").map_err(display)
    }

    fn restore_ui(&mut self, changes: &[UiChange]) -> Result<(), String> {
        if changes.is_empty() {
            return Ok(());
        }
        let id = Uuid::new_v4().simple();
        let payload = serde_json::to_string(changes).map_err(display)?;
        self.send(&format!("restore-ui {id} {payload}"))?;
        let saved = format!("QINGZHOU_UI_SAVED {id}");
        let failed = format!("QINGZHOU_UI_FAILED {id}");
        let deadline = Instant::now() + START_TIMEOUT;
        while let Ok(event) = self
            .events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            if event == saved {
                return Ok(());
            }
            if event == failed {
                break;
            }
        }
        Err("断线期间的草稿或偏好暂时无法保存。请检查数据目录后重新连接。".into())
    }

    fn wait_for(&self, expected: &str, timeout: Duration) -> Result<(), String> {
        match self.events.recv_timeout(timeout) {
            Ok(event) if event == expected => Ok(()),
            Ok(event) if event == "QINGZHOU_FLUSH_FAILED" => {
                Err("无法保存当前工作。请检查数据目录权限后重试。".into())
            }
            _ => Err("本地服务未能及时响应。请查看日志后重试。".into()),
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        // EOF prompts the sidecar to flush if the desktop closes unexpectedly.
        drop(self.child.stdin.take());
        let _ = self.child.try_wait();
    }
}

fn service_command(app: &AppHandle) -> Result<Command, String> {
    let exe = std::env::current_exe().map_err(display)?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let development = cfg!(debug_assertions) && std::env::var_os("QINGZHOU_DEV_ENTRY").is_some();
    let runtime = if development {
        None
    } else {
        Some(app.path().resource_dir().map_err(display)?.join("runtime"))
    };
    let node = match runtime.as_ref() {
        Some(directory) => directory.join("bin").join(node_name),
        None => dev_path("QINGZHOU_DEV_NODE")?,
    };
    let mut command = Command::new(&node);
    crate::proxy::apply_system_proxy(&mut command);
    command
        .env("QINGZHOU_NODE_BIN", &node)
        .env("QINGZHOU_EXEC_PATH", &exe)
        .env("QINGZHOU_APP_PATH", app_path(&exe))
        .env("QINGZHOU_DESKTOP", "1")
        .env("QINGZHOU_TAURI", "1")
        .env("QINGZHOU_VERSION", app.package_info().version.to_string())
        .env("NODE_ENV", "production")
        .env("HOST", "127.0.0.1")
        .env(
            "QINGZHOU_LEGACY_PORT",
            std::env::var_os("PORT").unwrap_or_default(),
        )
        .env("PORT", "0");

    if let Some(runtime) = runtime {
        let service = runtime.join("service.mjs");
        let web = runtime.join("web");
        let approval = runtime.join("approval.ts");
        let pi = runtime.join("pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
        for (file, name) in [
            (&node, "Node 运行时"),
            (&service, "本地服务入口"),
            (&web.join("index.html"), "工作台页面"),
            (&approval, "审批扩展"),
            (&pi, "Pi 运行时"),
        ] {
            if !file.is_file() {
                return Err(format!("安装资源缺失：{name}。请检查安装包后重试。"));
            }
        }
        command
            .arg(service)
            .env("QINGZHOU_WEB_DIST", web)
            .env("QINGZHOU_APPROVAL_EXTENSION", approval)
            .env("QINGZHOU_PI_ENTRY", pi)
            .env("QINGZHOU_PI_TOOLS", runtime.join("tools"))
            .env("QINGZHOU_PI_BUNDLED", "1");
    } else {
        command
            .arg(dev_path("QINGZHOU_DEV_ENTRY")?)
            .env("QINGZHOU_WEB_DIST", dev_path("QINGZHOU_DEV_WEB_DIST")?)
            .env(
                "QINGZHOU_APPROVAL_EXTENSION",
                dev_path("QINGZHOU_DEV_APPROVAL")?,
            );
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    Ok(command)
}

fn dev_path(key: &str) -> Result<PathBuf, String> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .ok_or_else(|| format!("桌面开发入口缺少 {key}。"))
}

fn app_path(exe: &std::path::Path) -> &std::path::Path {
    if cfg!(target_os = "macos") {
        if let Some(bundle) = exe
            .ancestors()
            .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        {
            return bundle;
        }
    }
    exe
}

pub fn log_location(app: &AppHandle) -> Result<PathBuf, String> {
    let path = match std::env::var_os("QINGZHOU_DESKTOP_LOG_DIR") {
        Some(path) => PathBuf::from(path),
        None => app.path().app_log_dir().map_err(display)?,
    };
    create_dir_all(&path).map_err(display)?;
    Ok(path)
}

fn bootstrap_url(origin: &Url, ticket: &str) -> Url {
    let mut url = origin.clone();
    url.set_path("/_desktop/bootstrap");
    url.query_pairs_mut().append_pair("ticket", ticket);
    url
}

fn display(error: impl std::fmt::Display) -> String {
    error.to_string()
}
