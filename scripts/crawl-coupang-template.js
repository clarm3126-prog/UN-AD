#!/usr/bin/env node
/*
  TEMPLATE ONLY
  - Use only where terms/policies permit.
  - This script collects currently rendered review elements and saves CSV.
*/

const fs = require("fs");
const path = require("path");

async function main() {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (err) {
    console.error("playwright 패키지가 필요합니다. npm i -D playwright 후 사용하세요.");
    process.exit(1);
  }

  const targetUrl = process.argv[2] || process.env.CRAWL_TARGET_URL;
  if (!targetUrl) {
    console.error("사용법: node scripts/crawl-coupang-template.js '<상품URL>'");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Scroll to load more review blocks (tune as needed for your page type).
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 2200);
    await page.waitForTimeout(700);
  }

  const rows = await page.evaluate(() => {
    function extractProductIdFromUrl() {
      const url = new URL(window.location.href);
      const path = url.pathname || "";
      const match = path.match(/\/products\/(\d+)/i) || path.match(/\/vp\/products\/(\d+)/i);
      return url.searchParams.get("productId") || (match ? match[1] : "");
    }

    function textOf(el, selectors) {
      for (const s of selectors) {
        const node = el.querySelector(s);
        if (node && node.textContent) {
          const t = node.textContent.trim();
          if (t) return t;
        }
      }
      return "";
    }

    const productId = String(extractProductIdFromUrl() || "");
    const productName = (document.querySelector("h1")?.textContent || "").trim();
    const nodes = Array.from(document.querySelectorAll(
      "[data-review-id], .sdp-review__article__list__item, .review__article, .js_reviewArticle"
    ));

    return nodes
      .map((item) => {
        const reviewId = item.getAttribute("data-review-id") || item.id || "";
        const ratingRaw = textOf(item, [
          "[data-rating]",
          ".sdp-review__article__list__info__product-info__star-orange",
          ".rating",
          ".star"
        ]);
        const ratingMatch = ratingRaw.match(/([1-5])/);
        const rating = ratingMatch ? Number(ratingMatch[1]) : 0;

        const createdAt = textOf(item, [
          "[data-created-at]",
          ".sdp-review__article__list__info__product-info__reg-date",
          ".date"
        ]);

        const reviewText = textOf(item, [
          ".sdp-review__article__list__review__content",
          ".review-content",
          ".content",
          "p"
        ]);

        return {
          product_id: productId,
          product_name: productName,
          review_id: reviewId,
          rating,
          created_at: createdAt,
          review_text: reviewText
        };
      })
      .filter((r) => r.review_text);
  });

  await browser.close();

  function esc(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  }

  const header = ["product_id", "product_name", "review_id", "rating", "created_at", "review_text"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push([
      row.product_id,
      row.product_name,
      row.review_id,
      row.rating,
      row.created_at,
      row.review_text
    ].map(esc).join(","));
  }

  const outDir = path.join(process.cwd(), "data/source/reviews");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `crawl_${Date.now()}.csv`);
  fs.writeFileSync(outFile, lines.join("\n"), "utf8");

  console.log(`saved: ${outFile}`);
  console.log(`rows: ${rows.length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
