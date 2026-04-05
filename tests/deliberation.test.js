const test = require("node:test");
const assert = require("node:assert/strict");

const { parseDeliberationResponse } = require("../council/deliberation");

test("Deliberation parser preserves standard heading formats", () => {
  const response = [
    "Reply to @sonar - Strong point on grounded evidence, but you underweight latency tradeoffs.",
    "",
    "For @copilot:",
    "Your implementation framing is solid, but it glosses over concurrency edge cases.",
    "",
    "Re @claude:",
    "Your architecture point is directionally right, though a bit too broad.",
  ].join("\n");

  const parsed = parseDeliberationResponse(
    "o3",
    response,
    ["sonar", "copilot", "claude"],
    "p",
    1
  );

  assert.equal(parsed.parse_mode, "headed");
  assert.deepEqual(parsed.missing_targets, []);
  assert.deepEqual(parsed.posts.map((post) => post.reply_to), [
    "@sonar",
    "@copilot",
    "@claude",
  ]);
});

test("Deliberation parser supports markdown-decorated headings", () => {
  const response = [
    "**To @gemini:**",
    "Your framing is strong but still too broad.",
    "",
    "**For @claude:**",
    "The architecture point is useful but misses execution details.",
  ].join("\n");

  const parsed = parseDeliberationResponse(
    "o3",
    response,
    ["gemini", "claude"],
    "p",
    1
  );

  assert.equal(parsed.parse_mode, "headed");
  assert.deepEqual(parsed.missing_targets, []);
  assert.deepEqual(parsed.posts.map((post) => post.reply_to), [
    "@gemini",
    "@claude",
  ]);
});

test("Deliberation parser remaps a single self-target heading to the lone missing target", () => {
  const parsed = parseDeliberationResponse(
    "claude",
    [
      "To @sonar:",
      "Your framing is strong but still too abstract.",
      "",
      "To @copilot:",
      "Your point is clear but underspecified.",
      "",
      "To @claude:",
      "This section was clearly meant for the one remaining peer.",
      "",
      "To @o3:",
      "Your diagnosis is sharp but slightly too broad.",
    ].join("\n"),
    ["gemini", "sonar", "copilot", "o3"],
    "p",
    1
  );

  assert.deepEqual(parsed.missing_targets, []);
  assert.equal(parsed.posts.filter((post) => post.reply_to === "@gemini").length, 1);
  assert.equal(parsed.posts.filter((post) => post.reply_to === "@claude").length, 0);
});

test("Deliberation parser reports a total parser miss deterministically", () => {
  const parsed = parseDeliberationResponse(
    "o3",
    "I agree with some of the feedback, but the rest depends on implementation details.",
    ["gemini", "claude"],
    "p",
    1
  );

  assert.equal(parsed.parse_mode, "unparsed");
  assert.deepEqual(parsed.posts, []);
  assert.deepEqual(parsed.missing_targets, ["gemini", "claude"]);
});

test("Deliberation parser does not confuse substring handles", () => {
  const parsed = parseDeliberationResponse(
    "o3",
    [
      "To @copilot:",
      "A concrete reply for Copilot.",
      "",
      "To @co:",
      "A separate reply for Co.",
    ].join("\n"),
    ["copilot", "co"],
    "p",
    1
  );

  assert.deepEqual(parsed.posts.map((post) => post.reply_to), [
    "@copilot",
    "@co",
  ]);
});
