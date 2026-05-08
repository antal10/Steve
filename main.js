const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

const ChatGPTAgent = require("./agents/chatgpt-agent");
const ClaudeAgent = require("./agents/claude-agent");
const PerplexityAgent = require("./agents/perplexity-agent");
const GeminiAgent = require("./agents/gemini-agent");
const CopilotAgent = require("./agents/copilot-agent");
const MetaAgent = require("./agents/meta-agent");
const GrokAgent = require("./agents/grok-agent");
const Pipeline = require("./council/pipeline");
const { saveRun } = require("./council/run-store");
const {
  assertNoLegacyRepoRuntimeDirs,
  assertPathInsideUserDataRoot,
  configureRuntimePaths,
  getConfigDir,
  getLogsDir,
  getProviderProfileDir,
  getUserDataRoot,
} = require("./runtime/runtime-paths");

const APP_NAME = "SteveApp";
const TOKEN_LIKE_PATTERN = /\b(?:eyJ[A-Za-z0-9._-]{10,}|[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{40,})\b/g;

let mainWindow;
let activePipeline = null;
let appLogFilePath = null;
let appLogWriteFailed = false;

app.setName(APP_NAME);
if (!process.env.STEVE_USER_DATA_ROOT && String(process.env.STEVE_ENV || "").toLowerCase() !== "test") {
  const localAppData = String(process.env.LOCALAPPDATA || "").trim();
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is unavailable. Steve requires a Windows local app data root.");
  }

  app.setPath("userData", path.join(localAppData, APP_NAME));
}
const configuredUserDataRoot = configureRuntimePaths({
  app,
  projectRoot: __dirname,
  userDataRoot: String(process.env.STEVE_USER_DATA_ROOT || "").trim() || undefined,
});
app.setPath("userData", configuredUserDataRoot);

function sanitizeLogMessage(message) {
  return String(message || "")
    .replace(/((?:set-)?cookie\s*[:=]\s*)([^\r\n]+)/gi, "$1[REDACTED]")
    .replace(/((?:authorization|x-api-key)\s*[:=]\s*)([^\r\n]+)/gi, "$1[REDACTED]")
    .replace(/\b(bearer)\s+[A-Za-z0-9._~+/-]+\b/gi, "$1 [REDACTED]")
    .replace(/\b((?:session(?:id)?|sid|access_token|refresh_token|id_token|token)\s*[:=]\s*)([^\s,;]+)/gi, "$1[REDACTED]")
    .replace(TOKEN_LIKE_PATTERN, "[REDACTED_TOKEN]");
}

function buildAppLogFilePath() {
  return assertPathInsideUserDataRoot(
    path.join(getLogsDir(), "steve-live.log"),
    "main process log file"
  );
}

function writeAppLog(level, message) {
  const sanitizedMessage = sanitizeLogMessage(message);
  const line = `${new Date().toISOString()} [${level}] ${sanitizedMessage}`;

  if (appLogFilePath) {
    try {
      fs.appendFileSync(appLogFilePath, `${line}${os.EOL}`, "utf-8");
    } catch (err) {
      if (!appLogWriteFailed) {
        appLogWriteFailed = true;
        console.error(
          `${new Date().toISOString()} [ERROR] Failed to append Steve live log file: ${err.message}`
        );
      }
    }
  }

  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }

  return sanitizedMessage;
}

function relayLogToRenderer(message, level = "INFO") {
  const sanitizedMessage = writeAppLog(level, message);
  sendToRenderer("steve-log", sanitizedMessage);
}

function initializeRuntimeState() {
  const electronSessionDataDir = assertPathInsideUserDataRoot(
    path.join(getConfigDir(), "electron-session"),
    "Electron session data directory"
  );
  fs.mkdirSync(electronSessionDataDir, { recursive: true });
  app.setPath("sessionData", electronSessionDataDir);

  const logsDir = getLogsDir();
  app.setAppLogsPath(logsDir);
  appLogFilePath = buildAppLogFilePath();

  assertNoLegacyRepoRuntimeDirs();
  writeAppLog("INFO", `Steve runtime state initialized under ${getUserDataRoot()}.`);
}

function createAgent(handle) {
  const profileDir = getProviderProfileDir(handle);

  switch (handle) {
    case "o3":
      return new ChatGPTAgent({
        handle: "o3",
        name: "ChatGPT o3-pro",
        siteUrl: "https://chatgpt.com",
        sessionsDir: profileDir,
        model: "o3-pro",
      });
    case "claude":
      return new ClaudeAgent({ sessionsDir: profileDir });
    case "sonar":
      return new PerplexityAgent({ sessionsDir: profileDir });
    case "gemini":
      return new GeminiAgent({ sessionsDir: profileDir });
    case "copilot":
      return new CopilotAgent({ sessionsDir: profileDir });
    case "meta":
      return new MetaAgent({ sessionsDir: profileDir });
    case "grok":
      return new GrokAgent({ sessionsDir: profileDir });
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

async function bootApplication() {
  try {
    initializeRuntimeState();
    createWindow();
  } catch (err) {
    writeAppLog("ERROR", `Startup failed: ${err.message}`);
    throw err;
  }
}

app.whenReady()
  .then(bootApplication)
  .catch(() => {
    app.exit(1);
  });

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
    relayLogToRenderer("[Steve] A council run is already in progress.", "WARN");
    return { error: "Run already in progress" };
  }

  writeAppLog("INFO", `[Steve] Council convened with ${agentHandles.length} agents.`);

  const agents = [];
  for (const handle of agentHandles) {
    try {
      agents.push(createAgent(handle));
    } catch (err) {
      writeAppLog("ERROR", `[Steve] Failed to create agent ${handle}: ${err.message}`);
    }
  }

  if (agents.length === 0) {
    relayLogToRenderer("[Steve] No valid agents to run.", "ERROR");
    return { error: "No valid agents" };
  }

  const pipeline = new Pipeline({
    agents,
    onPost: (post) => sendToRenderer("post-arrived", post),
    onLog: (line) => relayLogToRenderer(line),
    onMinutes: (minutes) => sendToRenderer("minutes-ready", minutes),
    onStageChange: (stage) => sendToRenderer("stage-changed", stage),
    onPauseForResume: () => sendToRenderer("pause-for-resume"),
  });

  activePipeline = pipeline;

  try {
    const runData = await pipeline.run(prompt);

    try {
      const filename = saveRun(runData);
      relayLogToRenderer(`[Steve] Run saved: ${filename}`);
    } catch (err) {
      relayLogToRenderer(`[Steve] Failed to save run: ${err.message}`, "ERROR");
    }

    return runData;
  } finally {
    activePipeline = null;
  }
});

ipcMain.on("pause-council", () => {
  writeAppLog("INFO", "[Steve] Pause signal received.");
  if (activePipeline) {
    activePipeline.requestPause();
  }
});

ipcMain.on("resume-council", () => {
  writeAppLog("INFO", "[Steve] Resume signal received.");
  if (activePipeline) {
    activePipeline.resume();
  }
});
