/* ── Steve V1 — Frontend Logic ──────────────────────────── */

(function () {
  "use strict";

  /* ── Agent color map ──────────────────────────────────── */
  const AGENT_COLORS = {
    o3: "#10a37f",
    claude: "#d97706",
    sonar: "#1da1f2",
    codex: "#8b5cf6",
  };

  /* ── DOM refs ─────────────────────────────────────────── */
  const viewControl = document.getElementById("view-control");
  const viewThread = document.getElementById("view-thread");
  const promptInput = document.getElementById("prompt-input");
  const chipContainer = document.getElementById("agent-chips");
  const stageBar = document.getElementById("stage-bar");
  const btnConvene = document.getElementById("btn-convene");
  const logStrip = document.getElementById("log-strip");
  const btnBack = document.getElementById("btn-back");
  const btnCopy = document.getElementById("btn-copy");
  const rootPost = document.getElementById("root-post");
  const rootContent = document.getElementById("root-content");
  const rootTimestamp = document.getElementById("root-timestamp");
  const postsArea = document.getElementById("posts-area");
  const minutesCard = document.getElementById("minutes-card");
  const minutesContent = document.getElementById("minutes-content");

  /* ── State ────────────────────────────────────────────── */
  let runActive = false;
  let currentPosts = [];
  let currentMinutes = null;
  let currentPrompt = "";

  /* ── View switching ───────────────────────────────────── */
  function showView(view) {
    viewControl.classList.remove("active");
    viewThread.classList.remove("active");
    view.classList.add("active");
  }

  btnBack.addEventListener("click", function () {
    showView(viewControl);
  });

  /* ── Agent chip toggles ───────────────────────────────── */
  chipContainer.addEventListener("click", function (e) {
    const chip = e.target.closest(".agent-chip");
    if (!chip || runActive) return;
    chip.classList.toggle("active");
  });

  function getSelectedAgents() {
    var chips = chipContainer.querySelectorAll(".agent-chip.active");
    var agents = [];
    for (var i = 0; i < chips.length; i++) {
      agents.push(chips[i].dataset.agent);
    }
    return agents;
  }

  /* ── Stage bar updates ────────────────────────────────── */
  const STAGE_ORDER = ["idle", "broadcasting", "collecting", "deliberating", "minutes"];

  function setStage(stageName) {
    var items = stageBar.querySelectorAll(".stage-item");
    var reachedActive = false;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var itemStage = item.dataset.stage;
      item.classList.remove("active", "completed");

      if (itemStage === stageName) {
        item.classList.add("active");
        reachedActive = true;
      } else if (!reachedActive) {
        item.classList.add("completed");
      }
    }
  }

  /* ── Log strip ────────────────────────────────────────── */
  function appendLog(line) {
    var el = document.createElement("div");
    el.className = "log-line";

    var match = line.match(/^\[(@\w+)\]/);
    if (match) {
      var handle = match[1].slice(1);
      var span = document.createElement("span");
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

  /* ── Post rendering ───────────────────────────────────── */
  function renderPost(post) {
    currentPosts.push(post);

    var card = document.createElement("div");
    card.className = "post-card";

    var meta = document.createElement("div");
    meta.className = "post-meta";

    var badge = document.createElement("span");
    badge.className = "post-badge";
    var handle = post.author.replace("@", "");
    badge.style.setProperty("--agent-color", AGENT_COLORS[handle] || "#64748b");
    badge.textContent = post.author;

    var ts = document.createElement("span");
    ts.className = "post-timestamp";
    ts.textContent = formatTime(post.timestamp);

    var wc = document.createElement("span");
    wc.className = "post-word-count";
    wc.textContent = post.word_count + " words";

    meta.appendChild(badge);
    meta.appendChild(ts);
    meta.appendChild(wc);
    card.appendChild(meta);

    if (post.reply_to) {
      var replyTag = document.createElement("div");
      replyTag.className = "post-reply-tag";
      replyTag.textContent = "\u21a9 replying to " + post.reply_to;
      card.appendChild(replyTag);
    }

    var content = document.createElement("div");
    content.className = "post-content";
    content.textContent = post.content;
    card.appendChild(content);

    postsArea.appendChild(card);
    card.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  /* ── Minutes rendering ────────────────────────────────── */
  function renderMinutes(minutes) {
    currentMinutes = minutes;
    var html = "";

    html += "<h4>Points of Agreement</h4><ul>";
    (minutes.points_of_agreement || []).forEach(function (p) {
      html += "<li>" + escapeHtml(p) + "</li>";
    });
    html += "</ul>";

    html += "<h4>Points of Disagreement</h4><ul>";
    (minutes.points_of_disagreement || []).forEach(function (p) {
      html += "<li>" + escapeHtml(p) + "</li>";
    });
    html += "</ul>";

    html += "<h4>Unresolved Questions</h4><ul>";
    (minutes.unresolved_questions || []).forEach(function (p) {
      html += "<li>" + escapeHtml(p) + "</li>";
    });
    html += "</ul>";

    html += "<h4>Recommended Next Action</h4>";
    html += '<div class="next-action">' + escapeHtml(minutes.recommended_next_action || "N/A") + "</div>";

    var level = minutes.consensus_level || "unresolved";
    html += '<div><span class="consensus-badge ' + level + '">Consensus: ' + level + "</span></div>";

    minutesContent.innerHTML = html;
    minutesCard.style.display = "block";
    minutesCard.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  /* ── Copy All ─────────────────────────────────────────── */
  btnCopy.addEventListener("click", function () {
    var text = "COUNCIL THREAD\n";
    text += "Prompt: " + currentPrompt + "\n";
    text += "═".repeat(60) + "\n\n";

    currentPosts.forEach(function (post) {
      if (post.reply_to) {
        text += post.author + " (replying to " + post.reply_to + "):\n";
      } else {
        text += post.author + " (" + post.stage + "):\n";
      }
      text += post.content + "\n\n";
    });

    if (currentMinutes) {
      text += "═".repeat(60) + "\n";
      text += "MEETING MINUTES\n\n";
      text += "Points of Agreement:\n";
      (currentMinutes.points_of_agreement || []).forEach(function (p) { text += "  • " + p + "\n"; });
      text += "\nPoints of Disagreement:\n";
      (currentMinutes.points_of_disagreement || []).forEach(function (p) { text += "  • " + p + "\n"; });
      text += "\nUnresolved Questions:\n";
      (currentMinutes.unresolved_questions || []).forEach(function (p) { text += "  • " + p + "\n"; });
      text += "\nRecommended Next Action:\n  " + (currentMinutes.recommended_next_action || "N/A") + "\n";
      text += "\nConsensus: " + (currentMinutes.consensus_level || "unresolved") + "\n";
    }

    navigator.clipboard.writeText(text).then(function () {
      var orig = btnCopy.textContent;
      btnCopy.textContent = "Copied!";
      setTimeout(function () { btnCopy.textContent = orig; }, 1500);
    });
  });

  /* ── Convene Council ──────────────────────────────────── */
  btnConvene.addEventListener("click", async function () {
    var prompt = promptInput.value.trim();
    if (!prompt) return;

    var agents = getSelectedAgents();
    if (agents.length === 0) {
      appendLog("[Steve] No agents selected.");
      return;
    }

    runActive = true;
    btnConvene.disabled = true;
    currentPosts = [];
    currentMinutes = null;
    currentPrompt = prompt;

    postsArea.innerHTML = "";
    minutesCard.style.display = "none";
    logStrip.innerHTML = "";

    rootContent.textContent = prompt;
    rootTimestamp.textContent = formatTime(new Date().toISOString());
    rootPost.style.display = "block";

    setStage("broadcasting");
    appendLog("[Steve] Council convened — " + agents.length + " agents active");

    showView(viewThread);

    try {
      await window.steve.runCouncil(prompt, agents);
      appendLog("[Steve] Council session complete.");
    } catch (err) {
      appendLog("[Steve] Error: " + err.message);
    } finally {
      runActive = false;
      btnConvene.disabled = false;
      setStage("idle");
    }
  });

  /* ── IPC Listeners ────────────────────────────────────── */
  window.steve.onPostArrived(function (post) {
    renderPost(post);
  });

  window.steve.onMinutesReady(function (minutes) {
    renderMinutes(minutes);
  });

  window.steve.onLog(function (line) {
    appendLog(line);
  });

  window.steve.onStageChanged(function (stage) {
    setStage(stage);
  });

  /* ── Helpers ──────────────────────────────────────────── */
  function formatTime(isoString) {
    try {
      var d = new Date(isoString);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (_) {
      return "";
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
