const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const ChatGPTAgent = require("./agents/chatgpt-agent");
const ClaudeAgent = require("./agents/claude-agent");
const PerplexityAgent = require("./agents/perplexity-agent");
const GeminiAgent = require("./agents/gemini-agent");
const CopilotAgent = require("./agents/copilot-agent");
const Pipeline = require("./council/pipeline");
const { saveRun } = require("./council/run-store");

const SESSIONS_DIR = path.join(__dirname, "sessions");

let mainWindow;
let activePipeline = null;

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
    case "gemini":
      return new GeminiAgent({ sessionsDir: SESSIONS_DIR });
    case "copilot":
      return new CopilotAgent({ sessionsDir: SESSIONS_DIR });
    default:
      throw new Error(`Unknown agent handle: ${handle}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "Steve - AI Council",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle("run-council", async (_event, { prompt, agents: agentHandles }) => {
  if (activePipeline) {
    sendToRenderer("steve-log", "[Steve] A council run is already in progress.");
    return { error: "Run already in progress" };
  }

  console.log(`[Steve] Council convened - prompt: "${prompt}", agents: ${agentHandles}`);

  const agents = [];
  for (const handle of agentHandles) {
    try {
      agents.push(createAgent(handle));
    } catch (err) {
      console.error(`[Steve] Failed to create agent ${handle}: ${err.message}`);
    }
  }

  if (agents.length === 0) {
    sendToRenderer("steve-log", "[Steve] No valid agents to run.");
    return { error: "No valid agents" };
  }

  const pipeline = new Pipeline({
    agents,
    onPost: (post) => sendToRenderer("post-arrived", post),
    onLog: (line) => sendToRenderer("steve-log", line),
    onMinutes: (minutes) => sendToRenderer("minutes-ready", minutes),
    onStageChange: (stage) => sendToRenderer("stage-changed", stage),
    onPauseForResume: () => sendToRenderer("pause-for-resume"),
  });

  activePipeline = pipeline;

  try {
    const runData = await pipeline.run(prompt);

    try {
      const filename = saveRun(runData);
      sendToRenderer("steve-log", `[Steve] Run saved: ${filename}`);
    } catch (err) {
      sendToRenderer("steve-log", `[Steve] Failed to save run: ${err.message}`);
    }

    return runData;
  } finally {
    activePipeline = null;
  }
});

ipcMain.on("pause-council", () => {
  console.log("[Steve] Pause signal received.");
  if (activePipeline) {
    activePipeline.requestPause();
  }
});

ipcMain.on("resume-council", () => {
  console.log("[Steve] Resume signal received.");
  if (activePipeline) {
    activePipeline.resume();
  }
});
