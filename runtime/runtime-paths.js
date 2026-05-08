const fs = require("fs");
const os = require("os");
const path = require("path");

const LEGACY_REPO_DIRS = ["profiles", "sessions", "local_data", "runs", "logs", "run-artifacts"];
const TEST_ROOT_NAME = "SteveApp-test";
const state = {
  projectRoot: path.resolve(__dirname, ".."),
  userDataRoot: null,
};

function isTestEnv() {
  return String(process.env.STEVE_ENV || "").toLowerCase() === "test";
}

function assertAbsolutePath(candidate, label) {
  const value = String(candidate || "").trim();
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }

  if (!path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path. Relative runtime paths are not allowed.`);
  }

  return path.resolve(value);
}

function isInsidePath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function resolveConfiguredRoot({ app, userDataRoot, projectRoot } = {}) {
  const resolvedProjectRoot = assertAbsolutePath(projectRoot || state.projectRoot, "Steve project root");

  let resolvedUserDataRoot = null;
  if (userDataRoot) {
    resolvedUserDataRoot = assertAbsolutePath(userDataRoot, "Steve user data root");
  } else if (process.env.STEVE_USER_DATA_ROOT) {
    resolvedUserDataRoot = assertAbsolutePath(process.env.STEVE_USER_DATA_ROOT, "STEVE_USER_DATA_ROOT");
  } else if (isTestEnv()) {
    resolvedUserDataRoot = path.join(os.tmpdir(), TEST_ROOT_NAME);
  } else if (app && typeof app.getPath === "function") {
    const localAppData = String(process.env.LOCALAPPDATA || "").trim();
    if (!localAppData) {
      throw new Error("LOCALAPPDATA is unavailable. Steve requires a Windows local app data root.");
    }

    const defaultUserDataRoot = assertAbsolutePath(app.getPath("userData"), "Electron userData root");
    resolvedUserDataRoot = path.join(localAppData, path.basename(defaultUserDataRoot));
  } else {
    throw new Error(
      "Steve runtime root is not configured. Pass Electron app.getPath('userData'), or set STEVE_USER_DATA_ROOT / STEVE_ENV=test."
    );
  }

  const safeUserDataRoot = assertAbsolutePath(resolvedUserDataRoot, "Steve user data root");
  if (isInsidePath(resolvedProjectRoot, safeUserDataRoot)) {
    throw new Error(
      `Unsafe Steve user data root "${safeUserDataRoot}". Runtime state must live outside the repo root "${resolvedProjectRoot}".`
    );
  }

  return {
    projectRoot: resolvedProjectRoot,
    userDataRoot: safeUserDataRoot,
  };
}

function configureRuntimePaths(options = {}) {
  const resolved = resolveConfiguredRoot(options);
  state.projectRoot = resolved.projectRoot;
  state.userDataRoot = resolved.userDataRoot;
  ensureRuntimeDirectories();
  return state.userDataRoot;
}

function getProjectRoot() {
  return state.projectRoot;
}

function getUserDataRoot() {
  if (!state.userDataRoot) {
    configureRuntimePaths();
  }

  return ensureDir(state.userDataRoot);
}

function assertPathInsideUserDataRoot(candidatePath, label = "runtime path") {
  const resolvedPath = assertAbsolutePath(candidatePath, label);
  const userDataRoot = getUserDataRoot();

  if (!isInsidePath(userDataRoot, resolvedPath)) {
    throw new Error(
      `Unsafe ${label} "${resolvedPath}". Steve may only write runtime state under "${userDataRoot}".`
    );
  }

  return resolvedPath;
}

function resolveRuntimeSubdir(subdirName) {
  const targetPath = path.join(getUserDataRoot(), subdirName);
  assertPathInsideUserDataRoot(targetPath, `${subdirName} directory`);
  return ensureDir(targetPath);
}

function getProfilesRoot() {
  return resolveRuntimeSubdir("profiles");
}

function getProviderProfileDir(provider) {
  const safeProvider = String(provider || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(safeProvider)) {
    throw new Error(`Invalid provider name "${provider}".`);
  }

  const profileDir = path.join(getProfilesRoot(), safeProvider);
  assertPathInsideUserDataRoot(profileDir, `${safeProvider} profile directory`);
  return ensureDir(profileDir);
}

function getLogsDir() {
  return resolveRuntimeSubdir("logs");
}

function getRunArtifactsDir() {
  return resolveRuntimeSubdir("run-artifacts");
}

function getConfigDir() {
  return resolveRuntimeSubdir("config");
}

function ensureRuntimeDirectories() {
  getProfilesRoot();
  getLogsDir();
  getRunArtifactsDir();
  getConfigDir();
  return getUserDataRoot();
}

function listLegacyRepoRuntimeDirs() {
  const projectRoot = getProjectRoot();
  return LEGACY_REPO_DIRS
    .map((dirName) => ({
      dirName,
      dirPath: path.join(projectRoot, dirName),
    }))
    .filter(({ dirPath }) => fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory());
}

function assertNoLegacyRepoRuntimeDirs() {
  const legacyDirs = listLegacyRepoRuntimeDirs();
  if (legacyDirs.length === 0) {
    return;
  }

  const foundNames = legacyDirs.map(({ dirName }) => dirName).join(", ");
  throw new Error(
    `Legacy repo-local runtime directories detected under "${getProjectRoot()}": ${foundNames}. `
    + `Remove them or migrate them explicitly before launching Steve. `
    + `Steve now stores runtime state only under "${getUserDataRoot()}".`
  );
}

module.exports = {
  assertNoLegacyRepoRuntimeDirs,
  assertPathInsideUserDataRoot,
  configureRuntimePaths,
  ensureRuntimeDirectories,
  getConfigDir,
  getLogsDir,
  getProjectRoot,
  getProviderProfileDir,
  getRunArtifactsDir,
  getUserDataRoot,
  listLegacyRepoRuntimeDirs,
};
