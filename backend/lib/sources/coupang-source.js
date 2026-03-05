const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_PRODUCTS_FILE = path.join(__dirname, "../../../data/source/products.csv");
const DEFAULT_MOCK_FILE = path.join(__dirname, "../../../data/source/coupang/mock-reviews.json");

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

function parseProductsCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

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
    return {
      productId: String(row.product_id || row.productId || ""),
      productName: row.product_name || row.productName || "",
      vendorItemId: String(row.vendor_item_id || row.vendorItemId || ""),
      vendorId: row.vendor_id || row.vendorId || ""
    };
  }).filter((row) => row.productId);
}

function normalizeTarget(target) {
  return {
    productId: String(target.productId || "").trim(),
    productName: String(target.productName || ""),
    vendorItemId: String(target.vendorItemId || ""),
    vendorId: String(target.vendorId || "")
  };
}

function resolveProducts(db, explicitTargets = []) {
  if (Array.isArray(explicitTargets) && explicitTargets.length) {
    return explicitTargets
      .map(normalizeTarget)
      .filter((row) => row.productId);
  }

  const productsFile = process.env.COUPANG_PRODUCTS_FILE || DEFAULT_PRODUCTS_FILE;
  const fromFile = parseProductsCsv(productsFile);
  if (fromFile.length) {
    return fromFile;
  }

  return db.products.map((p) => ({
    productId: String(p.productId),
    productName: p.productName || "",
    vendorItemId: p.vendorItemId || "",
    vendorId: p.vendorId || ""
  }));
}

function formatSignedDate() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function buildCoupangHeaders(requestUrl, method, vendorIdOverride) {
  const accessKey = process.env.COUPANG_ACCESS_KEY || "";
  const secretKey = process.env.COUPANG_SECRET_KEY || "";
  const vendorId = vendorIdOverride || process.env.COUPANG_VENDOR_ID || "";

  if (!accessKey || !secretKey) {
    return {
      "Content-Type": "application/json"
    };
  }

  const urlObj = new URL(requestUrl);
  const pathWithSlash = urlObj.pathname || "/";
  const query = urlObj.search ? urlObj.search.slice(1) : "";
  const signedDate = formatSignedDate();

  const msg = `${signedDate}${method.toUpperCase()}${pathWithSlash}${query}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(msg)
    .digest("hex");

  const auth = `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${signedDate}, signature=${signature}`;

  const headers = {
    Authorization: auth,
    "Content-Type": "application/json"
  };

  if (vendorId) {
    headers["X-EXTENDED-VENDOR-ID"] = vendorId;
  }

  return headers;
}

function normalizeReviewRow(raw, product) {
  const reviewId = String(
    raw.reviewId || raw.review_id || raw.id || raw.commentId || raw.comment_id || ""
  );
  const rawText = String(
    raw.reviewText || raw.review_text || raw.content || raw.text || raw.comment || ""
  ).trim();
  const createdAt = raw.createdAt || raw.created_at || raw.registeredAt || raw.regDate || new Date().toISOString();
  const rating = Number(raw.rating || raw.score || raw.star || 0);

  if (!rawText) {
    return null;
  }

  return {
    product_id: String(product.productId),
    product_name: product.productName || `product-${product.productId}`,
    vendor_item_id: product.vendorItemId || "",
    review_id: reviewId || undefined,
    rating,
    created_at: String(createdAt),
    review_text: rawText,
    source: "coupang_api"
  };
}

function extractReviewArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.reviews)) {
    return payload.reviews;
  }

  if (payload && payload.data && Array.isArray(payload.data.reviews)) {
    return payload.data.reviews;
  }

  if (payload && payload.data && Array.isArray(payload.data.items)) {
    return payload.data.items;
  }

  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }

  return [];
}

function interpolateTemplate(template, product) {
  return template
    .replaceAll("{productId}", encodeURIComponent(product.productId || ""))
    .replaceAll("{vendorItemId}", encodeURIComponent(product.vendorItemId || ""))
    .replaceAll("{vendorId}", encodeURIComponent(product.vendorId || process.env.COUPANG_VENDOR_ID || ""));
}

async function loadFromHttp(products) {
  const template = process.env.COUPANG_REVIEW_API_URL_TEMPLATE || "";
  if (!template) {
    throw new Error("COUPANG_REVIEW_API_URL_TEMPLATE is required for COUPANG_SOURCE_MODE=http");
  }

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in this Node runtime");
  }

  const rows = [];

  for (const product of products) {
    const url = interpolateTemplate(template, product);
    const headers = buildCoupangHeaders(url, "GET", product.vendorId);
    const response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
      throw new Error(`Coupang adapter request failed: ${response.status} ${response.statusText} for product ${product.productId}`);
    }

    const payload = await response.json();
    const array = extractReviewArray(payload);
    for (const raw of array) {
      const normalized = normalizeReviewRow(raw, product);
      if (normalized) {
        rows.push(normalized);
      }
    }
  }

  return {
    mode: "http",
    productTargets: products.length,
    rows
  };
}

function loadFromMock(products) {
  const filePath = process.env.COUPANG_REVIEW_MOCK_FILE || DEFAULT_MOCK_FILE;
  if (!fs.existsSync(filePath)) {
    return {
      mode: "mock-file",
      productTargets: products.length,
      rows: []
    };
  }

  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rows = [];

  for (const product of products) {
    const sourceArray = Array.isArray(payload)
      ? payload
      : (payload[String(product.productId)] || []);

    for (const raw of sourceArray) {
      const normalized = normalizeReviewRow(raw, product);
      if (normalized) {
        rows.push(normalized);
      }
    }
  }

  return {
    mode: "mock-file",
    productTargets: products.length,
    rows
  };
}

async function loadCoupangRows(db, options = {}) {
  const products = resolveProducts(db, options.targets || []);
  const mode = (process.env.COUPANG_SOURCE_MODE || "mock-file").toLowerCase();

  if (!products.length) {
    return {
      source: "coupang",
      mode,
      productTargets: 0,
      rows: []
    };
  }

  if (mode === "http") {
    const result = await loadFromHttp(products);
    return {
      source: "coupang",
      ...result
    };
  }

  const result = loadFromMock(products);
  return {
    source: "coupang",
    ...result
  };
}

module.exports = {
  loadCoupangRows
};
