const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const runtimePaths = require("./runtime-paths");
const runStore = require("../council/run-store");

function makeSandboxRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("runtime paths never resolve under the repo root", () => {
  const sandboxRoot = makeSandboxRoot("steve-runtime-root-");
  const projectRoot = path.join(sandboxRoot, "project");
  const nestedUserDataRoot = path.join(projectRoot, "profiles");

  fs.mkdirSync(projectRoot, { recursive: true });

  assert.throws(
    () => runtimePaths.configureRuntimePaths({ projectRoot, userDataRoot: nestedUserDataRoot }),
    /Runtime state must live outside the repo root/
  );
});

test("startup guard catches legacy runtime directories under the repo root", () => {
  const legacyDirs = ["profiles", "sessions", "local_data", "runs", "logs", "run-artifacts"];

  for (const legacyDir of legacyDirs) {
    const sandboxRoot = makeSandboxRoot(`steve-legacy-${legacyDir}-`);
    const projectRoot = path.join(sandboxRoot, "project");
    const userDataRoot = path.join(sandboxRoot, "user-data");

    fs.mkdirSync(path.join(projectRoot, legacyDir), { recursive: true });
    runtimePaths.configureRuntimePaths({ projectRoot, userDataRoot });

    assert.throws(
      () => runtimePaths.assertNoLegacyRepoRuntimeDirs(),
      new RegExp(`Legacy repo-local runtime directories detected.*${legacyDir}`)
    );
  }
});

test("run-store refuses paths that escape the runtime root", () => {
  const sandboxRoot = makeSandboxRoot("steve-run-store-");
  const projectRoot = path.join(sandboxRoot, "project");
  const userDataRoot = path.join(sandboxRoot, "user-data");

  fs.mkdirSync(projectRoot, { recursive: true });
  runtimePaths.configureRuntimePaths({ projectRoot, userDataRoot });

  const filename = runStore.saveRun({ status: "ok", posts: [] });
  const artifactPath = path.join(runtimePaths.getRunArtifactsDir(), filename);
  assert.ok(artifactPath.startsWith(runtimePaths.getUserDataRoot()));

  assert.throws(
    () => runStore.loadRun(path.join("..", "..", "escape.json")),
    /Unsafe run artifact file/
  );
});

test("test mode isolates runtime paths from real profile roots", () => {
  const previousEnv = process.env.STEVE_ENV;
  const previousOverride = process.env.STEVE_USER_DATA_ROOT;

  try {
    delete process.env.STEVE_USER_DATA_ROOT;
    process.env.STEVE_ENV = "test";

    const sandboxRoot = makeSandboxRoot("steve-test-mode-");
    const projectRoot = path.join(sandboxRoot, "project");
    fs.mkdirSync(projectRoot, { recursive: true });

    runtimePaths.configureRuntimePaths({ projectRoot });

    const userDataRoot = runtimePaths.getUserDataRoot();
    const profileDir = runtimePaths.getProviderProfileDir("grok");

    assert.match(userDataRoot, /SteveApp-test/i);
    assert.ok(profileDir.startsWith(userDataRoot));
    assert.equal(path.relative(projectRoot, userDataRoot).startsWith(".."), true);
  } finally {
    if (previousEnv === undefined) {
      delete process.env.STEVE_ENV;
    } else {
      process.env.STEVE_ENV = previousEnv;
    }

    if (previousOverride === undefined) {
      delete process.env.STEVE_USER_DATA_ROOT;
    } else {
      process.env.STEVE_USER_DATA_ROOT = previousOverride;
    }
  }
});
