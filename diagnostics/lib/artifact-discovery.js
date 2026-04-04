"use strict";

const fs = require("fs");
const path = require("path");

function discoverRuns(runsDir) {
  const resolvedRunsDir = path.resolve(runsDir);

  if (!fs.existsSync(resolvedRunsDir)) {
    return [];
  }

  return fs.readdirSync(resolvedRunsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(resolvedRunsDir, entry.name))
    .sort((left, right) => {
      const leftName = path.basename(left);
      const rightName = path.basename(right);
      return leftName.localeCompare(rightName) || left.localeCompare(right);
    });
}

module.exports = { discoverRuns };
