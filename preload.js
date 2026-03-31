const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("steve", {
  runCouncil: (prompt, agents) =>
    ipcRenderer.invoke("run-council", { prompt, agents }),

  pauseCouncil: () =>
    ipcRenderer.send("pause-council"),

  resumeCouncil: () =>
    ipcRenderer.send("resume-council"),

  onPostArrived: (callback) =>
    ipcRenderer.on("post-arrived", (_event, post) => callback(post)),

  onMinutesReady: (callback) =>
    ipcRenderer.on("minutes-ready", (_event, minutes) => callback(minutes)),

  onLog: (callback) =>
    ipcRenderer.on("steve-log", (_event, line) => callback(line)),

  onStageChanged: (callback) =>
    ipcRenderer.on("stage-changed", (_event, stage) => callback(stage)),

  onPauseForResume: (callback) =>
    ipcRenderer.on("pause-for-resume", () => callback()),
});
