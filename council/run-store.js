const fs = require("fs");
const path = require("path");

const {
  assertPathInsideUserDataRoot,
  getRunArtifactsDir,
} = require("../runtime/runtime-paths");

function ensureRunArtifactsDir() {
  return getRunArtifactsDir();
}

function generateFilename() {
  const runsDir = ensureRunArtifactsDir();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");

  const prefix = `${yyyy}-${mm}-${dd}_${hh}${mi}`;
  let n = 1;

  while (
    fs.existsSync(path.join(runsDir, `${prefix}_run${n}.json`))
    || fs.existsSync(path.join(runsDir, `${prefix}_run${n}`))
  ) {
    n++;
  }

  return `${prefix}_run${n}.json`;
}

function saveRun(runData, options = {}) {
  const config = {
    write_artifacts: false,
    ...options,
  };
  const runsDir = ensureRunArtifactsDir();
  const filename = generateFilename();
  const runId = filename.replace(".json", "");
  const filepath = assertPathInsideUserDataRoot(
    path.join(runsDir, filename),
    "run artifact file"
  );
  const mirrorDir = assertPathInsideUserDataRoot(
    path.join(runsDir, runId),
    "run artifact mirror directory"
  );

  runData.run_id = runId;

  fs.writeFileSync(filepath, JSON.stringify(runData, null, 2), "utf-8");

  if (config.write_artifacts) {
    const { mirrorRunArtifacts } = require("./artifact-mirror");
    mirrorRunArtifacts(runData, {
      runsDir,
      runId,
      sourceJsonFilename: filename,
    });

    if (!fs.existsSync(mirrorDir)) {
      throw new Error(`Artifact mirror was not created for run_id "${runId}".`);
    }
  }

  return filename;
}

function loadRun(filename) {
  const filepath = assertPathInsideUserDataRoot(
    path.join(ensureRunArtifactsDir(), filename),
    "run artifact file"
  );
  const raw = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

function listRuns() {
  const runsDir = ensureRunArtifactsDir();
  const files = fs.readdirSync(runsDir).filter((entry) => entry.endsWith(".json"));
  files.sort().reverse();
  return files;
}

module.exports = { saveRun, loadRun, listRuns };
