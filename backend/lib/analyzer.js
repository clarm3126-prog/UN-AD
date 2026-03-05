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

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function countMatchedKeywords(text, words) {
  return words.filter((word) => text.includes(word)).length;
}

function analyzeReview(text) {
  const normalized = (text || "").trim();
  const reasons = [];
  let suspiciousScore = 0;

  if (!normalized) {
    return {
      suspiciousScore: 100,
      trustScore: 0,
      label: "suspicious",
      reasons: ["빈 리뷰"]
    };
  }

  if (/https?:\/\/|www\.|open\.kakao|bit\.ly/i.test(normalized)) {
    suspiciousScore += 35;
    reasons.push("외부 링크/유도 문구");
  }

  const promoHits = countMatchedKeywords(normalized, promoKeywords);
  if (promoHits > 0) {
    suspiciousScore += Math.min(40, promoHits * 12);
    reasons.push("광고성 키워드 포함");
  }

  const genericHits = countMatchedKeywords(normalized, genericPhrases);
  if (genericHits > 0) {
    suspiciousScore += Math.min(20, genericHits * 8);
    reasons.push("과장/템플릿 문장 패턴");
  }

  if (/!{3,}|ㅋ{4,}|ㅎ{4,}|\?{3,}/.test(normalized)) {
    suspiciousScore += 10;
    reasons.push("과도한 강조 표현");
  }

  if (normalized.length < 14) {
    suspiciousScore += 18;
    reasons.push("정보량이 매우 적음");
  }

  const practicalHits = countMatchedKeywords(normalized, practicalSignals);
  if (practicalHits > 0) {
    suspiciousScore -= Math.min(24, practicalHits * 6);
    reasons.push("실사용 정황 단서");
  }

  if (/아쉬|단점|별로|재구매는 고민|배송이 늦|불편/.test(normalized)) {
    suspiciousScore -= 8;
    reasons.push("긍/부정 균형 표현");
  }

  suspiciousScore = clamp(Math.round(suspiciousScore), 0, 100);
  const label = suspiciousScore >= 45 ? "suspicious" : "real";

  return {
    suspiciousScore,
    trustScore: 100 - suspiciousScore,
    label,
    reasons: reasons.length ? reasons : ["뚜렷한 광고 패턴 미탐지"]
  };
}

module.exports = {
  analyzeReview
};
