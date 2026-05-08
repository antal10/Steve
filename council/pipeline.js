const crypto = require("crypto");

const { buildDeliberationPrompt, parseDeliberationResponse } = require("./deliberation");
const { buildMinutesPrompt, parseMinutesResponse } = require("./minutes");

const STAGE_SEQUENCE = ["broadcast", "collect", "deliberate", "minutes"];
const UI_STAGE_NAMES = {
  broadcast: "broadcasting",
  collect: "collecting",
  deliberate: "deliberating",
  minutes: "minutes",
};
const MINUTES_SCRIBE_PRIORITY = ["sonar", "meta", "grok", "o3", "gemini", "claude", "copilot"];

function isoNow() {
  return new Date().toISOString();
}

function hashText(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function diffSeconds(startIso, endIso) {
  if (!startIso || !endIso) {
    return 0;
  }

  return Math.max(0, Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000));
}

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

function normalizeErrorMessage(error, fallback) {
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

class Pipeline {
  constructor({ agents, onPost, onLog, onMinutes, onStageChange, onPauseForResume, config = {} }) {
    this.agents = agents;
    this.onPost = onPost || (() => {});
    this.onLog = onLog || (() => {});
    this.onMinutes = onMinutes || (() => {});
    this.onStageChange = onStageChange || (() => {});
    this.onPauseForResume = onPauseForResume || (() => {});
    this.config = {
      write_artifacts: false,
      artifact_root: null,
      run_id: null,
      ...config,
    };

    this._resumeResolve = null;
    this._pauseRequested = false;
    this._enteredStages = [];
    this._dispatchCounter = 1;
    this._postCounter = 1;
    this._dispatchKeys = new Set();
    this._postKeys = new Set();
  }

  log(msg) {
    this.onLog(`[Steve] ${msg}`);
  }

  requestPause() {
    if (this._resumeResolve || this._pauseRequested) {
      return;
    }

    this._pauseRequested = true;
    this.log("Pause requested. Steve will pause at the next safe checkpoint.");
  }

  resume() {
    if (this._resumeResolve) {
      const resolve = this._resumeResolve;
      this._resumeResolve = null;
      this._pauseRequested = false;
      resolve();
    }
  }

  async run(prompt) {
    const startTime = Date.now();
    const run = this._createRunObject(prompt, startTime);
    let liveAgents = [];

    for (const agent of this.agents) {
      agent.onLog = (msg) => this.onLog(msg);
    }

    try {
      await this._runBroadcastStage(run, prompt);
      liveAgents = this.agents.filter((agent) => {
        const record = run.agent_statuses[agent.handle];
        return record.launch.status === "completed";
      });

      if (!liveAgents.length) {
        this.log("No agents launched successfully. Aborting.");
        return this._finalizeRun(run, startTime);
      }

      const openingAgents = await this._runCollectStage(run, prompt);

      if (openingAgents.length < 2) {
        this.log("Fewer than 2 agents produced opening statements. Deliberation and minutes will be skipped.");
        this._markStageSkipped(run, "deliberate", "Insufficient opening statements.");
        this._markStageSkipped(run, "minutes", "Insufficient opening statements.");
        return this._finalizeRun(run, startTime);
      }

      await this._pauseIfRequested("Paused after opening statements. Click Resume to start deliberation.");
      await this._runDeliberationStage(run, prompt, openingAgents);

      await this._pauseIfRequested("Paused after deliberation. Click Resume to generate minutes.");
      await this._runMinutesStage(run, prompt, openingAgents);

      return this._finalizeRun(run, startTime);
    } finally {
      if (liveAgents.length > 0) {
        await this._closeAgents(liveAgents);
      }
      this._resumeResolve = null;
      this._pauseRequested = false;
      this._enteredStages = [];
      this._dispatchKeys.clear();
      this._postKeys.clear();
    }
  }

  async _runBroadcastStage(run, prompt) {
    this._beginStage(run, "broadcast");
    this.log("Stage 1 - Broadcasting prompt to all agents...");

    const launchResults = await Promise.allSettled(
      this.agents.map((agent) => this._launchAgent(run, agent))
    );

    const launchedAgents = [];
    for (let i = 0; i < launchResults.length; i++) {
      if (launchResults[i].status === "fulfilled" && launchResults[i].value) {
        launchedAgents.push(launchResults[i].value);
      }
    }

    const sendResults = await Promise.allSettled(
      launchedAgents.map((agent) => this._dispatchPrompt(run, agent, "opening", prompt, { round: 0 }))
    );

    let sentCount = 0;
    for (let i = 0; i < sendResults.length; i++) {
      if (sendResults[i].status === "fulfilled" && sendResults[i].value) {
        sentCount++;
      }
    }

    const stageStatus = sentCount === 0
      ? "failed"
      : sentCount === this.agents.length
        ? "completed"
        : "partial";

    this._finishStage(run, "broadcast", stageStatus);
  }

  async _runCollectStage(run) {
    this._beginStage(run, "collect");
    this.log("Stage 2 - Collecting opening statements...");

    const candidates = this.agents.filter((agent) => {
      const record = run.agent_statuses[agent.handle];
      return record.opening.status === "sent";
    });

    const collectResults = await Promise.allSettled(
      candidates.map((agent) => this._collectOpening(run, agent))
    );

    const openingAgents = [];
    for (const result of collectResults) {
      if (result.status === "fulfilled" && result.value) {
        openingAgents.push(result.value);
      }
    }

    const completedCount = openingAgents.length;
    const stageStatus = completedCount === 0
      ? "failed"
      : completedCount === candidates.length
        ? "completed"
        : "partial";

    this._finishStage(run, "collect", stageStatus);
    return openingAgents;
  }

  async _runDeliberationStage(run, prompt, openingAgents) {
    this._beginStage(run, "deliberate");
    this.log("Stage 3 - Deliberation (cross-replies)...");

    const expectedPairs = [];
    for (const agent of openingAgents) {
      for (const otherAgent of openingAgents) {
        if (agent.handle !== otherAgent.handle) {
          expectedPairs.push({
            from: `@${agent.handle}`,
            to: `@${otherAgent.handle}`,
          });
        }
      }
    }

    const results = await Promise.allSettled(
      openingAgents.map((agent) => this._runDeliberationForAgent(run, agent, prompt, openingAgents))
    );

    const successfulAgents = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        successfulAgents.push(result.value);
      }
    }

    const actualPairs = run.posts
      .filter((post) => post.stage === "deliberation")
      .map((post) => ({
        from: post.author,
        to: post.reply_to,
        post_id: post.post_id,
      }));

    const actualPairSet = new Set(actualPairs.map((pair) => `${pair.from}->${pair.to}`));
    const missingPairs = expectedPairs.filter((pair) => !actualPairSet.has(`${pair.from}->${pair.to}`));

    run.deliberation = {
      rounds: 1,
      participants: openingAgents.map((agent) => `@${agent.handle}`),
      expected_reply_count: expectedPairs.length,
      actual_reply_count: actualPairs.length,
      expected_pairs: expectedPairs,
      actual_pairs: actualPairs,
      missing_pairs: missingPairs,
    };

    const stageStatus = actualPairs.length === 0
      ? "failed"
      : missingPairs.length > 0 || successfulAgents.length < openingAgents.length
        ? "partial"
        : "completed";

    this._finishStage(run, "deliberate", stageStatus);
  }

  async _runMinutesStage(run, prompt, openingAgents) {
    this._beginStage(run, "minutes");
    this.log("Stage 4 - Generating meeting minutes...");

    const minutesAgent = this._chooseMinutesAgent(openingAgents);
    if (!minutesAgent) {
      this._markStageSkipped(run, "minutes", "No eligible minutes agent.");
      return;
    }

    for (const agent of this.agents) {
      const record = run.agent_statuses[agent.handle];
      record.minutes.role = agent.handle === minutesAgent.handle ? "scribe" : "not_selected";
      if (agent.handle !== minutesAgent.handle && record.minutes.status === "pending") {
        record.minutes.status = "skipped";
        record.minutes.completed_at = isoNow();
        record.minutes.skip_reason = "Another agent served as scribe.";
      }
    }

    const activeHandles = openingAgents.map((agent) => agent.handle);
    const minutesPrompt = buildMinutesPrompt(prompt, run.posts, activeHandles);
    const scribeRecord = run.agent_statuses[minutesAgent.handle];

    try {
      const dispatch = await this._dispatchPrompt(run, minutesAgent, "minutes", minutesPrompt, { round: 0 });
      if (!dispatch) {
        scribeRecord.minutes.status = "failed";
        scribeRecord.minutes.completed_at = isoNow();
        scribeRecord.minutes.error = "Minutes prompt could not be sent.";
        run.minutes = {
          generated_by: `@${minutesAgent.handle}`,
          attendees: activeHandles.map((handle) => `@${handle}`),
          points_of_agreement: [],
          points_of_disagreement: [],
          unresolved_questions: [],
          recommended_next_action: "",
          consensus_level: "unresolved",
          raw_minutes_text: "",
          raw_response_text: "",
          parse_status: "raw_fallback",
          status: "failed",
          source_dispatch_id: null,
          source_post_id: null,
        };
        this.onMinutes(run.minutes);
        this._finishStage(run, "minutes", "failed");
        return;
      }

      const waitResult = await minutesAgent.waitForResponse();
      const capturedText = await minutesAgent.getResponse();
      const finishedAt = isoNow();

      scribeRecord.minutes.completed_at = finishedAt;
      scribeRecord.minutes.response_status = waitResult.status;
      scribeRecord.minutes.raw_response_text = capturedText;

      if (!capturedText) {
        scribeRecord.minutes.status = "failed";
        scribeRecord.minutes.error = "Minutes response was empty.";
        this._recordFailure(run, minutesAgent, "minutes", "collect", "Minutes response was empty.");

        run.minutes = {
          generated_by: `@${minutesAgent.handle}`,
          attendees: activeHandles.map((handle) => `@${handle}`),
          points_of_agreement: [],
          points_of_disagreement: [],
          unresolved_questions: [],
          recommended_next_action: "",
          consensus_level: "unresolved",
          raw_minutes_text: "",
          raw_response_text: "",
          parse_status: "raw_fallback",
          status: "failed",
          source_dispatch_id: dispatch.dispatch_id,
          source_post_id: null,
        };

        this._finishStage(run, "minutes", "failed");
        this.onMinutes(run.minutes);
        return;
      }

      const minutes = parseMinutesResponse(capturedText, minutesAgent.handle, activeHandles);
      const post = this._appendPost(run, {
        author: `@${minutesAgent.handle}`,
        stage: "minutes",
        type: "minutes",
        reply_to: null,
        timestamp: finishedAt,
        latency_seconds: diffSeconds(scribeRecord.minutes.started_at, finishedAt),
        content: minutes.raw_minutes_text,
        raw_content: capturedText,
        word_count: countWords(minutes.raw_minutes_text),
        capture_status: waitResult.status,
        source_dispatch_id: dispatch.dispatch_id,
      }, { emit: false });

      const hasStructuredMinutes = minutes.parse_status !== "raw_fallback";
      const hasAnyStructuredField =
        minutes.points_of_agreement.length > 0
        || minutes.points_of_disagreement.length > 0
        || minutes.unresolved_questions.length > 0
        || Boolean(minutes.recommended_next_action);
      const minutesStatus = hasStructuredMinutes && (hasAnyStructuredField || minutes.raw_minutes_text)
        ? (waitResult.status === "partial" ? "partial" : "completed")
        : "partial";

      if (minutesStatus !== "completed") {
        this._recordFailure(
          run,
          minutesAgent,
          "minutes",
          "parse",
          "Minutes response did not fully satisfy the structured schema."
        );
      }

      scribeRecord.minutes.status = minutesStatus;
      scribeRecord.minutes.post_id = post ? post.post_id : null;
      scribeRecord.minutes.parse_status = minutes.parse_status;
      scribeRecord.minutes.source_dispatch_id = dispatch.dispatch_id;

      run.minutes = {
        ...minutes,
        status: minutesStatus,
        source_dispatch_id: dispatch.dispatch_id,
        source_post_id: post ? post.post_id : null,
      };

      this.onMinutes(run.minutes);
      this.log("Minutes generated.");
      this._finishStage(run, "minutes", minutesStatus);
    } catch (err) {
      const message = normalizeErrorMessage(err, "Minutes generation failed.");
      scribeRecord.minutes.status = "failed";
      scribeRecord.minutes.completed_at = isoNow();
      scribeRecord.minutes.error = message;
      this._recordFailure(run, minutesAgent, "minutes", "send", message);

      run.minutes = {
        generated_by: `@${minutesAgent.handle}`,
        attendees: activeHandles.map((handle) => `@${handle}`),
        points_of_agreement: [],
        points_of_disagreement: [],
        unresolved_questions: [],
        recommended_next_action: "",
        consensus_level: "unresolved",
        raw_minutes_text: "",
        raw_response_text: "",
        parse_status: "raw_fallback",
        status: "failed",
        source_dispatch_id: scribeRecord.minutes.source_dispatch_id || null,
        source_post_id: null,
      };

      this.onMinutes(run.minutes);
      this.log(`Minutes generation failed: ${message}`);
      this._finishStage(run, "minutes", "failed");
    }
  }

  async _launchAgent(run, agent) {
    const record = run.agent_statuses[agent.handle];
    record.launch.started_at = isoNow();

    try {
      await agent.launch();
      record.launch.completed_at = isoNow();
      record.launch.status = "completed";
      return agent;
    } catch (err) {
      const message = normalizeErrorMessage(err, "Failed to launch browser.");
      record.launch.completed_at = isoNow();
      record.launch.status = "failed";
      record.launch.error = message;
      this._recordFailure(run, agent, "broadcast", "launch", message);
      this.log(`Agent @${agent.handle} failed to launch: ${message}`);
      return null;
    }
  }

  async _dispatchPrompt(run, agent, stageKey, prompt, { round }) {
    const record = run.agent_statuses[agent.handle][stageKey];
    record.started_at = record.started_at || isoNow();

    try {
      const dispatchMeta = await agent.sendPrompt(prompt);
      const dispatch = this._recordDispatch(run, agent, stageKey, round, dispatchMeta, null);
      record.status = "sent";
      record.source_dispatch_id = dispatch.dispatch_id;
      return dispatch;
    } catch (err) {
      const dispatch = this._recordDispatch(run, agent, stageKey, round, agent.getLastPromptDispatch(), err);
      const message = normalizeErrorMessage(err, `Failed to send ${stageKey} prompt.`);
      record.status = "failed";
      record.completed_at = isoNow();
      record.error = message;
      record.source_dispatch_id = dispatch ? dispatch.dispatch_id : null;
      this._recordFailure(run, agent, stageKey, "send", message);
      this.log(`${stageKey} send failed for @${agent.handle}: ${message}`);
      return null;
    }
  }

  async _collectOpening(run, agent) {
    const record = run.agent_statuses[agent.handle].opening;
    if (record.status !== "sent") {
      return null;
    }

    try {
      const waitResult = await agent.waitForResponse();
      const capturedText = await agent.getResponse();
      const finishedAt = isoNow();
      record.completed_at = finishedAt;
      record.response_status = waitResult.status;
      record.raw_response_text = capturedText;

      if (!capturedText) {
        record.status = "failed";
        record.error = waitResult.status === "timeout"
          ? "No fresh opening response detected."
          : "Opening response was empty.";
        this._recordFailure(run, agent, "collect", "collect", record.error);
        return null;
      }

      record.status = waitResult.status === "partial" ? "partial" : "completed";

      const post = this._appendPost(run, {
        author: `@${agent.handle}`,
        stage: "opening",
        type: "statement",
        reply_to: null,
        timestamp: finishedAt,
        latency_seconds: diffSeconds(record.started_at, finishedAt),
        content: capturedText,
        raw_content: capturedText,
        word_count: countWords(capturedText),
        capture_status: waitResult.status,
        source_dispatch_id: record.source_dispatch_id,
      });

      record.post_id = post ? post.post_id : null;
      record.word_count = countWords(capturedText);

      if (waitResult.status === "partial") {
        this._recordFailure(run, agent, "collect", "timeout", "Opening response timed out and was recorded as partial.");
      }

      return agent;
    } catch (err) {
      const message = normalizeErrorMessage(err, "Opening response collection failed.");
      record.status = "failed";
      record.completed_at = isoNow();
      record.error = message;
      this._recordFailure(run, agent, "collect", "collect", message);
      return null;
    }
  }

  async _runDeliberationForAgent(run, agent, prompt, openingAgents) {
    const record = run.agent_statuses[agent.handle].deliberation;
    const otherPosts = run.posts.filter((post) => post.stage === "opening" && post.author !== `@${agent.handle}`);
    const otherHandles = otherPosts.map((post) => post.author.replace("@", ""));
    record.expected_targets = otherHandles.map((handle) => `@${handle}`);

    if (!otherPosts.length) {
      record.status = "skipped";
      record.completed_at = isoNow();
      record.skip_reason = "No other opening statements were available.";
      return null;
    }

    const deliberationPrompt = buildDeliberationPrompt(agent.handle, prompt, otherPosts);
    try {
      const dispatch = await this._dispatchPrompt(run, agent, "deliberation", deliberationPrompt, { round: 1 });
      if (!dispatch) {
        return null;
      }

      const waitResult = await agent.waitForResponse();
      const capturedText = await agent.getResponse();
      const finishedAt = isoNow();
      record.completed_at = finishedAt;
      record.response_status = waitResult.status;
      record.raw_response_text = capturedText;

      if (!capturedText) {
        record.status = "failed";
        record.error = "Deliberation response was empty.";
        this._recordFailure(run, agent, "deliberation", "collect", record.error);
        return null;
      }

      const parsed = parseDeliberationResponse(
        agent.handle,
        capturedText,
        otherHandles,
        "p",
        this._postCounter
      );

      record.parse_mode = parsed.parse_mode;
      record.actual_targets = parsed.posts.map((post) => post.reply_to);
      record.missing_targets = parsed.missing_targets.map((handle) => `@${handle}`);

      const postIds = [];
      for (const post of parsed.posts) {
        const appended = this._appendPost(run, {
          ...post,
          raw_content: post.content,
          capture_status: waitResult.status,
          source_dispatch_id: dispatch.dispatch_id,
        });
        if (appended) {
          postIds.push(appended.post_id);
        }
      }

      record.post_ids = postIds;

      if (!postIds.length) {
        record.status = "failed";
        record.error = "Deliberation response could not be mapped to any explicit target.";
        this._recordFailure(run, agent, "deliberation", "parse", record.error);
        return null;
      }

      if (waitResult.status === "partial" || record.missing_targets.length > 0) {
        record.status = "partial";
        if (waitResult.status === "partial") {
          this._recordFailure(run, agent, "deliberation", "timeout", "Deliberation response timed out and was recorded as partial.");
        }
        if (record.missing_targets.length > 0) {
          this._recordFailure(
            run,
            agent,
            "deliberation",
            "parse",
            `Missing explicit replies for ${record.missing_targets.join(", ")}.`
          );
        }
      } else {
        record.status = "completed";
      }

      return agent;
    } catch (err) {
      const message = normalizeErrorMessage(err, "Deliberation failed.");
      record.status = "failed";
      record.completed_at = isoNow();
      record.error = message;
      this._recordFailure(run, agent, "deliberation", "collect", message);
      return null;
    }
  }

  _createRunObject(prompt, startTime) {
    const agentStatuses = {};
    for (const agent of this.agents) {
      agentStatuses[agent.handle] = {
        handle: `@${agent.handle}`,
        name: agent.name,
        session_dir: agent.sessionsDir,
        status: "pending",
        launch: {
          status: "pending",
          started_at: null,
          completed_at: null,
          error: null,
        },
        opening: {
          status: "pending",
          started_at: null,
          completed_at: null,
          response_status: null,
          source_dispatch_id: null,
          post_id: null,
          raw_response_text: "",
          word_count: 0,
          error: null,
        },
        deliberation: {
          status: "pending",
          started_at: null,
          completed_at: null,
          response_status: null,
          source_dispatch_id: null,
          post_ids: [],
          expected_targets: [],
          actual_targets: [],
          missing_targets: [],
          parse_mode: null,
          raw_response_text: "",
          error: null,
        },
        minutes: {
          role: "not_selected",
          status: "pending",
          started_at: null,
          completed_at: null,
          response_status: null,
          source_dispatch_id: null,
          post_id: null,
          parse_status: null,
          raw_response_text: "",
          skip_reason: null,
          error: null,
        },
        failures: [],
      };
    }

    return {
      run_id: "",
      status: "running",
      timestamp: new Date(startTime).toISOString(),
      prompt,
      prompt_sha256: hashText(prompt),
      agents_active: this.agents.map((agent) => `@${agent.handle}`),
      stages_completed: [],
      stage_timestamps: {
        broadcast: { started_at: null, completed_at: null, status: "pending", message: null },
        collect: { started_at: null, completed_at: null, status: "pending", message: null },
        deliberate: { started_at: null, completed_at: null, status: "pending", message: null },
        minutes: { started_at: null, completed_at: null, status: "pending", message: null },
      },
      duration_seconds: 0,
      deliberation_rounds: 1,
      prompt_dispatches: [],
      posts: [],
      minutes: {},
      failures: [],
      agent_statuses: agentStatuses,
      deliberation: {
        rounds: 1,
        participants: [],
        expected_reply_count: 0,
        actual_reply_count: 0,
        expected_pairs: [],
        actual_pairs: [],
        missing_pairs: [],
      },
    };
  }

  _beginStage(run, stage) {
    const expectedStage = STAGE_SEQUENCE[this._enteredStages.length];
    if (expectedStage !== stage) {
      throw new Error(`Stage order violation: expected ${expectedStage}, received ${stage}`);
    }

    this._enteredStages.push(stage);
    run.stage_timestamps[stage].started_at = isoNow();
    run.stage_timestamps[stage].status = "in_progress";
    this.onStageChange(UI_STAGE_NAMES[stage]);
  }

  _finishStage(run, stage, status, message = null) {
    run.stage_timestamps[stage].completed_at = isoNow();
    run.stage_timestamps[stage].status = status;
    run.stage_timestamps[stage].message = message;
    if (!run.stages_completed.includes(stage)) {
      run.stages_completed.push(stage);
    }
  }

  _markStageSkipped(run, stage, message) {
    if (!this._enteredStages.includes(stage)) {
      const expectedStage = STAGE_SEQUENCE[this._enteredStages.length];
      if (expectedStage !== stage) {
        throw new Error(`Stage order violation: expected ${expectedStage}, received ${stage}`);
      }
      this._enteredStages.push(stage);
    }

    run.stage_timestamps[stage].started_at = run.stage_timestamps[stage].started_at || isoNow();
    run.stage_timestamps[stage].completed_at = isoNow();
    run.stage_timestamps[stage].status = "skipped";
    run.stage_timestamps[stage].message = message;
    if (!run.stages_completed.includes(stage)) {
      run.stages_completed.push(stage);
    }

    for (const agent of this.agents) {
      const stageKey = stage === "collect"
        ? "opening"
        : stage === "deliberate"
          ? "deliberation"
          : stage;
      const stageRecord = run.agent_statuses[agent.handle][stageKey];
      if (stageRecord && stageRecord.status === "pending") {
        stageRecord.status = "skipped";
        stageRecord.completed_at = isoNow();
        stageRecord.skip_reason = message;
      }
    }

    if (stage === "minutes") {
      run.minutes = {
        status: "skipped",
        reason: message,
      };
    }
  }

  _recordDispatch(run, agent, stageKey, round, meta, error) {
    const dispatchMeta = meta || {
      timestamp: isoNow(),
      original_text: "",
      original_chars: 0,
      sent_text: "",
      sent_chars: 0,
      truncated: false,
    };
    const dispatchKey = `${stageKey}:${agent.handle}:${round}`;
    if (this._dispatchKeys.has(dispatchKey)) {
      throw new Error(`Duplicate prompt dispatch detected for ${dispatchKey}`);
    }

    this._dispatchKeys.add(dispatchKey);

    const dispatch = {
      dispatch_id: `d${String(this._dispatchCounter++).padStart(3, "0")}`,
      stage: stageKey,
      round,
      agent: `@${agent.handle}`,
      timestamp: dispatchMeta.timestamp || isoNow(),
      original_prompt_text: dispatchMeta.original_text || "",
      sent_prompt_text: dispatchMeta.sent_text || "",
      original_chars: dispatchMeta.original_chars || 0,
      sent_chars: dispatchMeta.sent_chars || 0,
      original_prompt_sha256: hashText(dispatchMeta.original_text || ""),
      sent_prompt_sha256: hashText(dispatchMeta.sent_text || ""),
      truncated: Boolean(dispatchMeta.truncated),
      truncation_limit: dispatchMeta.truncation_limit || null,
      truncated_from_chars: dispatchMeta.truncated_from_chars || null,
      status: error ? "failed" : "sent",
      error: error ? normalizeErrorMessage(error, "Prompt dispatch failed.") : null,
    };

    run.prompt_dispatches.push(dispatch);
    return dispatch;
  }

  _appendPost(run, post, options = {}) {
    const emit = options.emit !== false;
    const dedupeKey = [
      post.stage,
      post.author,
      post.reply_to || "",
      post.source_dispatch_id || "",
      post.content,
    ].join("|");

    if (this._postKeys.has(dedupeKey)) {
      this.log(`Duplicate post suppressed for ${post.author} (${post.stage}).`);
      return null;
    }

    this._postKeys.add(dedupeKey);

    const fullPost = {
      post_id: `p${String(this._postCounter++).padStart(3, "0")}`,
      author: post.author,
      stage: post.stage,
      type: post.type,
      reply_to: post.reply_to,
      timestamp: post.timestamp || isoNow(),
      latency_seconds: post.latency_seconds || 0,
      content: post.content,
      raw_content: post.raw_content || post.content,
      word_count: post.word_count || countWords(post.content),
      capture_status: post.capture_status || "complete",
      source_dispatch_id: post.source_dispatch_id || null,
    };

    run.posts.push(fullPost);
    if (emit) {
      this.onPost(fullPost);
    }
    return fullPost;
  }

  _recordFailure(run, agent, stage, phase, message) {
    const failure = {
      timestamp: isoNow(),
      agent: `@${agent.handle}`,
      stage,
      phase,
      message,
    };

    run.failures.push(failure);
    run.agent_statuses[agent.handle].failures.push(failure);
  }

  _chooseMinutesAgent(openingAgents) {
    for (const handle of MINUTES_SCRIBE_PRIORITY) {
      const match = openingAgents.find((agent) => agent.handle === handle);
      if (match) {
        return match;
      }
    }

    return openingAgents[0] || null;
  }

  _finalizeRun(run, startTime) {
    run.duration_seconds = Math.round((Date.now() - startTime) / 1000);

    for (const agent of this.agents) {
      const record = run.agent_statuses[agent.handle];
      record.status = this._computeAgentStatus(record);
    }

    const stageStatuses = Object.values(run.stage_timestamps).map((stage) => stage.status);
    const hasAnyOutput = run.posts.length > 0 || Boolean(run.minutes?.raw_minutes_text);
    const hasIssues =
      run.failures.length > 0
      || stageStatuses.some((status) => status === "partial" || status === "failed" || status === "skipped")
      || run.deliberation.missing_pairs.length > 0
      || Object.values(run.agent_statuses).some((record) => record.status !== "completed");

    if (!hasAnyOutput) {
      run.status = "failed";
    } else if (hasIssues) {
      run.status = "partial";
    } else {
      run.status = "completed";
    }

    return run;
  }

  _computeAgentStatus(record) {
    if (record.launch.status === "failed") {
      return "failed";
    }

    const statuses = [
      record.opening.status,
      record.deliberation.status,
      record.minutes.role === "scribe" ? record.minutes.status : null,
    ].filter(Boolean);

    if (statuses.includes("failed")) {
      return record.opening.post_id ? "partial" : "failed";
    }

    if (statuses.includes("partial")) {
      return "partial";
    }

    if (record.opening.status === "completed" || record.opening.status === "partial") {
      return statuses.every((status) => ["completed", "skipped", "sent"].includes(status))
        ? "completed"
        : "partial";
    }

    return "pending";
  }

  async _pauseIfRequested(message) {
    if (!this._pauseRequested) {
      return;
    }

    this._pauseRequested = false;
    this.onStageChange("paused");
    this.log(message);
    this.onPauseForResume();

    await new Promise((resolve) => {
      this._resumeResolve = resolve;
    });

    this.log("Resumed.");
  }

  async _closeAgents(agents) {
    this.log("Closing all browser windows...");
    await Promise.allSettled(agents.map((agent) => agent.close()));
    this.log("All browsers closed.");
  }
}

module.exports = Pipeline;
