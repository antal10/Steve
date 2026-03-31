const { buildDeliberationPrompt, parseDeliberationResponse } = require("./deliberation");
const { buildMinutesPrompt, parseMinutesResponse } = require("./minutes");

/**
 * Pipeline - orchestrates the 4-stage council process.
 *
 * Stages:
 *   1. Broadcast  - send prompt to all agents in parallel
 *   2. Collect    - wait for all responses, emit opening statement posts
 *   3. Deliberate - each agent replies to all others
 *   4. Minutes    - send full thread to a minutes agent and parse JSON minutes
 */
class Pipeline {
  /**
   * @param {object} opts
   * @param {Array} opts.agents
   * @param {Function} opts.onPost
   * @param {Function} opts.onLog
   * @param {Function} opts.onMinutes
   * @param {Function} opts.onStageChange
   * @param {Function} opts.onPauseForResume
   */
  constructor({ agents, onPost, onLog, onMinutes, onStageChange, onPauseForResume }) {
    this.agents = agents;
    this.onPost = onPost || (() => {});
    this.onLog = onLog || (() => {});
    this.onMinutes = onMinutes || (() => {});
    this.onStageChange = onStageChange || (() => {});
    this.onPauseForResume = onPauseForResume || (() => {});

    this._resumeResolve = null;
    this._pauseRequested = false;
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

  /**
   * Run the full 4-stage pipeline.
   *
   * @param {string} prompt - the user's question
   * @returns {object}      - complete run object matching SCHEMA.md
   */
  async run(prompt) {
    const startTime = Date.now();
    const allPosts = [];
    const stagesCompleted = [];
    let postCounter = 1;
    let liveAgents = [];

    for (const agent of this.agents) {
      agent.onLog = (msg) => this.onLog(msg);
    }

    try {
      this.onStageChange("broadcasting");
      this.log("Stage 1 - Broadcasting prompt to all agents...");

      const launchResults = await Promise.allSettled(
        this.agents.map((agent) => agent.launch())
      );

      for (let i = 0; i < this.agents.length; i++) {
        if (launchResults[i].status === "fulfilled") {
          liveAgents.push(this.agents[i]);
        } else {
          this.log(`Agent @${this.agents[i].handle} failed to launch: ${launchResults[i].reason?.message}`);
        }
      }

      if (liveAgents.length === 0) {
        this.log("No agents launched successfully. Aborting.");
        return this._buildRunObject(prompt, [], null, startTime, []);
      }

      await Promise.allSettled(
        liveAgents.map((agent) => agent.sendPrompt(prompt))
      );

      stagesCompleted.push("broadcast");

      this.onStageChange("collecting");
      this.log("Stage 2 - Collecting opening statements...");

      const openingPosts = [];
      const collectResults = await Promise.allSettled(
        liveAgents.map(async (agent) => {
          const agentStart = Date.now();
          await agent.waitForResponse();
          const text = await agent.getResponse();
          const latency = Math.round((Date.now() - agentStart) / 1000);
          return { agent, text, latency };
        })
      );

      const successfulAgents = [];
      for (const result of collectResults) {
        if (result.status === "fulfilled" && result.value.text) {
          const { agent, text, latency } = result.value;
          const wordCount = text.split(/\s+/).filter(Boolean).length;
          const post = {
            post_id: `p${String(postCounter++).padStart(3, "0")}`,
            author: `@${agent.handle}`,
            stage: "opening",
            type: "statement",
            reply_to: null,
            timestamp: new Date().toISOString(),
            latency_seconds: latency,
            content: text,
            word_count: wordCount,
          };

          openingPosts.push(post);
          allPosts.push(post);
          successfulAgents.push(agent);
          this.onPost(post);
        } else {
          const reason = result.status === "rejected"
            ? result.reason?.message
            : "Empty response";
          this.log(`Failed to collect from an agent: ${reason}`);
        }
      }

      stagesCompleted.push("collect");

      if (successfulAgents.length < 2) {
        this.log("Fewer than 2 agents responded. Skipping deliberation.");
        return this._buildRunObject(prompt, allPosts, null, startTime, stagesCompleted);
      }

      await this._pauseIfRequested("Paused after opening statements. Click Resume to start deliberation.");

      this.onStageChange("deliberating");
      this.log("Stage 3 - Deliberation (cross-replies)...");

      const deliberationResults = await Promise.allSettled(
        successfulAgents.map(async (agent) => {
          const otherPosts = openingPosts.filter((post) => post.author !== `@${agent.handle}`);
          const otherHandles = otherPosts.map((post) => post.author.replace("@", ""));
          const deliberationPrompt = buildDeliberationPrompt(agent.handle, prompt, otherPosts);

          this.log(`Sending deliberation prompt to @${agent.handle}...`);
          await agent.sendPrompt(deliberationPrompt);
          await agent.waitForResponse();
          const response = await agent.getResponse();

          return { agent, response, otherHandles };
        })
      );

      for (const result of deliberationResults) {
        if (result.status === "fulfilled" && result.value.response) {
          const { agent, response, otherHandles } = result.value;
          const replyPosts = parseDeliberationResponse(
            agent.handle,
            response,
            otherHandles,
            "p",
            postCounter
          );

          postCounter += replyPosts.length;

          for (const post of replyPosts) {
            allPosts.push(post);
            this.onPost(post);
          }
        } else {
          const reason = result.status === "rejected"
            ? result.reason?.message
            : "Empty deliberation response";
          this.log(`Deliberation failed for an agent: ${reason}`);
        }
      }

      stagesCompleted.push("deliberate");

      await this._pauseIfRequested("Paused after deliberation. Click Resume to generate minutes.");

      this.onStageChange("minutes");
      this.log("Stage 4 - Generating meeting minutes...");

      let minutesAgent = successfulAgents.find((agent) => agent.handle === "sonar");
      if (!minutesAgent) {
        minutesAgent = successfulAgents[0];
      }

      let minutes = null;
      const activeHandles = successfulAgents.map((agent) => agent.handle);

      try {
        const minutesPrompt = buildMinutesPrompt(prompt, allPosts, activeHandles);
        this.log(`Sending minutes prompt to @${minutesAgent.handle}...`);
        await minutesAgent.sendPrompt(minutesPrompt);
        await minutesAgent.waitForResponse();
        const minutesResponse = await minutesAgent.getResponse();

        minutes = parseMinutesResponse(minutesResponse, minutesAgent.handle, activeHandles);

        const minutesPost = {
          post_id: `p${String(postCounter++).padStart(3, "0")}`,
          author: `@${minutesAgent.handle}`,
          stage: "minutes",
          type: "minutes",
          reply_to: null,
          timestamp: new Date().toISOString(),
          latency_seconds: 0,
          content: minutes.raw_minutes_text,
          word_count: minutes.raw_minutes_text.split(/\s+/).filter(Boolean).length,
        };

        allPosts.push(minutesPost);
        this.onMinutes(minutes);
        this.log("Minutes generated successfully.");
      } catch (err) {
        this.log(`Minutes generation failed: ${err.message}`);
        minutes = {
          generated_by: `@${minutesAgent.handle}`,
          attendees: activeHandles.map((handle) => `@${handle}`),
          points_of_agreement: [],
          points_of_disagreement: [],
          unresolved_questions: [],
          recommended_next_action: "",
          consensus_level: "unresolved",
          raw_minutes_text: "Minutes generation failed.",
        };
        this.onMinutes(minutes);
      }

      stagesCompleted.push("minutes");

      return this._buildRunObject(prompt, allPosts, minutes, startTime, stagesCompleted);
    } finally {
      if (liveAgents.length > 0) {
        await this._closeAgents(liveAgents);
      }
      this._resumeResolve = null;
      this._pauseRequested = false;
    }
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

  _buildRunObject(prompt, posts, minutes, startTime, stagesCompleted) {
    const duration = Math.round((Date.now() - startTime) / 1000);
    const activeHandles = this.agents.map((agent) => `@${agent.handle}`);

    return {
      run_id: "",
      timestamp: new Date(startTime).toISOString(),
      prompt,
      agents_active: activeHandles,
      stages_completed: stagesCompleted,
      duration_seconds: duration,
      posts,
      minutes: minutes || {},
    };
  }
}

module.exports = Pipeline;
