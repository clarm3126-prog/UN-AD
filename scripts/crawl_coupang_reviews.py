#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from playwright.sync_api import TimeoutError as PWTimeoutError
from playwright.sync_api import sync_playwright


@dataclass
class ReviewRow:
    product_id: str
    product_name: str
    review_id: str
    rating: Optional[float]
    created_at: Optional[str]
    option: Optional[str]
    review_text: str
    helpful: Optional[int]


def _normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _to_rating(text: str) -> Optional[float]:
    nums = re.findall(r"\d+(?:\.\d+)?", _normalize_space(text))
    if not nums:
        return None
    try:
        value = float(nums[0])
    except ValueError:
        return None
    if value < 0 or value > 5:
        return None
    return value


def _to_int(text: str) -> Optional[int]:
    m = re.search(r"(\d+)", _normalize_space(text).replace(",", ""))
    return int(m.group(1)) if m else None


def _extract_product_id(url: str) -> str:
    m = re.search(r"/products/(\d+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]productId=(\d+)", url)
    return m.group(1) if m else ""


def _row_key(raw: Dict[str, object], product_id: str) -> str:
    review_id = _normalize_space(str(raw.get("review_id") or ""))
    if review_id:
        return f"id:{product_id}:{review_id}"

    seed = "|".join(
        [
            product_id,
            _normalize_space(str(raw.get("rating") or "")),
            _normalize_space(str(raw.get("created_at") or "")),
            _normalize_space(str(raw.get("review_text") or "")),
        ]
    )
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]
    return f"hash:{product_id}:{digest}"


def _build_review_row(raw: Dict[str, object], product_id: str, product_name: str) -> Optional[ReviewRow]:
    review_text = _normalize_space(str(raw.get("review_text") or ""))
    if len(review_text) < 8:
        return None

    rating = _to_rating(str(raw.get("rating") or ""))
    review_id = _normalize_space(str(raw.get("review_id") or ""))
    if not review_id:
        review_id = _row_key(raw, product_id).split(":")[-1]

    return ReviewRow(
        product_id=product_id,
        product_name=product_name,
        review_id=review_id,
        rating=rating,
        created_at=_normalize_space(str(raw.get("created_at") or "")) or None,
        option=_normalize_space(str(raw.get("option") or "")) or None,
        review_text=review_text,
        helpful=_to_int(str(raw.get("helpful") or "")),
    )


def crawl_coupang_reviews(
    product_url: str,
    max_reviews: int,
    headless: bool,
    delay_sec: float,
    max_rounds: int,
) -> List[ReviewRow]:
    product_id = _extract_product_id(product_url)
    seen_keys = set()
    rows: List[ReviewRow] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(
            locale="ko-KR",
            viewport={"width": 1440, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(20000)

        page.goto(product_url, wait_until="domcontentloaded")
        time.sleep(delay_sec)

        product_name = _normalize_space(page.locator("h1").first.inner_text()) if page.locator("h1").count() else ""

        review_tab_candidates = [
            "a:has-text('상품평')",
            "button:has-text('상품평')",
            "a:has-text('리뷰')",
            "button:has-text('리뷰')",
            "text=상품평",
            "text=리뷰",
        ]
        for sel in review_tab_candidates:
            try:
                loc = page.locator(sel).first
                if loc.count() > 0 and loc.is_visible():
                    loc.click()
                    time.sleep(delay_sec)
                    break
            except Exception:
                continue

        idle_rounds = 0

        for _ in range(max_rounds):
            extracted = page.evaluate(
                """
                () => {
                  const pickText = (root, selectors) => {
                    for (const s of selectors) {
                      const n = root.querySelector(s);
                      if (n && n.textContent) {
                        const t = n.textContent.trim();
                        if (t) return t;
                      }
                    }
                    return "";
                  };

                  const cardSelectors = [
                    "[data-review-id]",
                    ".sdp-review__article__list__item",
                    "article.sdp-review__article__list__item",
                    ".review__article",
                    ".js_reviewArticle"
                  ];

                  const seen = new Set();
                  const cards = [];
                  for (const sel of cardSelectors) {
                    const nodes = document.querySelectorAll(sel);
                    for (const n of nodes) {
                      if (!seen.has(n)) {
                        seen.add(n);
                        cards.push(n);
                      }
                    }
                  }

                  return cards.map((card) => {
                    const reviewId =
                      card.getAttribute("data-review-id") ||
                      card.getAttribute("data-id") ||
                      card.id || "";

                    const rating = pickText(card, [
                      "[aria-label*='별점']",
                      "[class*='rating']",
                      "[data-rating]",
                      ".sdp-review__article__list__info__product-info__star-orange"
                    ]);

                    const createdAt = pickText(card, [
                      "time",
                      "[class*='reg-date']",
                      "[class*='date']",
                      "[data-created-at]"
                    ]);

                    const option = pickText(card, [
                      "[class*='option']",
                      "[class*='product-info'] [class*='name']"
                    ]);

                    const reviewText = pickText(card, [
                      ".sdp-review__article__list__review__content",
                      "[class*='review__content']",
                      "[class*='review-content']",
                      "[class*='content']"
                    ]);

                    const helpful = pickText(card, [
                      "button:has-text('도움')",
                      "span:has-text('도움')",
                      "[class*='helpful']"
                    ]);

                    return {
                      review_id: reviewId,
                      rating,
                      created_at: createdAt,
                      option,
                      review_text: reviewText,
                      helpful
                    };
                  });
                }
                """
            )

            new_count = 0
            for raw in extracted:
                key = _row_key(raw, product_id)
                if key in seen_keys:
                    continue

                row = _build_review_row(raw, product_id, product_name)
                if not row:
                    continue

                rows.append(row)
                seen_keys.add(key)
                new_count += 1
                if len(rows) >= max_reviews:
                    break

            if len(rows) >= max_reviews:
                break

            if new_count == 0:
                idle_rounds += 1
            else:
                idle_rounds = 0

            clicked_more = False
            for sel in [
                "button:has-text('더보기')",
                "a:has-text('더보기')",
                "button:has-text('상품평 더보기')",
                "button:has-text('리뷰 더보기')",
            ]:
                try:
                    btn = page.locator(sel).first
                    if btn.count() > 0 and btn.is_visible():
                        btn.click()
                        clicked_more = True
                        time.sleep(delay_sec)
                        break
                except PWTimeoutError:
                    continue
                except Exception:
                    continue

            page.mouse.wheel(0, 2200)
            time.sleep(delay_sec)

            if idle_rounds >= 6 and not clicked_more:
                break

        browser.close()

    return rows[:max_reviews]


def save_rows(rows: List[ReviewRow], out_path: Path) -> Tuple[Path, int]:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    records = [asdict(r) for r in rows]

    if out_path.suffix.lower() == ".xlsx":
        try:
            import pandas as pd  # type: ignore
        except Exception as exc:
            raise RuntimeError(".xlsx 저장은 pandas/openpyxl 필요: pip install pandas openpyxl") from exc

        pd.DataFrame(records).to_excel(out_path, index=False)
    else:
        with out_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "product_id",
                    "product_name",
                    "review_id",
                    "rating",
                    "created_at",
                    "option",
                    "review_text",
                    "helpful",
                ],
            )
            writer.writeheader()
            writer.writerows(records)

    return out_path, len(records)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Coupang product review crawler template (use only where allowed by policy/terms)."
    )
    parser.add_argument("url", help="쿠팡 상품 URL")
    parser.add_argument("--max-reviews", type=int, default=150)
    parser.add_argument("--headless", action="store_true", default=False)
    parser.add_argument("--delay-sec", type=float, default=1.0)
    parser.add_argument("--max-rounds", type=int, default=40)
    parser.add_argument(
        "--out",
        default="data/source/reviews/coupang_reviews.csv",
        help="출력 파일(.csv 또는 .xlsx)",
    )

    args = parser.parse_args()

    rows = crawl_coupang_reviews(
        product_url=args.url,
        max_reviews=max(1, args.max_reviews),
        headless=bool(args.headless),
        delay_sec=max(0.2, args.delay_sec),
        max_rounds=max(5, args.max_rounds),
    )

    out_file, count = save_rows(rows, Path(args.out))
    print(f"saved: {out_file}")
    print(f"rows: {count}")


if __name__ == "__main__":
    main()
