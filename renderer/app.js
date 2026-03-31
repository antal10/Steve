(function () {
  "use strict";

  const AGENT_COLORS = {
    o3: "#10a37f",
    gemini: "#4285f4",
    copilot: "#00a4ef",
    claude: "#d97706",
    sonar: "#1da1f2",
    meta: "#2563eb",
    grok: "#111827",
  };

  const viewControl = document.getElementById("view-control");
  const viewThread = document.getElementById("view-thread");
  const promptInput = document.getElementById("prompt-input");
  const chipContainer = document.getElementById("agent-chips");
  const stageBar = document.getElementById("stage-bar");
  const btnRun = document.getElementById("btn-run");
  const btnPause = document.getElementById("btn-pause");
  const btnResume = document.getElementById("btn-resume");
  const btnThread = document.getElementById("btn-thread");
  const runStatus = document.getElementById("run-status");
  const logStrip = document.getElementById("log-strip");
  const btnBack = document.getElementById("btn-back");
  const btnCopy = document.getElementById("btn-copy");
  const rootPost = document.getElementById("root-post");
  const rootContent = document.getElementById("root-content");
  const rootTimestamp = document.getElementById("root-timestamp");
  const postsArea = document.getElementById("posts-area");
  const minutesCard = document.getElementById("minutes-card");
  const minutesContent = document.getElementById("minutes-content");

  let runActive = false;
  let waitingForResume = false;
  let pauseRequested = false;
  let currentPrompt = "";
  let currentPosts = [];
  let currentMinutes = null;

  function isBusy() {
    return runActive || waitingForResume;
  }

  function showView(view) {
    viewControl.classList.remove("active");
    viewThread.classList.remove("active");
    view.classList.add("active");
  }

  function updateStatus(text) {
    runStatus.textContent = text;
  }

  function syncControls() {
    const threadAvailable = Boolean(currentPrompt || currentPosts.length || currentMinutes);

    promptInput.disabled = isBusy();
    btnRun.disabled = isBusy();
    btnPause.disabled = !runActive || waitingForResume || pauseRequested;
    btnResume.disabled = !waitingForResume;
    btnThread.disabled = !threadAvailable;
  }

  function setStage(stageName) {
    const items = stageBar.querySelectorAll(".stage-item");
    let reachedActive = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemStage = item.dataset.stage;
      item.classList.remove("active", "completed");

      if (itemStage === stageName) {
        item.classList.add("active");
        reachedActive = true;
      } else if (!reachedActive) {
        item.classList.add("completed");
      }
    }
  }

  function appendLog(line) {
    const el = document.createElement("div");
    el.className = "log-line";

    const match = line.match(/^\[(@?\w+)\]/);
    if (match) {
      const handle = match[1].replace("@", "");
      const span = document.createElement("span");
      span.className = "log-handle";
      span.style.color = AGENT_COLORS[handle] || "inherit";
      span.textContent = match[0];
      el.appendChild(span);
      el.appendChild(document.createTextNode(line.slice(match[0].length)));
    } else {
      el.textContent = line;
    }

    logStrip.appendChild(el);
    logStrip.scrollTop = logStrip.scrollHeight;
  }

  function formatTime(isoString) {
    try {
      return new Date(isoString).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  function getSelectedAgents() {
    const chips = chipContainer.querySelectorAll(".agent-chip.active");
    const agents = [];
    for (let i = 0; i < chips.length; i++) {
      agents.push(chips[i].dataset.agent);
    }
    return agents;
  }

  function resetRunView(prompt) {
    currentPrompt = prompt;
    currentPosts = [];
    currentMinutes = null;

    postsArea.innerHTML = "";
    minutesCard.style.display = "none";
    minutesContent.innerHTML = "";
    logStrip.innerHTML = "";

    rootContent.textContent = prompt;
    rootTimestamp.textContent = formatTime(new Date().toISOString());
    rootPost.style.display = "block";

    syncControls();
  }

  function renderPost(post) {
    currentPosts.push(post);
    syncControls();

    const card = document.createElement("div");
    card.className = "post-card";

    const meta = document.createElement("div");
    meta.className = "post-meta";

    const badge = document.createElement("span");
    badge.className = "post-badge";
    const handle = post.author.replace("@", "");
    badge.style.setProperty("--agent-color", AGENT_COLORS[handle] || "#64748b");
    badge.textContent = post.author;

    const ts = document.createElement("span");
    ts.className = "post-timestamp";
    ts.textContent = formatTime(post.timestamp);

    const wc = document.createElement("span");
    wc.className = "post-word-count";
    wc.textContent = `${post.word_count} words`;

    meta.appendChild(badge);
    meta.appendChild(ts);
    meta.appendChild(wc);
    card.appendChild(meta);

    if (post.reply_to) {
      const replyTag = document.createElement("div");
      replyTag.className = "post-reply-tag";
      replyTag.textContent = `Replying to ${post.reply_to}`;
      card.appendChild(replyTag);
    }

    const content = document.createElement("div");
    content.className = "post-content";
    content.textContent = post.content;
    card.appendChild(content);

    postsArea.appendChild(card);
  }

  function renderListSection(title, items) {
    let html = `<h4>${title}</h4><ul>`;

    if (items.length === 0) {
      html += "<li>No items captured.</li>";
    } else {
      items.forEach(function (item) {
        html += `<li>${escapeHtml(item)}</li>`;
      });
    }

    html += "</ul>";
    return html;
  }

  function renderMinutes(minutes) {
    currentMinutes = minutes;
    syncControls();

    let html = "";
    html += renderListSection("Points of Agreement", minutes.points_of_agreement || []);
    html += renderListSection("Points of Disagreement", minutes.points_of_disagreement || []);
    html += renderListSection("Unresolved Questions", minutes.unresolved_questions || []);
    html += "<h4>Recommended Next Action</h4>";
    html += `<div class="next-action">${escapeHtml(minutes.recommended_next_action || "N/A")}</div>`;

    const level = minutes.consensus_level || "unresolved";
    html += `<div><span class="consensus-badge ${level}">Consensus: ${escapeHtml(level)}</span></div>`;

    minutesContent.innerHTML = html;
    minutesCard.style.display = "block";
  }

  function buildCopyText() {
    let text = "COUNCIL THREAD\n";
    text += `Prompt: ${currentPrompt}\n`;
    text += `${"=".repeat(60)}\n\n`;

    currentPosts.forEach(function (post) {
      if (post.reply_to) {
        text += `${post.author} (replying to ${post.reply_to}):\n`;
      } else {
        text += `${post.author} (${post.stage}):\n`;
      }
      text += `${post.content}\n\n`;
    });

    if (currentMinutes) {
      text += `${"=".repeat(60)}\n`;
      text += "MEETING MINUTES\n\n";
      text += "Points of Agreement:\n";
      (currentMinutes.points_of_agreement || []).forEach(function (item) {
        text += `- ${item}\n`;
      });
      text += "\nPoints of Disagreement:\n";
      (currentMinutes.points_of_disagreement || []).forEach(function (item) {
        text += `- ${item}\n`;
      });
      text += "\nUnresolved Questions:\n";
      (currentMinutes.unresolved_questions || []).forEach(function (item) {
        text += `- ${item}\n`;
      });
      text += `\nRecommended Next Action:\n${currentMinutes.recommended_next_action || "N/A"}\n`;
      text += `\nConsensus: ${currentMinutes.consensus_level || "unresolved"}\n`;
    }

    return text;
  }

  chipContainer.addEventListener("click", function (event) {
    const chip = event.target.closest(".agent-chip");
    if (!chip || isBusy()) {
      return;
    }
    chip.classList.toggle("active");
  });

  btnBack.addEventListener("click", function () {
    showView(viewControl);
  });

  btnThread.addEventListener("click", function () {
    if (!btnThread.disabled) {
      showView(viewThread);
    }
  });

  btnCopy.addEventListener("click", function () {
    navigator.clipboard.writeText(buildCopyText()).then(function () {
      const original = btnCopy.textContent;
      btnCopy.textContent = "Copied!";
      setTimeout(function () {
        btnCopy.textContent = original;
      }, 1500);
    });
  });

  btnRun.addEventListener("click", async function () {
    const prompt = promptInput.value.trim();
    if (!prompt) {
      appendLog("[Steve] Enter a prompt before starting a run.");
      return;
    }

    const agents = getSelectedAgents();
    if (agents.length === 0) {
      appendLog("[Steve] Select at least one agent.");
      return;
    }

    runActive = true;
    waitingForResume = false;
    pauseRequested = false;
    resetRunView(prompt);
    setStage("broadcasting");
    updateStatus("Running");
    appendLog(`[Steve] Council convened - ${agents.length} agents active.`);
    syncControls();

    try {
      const result = await window.steve.runCouncil(prompt, agents);
      if (result && result.error) {
        appendLog(`[Steve] ${result.error}`);
        setStage("idle");
        updateStatus("Ready");
      } else {
        updateStatus("Complete");
      }
    } catch (err) {
      appendLog(`[Steve] Error: ${err.message}`);
      setStage("idle");
      updateStatus("Ready");
    } finally {
      runActive = false;
      waitingForResume = false;
      pauseRequested = false;
      syncControls();
    }
  });

  btnPause.addEventListener("click", function () {
    if (!runActive || waitingForResume || pauseRequested) {
      return;
    }

    pauseRequested = true;
    updateStatus("Pause requested");
    appendLog("[Steve] Pause requested. Waiting for the next checkpoint.");
    window.steve.pauseCouncil();
    syncControls();
  });

  btnResume.addEventListener("click", function () {
    if (!waitingForResume) {
      return;
    }

    waitingForResume = false;
    runActive = true;
    updateStatus("Resuming");
    window.steve.resumeCouncil();
    syncControls();
  });

  window.steve.onPostArrived(function (post) {
    renderPost(post);
  });

  window.steve.onMinutesReady(function (minutes) {
    renderMinutes(minutes);
    updateStatus("Minutes ready");
  });

  window.steve.onLog(function (line) {
    appendLog(line);
  });

  window.steve.onStageChanged(function (stage) {
    setStage(stage);
    if (stage === "broadcasting") {
      updateStatus("Broadcasting");
    } else if (stage === "collecting") {
      updateStatus("Collecting");
    } else if (stage === "deliberating") {
      updateStatus("Deliberating");
    } else if (stage === "minutes") {
      updateStatus("Generating minutes");
    }
  });

  window.steve.onPauseForResume(function () {
    pauseRequested = false;
    waitingForResume = true;
    runActive = false;
    updateStatus("Paused");
    syncControls();
  });

  setStage("idle");
  updateStatus("Ready");
  syncControls();
})();
