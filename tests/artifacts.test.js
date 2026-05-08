const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { writeArtifact } = require("../council/artifact-writer");
const { appendEvent, EVENT_FIELDS } = require("../council/event-log");
const { buildDeliberationPrompt } = require("../council/deliberation");
const { writeMatrices } = require("../council/matrix-writer");
const { buildV1PaidDeliberationPacket } = require("../council/round-packet");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

test("event log appends valid JSONL with injected timestamps", () => {
  const dir = makeTempDir("steve-event-log-");
  const logPath = path.join(dir, "nested", "events.jsonl");
  const timestamp = "2026-05-04T12:00:00.000Z";

  appendEvent(
    logPath,
    {
      run_id: "run-001",
      stage: "opening",
      round: 0,
      agent: "@o3",
      type: "prompt",
      status: "written",
      artifact_path: "opening/round-0/o3/prompt.md",
      prompt_hash: "prompt-hash",
      response_hash: null,
    },
    { timestamp }
  );

  appendEvent(
    logPath,
    {
      run_id: "run-001",
      stage: "opening",
      round: 0,
      agent: "@o3",
      type: "post",
      status: "written",
      artifact_path: "opening/round-0/o3/p001.md",
      prompt_hash: "prompt-hash",
      response_hash: "response-hash",
    },
    { timestamp }
  );

  const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
  assert.equal(lines.length, 2);

  for (const line of lines) {
    const event = JSON.parse(line);
    for (const field of EVENT_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(event, field), field);
    }
    assert.equal(event.timestamp, timestamp);
    assert.equal(event.run_id, "run-001");
  }
});

test("artifact writer writes content and returns relative path, hash, and byte length", () => {
  const rootDir = makeTempDir("steve-artifact-writer-");
  const content = "# Opening\n\nSafe markdown/text content.\n";
  const result = writeArtifact({
    rootDir,
    artifactPath: "posts/opening/o3/p001.md",
    content,
  });

  assert.deepEqual(result, {
    artifact_path: "posts/opening/o3/p001.md",
    sha256: sha256(content),
    byte_length: Buffer.byteLength(content, "utf-8"),
  });
  assert.equal(
    fs.readFileSync(path.join(rootDir, "posts", "opening", "o3", "p001.md"), "utf-8"),
    content
  );
  assert.throws(
    () => writeArtifact({ rootDir, artifactPath: "../escape.md", content: "no" }),
    /Unsafe artifact path/
  );
});

test("round packet V1 paid deliberation stays byte-identical to buildDeliberationPrompt", () => {
  const prompt = "Evaluate a local-first artifact ledger design for Steve.";
  const allOpeningPosts = [
    ["o3", "o3 opening with model orchestration and paid-flow compatibility concerns."],
    ["gemini", "Gemini opening with system tradeoffs and storage layout concerns."],
    ["copilot", "Copilot opening with implementation sequencing and test coverage concerns."],
    ["claude", "Claude opening with architecture boundaries and migration risk concerns."],
    ["sonar", "Sonar opening with traceability and source citation concerns."],
    ["meta", "Meta opening with UX impact and resilience concerns."],
    ["grok", "Grok opening with operational simplicity and failure-mode concerns."],
  ].map(([handle, content], index) => ({
    post_id: `p00${index + 1}`,
    author: `@${handle}`,
    stage: "opening",
    type: "statement",
    reply_to: null,
    timestamp: "2026-05-04T12:00:00.000Z",
    content,
  }));
  const otherPosts = allOpeningPosts.filter((post) => post.author !== "@o3");

  const expected = buildDeliberationPrompt("o3", prompt, otherPosts);
  const actual = buildV1PaidDeliberationPacket({
    agentHandle: "o3",
    prompt,
    otherPosts,
  });

  assert.equal(Buffer.compare(Buffer.from(actual, "utf-8"), Buffer.from(expected, "utf-8")), 0);
});

test("matrix writer produces expected headers and artifact references without full responses", () => {
  const dir = makeTempDir("steve-matrix-writer-");
  const longOpening = "o3 ".repeat(500);
  const posts = [
    {
      post_id: "p001",
      author: "@o3",
      stage: "opening",
      type: "statement",
      reply_to: null,
      timestamp: "2026-05-04T12:00:01.000Z",
      content: longOpening,
      word_count: 500,
      capture_status: "complete",
    },
    {
      post_id: "p002",
      author: "@gemini",
      stage: "opening",
      type: "statement",
      reply_to: null,
      timestamp: "2026-05-04T12:00:02.000Z",
      content: "gemini opening",
      word_count: 2,
      capture_status: "complete",
    },
    {
      post_id: "p003",
      author: "@o3",
      stage: "deliberation",
      type: "reply",
      reply_to: "@gemini",
      timestamp: "2026-05-04T12:00:03.000Z",
      content: "I agree on the data layout, but add deterministic hashes.",
      word_count: 10,
      capture_status: "complete",
    },
  ];
  const artifactsByPostId = {
    p001: {
      artifact_path: "posts/opening/o3/p001.md",
      sha256: sha256(longOpening),
      byte_length: Buffer.byteLength(longOpening, "utf-8"),
    },
    p002: {
      artifact_path: "posts/opening/gemini/p002.md",
      sha256: sha256("gemini opening"),
      byte_length: Buffer.byteLength("gemini opening", "utf-8"),
    },
    p003: {
      artifact_path: "posts/deliberation/o3/p003.md",
      sha256: sha256(posts[2].content),
      byte_length: Buffer.byteLength(posts[2].content, "utf-8"),
    },
  };

  const result = writeMatrices(dir, {
    posts,
    artifactsByPostId,
    agents: ["@o3", "@gemini"],
  });

  assert.equal(result.opening_matrix.filename, "opening_matrix.csv");
  assert.equal(result.cross_reply_matrix.filename, "cross_reply_matrix.csv");

  const openingCsv = fs.readFileSync(path.join(dir, "opening_matrix.csv"), "utf-8");
  const crossReplyCsv = fs.readFileSync(path.join(dir, "cross_reply_matrix.csv"), "utf-8");

  assert.match(openingCsv, /^post_id,agent,stage,type,status,timestamp,response_hash,artifact_path,byte_length,word_count\n/);
  assert.match(crossReplyCsv, /^post_id,from_agent,to_agent,stage,type,status,timestamp,response_hash,artifact_path,byte_length,word_count\n/);
  assert.match(openingCsv, /posts\/opening\/o3\/p001\.md/);
  assert.match(crossReplyCsv, /posts\/deliberation\/o3\/p003\.md/);
  assert.match(crossReplyCsv, /@gemini,@o3,deliberation,reply,missing/);
  assert.equal(openingCsv.includes(longOpening), false);
});
