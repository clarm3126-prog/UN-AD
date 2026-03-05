const productLink = document.getElementById("productLink");
const summarizeBtn = document.getElementById("summarizeBtn");
const demoBtn = document.getElementById("demoBtn");
const statusText = document.getElementById("statusText");

const summaryTitle = document.getElementById("summaryTitle");
const resultHint = document.getElementById("resultHint");
const productIdEl = document.getElementById("productId");
const lowCountEl = document.getElementById("lowCount");
const summaryModeEl = document.getElementById("summaryMode");
const consList = document.getElementById("consList");
const evidenceList = document.getElementById("evidenceList");

function getApiBase() {
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

function setStatus(text, kind = "idle") {
  statusText.textContent = text;
  statusText.dataset.kind = kind;
}

function renderList(container, rows, emptyText) {
  container.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty-item";
    li.textContent = emptyText;
    container.appendChild(li);
    return;
  }

  rows.forEach((row) => {
    const li = document.createElement("li");
    li.textContent = row;
    container.appendChild(li);
  });
}

function renderEvidence(rows) {
  evidenceList.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty-item";
    li.textContent = "근거 리뷰가 없습니다.";
    evidenceList.appendChild(li);
    return;
  }

  rows.forEach((row) => {
    const li = document.createElement("li");
    li.className = "evidence-item";
    li.innerHTML = `
      <p class="evidence-head">평점 ${row.rating}점 · ${row.reviewId}</p>
      <p class="evidence-text">${row.text}</p>
    `;
    evidenceList.appendChild(li);
  });
}

async function summarizeFromLink() {
  const url = productLink.value.trim();
  if (!url) {
    setStatus("링크를 입력하세요", "error");
    return;
  }

  setStatus("수집/분석 중...", "loading");
  summarizeBtn.disabled = true;

  try {
    const response = await fetch(`${getApiBase()}/insights/from-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "요약 중 오류가 발생했습니다.");
    }

    const data = payload.data;
    summaryTitle.textContent = data.summary.summaryTitle || "이 제품 사기 전 꼭 봐야 할 단점";
    resultHint.textContent = `자동 수집/분석 완료 · 저평점 리뷰 ${data.lowRatingCount}개 기준`;
    productIdEl.textContent = data.product.productId || "-";
    lowCountEl.textContent = String(data.lowRatingCount || 0);
    summaryModeEl.textContent = data.summary.mode || "-";

    renderList(
      consList,
      data.summary.mustKnowCons || [],
      "요약할 단점이 아직 없습니다."
    );

    renderEvidence(data.evidence || []);
    setStatus("완료", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    summarizeBtn.disabled = false;
  }
}

demoBtn.addEventListener("click", () => {
  productLink.value = "https://www.coupang.com/vp/products/131023672?itemId=362266710&vendorItemId=4279191312";
});

summarizeBtn.addEventListener("click", summarizeFromLink);
