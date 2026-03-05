const crypto = require("crypto");
const http = require("http");

const {
  loadDb,
  saveDb,
  upsertProduct,
  insertReview,
  listProductsWithStats,
  getReviewsByProduct,
  getProductStats
} = require("./lib/store");
const { enqueue } = require("./lib/queue");
const { runIngestion } = require("./lib/ingestion-runner");
const { processQueueOnce } = require("./lib/worker-runner");
const {
  extractCoupangTargetFromUrl,
  summarizeLowRatingReviews
} = require("./lib/link-insights");

const PORT = Number(process.env.API_PORT || 4000);

function sendJson(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 15 * 1024 * 1024) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        cur += "\"";
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

function parseCsvText(csvText) {
  const lines = String(csvText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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

function ingestRowsIntoDb(rows, source = "csv_upload") {
  const db = loadDb();
  let importedReviews = 0;
  let enqueued = 0;
  const touchedProductIds = new Set();

  for (const row of rows) {
    const productId = String(row.product_id || row.productId || "").trim();
    const reviewText = String(row.review_text || row.reviewText || "").trim();
    if (!productId || !reviewText) {
      continue;
    }

    const createdAt = row.created_at || row.createdAt || new Date().toISOString();
    const reviewId = row.review_id || row.reviewId || makeReviewId(productId, reviewText, createdAt);

    upsertProduct(db, {
      productId,
      productName: row.product_name || row.productName || `product-${productId}`,
      vendorItemId: String(row.vendor_item_id || row.vendorItemId || ""),
      source
    });

    const inserted = insertReview(db, {
      reviewId,
      productId,
      rating: Number(row.rating || 0),
      rawText: reviewText,
      createdAt: String(createdAt),
      source,
      uniqueKey: `${productId}:${reviewId}`
    });

    if (!inserted) {
      continue;
    }

    importedReviews += 1;
    touchedProductIds.add(productId);
    enqueue({
      type: "review.created",
      reviewId,
      productId,
      createdAt: String(createdAt),
      source
    });
    enqueued += 1;
  }

  saveDb(db);

  return {
    importedReviews,
    enqueued,
    productIds: Array.from(touchedProductIds)
  };
}

function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "api-server" });
    return;
  }

  if (req.method === "GET" && pathname === "/products") {
    const db = loadDb();
    sendJson(res, 200, { ok: true, data: listProductsWithStats(db) });
    return;
  }

  if (req.method === "GET" && /^\/products\/[^/]+\/stats$/.test(pathname)) {
    const productId = pathname.split("/")[2];
    const db = loadDb();
    sendJson(res, 200, { ok: true, data: getProductStats(db, productId) });
    return;
  }

  if (req.method === "GET" && /^\/products\/[^/]+\/reviews$/.test(pathname)) {
    const productId = pathname.split("/")[2];
    const label = url.searchParams.get("label") || "all";
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 50)));
    const db = loadDb();

    sendJson(res, 200, {
      ok: true,
      data: getReviewsByProduct(db, productId, label, limit)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/ingestion/run") {
    parseBody(req)
      .then((body) => runIngestion({ source: body.source || "csv" }))
      .then((summary) => {
        sendJson(res, 200, { ok: true, data: summary });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === "POST" && pathname === "/insights/from-link") {
    parseBody(req)
      .then(async (body) => {
        const link = String(body.url || "").trim();
        if (!link) {
          throw new Error("url 필드는 필수입니다.");
        }

        const target = extractCoupangTargetFromUrl(link);
        const ingestion = await runIngestion({
          source: "coupang",
          productTargets: [target]
        });
        const worker = processQueueOnce();

        const db = loadDb();
        const allRows = getReviewsByProduct(db, target.productId, "all", 500);
        const lowRows = allRows.filter((row) => Number(row.rating || 0) > 0 && Number(row.rating || 0) <= 2);
        const summary = await summarizeLowRatingReviews(lowRows);

        return {
          product: {
            productId: target.productId,
            vendorItemId: target.vendorItemId
          },
          ingestion,
          worker,
          lowRatingCount: lowRows.length,
          summary,
          evidence: lowRows.slice(0, 15).map((row) => ({
            reviewId: row.reviewId,
            rating: row.rating,
            text: row.rawText
          }))
        };
      })
      .then((data) => {
        sendJson(res, 200, { ok: true, data });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === "POST" && pathname === "/insights/from-csv") {
    parseBody(req)
      .then(async (body) => {
        const csvText = String(body.csvText || "").trim();
        if (!csvText) {
          throw new Error("csvText 필드는 필수입니다.");
        }

        const rows = parseCsvText(csvText);
        if (!rows.length) {
          throw new Error("CSV 데이터가 비어 있습니다.");
        }

        const ingestion = ingestRowsIntoDb(rows, "csv_upload");
        const worker = processQueueOnce();
        const db = loadDb();

        const products = [];
        for (const productId of ingestion.productIds) {
          const allRows = getReviewsByProduct(db, productId, "all", 1000);
          const lowRows = allRows.filter((row) => Number(row.rating || 0) > 0 && Number(row.rating || 0) <= 2);
          const summary = await summarizeLowRatingReviews(lowRows);
          products.push({
            productId,
            lowRatingCount: lowRows.length,
            summary,
            evidence: lowRows.slice(0, 15).map((row) => ({
              reviewId: row.reviewId,
              rating: row.rating,
              text: row.rawText
            }))
          });
        }

        products.sort((a, b) => b.lowRatingCount - a.lowRatingCount);
        const primary = products[0] || null;

        return {
          ingestion: {
            scannedRows: rows.length,
            ...ingestion
          },
          worker,
          primary,
          products
        };
      })
      .then((data) => {
        sendJson(res, 200, { ok: true, data });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  if (req.method === "POST" && /^\/reviews\/[^/]+\/feedback$/.test(pathname)) {
    parseBody(req)
      .then((body) => {
        const reviewId = pathname.split("/")[2];
        const db = loadDb();
        db.feedback.push({
          reviewId,
          isFalsePositive: Boolean(body.isFalsePositive),
          note: String(body.note || ""),
          createdAt: new Date().toISOString()
        });
        saveDb(db);
        sendJson(res, 200, { ok: true });
      })
      .catch((err) => {
        sendJson(res, 400, { ok: false, error: err.message });
      });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

http.createServer(route).listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
