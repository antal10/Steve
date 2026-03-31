const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const ChatGPTAgent = require("./agents/chatgpt-agent");
const ClaudeAgent = require("./agents/claude-agent");
const PerplexityAgent = require("./agents/perplexity-agent");
const CodexAgent = require("./agents/codex-agent");
const Pipeline = require("./council/pipeline");
const { saveRun } = require("./council/run-store");

const SESSIONS_DIR = path.join(__dirname, "sessions");

let mainWindow;

/* ── Agent factory ──────────────────────────────────────── */

function createAgent(handle) {
  switch (handle) {
    case "o3":
      return new ChatGPTAgent({
        handle: "o3",
        name: "ChatGPT o3-pro",
        siteUrl: "https://chatgpt.com",
        sessionsDir: SESSIONS_DIR,
        model: "o3-pro",
      });
    case "claude":
      return new ClaudeAgent({ sessionsDir: SESSIONS_DIR });
    case "sonar":
      return new PerplexityAgent({ sessionsDir: SESSIONS_DIR });
    case "codex":
      return new CodexAgent({ sessionsDir: SESSIONS_DIR });
    default:
      throw new Error(`Unknown agent handle: ${handle}`);
  }
}

/* ── Window ─────────────────────────────────────────────── */

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

/* ── IPC: run-council ───────────────────────────────────── */

ipcMain.handle("run-council", async (_event, { prompt, agents: agentHandles }) => {
  console.log(`[Steve] Council convened — prompt: "${prompt}", agents: ${agentHandles}`);

  // Instantiate agent drivers for selected agents
  const agents = [];
  for (const handle of agentHandles) {
    try {
      agents.push(createAgent(handle));
    } catch (err) {
      console.error(`[Steve] Failed to create agent ${handle}: ${err.message}`);
    }
  }

  if (agents.length === 0) {
    mainWindow.webContents.send("steve-log", "[Steve] No valid agents to run.");
    return { error: "No valid agents" };
  }

  // Create pipeline with IPC-forwarding callbacks
  const pipeline = new Pipeline({
    agents,
    onPost: (post) => {
      mainWindow.webContents.send("post-arrived", post);
    },
    onLog: (line) => {
      mainWindow.webContents.send("steve-log", line);
    },
    onMinutes: (minutes) => {
      mainWindow.webContents.send("minutes-ready", minutes);
    },
    onStageChange: (stage) => {
      mainWindow.webContents.send("stage-changed", stage);
    },
  });

  // Run the full pipeline
  const runData = await pipeline.run(prompt);

  // Persist the run
  try {
    const filename = saveRun(runData);
    mainWindow.webContents.send("steve-log", `[Steve] Run saved: ${filename}`);
  } catch (err) {
    mainWindow.webContents.send("steve-log", `[Steve] Failed to save run: ${err.message}`);
  }

  return runData;
});
