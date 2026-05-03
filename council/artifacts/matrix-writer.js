/**
 * matrix-writer.js - renders CSV matrix views from in-memory post records.
 *
 * Contract (see docs/debate_artifacts.md):
 *   - Three matrices: opening_matrix.csv, cross_reply_matrix.csv,
 *     reception_matrix.csv.
 *   - CSV cells reference artifact paths and hashes; they never embed
 *     verbatim agent text.
 *   - Matrices are derived views. They are regenerable from the JSON/JSONL
 *     artifacts and can be deleted without corrupting the run.
 *
 * Not implemented yet. The pipeline does not call this module.
 */

function writeOpeningMatrix(_runDir, _records) {
  throw new Error("matrix-writer.writeOpeningMatrix not implemented yet");
}

function writeCrossReplyMatrix(_runDir, _records) {
  throw new Error("matrix-writer.writeCrossReplyMatrix not implemented yet");
}

function writeReceptionMatrix(_runDir, _records) {
  throw new Error("matrix-writer.writeReceptionMatrix not implemented yet");
}

module.exports = {
  writeOpeningMatrix,
  writeCrossReplyMatrix,
  writeReceptionMatrix,
};
