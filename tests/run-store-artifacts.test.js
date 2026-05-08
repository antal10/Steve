const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const runtimePaths = require("../runtime/runtime-paths");
const runStore = require("../council/run-store");
const { mirrorRunArtifacts } = require("../council/artifact-mirror");

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf-8").digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configureRuntime(prefix) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const projectRoot = path.join(sandboxRoot, "project");
  const userDataRoot = path.join(sandboxRoot, "user-data");
  fs.mkdirSync(projectRoot, { recursive: true });
  runtimePaths.configureRuntimePaths({ projectRoot, userDataRoot });

  return {
    projectRoot,
    runsDir: runtimePaths.getRunArtifactsDir(),
    userDataRoot,
  };
}

function listMirrorFolders(runsDir) {
  return fs.readdirSync(runsDir)
    .filter((entry) => {
      return fs.statSync(path.join(runsDir, entry)).isDirectory()
        && !entry.includes(".artifact-tmp-");
    })
    .sort();
}

function makeRunData() {
  const prompt = "Confirm the artifact ledger remains passive.";
  const openingO3 = "o3 opening statement";
  const openingSonar = "sonar opening statement";
  const replyO3 = "I agree on traceability, but keep the mirror default-off.";
  const replySonar = "I agree on default-off behavior, but require a stable run id.";
  const minutesText = "The council accepted a passive artifact mirror tied to saveRun.";
  const minutesResponse = JSON.stringify({
    points_of_agreement: ["Artifact mirroring should be default-off."],
    points_of_disagreement: ["Local preflight remains out of scope."],
    unresolved_questions: ["Which reader consumes these artifacts later?"],
    recommended_next_action: "Land the run-id contract.",
    consensus_level: "moderate",
    raw_minutes_text: minutesText,
  });
  const openingPrompt = prompt;
  const o3DeliberationPrompt = "V1 deliberation prompt for @o3";
  const sonarDeliberationPrompt = "V1 deliberation prompt for @sonar";
  const minutesPrompt = "V1 minutes prompt";

  return {
    run_id: "",
    status: "completed",
    timestamp: "2026-05-04T12:00:00.000Z",
    prompt,
    prompt_sha256: sha256(prompt),
    agents_active: ["@o3", "@sonar"],
    stages_completed: ["broadcast", "collect", "deliberate", "minutes"],
    stage_timestamps: {
      broadcast: {
        started_at: "2026-05-04T12:00:00.000Z",
        completed_at: "2026-05-04T12:00:01.000Z",
        status: "completed",
        message: null,
      },
      collect: {
        started_at: "2026-05-04T12:00:01.000Z",
        completed_at: "2026-05-04T12:00:02.000Z",
        status: "completed",
        message: null,
      },
      deliberate: {
        started_at: "2026-05-04T12:00:02.000Z",
        completed_at: "2026-05-04T12:00:03.000Z",
        status: "completed",
        message: null,
      },
      minutes: {
        started_at: "2026-05-04T12:00:03.000Z",
        completed_at: "2026-05-04T12:00:04.000Z",
        status: "completed",
        message: null,
      },
    },
    duration_seconds: 4,
    deliberation_rounds: 1,
    prompt_dispatches: [
      {
        dispatch_id: "d001",
        stage: "opening",
        round: 0,
        agent: "@o3",
        timestamp: "2026-05-04T12:00:00.100Z",
        original_prompt_text: openingPrompt,
        sent_prompt_text: openingPrompt,
        original_chars: openingPrompt.length,
        sent_chars: openingPrompt.length,
        original_prompt_sha256: sha256(openingPrompt),
        sent_prompt_sha256: sha256(openingPrompt),
        truncated: false,
        truncation_limit: null,
        truncated_from_chars: null,
        status: "sent",
        error: null,
      },
      {
        dispatch_id: "d002",
        stage: "opening",
        round: 0,
        agent: "@sonar",
        timestamp: "2026-05-04T12:00:00.200Z",
        original_prompt_text: openingPrompt,
        sent_prompt_text: openingPrompt,
        original_chars: openingPrompt.length,
        sent_chars: openingPrompt.length,
        original_prompt_sha256: sha256(openingPrompt),
        sent_prompt_sha256: sha256(openingPrompt),
        truncated: false,
        truncation_limit: null,
        truncated_from_chars: null,
        status: "sent",
        error: null,
      },
      {
        dispatch_id: "d003",
        stage: "deliberation",
        round: 1,
        agent: "@o3",
        timestamp: "2026-05-04T12:00:02.100Z",
        original_prompt_text: o3DeliberationPrompt,
        sent_prompt_text: o3DeliberationPrompt,
        original_chars: o3DeliberationPrompt.length,
        sent_chars: o3DeliberationPrompt.length,
        original_prompt_sha256: sha256(o3DeliberationPrompt),
        sent_prompt_sha256: sha256(o3DeliberationPrompt),
        truncated: false,
        truncation_limit: null,
        truncated_from_chars: null,
        status: "sent",
        error: null,
      },
      {
        dispatch_id: "d004",
        stage: "deliberation",
        round: 1,
        agent: "@sonar",
        timestamp: "2026-05-04T12:00:02.200Z",
        original_prompt_text: sonarDeliberationPrompt,
        sent_prompt_text: sonarDeliberationPrompt,
        original_chars: sonarDeliberationPrompt.length,
        sent_chars: sonarDeliberationPrompt.length,
        original_prompt_sha256: sha256(sonarDeliberationPrompt),
        sent_prompt_sha256: sha256(sonarDeliberationPrompt),
        truncated: false,
        truncation_limit: null,
        truncated_from_chars: null,
        status: "sent",
        error: null,
      },
      {
        dispatch_id: "d005",
        stage: "minutes",
        round: 0,
        agent: "@sonar",
        timestamp: "2026-05-04T12:00:03.100Z",
        original_prompt_text: minutesPrompt,
        sent_prompt_text: minutesPrompt,
        original_chars: minutesPrompt.length,
        sent_chars: minutesPrompt.length,
        original_prompt_sha256: sha256(minutesPrompt),
        sent_prompt_sha256: sha256(minutesPrompt),
        truncated: false,
        truncation_limit: null,
        truncated_from_chars: null,
        status: "sent",
        error: null,
      },
    ],
    posts: [
      {
        post_id: "p001",
        author: "@o3",
        stage: "opening",
        type: "statement",
        reply_to: null,
        timestamp: "2026-05-04T12:00:01.100Z",
        latency_seconds: 1,
        content: openingO3,
        raw_content: openingO3,
        word_count: 3,
        capture_status: "complete",
        source_dispatch_id: "d001",
      },
      {
        post_id: "p002",
        author: "@sonar",
        stage: "opening",
        type: "statement",
        reply_to: null,
        timestamp: "2026-05-04T12:00:01.200Z",
        latency_seconds: 1,
        content: openingSonar,
        raw_content: openingSonar,
        word_count: 3,
        capture_status: "complete",
        source_dispatch_id: "d002",
      },
      {
        post_id: "p003",
        author: "@o3",
        stage: "deliberation",
        type: "reply",
        reply_to: "@sonar",
        timestamp: "2026-05-04T12:00:02.300Z",
        latency_seconds: 1,
        content: replyO3,
        raw_content: replyO3,
        word_count: 9,
        capture_status: "complete",
        source_dispatch_id: "d003",
      },
      {
        post_id: "p004",
        author: "@sonar",
        stage: "deliberation",
        type: "reply",
        reply_to: "@o3",
        timestamp: "2026-05-04T12:00:02.400Z",
        latency_seconds: 1,
        content: replySonar,
        raw_content: replySonar,
        word_count: 10,
        capture_status: "complete",
        source_dispatch_id: "d004",
      },
      {
        post_id: "p005",
        author: "@sonar",
        stage: "minutes",
        type: "minutes",
        reply_to: null,
        timestamp: "2026-05-04T12:00:04.000Z",
        latency_seconds: 1,
        content: minutesText,
        raw_content: minutesResponse,
        word_count: 10,
        capture_status: "complete",
        source_dispatch_id: "d005",
      },
    ],
    minutes: {
      generated_by: "@sonar",
      attendees: ["@o3", "@sonar"],
      points_of_agreement: ["Artifact mirroring should be default-off."],
      points_of_disagreement: ["Local preflight remains out of scope."],
      unresolved_questions: ["Which reader consumes these artifacts later?"],
      recommended_next_action: "Land the run-id contract.",
      consensus_level: "moderate",
      raw_minutes_text: minutesText,
      raw_response_text: minutesResponse,
      parse_status: "json",
      status: "completed",
      source_dispatch_id: "d005",
      source_post_id: "p005",
    },
    failures: [],
    agent_statuses: {},
    deliberation: {
      rounds: 1,
      participants: ["@o3", "@sonar"],
      expected_reply_count: 2,
      actual_reply_count: 2,
      expected_pairs: [
        { from: "@o3", to: "@sonar" },
        { from: "@sonar", to: "@o3" },
      ],
      actual_pairs: [
        { from: "@o3", to: "@sonar", post_id: "p003" },
        { from: "@sonar", to: "@o3", post_id: "p004" },
      ],
      missing_pairs: [],
    },
  };
}

test("saveRun default write_artifacts=false writes only the canonical JSON file", () => {
  const { runsDir } = configureRuntime("steve-save-default-");
  const filename = runStore.saveRun(makeRunData());
  const runId = filename.replace(".json", "");

  assert.equal(fs.existsSync(path.join(runsDir, filename)), true);
  assert.equal(fs.existsSync(path.join(runsDir, runId)), false);
  assert.deepEqual(listMirrorFolders(runsDir), []);
});

test("saveRun explicit write_artifacts=false writes no mirror folder", () => {
  const { runsDir } = configureRuntime("steve-save-explicit-false-");
  const filename = runStore.saveRun(makeRunData(), { write_artifacts: false });
  const runId = filename.replace(".json", "");

  assert.equal(fs.existsSync(path.join(runsDir, filename)), true);
  assert.equal(fs.existsSync(path.join(runsDir, runId)), false);
  assert.deepEqual(listMirrorFolders(runsDir), []);
});

test("saveRun write_artifacts=true creates one mirror folder linked to the saved JSON run_id", () => {
  const { runsDir } = configureRuntime("steve-save-mirror-");
  const filename = runStore.saveRun(makeRunData(), { write_artifacts: true });
  const runId = filename.replace(".json", "");
  const runDir = path.join(runsDir, runId);
  const savedJson = runStore.loadRun(filename);

  assert.deepEqual(listMirrorFolders(runsDir), [runId]);
  assert.equal(savedJson.run_id, runId);
  assert.equal(fs.existsSync(path.join(runDir, "prompt_packet.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "events.jsonl")), true);
  assert.equal(fs.existsSync(path.join(runDir, "posts", "round-0", "o3", "p001.md")), true);
  assert.equal(fs.existsSync(path.join(runDir, "packets", "round-1", "o3", "d003.md")), true);
  assert.equal(fs.existsSync(path.join(runDir, "matrices", "opening_matrix.csv")), true);
  assert.equal(fs.existsSync(path.join(runDir, "matrices", "cross_reply_matrix.csv")), true);
  assert.equal(fs.existsSync(path.join(runDir, "minutes.json")), true);
  assert.equal(fs.existsSync(path.join(runDir, "deviation_report.json")), true);

  const promptPacket = JSON.parse(fs.readFileSync(path.join(runDir, "prompt_packet.json"), "utf-8"));
  const minutes = JSON.parse(fs.readFileSync(path.join(runDir, "minutes.json"), "utf-8"));
  const deviationReport = JSON.parse(fs.readFileSync(path.join(runDir, "deviation_report.json"), "utf-8"));
  const eventRunIds = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).run_id);

  assert.equal(promptPacket.run_id, runId);
  assert.equal(promptPacket.source_json, filename);
  assert.equal(minutes.run_id, runId);
  assert.equal(deviationReport.run_id, runId);
  assert.deepEqual([...new Set(eventRunIds)], [runId]);
});

test("saveRun leaves no orphan mirror folder when the JSON write fails", () => {
  const { runsDir } = configureRuntime("steve-save-fail-");
  const originalWriteFileSync = fs.writeFileSync;

  fs.writeFileSync = function patchedWriteFileSync(targetPath, ...args) {
    if (String(targetPath).endsWith(".json")) {
      throw new Error("forced JSON write failure");
    }

    return originalWriteFileSync.call(this, targetPath, ...args);
  };

  try {
    assert.throws(
      () => runStore.saveRun(makeRunData(), { write_artifacts: true }),
      /forced JSON write failure/
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.deepEqual(fs.readdirSync(runsDir), []);
});

test("saveRun cleans staging folders if artifact mirroring fails", () => {
  const { runsDir } = configureRuntime("steve-mirror-fail-");
  const originalRenameSync = fs.renameSync;

  fs.renameSync = function patchedRenameSync() {
    throw new Error("forced mirror rename failure");
  };

  try {
    assert.throws(
      () => runStore.saveRun(makeRunData(), { write_artifacts: true }),
      /forced mirror rename failure/
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(fs.readdirSync(runsDir).filter((entry) => entry.endsWith(".json")).length, 1);
  assert.deepEqual(listMirrorFolders(runsDir), []);
  assert.equal(
    fs.readdirSync(runsDir).some((entry) => entry.includes(".artifact-tmp-")),
    false
  );
});

test("artifact mirroring rejects run ids that would escape the runtime runs root", () => {
  const { runsDir } = configureRuntime("steve-mirror-escape-");

  assert.throws(
    () => mirrorRunArtifacts(makeRunData(), {
      runsDir,
      runId: "../escape",
      sourceJsonFilename: "../escape.json",
    }),
    /Unsafe artifact mirror run_id/
  );
  assert.deepEqual(listMirrorFolders(runsDir), []);
});

test("saveRun skips existing mirror folder collisions when choosing the canonical run_id", () => {
  const { runsDir } = configureRuntime("steve-save-collision-");
  const realDate = Date;
  class FixedDate extends realDate {
    constructor(...args) {
      if (args.length === 0) {
        return new realDate(2026, 4, 4, 12, 34, 0, 0);
      }

      return new realDate(...args);
    }

    static now() {
      return new realDate(2026, 4, 4, 12, 34, 0, 0).getTime();
    }

    static parse(value) {
      return realDate.parse(value);
    }

    static UTC(...args) {
      return realDate.UTC(...args);
    }
  }

  const collidingRunId = "2026-05-04_1234_run1";
  fs.mkdirSync(path.join(runsDir, collidingRunId), { recursive: true });

  try {
    global.Date = FixedDate;
    const filename = runStore.saveRun(makeRunData());
    assert.equal(filename, "2026-05-04_1234_run2.json");
  } finally {
    global.Date = realDate;
  }
});

test("artifact mirroring preserves the current single JSON schema", () => {
  const { runsDir } = configureRuntime("steve-save-schema-");
  const jsonOnlyFilename = runStore.saveRun(clone(makeRunData()));
  const mirrorFilename = runStore.saveRun(clone(makeRunData()), { write_artifacts: true });
  const jsonOnly = JSON.parse(fs.readFileSync(path.join(runsDir, jsonOnlyFilename), "utf-8"));
  const withMirror = JSON.parse(fs.readFileSync(path.join(runsDir, mirrorFilename), "utf-8"));

  assert.equal(Object.prototype.hasOwnProperty.call(jsonOnly, "artifact_mirror"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(withMirror, "artifact_mirror"), false);
  assert.deepEqual(Object.keys(withMirror).sort(), Object.keys(jsonOnly).sort());

  delete jsonOnly.run_id;
  delete withMirror.run_id;
  assert.deepEqual(withMirror, jsonOnly);
});

test("paid path imports and write_artifacts=false save do not load artifact modules", () => {
  const script = `
    const Module = require("module");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const originalLoad = Module._load;
    Module._load = function guardedLoad(request) {
      const blocked = ["artifact-mirror", "artifact-writer", "event-log", "matrix-writer", "round-packet"];
      if (blocked.some((name) => String(request).includes(name))) {
        throw new Error("artifact module loaded: " + request);
      }
      return originalLoad.apply(this, arguments);
    };
    const runtimePaths = require("./runtime/runtime-paths");
    const Pipeline = require("./council/pipeline");
    const { saveRun } = require("./council/run-store");
    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "steve-import-passive-"));
    const projectRoot = path.join(sandboxRoot, "project");
    const userDataRoot = path.join(sandboxRoot, "user-data");
    fs.mkdirSync(projectRoot, { recursive: true });
    runtimePaths.configureRuntimePaths({ projectRoot, userDataRoot });
    const assertPipeline = typeof Pipeline === "function";
    saveRun({
      status: "completed",
      timestamp: "2026-05-04T12:00:00.000Z",
      prompt: "x",
      agents_active: [],
      stages_completed: [],
      posts: [],
      minutes: {},
      failures: []
    }, { write_artifacts: false });
    process.stdout.write(assertPipeline ? "ok" : "bad");
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ok");
});
