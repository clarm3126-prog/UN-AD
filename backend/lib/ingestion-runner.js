const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  loadDb,
  saveDb,
  upsertProduct,
  insertReview
} = require("./store");
const { enqueue } = require("./queue");

const SOURCE_DIR = path.join(__dirname, "../../data/source/reviews");

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

function makeReviewId(productId, text, createdAt) {
  const digest = crypto
    .createHash("sha1")
    .update(`${productId}|${text}|${createdAt}`)
    .digest("hex");
  return `rv_${digest.slice(0, 16)}`;
}

function ensureSourceDir() {
  if (!fs.existsSync(SOURCE_DIR)) {
    fs.mkdirSync(SOURCE_DIR, { recursive: true });
  }
}

function runIngestion() {
  ensureSourceDir();
  const db = loadDb();

  const files = fs.readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".csv"))
    .sort();

  let importedReviews = 0;
  let enqueued = 0;
  const newlyProcessedFiles = [];

  for (const fileName of files) {
    if (db.ingestionState.processedFiles.includes(fileName)) {
      continue;
    }

    const filePath = path.join(SOURCE_DIR, fileName);
    const rows = parseCsvFile(filePath);

    for (const row of rows) {
      const productId = row.product_id || row.productId;
      if (!productId) {
        continue;
      }

      upsertProduct(db, {
        productId: String(productId),
        productName: row.product_name || row.productName || `product-${productId}`,
        vendorItemId: row.vendor_item_id || row.vendorItemId || "",
        source: row.source || "csv"
      });

      const createdAt = row.created_at || row.createdAt || new Date().toISOString();
      const reviewText = row.review_text || row.reviewText || "";
      const reviewId = row.review_id || row.reviewId || makeReviewId(productId, reviewText, createdAt);
      const uniqueKey = `${productId}:${reviewId}`;

      const inserted = insertReview(db, {
        reviewId,
        productId: String(productId),
        rating: Number(row.rating || 0),
        rawText: reviewText,
        createdAt,
        source: row.source || "csv",
        uniqueKey
      });

      if (!inserted) {
        continue;
      }

      importedReviews += 1;
      enqueue({
        type: "review.created",
        reviewId,
        productId: String(productId),
        createdAt,
        source: row.source || "csv"
      });
      enqueued += 1;
    }

    db.ingestionState.processedFiles.push(fileName);
    newlyProcessedFiles.push(fileName);
  }

  saveDb(db);

  return {
    scannedFiles: files.length,
    processedFiles: newlyProcessedFiles,
    importedReviews,
    enqueued
  };
}

module.exports = {
  runIngestion
};
