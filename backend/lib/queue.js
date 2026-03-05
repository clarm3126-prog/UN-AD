const fs = require("fs");
const path = require("path");

const QUEUE_PATH = path.join(__dirname, "../../data/runtime/review-queue.ndjson");
const OFFSET_PATH = path.join(__dirname, "../../data/runtime/worker-offset.json");

function ensureRuntimeFiles() {
  const dir = path.dirname(QUEUE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(QUEUE_PATH)) {
    fs.writeFileSync(QUEUE_PATH, "", "utf8");
  }

  if (!fs.existsSync(OFFSET_PATH)) {
    fs.writeFileSync(OFFSET_PATH, JSON.stringify({ offset: 0 }, null, 2), "utf8");
  }
}

function enqueue(item) {
  ensureRuntimeFiles();
  const row = JSON.stringify(item);
  fs.appendFileSync(QUEUE_PATH, `${row}\n`, "utf8");
}

function readAllLines() {
  ensureRuntimeFiles();
  const raw = fs.readFileSync(QUEUE_PATH, "utf8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines;
}

function readOffset() {
  ensureRuntimeFiles();
  const raw = fs.readFileSync(OFFSET_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return parsed.offset || 0;
}

function writeOffset(offset) {
  ensureRuntimeFiles();
  fs.writeFileSync(OFFSET_PATH, JSON.stringify({ offset }, null, 2), "utf8");
}

function drainUnprocessed() {
  const lines = readAllLines();
  const offset = readOffset();
  const pendingLines = lines.slice(offset);

  const items = pendingLines.map((line) => JSON.parse(line));
  return {
    items,
    nextOffset: offset + pendingLines.length,
    pendingCount: pendingLines.length
  };
}

module.exports = {
  enqueue,
  drainUnprocessed,
  writeOffset,
  readOffset
};
