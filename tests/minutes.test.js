const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMinutesPrompt, parseMinutesResponse } = require("../council/minutes");
const { parseDeliberationResponse } = require("../council/deliberation");

test("Minutes prompt explicitly instructs any scribe to return JSON rather than continue the debate", () => {
  const prompt = buildMinutesPrompt(
    "What should we do?",
    [
      {
        author: "@o3",
        stage: "opening",
        reply_to: null,
        content: "Opening statement",
      },
      {
        author: "@gemini",
        stage: "deliberation",
        reply_to: "@o3",
        content: "Reply text",
      },
    ],
    ["o3", "gemini"]
  );

  assert.match(prompt, /Return exactly one valid JSON object/);
  assert.match(prompt, /Do not continue the debate/);
  assert.match(prompt, /The first character of your reply must be \{/);
});

test("Minutes parser extracts structured fields from labeled prose fallback for any scribe", () => {
  const response = [
    "Points of Agreement:",
    "- Copilot is a product wrapper.",
    "- Ecosystem fit matters.",
    "",
    "Points of Disagreement:",
    "- Transparency scores differ.",
    "",
    "Unresolved Questions:",
    "- Which retrieval stack is most reliable?",
    "",
    "Recommended Next Action: Run a controlled benchmark.",
    "Consensus Level: moderate",
    "Summary: The council agreed on product framing but not on raw capability gaps.",
  ].join("\n");

  const minutes = parseMinutesResponse(response, "grok", ["o3", "gemini", "grok"]);

  assert.equal(minutes.generated_by, "@grok");
  assert.equal(minutes.parse_status, "section_fallback");
  assert.deepEqual(minutes.points_of_agreement, [
    "Copilot is a product wrapper.",
    "Ecosystem fit matters.",
  ]);
  assert.deepEqual(minutes.points_of_disagreement, [
    "Transparency scores differ.",
  ]);
  assert.deepEqual(minutes.unresolved_questions, [
    "Which retrieval stack is most reliable?",
  ]);
  assert.equal(minutes.recommended_next_action, "Run a controlled benchmark.");
  assert.equal(minutes.consensus_level, "moderate");
});

test("Minutes parser preserves already-valid JSON responses", () => {
  const response = JSON.stringify(
    {
      points_of_agreement: ["Parser fixes are testable."],
      points_of_disagreement: ["Lifecycle work has broader scope."],
      unresolved_questions: ["What should be measured next?"],
      recommended_next_action: "Ship the parser patch.",
      consensus_level: "moderate",
      raw_minutes_text: "The council agreed to land the parser change first.",
    },
    null,
    2
  );

  const minutes = parseMinutesResponse(response, "sonar", ["o3", "claude", "sonar"]);

  assert.equal(minutes.parse_status, "json");
  assert.deepEqual(minutes.points_of_agreement, ["Parser fixes are testable."]);
  assert.equal(minutes.recommended_next_action, "Ship the parser patch.");
  assert.equal(minutes.raw_minutes_text, "The council agreed to land the parser change first.");
});

test("Minutes parser repairs unescaped internal quotes inside JSON string values", () => {
  const response = [
    "{",
    '  "points_of_agreement": ["Parser fixes are testable."],',
    '  "points_of_disagreement": ["Whether to prioritize "parser determinism" before lifecycle work."],',
    '  "unresolved_questions": ["What should define "parser determinism" in tests?"],',
    '  "recommended_next_action": "Ship the "parser determinism" patch first.",',
    '  "consensus_level": "moderate",',
    '  "raw_minutes_text": "The council agreed that "parser determinism" is the best first step."',
    "}",
  ].join("\n");

  const minutes = parseMinutesResponse(response, "sonar", ["o3", "claude", "sonar"]);

  assert.equal(minutes.parse_status, "json_repaired");
  assert.deepEqual(minutes.points_of_disagreement, [
    'Whether to prioritize "parser determinism" before lifecycle work.',
  ]);
  assert.deepEqual(minutes.unresolved_questions, [
    'What should define "parser determinism" in tests?',
  ]);
  assert.equal(minutes.recommended_next_action, 'Ship the "parser determinism" patch first.');
  assert.equal(
    minutes.raw_minutes_text,
    'The council agreed that "parser determinism" is the best first step.'
  );
});

test("Minutes parser leaves non-JSON garbage on raw fallback", () => {
  const response = "not json at all, just a loose paragraph with no schema";
  const minutes = parseMinutesResponse(response, "sonar", ["o3", "claude", "sonar"]);

  assert.equal(minutes.parse_status, "raw_fallback");
  assert.deepEqual(minutes.points_of_agreement, []);
  assert.equal(minutes.raw_minutes_text, response);
});

test("Deliberation parser preserves existing supported headed reply formats", () => {
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

test("Deliberation parser remaps a single self-target heading to the lone missing target", () => {
  const cases = [
    {
      authorHandle: "claude",
      otherHandles: ["gemini", "sonar", "copilot", "o3"],
      missingTarget: "@gemini",
      response: [
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
    },
    {
      authorHandle: "gemini",
      otherHandles: ["sonar", "claude", "copilot", "o3"],
      missingTarget: "@o3",
      response: [
        "To @sonar:",
        "Strong point on telemetry patterns.",
        "",
        "To @claude:",
        "Clear point on actionable data.",
        "",
        "To @copilot:",
        "Useful point on stability outcomes.",
        "",
        "To @gemini:",
        "This section was clearly meant for the one remaining peer.",
      ].join("\n"),
    },
    {
      authorHandle: "o3",
      otherHandles: ["gemini", "sonar", "copilot", "claude"],
      missingTarget: "@gemini",
      response: [
        "To @sonar:",
        "Good system-level framing.",
        "",
        "To @copilot:",
        "Good plain-language framing.",
        "",
        "To @claude:",
        "Most mechanically precise reply.",
        "",
        "To @o3:",
        "This section was clearly meant for the one remaining peer.",
      ].join("\n"),
    },
  ];

  for (const testCase of cases) {
    const parsed = parseDeliberationResponse(
      testCase.authorHandle,
      testCase.response,
      testCase.otherHandles,
      "p",
      1
    );

    assert.deepEqual(parsed.missing_targets, []);
    assert.equal(
      parsed.posts.filter((post) => post.reply_to === testCase.missingTarget).length,
      1
    );
    assert.equal(
      parsed.posts.filter((post) => post.reply_to === `@${testCase.authorHandle}`).length,
      0
    );
  }
});
