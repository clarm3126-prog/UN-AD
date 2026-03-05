const { drainUnprocessed, writeOffset } = require("../backend/lib/queue");
const { analyzeReview } = require("../backend/lib/analyzer");
const { loadDb, saveDb, upsertReviewAnalysis } = require("../backend/lib/store");

function processOnce() {
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

function main() {
  const summary = processOnce();
  console.log(JSON.stringify({
    ok: true,
    service: "filter-worker",
    summary
  }, null, 2));
}

main();
