const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Pipeline = require("../council/pipeline");

class StubAgent {
  constructor(handle, script) {
    this.handle = handle;
    this.name = `Stub ${handle}`;
    this.sessionsDir = `C:\\Users\\Test\\AppData\\Local\\SteveApp\\profiles\\${handle}`;
    this.script = script;
    this.stageOrder = ["opening", "deliberation", "minutes"];
    this.sendIndex = 0;
    this.currentStage = null;
    this.lastPromptDispatch = null;
    this.onLog = () => {};
  }

  async launch() {
    if (this.script.launchError) {
      throw new Error(this.script.launchError);
    }
  }

  async close() {}

  async sendPrompt(prompt) {
    this.currentStage = this.stageOrder[this.sendIndex] || "minutes";
    this.sendIndex++;

    const stageScript = this.script[this.currentStage] || {};
    const sentText = stageScript.sentPrompt || prompt;
    this.lastPromptDispatch = {
      timestamp: new Date().toISOString(),
      original_text: prompt,
      original_chars: prompt.length,
      sent_text: sentText,
      sent_chars: sentText.length,
      truncated: sentText !== prompt,
    };

    if (stageScript.sendError) {
      throw new Error(stageScript.sendError);
    }

    return this.lastPromptDispatch;
  }

  getLastPromptDispatch() {
    return this.lastPromptDispatch;
  }

  async waitForResponse() {
    const stageScript = this.script[this.currentStage] || {};
    if (stageScript.waitError) {
      throw new Error(stageScript.waitError);
    }
    return stageScript.waitResult || { status: "complete" };
  }

  async getResponse() {
    const stageScript = this.script[this.currentStage] || {};
    if (stageScript.responseError) {
      throw new Error(stageScript.responseError);
    }
    return stageScript.response || "";
  }
}

test("Pipeline records a reconstructable completed run with explicit dispatches and traceable minutes", async () => {
  const agents = [
    new StubAgent("o3", {
      opening: { response: "o3 opening statement" },
      deliberation: {
        response: "To @gemini:\nI agree with your framing.\n\nTo @sonar:\nI disagree on retrieval quality.",
      },
    }),
    new StubAgent("gemini", {
      opening: { response: "gemini opening statement" },
      deliberation: {
        response: "To @o3:\nI agree on logic.\n\nTo @sonar:\nI disagree on citations.",
      },
    }),
    new StubAgent("sonar", {
      opening: { response: "sonar opening statement" },
      deliberation: {
        response: "To @o3:\nI agree on workflow.\n\nTo @gemini:\nI disagree on usability.",
      },
      minutes: {
        response: JSON.stringify({
          points_of_agreement: ["All three differentiate product from model."],
          points_of_disagreement: ["They disagree on transparency scores."],
          unresolved_questions: ["Which retrieval stack performs best on live tasks?"],
          recommended_next_action: "Run a fixed-prompt benchmark.",
          consensus_level: "moderate",
          raw_minutes_text: "The council aligned on framing but not on capability gaps.",
        }),
      },
    }),
  ];

  const pipeline = new Pipeline({ agents });
  const run = await pipeline.run("Compare the tools.");

  assert.equal(run.status, "completed");
  assert.equal(run.stage_timestamps.broadcast.status, "completed");
  assert.equal(run.stage_timestamps.collect.status, "completed");
  assert.equal(run.stage_timestamps.deliberate.status, "completed");
  assert.equal(run.stage_timestamps.minutes.status, "completed");
  assert.equal(run.prompt_dispatches.length, 7);

  const openingDispatches = run.prompt_dispatches.filter((dispatch) => dispatch.stage === "opening");
  assert.equal(new Set(openingDispatches.map((dispatch) => dispatch.sent_prompt_text)).size, 1);
  assert.equal(run.deliberation.expected_reply_count, 6);
  assert.equal(run.deliberation.actual_reply_count, 6);
  assert.deepEqual(run.deliberation.missing_pairs, []);
  assert.equal(run.minutes.status, "completed");
  assert.equal(run.minutes.generated_by, "@sonar");
  assert.equal(run.minutes.parse_status, "json");
  assert.ok(run.minutes.source_post_id);
  assert.equal(new Set(run.posts.map((post) => post.post_id)).size, run.posts.length);
  assert.ok(run.posts.every((post) => typeof post.raw_content === "string" && post.source_dispatch_id));
  assert.equal(run.agent_statuses.o3.status, "completed");
  assert.equal(run.agent_statuses.gemini.status, "completed");
  assert.equal(run.agent_statuses.sonar.status, "completed");
});

test("Pipeline records missing deliberation edges and failures without fabricating posts", async () => {
  const agents = [
    new StubAgent("o3", {
      opening: { response: "o3 opening" },
      deliberation: {
        response: "To @gemini:\nTargeted reply.\n\nTo @claude:\nAnother targeted reply.",
      },
      minutes: {
        response: JSON.stringify({
          points_of_agreement: ["There is agreement on workflow importance."],
          points_of_disagreement: ["There is disagreement on reasoning quality."],
          unresolved_questions: ["Which benchmark matters most?"],
          recommended_next_action: "Benchmark with a shared prompt set.",
          consensus_level: "split",
          raw_minutes_text: "The council split on model quality but agreed on testing next.",
        }),
      },
    }),
    new StubAgent("gemini", {
      opening: { response: "gemini opening" },
      deliberation: {
        response: "General prose with no explicit headings anywhere in the reply.",
      },
    }),
    new StubAgent("claude", {
      opening: { response: "claude opening" },
      deliberation: {
        response: "To @o3:\nTargeted reply.\n\nTo @gemini:\nTargeted reply.",
      },
    }),
  ];

  const pipeline = new Pipeline({ agents });
  const run = await pipeline.run("Test missing edges.");

  assert.equal(run.status, "partial");
  assert.equal(run.stage_timestamps.deliberate.status, "partial");
  assert.ok(run.failures.some((failure) => {
    return failure.agent === "@gemini"
      && failure.stage === "deliberation"
      && failure.phase === "parse";
  }));
  assert.deepEqual(run.deliberation.missing_pairs, [
    { from: "@gemini", to: "@o3" },
    { from: "@gemini", to: "@claude" },
  ]);
  assert.equal(
    run.posts.some((post) => post.stage === "deliberation" && post.author === "@gemini"),
    false
  );
  assert.deepEqual(run.agent_statuses.gemini.deliberation.missing_targets, ["@o3", "@claude"]);
  assert.equal(run.minutes.status, "completed");
});

test("Pipeline write_artifacts default false preserves run behavior and writes no mirror files", async () => {
  const artifactRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "steve-pipeline-default-")), "artifacts");
  const agents = [
    new StubAgent("o3", {
      opening: { response: "o3 opening statement" },
      deliberation: {
        response: "To @sonar:\nI agree on traceability, but would keep the first write path small.",
      },
    }),
    new StubAgent("sonar", {
      opening: { response: "sonar opening statement" },
      deliberation: {
        response: "To @o3:\nI agree on keeping the paid path stable, but want ledger tests first.",
      },
      minutes: {
        response: JSON.stringify({
          points_of_agreement: ["Keep paid behavior stable by default."],
          points_of_disagreement: ["Scope of mirroring can wait."],
          unresolved_questions: ["Which folder naming scheme should become canonical?"],
          recommended_next_action: "Land pure artifact utilities first.",
          consensus_level: "moderate",
          raw_minutes_text: "The council agreed that default-off artifact work is safe.",
        }),
      },
    }),
  ];

  const pipeline = new Pipeline({
    agents,
    config: {
      artifact_root: artifactRoot,
    },
  });
  const run = await pipeline.run("Confirm default-off artifact mirroring.");

  assert.equal(run.status, "completed");
  assert.equal(run.prompt_dispatches.length, 5);
  assert.equal(run.posts.length, 5);
  assert.equal(run.artifact_mirror, undefined);
  assert.equal(fs.existsSync(artifactRoot), false);
});
