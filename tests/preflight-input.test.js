const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  PREFLIGHT_SCHEMA_VERSION,
  buildPreflightInput,
  validatePreflightInput,
} = require("../council/preflight-input");

function sha256(text) {
  return crypto.createHash("sha256").update(Buffer.from(text, "utf-8")).digest("hex");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validPacket(overrides = {}) {
  return {
    schema_version: PREFLIGHT_SCHEMA_VERSION,
    prompt: "Validate this prompt.",
    prompt_sha256: sha256("Validate this prompt."),
    prompt_byte_length: Buffer.byteLength("Validate this prompt.", "utf-8"),
    run_id: null,
    agents_active: null,
    timestamp: null,
    references: [],
    ...overrides,
  };
}

test("preflight input builds ASCII prompt hash and byte length", () => {
  const prompt = "Plain ASCII prompt.";
  const packet = buildPreflightInput({ prompt });

  assert.equal(packet.schema_version, "steve.v1.preflight_input");
  assert.equal(packet.prompt, prompt);
  assert.equal(packet.prompt_sha256, sha256(prompt));
  assert.equal(packet.prompt_byte_length, Buffer.byteLength(prompt, "utf-8"));
});

test("preflight input builds multi-byte UTF-8 prompt hash and byte length", () => {
  const prompt = "Résumé prompt with π and 漢字.";
  const packet = buildPreflightInput({ prompt });

  assert.equal(packet.prompt_sha256, sha256(prompt));
  assert.equal(packet.prompt_byte_length, Buffer.byteLength(prompt, "utf-8"));
  assert.notEqual(packet.prompt_byte_length, prompt.length);
});

test("preflight input handles an empty string prompt", () => {
  const packet = buildPreflightInput({ prompt: "" });

  assert.equal(packet.prompt, "");
  assert.equal(packet.prompt_sha256, sha256(""));
  assert.equal(packet.prompt_byte_length, 0);
  assert.deepEqual(validatePreflightInput(packet), {
    valid: true,
    errors: [],
    warnings: [],
  });
});

test("preflight input defaults absent run_id to null", () => {
  const packet = buildPreflightInput({ prompt: "No run id yet." });

  assert.equal(packet.run_id, null);
});

test("preflight validator rejects non-string run_id", () => {
  const packet = validPacket({ run_id: 42 });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "run_id_invalid"));
});

test("preflight validator rejects empty run_id", () => {
  const packet = validPacket({ run_id: "" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "run_id_invalid"));
});

test("preflight input defaults absent agents_active to null", () => {
  const packet = buildPreflightInput({ prompt: "No agents chosen yet." });

  assert.equal(packet.agents_active, null);
});

test("preflight input preserves provided agents_active order deterministically", () => {
  const agents = ["@sonar", "@o3", "@gemini"];
  const packet = buildPreflightInput({
    prompt: "Preserve agent order.",
    agents_active: agents,
  });

  assert.deepEqual(packet.agents_active, agents);
  agents.push("@claude");
  assert.deepEqual(packet.agents_active, ["@sonar", "@o3", "@gemini"]);
});

test("preflight validator rejects non-array agents_active", () => {
  const packet = validPacket({ agents_active: "x" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "agents_active_invalid"));
});

test("preflight validator rejects non-string agents_active entries", () => {
  const packet = validPacket({ agents_active: [1, 2] });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "agents_active_invalid"));
});

test("preflight validator accepts agents_active strings and preserves order", () => {
  const packet = buildPreflightInput({
    prompt: "Preserve plain handles.",
    agents_active: ["claude", "codex"],
  });

  assert.deepEqual(packet.agents_active, ["claude", "codex"]);
  assert.equal(validatePreflightInput(packet).valid, true);
});

test("preflight input defaults absent references to an empty array", () => {
  const packet = buildPreflightInput({ prompt: "No references." });

  assert.deepEqual(packet.references, []);
});

test("preflight input includes references only from explicit caller input", () => {
  const references = [
    { path: "docs/spec.md", label: "Spec" },
    { url: "https://example.com/reference", title: "External reference" },
  ];
  const packet = buildPreflightInput({
    prompt: "Use explicit references only.",
    references,
  });

  assert.deepEqual(packet.references, references);
  references[0].path = "docs/changed.md";
  assert.equal(packet.references[0].path, "docs/spec.md");
});

test("preflight validator rejects non-array references", () => {
  const packet = validPacket({ references: "x" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "references_invalid"));
});

test("preflight validator rejects path traversal in any reference string value", () => {
  const packet = validPacket({
    references: [
      { target: "../escape" },
    ],
  });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => {
    return error.code === "unsafe_reference_path"
      && error.value === "../escape";
  }));
});

test("preflight validator rejects absolute url-like reference paths", () => {
  const packet = validPacket({
    references: [
      { url: "/etc/passwd" },
    ],
  });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => {
    return error.code === "unsafe_reference_path"
      && error.value === "/etc/passwd";
  }));
});

test("preflight validator rejects Windows absolute reference strings under any key", () => {
  const packet = validPacket({
    references: [
      { location: "C:\\Users\\x" },
    ],
  });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => {
    return error.code === "unsafe_reference_path"
      && error.value === "C:\\Users\\x";
  }));
});

test("preflight validator accepts safe explicit reference objects", () => {
  const packet = buildPreflightInput({
    prompt: "Use safe references.",
    references: [
      {
        target: "docs/spec.md",
        url: "https://example.com/reference",
        location: "notes/local-context.md",
      },
    ],
  });

  assert.equal(validatePreflightInput(packet).valid, true);
});

test("preflight validator accepts a valid ISO timestamp", () => {
  const packet = buildPreflightInput({
    prompt: "Timestamped packet.",
    timestamp: "2026-05-08T12:34:56.000Z",
  });

  assert.equal(packet.timestamp, "2026-05-08T12:34:56.000Z");
  assert.equal(validatePreflightInput(packet).valid, true);
});

test("preflight validator rejects non-string timestamp", () => {
  const packet = validPacket({ timestamp: 42 });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "timestamp_invalid"));
});

test("preflight validator rejects invalid timestamp strings", () => {
  const packet = validPacket({ timestamp: "not a date" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "timestamp_invalid"));
});

test("preflight validator rejects parseable non-ISO timestamp strings", () => {
  const packet = validPacket({ timestamp: "May 8, 2026" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "timestamp_invalid"));
});

test("preflight validator rejects post-run mirror prompt packet schema", () => {
  const packet = {
    schema_version: 1,
    packet_type: "steve.v1.prompt_packet",
    run_id: "x",
    prompt: "x",
    prompt_sha256: sha256("x"),
    prompt_byte_length: Buffer.byteLength("x", "utf-8"),
  };

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "schema_version_invalid"));
});

test("preflight validator rejects missing prompt", () => {
  const packet = validPacket();
  delete packet.prompt;

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "prompt_missing"));
});

test("preflight validator rejects null packet", () => {
  const validation = validatePreflightInput(null);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "packet_invalid"));
});

test("preflight validator rejects array packet", () => {
  const validation = validatePreflightInput([]);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "packet_invalid"));
});

test("preflight builder rejects non-object input", () => {
  assert.throws(
    () => buildPreflightInput("string"),
    /input object/
  );
});

test("preflight validator rejects missing schema_version", () => {
  const packet = validPacket();
  delete packet.schema_version;

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "schema_version_invalid"));
});

test("preflight validator rejects wrong schema_version", () => {
  const packet = validPacket({ schema_version: "wrong" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "schema_version_invalid"));
});

test("preflight validator rejects non-string prompt", () => {
  const packet = validPacket({ prompt: 42 });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "prompt_invalid"));
});

test("preflight validator rejects mismatched prompt_sha256", () => {
  const packet = validPacket({ prompt_sha256: "bad-hash" });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "prompt_hash_mismatch"));
});

test("preflight validator rejects mismatched prompt_byte_length", () => {
  const packet = validPacket({ prompt_byte_length: 999 });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "prompt_byte_length_mismatch"));
});

test("preflight validator rejects unsafe absolute reference paths", () => {
  const packet = validPacket({
    references: [
      { path: "C:\\Users\\Antal\\secret.txt" },
      { path: "/var/tmp/secret.txt" },
    ],
  });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.filter((error) => error.code === "unsafe_reference_path").length, 2);
});

test("preflight validator rejects reference path traversal", () => {
  const packet = validPacket({
    references: [
      { path: "../escape.md" },
    ],
  });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => {
    return error.code === "unsafe_reference_path"
      && error.value === "../escape.md";
  }));
});

test("preflight validator rejects reference path escape attempts", () => {
  const packet = validPacket({
    references: [
      { path: "safe/../../escape.md" },
    ],
  });

  const validation = validatePreflightInput(packet);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => {
    return error.code === "unsafe_reference_path"
      && error.value === "safe/../../escape.md";
  }));
});

test("preflight output object and nested arrays are frozen", () => {
  const packet = buildPreflightInput({
    prompt: "Freeze this packet.",
    agents_active: ["@o3"],
    references: [{ path: "docs/spec.md" }],
  });

  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.agents_active), true);
  assert.equal(Object.isFrozen(packet.references), true);
  assert.equal(Object.isFrozen(packet.references[0]), true);
  assert.throws(
    () => packet.references.push({ path: "docs/other.md" }),
    TypeError
  );

  const before = clone(packet);
  packet.prompt = "mutated";
  packet.references[0].path = "docs/mutated.md";
  assert.deepEqual(clone(packet), before);
});

test("preflight output freezes nested objects beyond one level", () => {
  const packet = buildPreflightInput({
    prompt: "Deep freeze references.",
    references: [
      {
        meta: {
          nested: true,
        },
      },
    ],
  });

  assert.equal(Object.isFrozen(packet.references[0].meta), true);
  const before = clone(packet);
  packet.references[0].meta.nested = false;
  assert.deepEqual(clone(packet), before);
});

test("importing preflight-input does not import paid, artifact, browser, or agent modules", () => {
  const script = `
    const Module = require("module");
    const originalLoad = Module._load;
    Module._load = function guardedLoad(request) {
      const blocked = [
        "main.js",
        "council/pipeline",
        "electron",
        "playwright",
        "artifact-mirror",
        "artifact-reader",
        "artifact-validator",
        "agents/",
        "chatgpt-agent",
        "claude-agent",
        "perplexity-agent",
        "gemini-agent",
        "copilot-agent",
        "meta-agent",
        "grok-agent"
      ];
      if (blocked.some((name) => String(request).includes(name))) {
        throw new Error("blocked module loaded: " + request);
      }
      return originalLoad.apply(this, arguments);
    };
    const { buildPreflightInput } = require("./council/preflight-input");
    const packet = buildPreflightInput({ prompt: "offline only" });
    process.stdout.write(packet.schema_version);
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, PREFLIGHT_SCHEMA_VERSION);
});

test("paid V1 default-off path does not import preflight-input", () => {
  const script = `
    const Module = require("module");
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const originalLoad = Module._load;
    Module._load = function guardedLoad(request) {
      if (String(request).includes("preflight-input")) {
        throw new Error("preflight-input loaded on paid default-off path");
      }
      return originalLoad.apply(this, arguments);
    };
    const runtimePaths = require("./runtime/runtime-paths");
    const Pipeline = require("./council/pipeline");
    const { saveRun } = require("./council/run-store");
    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "steve-preflight-default-off-"));
    const projectRoot = path.join(sandboxRoot, "project");
    const userDataRoot = path.join(sandboxRoot, "user-data");
    fs.mkdirSync(projectRoot, { recursive: true });
    runtimePaths.configureRuntimePaths({ projectRoot, userDataRoot });
    saveRun({
      status: "completed",
      timestamp: "2026-05-08T12:00:00.000Z",
      prompt: "paid path",
      agents_active: [],
      stages_completed: [],
      posts: [],
      minutes: {},
      failures: []
    }, { write_artifacts: false });
    process.stdout.write(typeof Pipeline === "function" ? "ok" : "bad");
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ok");
});
