const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../../data/runtime/db.json");

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      products: [],
      reviews: [],
      reviewAnalysis: [],
      ingestionState: {
        processedFiles: []
      },
      feedback: []
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), "utf8");
  }
}

function loadDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(raw);
}

function saveDb(db) {
  ensureDbFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function upsertProduct(db, product) {
  const idx = db.products.findIndex((p) => String(p.productId) === String(product.productId));
  if (idx === -1) {
    db.products.push(product);
    return;
  }

  db.products[idx] = {
    ...db.products[idx],
    ...product
  };
}

function insertReview(db, review) {
  const exists = db.reviews.some((r) => r.uniqueKey === review.uniqueKey);
  if (exists) {
    return false;
  }

  db.reviews.push(review);
  return true;
}

function upsertReviewAnalysis(db, analysisRow) {
  const idx = db.reviewAnalysis.findIndex((a) => a.reviewId === analysisRow.reviewId);
  if (idx === -1) {
    db.reviewAnalysis.push(analysisRow);
    return;
  }

  db.reviewAnalysis[idx] = {
    ...db.reviewAnalysis[idx],
    ...analysisRow
  };
}

function listProductsWithStats(db) {
  return db.products.map((product) => {
    const reviews = db.reviews.filter((r) => String(r.productId) === String(product.productId));
    const reviewIds = new Set(reviews.map((r) => r.reviewId));
    const analyses = db.reviewAnalysis.filter((a) => reviewIds.has(a.reviewId));
    const real = analyses.filter((a) => a.label === "real").length;
    const suspicious = analyses.filter((a) => a.label === "suspicious").length;

    return {
      ...product,
      stats: {
        totalReviews: reviews.length,
        analyzedReviews: analyses.length,
        realReviews: real,
        suspiciousReviews: suspicious
      }
    };
  });
}

function getReviewsByProduct(db, productId, label, limit) {
  const reviews = db.reviews
    .filter((r) => String(r.productId) === String(productId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const merged = reviews.map((review) => {
    const analysis = db.reviewAnalysis.find((a) => a.reviewId === review.reviewId) || null;
    return {
      ...review,
      analysis
    };
  });

  const filtered = label && label !== "all"
    ? merged.filter((row) => row.analysis && row.analysis.label === label)
    : merged;

  return filtered.slice(0, limit);
}

function getProductStats(db, productId) {
  const rows = getReviewsByProduct(db, productId, "all", Number.MAX_SAFE_INTEGER);
  const totalReviews = rows.length;
  const analyzedReviews = rows.filter((r) => r.analysis).length;
  const realReviews = rows.filter((r) => r.analysis && r.analysis.label === "real").length;
  const suspiciousReviews = rows.filter((r) => r.analysis && r.analysis.label === "suspicious").length;

  return {
    productId: String(productId),
    totalReviews,
    analyzedReviews,
    realReviews,
    suspiciousReviews
  };
}

module.exports = {
  loadDb,
  saveDb,
  upsertProduct,
  insertReview,
  upsertReviewAnalysis,
  listProductsWithStats,
  getReviewsByProduct,
  getProductStats
};
