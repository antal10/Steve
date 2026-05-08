const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { readArtifactMirror } = require("../council/artifact-reader");
const { validateArtifactFolder } = require("../council/artifact-validator");
const runtimePaths = require("../runtime/runtime-paths");
const runStore = require("../council/run-store");

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf-8").digest("hex");
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

function makeRunData() {
  const prompt = "Validate the artifact mirror.";
  const o3Opening = "o3 opening";
  const sonarOpening = "sonar opening";
  const o3Reply = "I agree on validation, but reject unsafe paths.";
  const sonarReply = "I agree on safe paths, but require hash checks.";
  const minutesText = "The artifact mirror validates without invoking paid agents.";
  const minutesResponse = JSON.stringify({
    points_of_agreement: ["Validation is pure I/O."],
    points_of_disagreement: ["Preflight remains out of scope."],
    unresolved_questions: ["Which consumer reads this later?"],
    recommended_next_action: "Land reader validation.",
    consensus_level: "moderate",
    raw_minutes_text: minutesText,
  });
  const o3Packet = "V1 deliberation prompt for @o3";
  const sonarPacket = "V1 deliberation prompt for @sonar";
  const minutesPacket = "V1 minutes prompt";

  return {
    run_id: "",
    status: "completed",
    timestamp: "2026-05-04T12:00:00.000Z",
    prompt,
    prompt_sha256: sha256(prompt),
    agents_active: ["@o3", "@sonar"],
    stages_completed: ["broadcast", "collect", "deliberate", "minutes"],
    stage_timestamps: {
      broadcast: { started_at: "2026-05-04T12:00:00.000Z", completed_at: "2026-05-04T12:00:01.000Z", status: "completed", message: null },
      collect: { started_at: "2026-05-04T12:00:01.000Z", completed_at: "2026-05-04T12:00:02.000Z", status: "completed", message: null },
      deliberate: { started_at: "2026-05-04T12:00:02.000Z", completed_at: "2026-05-04T12:00:03.000Z", status: "completed", message: null },
      minutes: { started_at: "2026-05-04T12:00:03.000Z", completed_at: "2026-05-04T12:00:04.000Z", status: "completed", message: null },
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
        original_prompt_text: prompt,
        sent_prompt_text: prompt,
        original_chars: prompt.length,
        sent_chars: prompt.length,
        original_prompt_sha256: sha256(prompt),
        sent_prompt_sha256: sha256(prompt),
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
        original_prompt_text: prompt,
        sent_prompt_text: prompt,
        original_chars: prompt.length,
        sent_chars: prompt.length,
        original_prompt_sha256: sha256(prompt),
        sent_prompt_sha256: sha256(prompt),
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
        original_prompt_text: o3Packet,
        sent_prompt_text: o3Packet,
        original_chars: o3Packet.length,
        sent_chars: o3Packet.length,
        original_prompt_sha256: sha256(o3Packet),
        sent_prompt_sha256: sha256(o3Packet),
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
        original_prompt_text: sonarPacket,
        sent_prompt_text: sonarPacket,
        original_chars: sonarPacket.length,
        sent_chars: sonarPacket.length,
        original_prompt_sha256: sha256(sonarPacket),
        sent_prompt_sha256: sha256(sonarPacket),
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
        original_prompt_text: minutesPacket,
        sent_prompt_text: minutesPacket,
        original_chars: minutesPacket.length,
        sent_chars: minutesPacket.length,
        original_prompt_sha256: sha256(minutesPacket),
        sent_prompt_sha256: sha256(minutesPacket),
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
        content: o3Opening,
        raw_content: o3Opening,
        word_count: 2,
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
        content: sonarOpening,
        raw_content: sonarOpening,
        word_count: 2,
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
        content: o3Reply,
        raw_content: o3Reply,
        word_count: 8,
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
        content: sonarReply,
        raw_content: sonarReply,
        word_count: 9,
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
        word_count: 8,
        capture_status: "complete",
        source_dispatch_id: "d005",
      },
    ],
    minutes: {
      generated_by: "@sonar",
      attendees: ["@o3", "@sonar"],
      points_of_agreement: ["Validation is pure I/O."],
      points_of_disagreement: ["Preflight remains out of scope."],
      unresolved_questions: ["Which consumer reads this later?"],
      recommended_next_action: "Land reader validation.",
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

function createMirror(prefix = "steve-reader-") {
  const { runsDir } = configureRuntime(prefix);
  const filename = runStore.saveRun(makeRunData(), { write_artifacts: true });
  const runId = filename.replace(".json", "");
  const runDir = path.join(runsDir, runId);

  return {
    filename,
    runDir,
    runId,
    runsDir,
  };
}

function replaceInFile(filePath, pattern, replacement) {
  const current = fs.readFileSync(filePath, "utf-8");
  fs.writeFileSync(filePath, current.replace(pattern, replacement), "utf-8");
}

test("artifact reader loads a valid mirror folder by path and run_id", () => {
  const { runDir, runId } = createMirror("steve-reader-valid-");

  const byPath = readArtifactMirror(runDir);
  const byRunId = readArtifactMirror(runId);

  assert.equal(byPath.valid, true);
  assert.deepEqual(byPath.errors, []);
  assert.equal(byPath.run_id, runId);
  assert.equal(byPath.prompt_packet.run_id, runId);
  assert.equal(byPath.events.length, 11);
  assert.equal(byPath.matrices.opening_matrix.rows.length, 2);
  assert.equal(byPath.matrices.cross_reply_matrix.rows.length, 2);
  assert.equal(Object.keys(byPath.posts).length, 5);
  assert.equal(Object.keys(byPath.packets).length, 5);
  assert.equal(byPath.minutes.run_id, runId);
  assert.equal(byPath.deviation_report.run_id, runId);

  assert.equal(byRunId.valid, true);
  assert.equal(byRunId.run_dir, runDir);
});

test("artifact validator fails when prompt_packet.json is missing", () => {
  const { runDir } = createMirror("steve-reader-missing-prompt-");
  fs.rmSync(path.join(runDir, "prompt_packet.json"));

  const result = validateArtifactFolder(runDir);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => {
    return error.code === "required_file_missing"
      && error.artifact_path === "prompt_packet.json";
  }));
});

test("artifact validator reports malformed events.jsonl as a hard error", () => {
  const { runDir } = createMirror("steve-reader-bad-events-");
  fs.appendFileSync(path.join(runDir, "events.jsonl"), "{not json}\n", "utf-8");

  const result = validateArtifactFolder(runDir);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === "required_jsonl_invalid"));
});

test("artifact validator rejects matrix references to missing artifact paths", () => {
  const { runDir } = createMirror("steve-reader-missing-matrix-ref-");
  const matrixPath = path.join(runDir, "matrices", "opening_matrix.csv");
  replaceInFile(matrixPath, "posts/round-0/o3/p001.md", "posts/round-0/o3/missing.md");

  const result = validateArtifactFolder(runDir);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => {
    return error.code === "matrix_artifact_missing"
      && error.artifact_path === "posts/round-0/o3/missing.md";
  }));
});

test("artifact validator rejects path traversal in artifact references", () => {
  const { runDir } = createMirror("steve-reader-traversal-");
  const matrixPath = path.join(runDir, "matrices", "opening_matrix.csv");
  replaceInFile(matrixPath, "posts/round-0/o3/p001.md", "../escape.md");

  const result = validateArtifactFolder(runDir);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => {
    return error.code === "unsafe_artifact_path"
      && error.artifact_path === "../escape.md";
  }));
});

test("artifact reader allows optional files to be missing with warnings", () => {
  const { runDir } = createMirror("steve-reader-optional-missing-");
  fs.rmSync(path.join(runDir, "matrices", "reception_matrix.csv"));
  fs.rmSync(path.join(runDir, "minutes.json"));
  fs.rmSync(path.join(runDir, "deviation_report.json"));
  fs.rmSync(path.join(runDir, "packets"), { recursive: true, force: true });

  const result = readArtifactMirror(runDir);

  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((warning) => warning.artifact_path === "matrices/reception_matrix.csv"));
  assert.ok(result.warnings.some((warning) => warning.artifact_path === "minutes.json"));
  assert.ok(result.warnings.some((warning) => warning.artifact_path === "deviation_report.json"));
  assert.ok(result.warnings.some((warning) => warning.artifact_path === "packets"));
  assert.equal(Object.keys(result.packets).length, 0);
});

test("artifact validator checks response hashes when available", () => {
  const { runDir } = createMirror("steve-reader-hash-mismatch-");
  fs.writeFileSync(path.join(runDir, "posts", "round-0", "o3", "p001.md"), "tampered", "utf-8");

  const result = validateArtifactFolder(runDir);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => {
    return error.code === "hash_mismatch"
      && error.artifact_path === "posts/round-0/o3/p001.md";
  }));
});

test("artifact reader import does not depend on live paid path modules", () => {
  const script = `
    const Module = require("module");
    const originalLoad = Module._load;
    Module._load = function guardedLoad(request) {
      const blocked = ["./council/pipeline", "./main", "electron"];
      if (blocked.includes(String(request))) {
        throw new Error("live paid path module loaded: " + request);
      }
      return originalLoad.apply(this, arguments);
    };
    const { readArtifactMirror } = require("./council/artifact-reader");
    process.stdout.write(typeof readArtifactMirror === "function" ? "ok" : "bad");
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ok");
});
