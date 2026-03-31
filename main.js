const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Steve — AI Council",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Stubs ──────────────────────────────────────────────

ipcMain.handle("run-council", async (_event, { prompt, agents }) => {
  // TODO: Stage 1–4 pipeline
  // 1. Broadcast prompt to active agents via Playwright
  // 2. Collect opening statements
  // 3. Run cross-deliberation round
  // 4. Generate meeting minutes
  console.log(`[Steve] Council convened — prompt: "${prompt}", agents: ${agents}`);
  return { status: "not-implemented" };
});
