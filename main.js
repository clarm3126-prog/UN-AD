const reviewInput = document.getElementById("reviewInput");
const strictness = document.getElementById("strictness");
const showOnlyReal = document.getElementById("showOnlyReal");
const analyzeBtn = document.getElementById("analyzeBtn");
const demoBtn = document.getElementById("demoBtn");
const clearBtn = document.getElementById("clearBtn");

const totalCount = document.getElementById("totalCount");
const realCount = document.getElementById("realCount");
const fakeCount = document.getElementById("fakeCount");
const resultHint = document.getElementById("resultHint");
const resultList = document.getElementById("resultList");

const promoKeywords = [
  "협찬", "체험단", "광고", "지원받아", "원고료", "제휴", "쿠폰", "할인코드",
  "링크", "오픈채팅", "dm", "문의", "최저가 보장", "무조건 사세요", "강추"
];

const genericPhrases = [
  "진짜 좋아요", "인생템", "역대급", "완전 추천", "꼭 사세요", "가성비 최고"
];

const practicalSignals = [
  "일주일", "한달", "3일", "배송", "포장", "재구매", "소음", "내구성", "사이즈",
  "단점", "아쉬운", "환불", "교환", "사용감", "설치", "세척"
];

const strictMap = {
  strict: 35,
  normal: 45,
  lenient: 58,
};

let latestRows = [];

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function countMatchedKeywords(text, words) {
  return words.filter((word) => text.includes(word)).length;
}

function analyzeReview(rawText, level) {
  const text = rawText.trim();
  const reasons = [];
  let suspiciousScore = 0;

  if (!text) {
    return {
      text,
      suspiciousScore: 100,
      trustScore: 0,
      reasons: ["빈 리뷰"],
      isReal: false,
    };
  }

  if (/https?:\/\/|www\.|open\.kakao|bit\.ly/i.test(text)) {
    suspiciousScore += 35;
    reasons.push("외부 링크/유도 문구");
  }

  const promoHits = countMatchedKeywords(text, promoKeywords);
  if (promoHits > 0) {
    suspiciousScore += Math.min(40, promoHits * 12);
    reasons.push("광고성 키워드 포함");
  }

  const genericHits = countMatchedKeywords(text, genericPhrases);
  if (genericHits > 0) {
    suspiciousScore += Math.min(20, genericHits * 8);
    reasons.push("과장/템플릿 문장 패턴");
  }

  if (/!{3,}|ㅋ{4,}|ㅎ{4,}|\?{3,}/.test(text)) {
    suspiciousScore += 10;
    reasons.push("과도한 강조 표현");
  }

  if (text.length < 14) {
    suspiciousScore += 18;
    reasons.push("정보량이 매우 적음");
  }

  const practicalHits = countMatchedKeywords(text, practicalSignals);
  if (practicalHits > 0) {
    suspiciousScore -= Math.min(24, practicalHits * 6);
    reasons.push("실사용 정황 단서");
  }

  if (/아쉬|단점|별로|재구매는 고민|배송이 늦|불편/.test(text)) {
    suspiciousScore -= 8;
    reasons.push("긍/부정 균형 표현");
  }

  if (/^[\p{L}\p{N}\s.,!?~'"()\-]+$/u === false) {
    suspiciousScore += 5;
  }

  suspiciousScore = clamp(Math.round(suspiciousScore), 0, 100);
  const threshold = strictMap[level] ?? strictMap.normal;

  return {
    text,
    suspiciousScore,
    trustScore: 100 - suspiciousScore,
    reasons: reasons.length ? reasons : ["뚜렷한 광고 패턴 미탐지"],
    isReal: suspiciousScore < threshold,
  };
}

function parseRows(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderRows(rows) {
  const filteredRows = showOnlyReal.checked ? rows.filter((row) => row.isReal) : rows;

  resultList.innerHTML = "";

  if (!filteredRows.length) {
    const empty = document.createElement("li");
    empty.className = "review-card";
    empty.textContent = "표시할 리뷰가 없습니다. (필터 조건을 확인하세요)";
    resultList.appendChild(empty);
    return;
  }

  filteredRows.forEach((row, idx) => {
    const item = document.createElement("li");
    item.className = `review-card ${row.isReal ? "safe" : "danger"}`;

    const reasons = row.reasons
      .map((reason) => `<span class="reason">${reason}</span>`)
      .join("");

    item.innerHTML = `
      <div class="review-head">
        <span class="badge ${row.isReal ? "safe" : "danger"}">
          ${row.isReal ? "실제 소비자 추정" : "광고/가짜 의심"}
        </span>
        <span class="score">의심 점수 ${row.suspiciousScore} / 100</span>
      </div>
      <p class="review-text">${idx + 1}. ${row.text}</p>
      <div class="reasons">${reasons}</div>
    `;

    resultList.appendChild(item);
  });
}

function updateStats(rows) {
  const real = rows.filter((row) => row.isReal).length;
  const fake = rows.length - real;

  totalCount.textContent = String(rows.length);
  realCount.textContent = String(real);
  fakeCount.textContent = String(fake);
}

function runAnalysis() {
  const rows = parseRows(reviewInput.value);

  if (!rows.length) {
    latestRows = [];
    updateStats([]);
    resultHint.textContent = "리뷰를 입력한 뒤 분석을 눌러주세요.";
    renderRows([]);
    return;
  }

  latestRows = rows.map((text) => analyzeReview(text, strictness.value));
  updateStats(latestRows);
  resultHint.textContent = `분석 완료: ${latestRows.length}개 리뷰`;
  renderRows(latestRows);
}

demoBtn.addEventListener("click", () => {
  reviewInput.value = [
    "체험단으로 제품 제공받아 작성합니다. 링크 타고 사면 쿠폰 줌! 무조건 사세요!!!",
    "배송은 하루 늦었지만 설치는 10분 정도 걸렸고 소음이 생각보다 적었습니다.",
    "가성비 최고 인생템 진짜 좋아요",
    "한달 사용 기준으로 세척이 쉬운 편인데 뚜껑 결합부는 조금 헐거워졌어요.",
    "문의는 오픈채팅으로 주세요. 최저가 보장합니다."
  ].join("\n");
  runAnalysis();
});

clearBtn.addEventListener("click", () => {
  reviewInput.value = "";
  latestRows = [];
  updateStats([]);
  resultHint.textContent = "아직 분석 전입니다.";
  resultList.innerHTML = "";
});

analyzeBtn.addEventListener("click", runAnalysis);
strictness.addEventListener("change", () => {
  if (latestRows.length) {
    runAnalysis();
  }
});
showOnlyReal.addEventListener("change", () => renderRows(latestRows));
