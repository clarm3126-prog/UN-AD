const productLink = document.getElementById("productLink");
const summarizeBtn = document.getElementById("summarizeBtn");
const demoBtn = document.getElementById("demoBtn");
const demoCsvBtn = document.getElementById("demoCsvBtn");
const csvFile = document.getElementById("csvFile");
const uploadBtn = document.getElementById("uploadBtn");
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

function renderPrimaryResult(primary) {
  if (!primary) {
    summaryTitle.textContent = "이 제품 사기 전 꼭 봐야 할 단점";
    resultHint.textContent = "분석 결과가 없습니다.";
    productIdEl.textContent = "-";
    lowCountEl.textContent = "0";
    summaryModeEl.textContent = "-";
    renderList(consList, [], "요약할 단점이 아직 없습니다.");
    renderEvidence([]);
    return;
  }

  summaryTitle.textContent = primary.summary.summaryTitle || "이 제품 사기 전 꼭 봐야 할 단점";
  resultHint.textContent = `자동 분석 완료 · 대표 상품 ${primary.productId}`;
  productIdEl.textContent = primary.productId || "-";
  lowCountEl.textContent = String(primary.lowRatingCount || 0);
  summaryModeEl.textContent = primary.summary.mode || "-";
  renderList(consList, primary.summary.mustKnowCons || [], "요약할 단점이 아직 없습니다.");
  renderEvidence(primary.evidence || []);
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
    renderPrimaryResult({
      productId: data.product.productId,
      lowRatingCount: data.lowRatingCount,
      summary: data.summary,
      evidence: data.evidence
    });
    setStatus("완료", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    summarizeBtn.disabled = false;
  }
}

async function summarizeFromCsvUpload() {
  const file = csvFile.files && csvFile.files[0];
  if (!file) {
    setStatus("CSV 파일을 선택하세요", "error");
    return;
  }

  setStatus("CSV 업로드/분석 중...", "loading");
  uploadBtn.disabled = true;

  try {
    const csvText = await file.text();
    const response = await fetch(`${getApiBase()}/insights/from-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "CSV 분석 중 오류가 발생했습니다.");
    }

    const data = payload.data;
    renderPrimaryResult(data.primary);
    resultHint.textContent = `CSV ${data.ingestion.scannedRows}행 처리 · 신규 리뷰 ${data.ingestion.importedReviews}개`;
    setStatus("완료", "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    uploadBtn.disabled = false;
  }
}

demoBtn.addEventListener("click", () => {
  productLink.value = "https://www.coupang.com/vp/products/131023672?itemId=362266710&vendorItemId=4279191312";
});

demoCsvBtn.addEventListener("click", () => {
  const sample = [
    "product_id,product_name,review_id,rating,created_at,review_text",
    "131023672,해피바스 솝베리 클렌징 오일,demo_1,1,2026-03-05T08:00:00Z,배송은 빠르지만 사용 후 피부가 따갑고 건조합니다.",
    "131023672,해피바스 솝베리 클렌징 오일,demo_2,2,2026-03-05T09:00:00Z,일주일 쓰니 펌프가 헐거워져서 오일이 샜어요.",
    "999000111,샘플 상품 B,demo_3,1,2026-03-05T10:00:00Z,한달 안돼서 고장나서 내구성이 아쉽습니다."
  ].join("\n");

  const blob = new Blob([sample], { type: "text/csv" });
  const demoFile = new File([blob], "demo_reviews.csv", { type: "text/csv" });
  const dt = new DataTransfer();
  dt.items.add(demoFile);
  csvFile.files = dt.files;
  setStatus("데모 CSV 준비 완료", "idle");
});

summarizeBtn.addEventListener("click", summarizeFromLink);
uploadBtn.addEventListener("click", summarizeFromCsvUpload);
