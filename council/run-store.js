const fs = require("fs");
const path = require("path");

const RUNS_DIR = path.resolve(__dirname, "..", "runs");

/**
 * Ensure the runs/ directory exists.
 */
function ensureDir() {
  if (!fs.existsSync(RUNS_DIR)) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
  }
}

/**
 * Generate a run filename: YYYY-MM-DD_HHMM_runN.json
 * N increments if a file for that minute already exists.
 */
function generateFilename() {
  ensureDir();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");

  const prefix = `${yyyy}-${mm}-${dd}_${hh}${mi}`;
  let n = 1;

  while (fs.existsSync(path.join(RUNS_DIR, `${prefix}_run${n}.json`))) {
    n++;
  }

  return `${prefix}_run${n}.json`;
}

/**
 * Save a run object to disk.
 * @param {object} runData — the complete run object
 * @returns {string} — the filename written
 */
function saveRun(runData) {
  ensureDir();
  const filename = generateFilename();
  const filepath = path.join(RUNS_DIR, filename);

  // Set run_id from filename (without extension)
  runData.run_id = filename.replace(".json", "");

  fs.writeFileSync(filepath, JSON.stringify(runData, null, 2), "utf-8");
  return filename;
}

/**
 * Load and parse a run file.
 * @param {string} filename — the run filename (e.g. "2026-03-31_1145_run1.json")
 * @returns {object} — parsed run object
 */
function loadRun(filename) {
  const filepath = path.join(RUNS_DIR, filename);
  const raw = fs.readFileSync(filepath, "utf-8");
  return JSON.parse(raw);
}

/**
 * List all run filenames sorted by date (newest first).
 * @returns {string[]} — array of filenames
 */
function listRuns() {
  ensureDir();
  const files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
  files.sort().reverse();
  return files;
}

module.exports = { saveRun, loadRun, listRuns };
