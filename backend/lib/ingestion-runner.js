const crypto = require("crypto");

const {
  loadDb,
  saveDb,
  upsertProduct,
  insertReview
} = require("./store");
const { enqueue } = require("./queue");
const { loadCsvRows } = require("./sources/csv-source");
const { loadCoupangRows } = require("./sources/coupang-source");

function makeReviewId(productId, text, createdAt) {
  const digest = crypto
    .createHash("sha1")
    .update(`${productId}|${text}|${createdAt}`)
    .digest("hex");
  return `rv_${digest.slice(0, 16)}`;
}

function normalizeIncomingRow(row) {
  const productId = String(row.product_id || row.productId || "");
  const productName = row.product_name || row.productName || `product-${productId}`;
  const vendorItemId = String(row.vendor_item_id || row.vendorItemId || "");
  const source = row.source || "unknown";
  const createdAt = row.created_at || row.createdAt || new Date().toISOString();
  const reviewText = row.review_text || row.reviewText || "";

  if (!productId || !reviewText.trim()) {
    return null;
  }

  const reviewId = row.review_id || row.reviewId || makeReviewId(productId, reviewText, createdAt);

  return {
    product: {
      productId,
      productName,
      vendorItemId,
      source
    },
    review: {
      reviewId,
      productId,
      rating: Number(row.rating || 0),
      rawText: reviewText,
      createdAt,
      source,
      uniqueKey: `${productId}:${reviewId}`
    }
  };
}

function ingestRows(db, rows) {
  let importedReviews = 0;
  let enqueued = 0;

  for (const row of rows) {
    const normalized = normalizeIncomingRow(row);
    if (!normalized) {
      continue;
    }

    upsertProduct(db, normalized.product);

    const inserted = insertReview(db, normalized.review);
    if (!inserted) {
      continue;
    }

    importedReviews += 1;
    enqueue({
      type: "review.created",
      reviewId: normalized.review.reviewId,
      productId: normalized.review.productId,
      createdAt: normalized.review.createdAt,
      source: normalized.review.source
    });
    enqueued += 1;
  }

  return { importedReviews, enqueued };
}

function ensureIngestionState(db) {
  if (!db.ingestionState) {
    db.ingestionState = { processedFiles: [] };
  }

  if (!Array.isArray(db.ingestionState.processedFiles)) {
    db.ingestionState.processedFiles = [];
  }
}

async function runCsvSource(db) {
  const csvData = loadCsvRows(db);
  const result = ingestRows(db, csvData.rows);

  db.ingestionState.processedFiles.push(...csvData.processedFiles);

  return {
    source: "csv",
    scannedFiles: csvData.scannedFiles,
    processedFiles: csvData.processedFiles,
    importedReviews: result.importedReviews,
    enqueued: result.enqueued
  };
}

async function runCoupangSource(db, options = {}) {
  const cp = await loadCoupangRows(db, { targets: options.productTargets || [] });
  const result = ingestRows(db, cp.rows);

  db.ingestionState.lastCoupangRunAt = new Date().toISOString();

  return {
    source: "coupang",
    mode: cp.mode,
    productTargets: cp.productTargets,
    fetchedRows: cp.rows.length,
    importedReviews: result.importedReviews,
    enqueued: result.enqueued
  };
}

async function runIngestion(options = {}) {
  const requestedSource = String(options.source || "csv").toLowerCase();
  const source = ["csv", "coupang", "all"].includes(requestedSource) ? requestedSource : "csv";

  const db = loadDb();
  ensureIngestionState(db);

  const summaries = [];

  if (source === "csv" || source === "all") {
    summaries.push(await runCsvSource(db));
  }

  if (source === "coupang" || source === "all") {
    summaries.push(await runCoupangSource(db, options));
  }

  saveDb(db);

  const totals = summaries.reduce((acc, row) => ({
    importedReviews: acc.importedReviews + Number(row.importedReviews || 0),
    enqueued: acc.enqueued + Number(row.enqueued || 0)
  }), { importedReviews: 0, enqueued: 0 });

  return {
    source,
    totals,
    summaries
  };
}

module.exports = {
  runIngestion
};
