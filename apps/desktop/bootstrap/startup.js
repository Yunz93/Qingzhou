/* global document, window */
const statusText = document.getElementById("status");
const actions = document.getElementById("actions");

async function start() {
  actions.hidden = true;
  statusText.textContent = "正在启动本地服务…";
  try {
    await window.__TAURI_INTERNALS__.invoke("start_workbench");
  } catch (error) {
    statusText.textContent = String(error);
    actions.hidden = false;
  }
}

document.getElementById("retry").addEventListener("click", start);
document.getElementById("logs").addEventListener("click", async () => {
  try {
    await window.__TAURI_INTERNALS__.invoke("open_logs");
  } catch (error) {
    statusText.textContent = String(error);
  }
});

void start();
