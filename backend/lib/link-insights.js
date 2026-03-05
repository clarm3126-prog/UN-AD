const OpenAI = require("openai");

function extractCoupangTargetFromUrl(urlText) {
  let parsed;
  try {
    parsed = new URL(urlText);
  } catch (err) {
    throw new Error("유효한 URL 형식이 아닙니다.");
  }

  const host = (parsed.hostname || "").toLowerCase();
  if (!host.includes("coupang.com")) {
    throw new Error("쿠팡 링크만 지원합니다.");
  }

  const path = parsed.pathname || "";
  const match = path.match(/\/products\/(\d+)/i) || path.match(/\/vp\/products\/(\d+)/i);
  const productId = String(
    parsed.searchParams.get("productId") ||
    (match ? match[1] : "")
  ).trim();

  if (!productId) {
    throw new Error("링크에서 productId를 찾지 못했습니다.");
  }

  return {
    productId,
    vendorItemId: String(parsed.searchParams.get("vendorItemId") || "").trim(),
    productName: "",
    vendorId: process.env.COUPANG_VENDOR_ID || ""
  };
}

function classifyTheme(text) {
  const t = String(text || "");
  const rules = [
    { theme: "배송/포장", keys: ["배송", "포장", "도착", "지연"] },
    { theme: "품질/불량", keys: ["불량", "고장", "파손", "불량품", "작동 안"] },
    { theme: "내구성", keys: ["내구", "망가", "헐거", "금방", "벗겨"] },
    { theme: "성능/효과", keys: ["효과", "성능", "흡입", "세정", "지속"] },
    { theme: "사용감/자극", keys: ["자극", "따가", "건조", "끈적", "무거"] },
    { theme: "사이즈/규격", keys: ["사이즈", "작다", "크다", "용량", "치수"] },
    { theme: "가격/가성비", keys: ["비싸", "가격", "가성비", "값", "대비"] },
    { theme: "AS/고객응대", keys: ["응대", "상담", "환불", "교환", "센터"] }
  ];

  const found = rules.find((rule) => rule.keys.some((key) => t.includes(key)));
  return found ? found.theme : "기타";
}

function buildLocalSummary(lowReviews) {
  const themeMap = new Map();

  for (const row of lowReviews) {
    const theme = classifyTheme(row.rawText);
    if (!themeMap.has(theme)) {
      themeMap.set(theme, { count: 0, samples: [] });
    }

    const entry = themeMap.get(theme);
    entry.count += 1;
    if (entry.samples.length < 2) {
      entry.samples.push(row.rawText);
    }
  }

  const topThemes = Array.from(themeMap.entries())
    .map(([theme, info]) => ({
      theme,
      count: info.count,
      samples: info.samples
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const mustKnowCons = topThemes.map((row) => {
    const sample = row.samples[0] || "";
    return `${row.theme}: ${sample}`;
  });

  return {
    mode: "local",
    summaryTitle: "이 제품 사기 전 꼭 봐야 할 단점",
    mustKnowCons,
    topThemes: topThemes.map((row) => ({ theme: row.theme, count: row.count }))
  };
}

async function buildOpenAiSummary(lowReviews) {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return null;
  }

  const client = new OpenAI({ apiKey });
  const compact = lowReviews.slice(0, 80).map((r) => ({
    rating: r.rating,
    text: r.rawText
  }));

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summaryTitle: { type: "string" },
      mustKnowCons: {
        type: "array",
        items: { type: "string" }
      },
      topThemes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            theme: { type: "string" },
            count: { type: "number" }
          },
          required: ["theme", "count"]
        }
      }
    },
    required: ["summaryTitle", "mustKnowCons", "topThemes"]
  };

  const response = await client.responses.create({
    model: process.env.SUMMARY_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: "너는 제품 구매 리스크 분석가다. 1~2점 리뷰를 기반으로 구매 전 꼭 확인할 단점만 간결하게 요약한다."
      },
      {
        role: "user",
        content: `다음은 저평점 리뷰 목록이다(JSON): ${JSON.stringify(compact)}`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cons_summary",
        schema,
        strict: true
      }
    }
  });

  const output = response.output_text || "";
  if (!output) {
    return null;
  }

  const parsed = JSON.parse(output);
  return {
    mode: "openai",
    summaryTitle: parsed.summaryTitle,
    mustKnowCons: parsed.mustKnowCons,
    topThemes: parsed.topThemes
  };
}

async function summarizeLowRatingReviews(lowReviews) {
  if (!lowReviews.length) {
    return {
      mode: "empty",
      summaryTitle: "저평점 리뷰가 아직 없습니다",
      mustKnowCons: ["현재 수집된 1~2점 리뷰가 없어 단점을 요약할 수 없습니다."],
      topThemes: []
    };
  }

  try {
    const ai = await buildOpenAiSummary(lowReviews);
    if (ai) {
      return ai;
    }
  } catch (err) {
    // Fallback to local summarizer.
  }

  return buildLocalSummary(lowReviews);
}

module.exports = {
  extractCoupangTargetFromUrl,
  summarizeLowRatingReviews
};
