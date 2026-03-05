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

function extractReviews() {
  const productId = String(extractProductIdFromUrl() || "");
  const productName = (document.querySelector("h1")?.textContent || "").trim();

  const candidates = Array.from(document.querySelectorAll(
    "[data-review-id], .sdp-review__article__list__item, .review__article, .js_reviewArticle"
  ));

  const rows = [];

  for (const item of candidates) {
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

    if (!reviewText) continue;

    rows.push({
      product_id: productId,
      product_name: productName,
      review_id: reviewId,
      rating,
      created_at: createdAt,
      review_text: reviewText
    });
  }

  return rows;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "UNAD_EXTRACT_REVIEWS") {
    return;
  }

  try {
    const rows = extractReviews();
    sendResponse({ ok: true, rows });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
});
