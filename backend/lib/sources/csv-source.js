const fs = require("fs");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "../../../data/source/reviews");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }

  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    header.forEach((key, idx) => {
      row[key] = values[idx] || "";
    });
    return row;
  });
}

function ensureSourceDir() {
  if (!fs.existsSync(SOURCE_DIR)) {
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
  }
}

function loadCsvRows(db) {
  ensureSourceDir();
  const files = fs.readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".csv"))
    .sort();

  const processedFiles = [];
  const rows = [];

  for (const fileName of files) {
    if (db.ingestionState.processedFiles.includes(fileName)) {
      continue;
    }

    const filePath = path.join(SOURCE_DIR, fileName);
    rows.push(...parseCsvFile(filePath).map((row) => ({ ...row, source: row.source || "csv" })));
    processedFiles.push(fileName);
  }

  return {
    scannedFiles: files.length,
    processedFiles,
    rows
  };
}

module.exports = {
  loadCsvRows
};
