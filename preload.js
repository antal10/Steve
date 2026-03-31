const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("steve", {
  /** Kick off a full council run. Returns the completed run object. */
  runCouncil: (prompt, agents) =>
    ipcRenderer.invoke("run-council", { prompt, agents }),

  /** Tell the pipeline to resume after the Stage 2 pause. */
  resumeCouncil: () =>
    ipcRenderer.send("resume-council"),

  /** Subscribe to individual posts as they arrive during a run. */
  onPostArrived: (callback) =>
    ipcRenderer.on("post-arrived", (_event, post) => callback(post)),

  /** Subscribe to the final minutes object when Stage 4 completes. */
  onMinutesReady: (callback) =>
    ipcRenderer.on("minutes-ready", (_event, minutes) => callback(minutes)),

  /** Subscribe to Playwright log lines for the live log strip. */
  onLog: (callback) =>
    ipcRenderer.on("steve-log", (_event, line) => callback(line)),

  /** Subscribe to stage changes during the pipeline. */
  onStageChanged: (callback) =>
    ipcRenderer.on("stage-changed", (_event, stage) => callback(stage)),

  /** Subscribe to pause-for-resume signal after Stage 2. */
  onPauseForResume: (callback) =>
    ipcRenderer.on("pause-for-resume", () => callback()),
});
