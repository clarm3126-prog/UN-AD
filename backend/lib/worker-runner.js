const { drainUnprocessed, writeOffset } = require("./queue");
const { analyzeReview } = require("./analyzer");
const { loadDb, saveDb, upsertReviewAnalysis } = require("./store");

function processQueueOnce() {
  const { items, nextOffset, pendingCount } = drainUnprocessed();
  if (!pendingCount) {
    return {
      processed: 0,
      pendingCount: 0
    };
  }

  const db = loadDb();
  let processed = 0;

  for (const item of items) {
    if (item.type !== "review.created") {
      continue;
    }

    const review = db.reviews.find((r) => r.reviewId === item.reviewId);
    if (!review) {
      continue;
    }

    const result = analyzeReview(review.rawText);
    upsertReviewAnalysis(db, {
      reviewId: review.reviewId,
      productId: review.productId,
      suspicionScore: result.suspiciousScore,
      trustScore: result.trustScore,
      label: result.label,
      reasons: result.reasons,
      modelVersion: "rules-v1",
      analyzedAt: new Date().toISOString()
    });
    processed += 1;
  }

  saveDb(db);
  writeOffset(nextOffset);

  return {
    processed,
    pendingCount
  };
}

module.exports = {
  processQueueOnce
};
