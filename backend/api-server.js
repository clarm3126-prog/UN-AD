const http = require("http");

const {
  loadDb,
  saveDb,
  listProductsWithStats,
  getReviewsByProduct,
  getProductStats
} = require("./lib/store");
const { runIngestion } = require("./lib/ingestion-runner");

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
      if (raw.length > 1e6) {
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
