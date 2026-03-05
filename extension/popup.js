const exportBtn = document.getElementById("exportBtn");
const copyBtn = document.getElementById("copyBtn");
const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function toCsv(rows) {
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
    ].map(csvEscape).join(","));
  }
  return lines.join("\n");
}

function queryActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]);
}

function requestRows(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "UNAD_EXTRACT_REVIEWS" });
}

async function getRows() {
  const tab = await queryActiveTab();
  if (!tab || !tab.id) {
    throw new Error("활성 탭을 찾지 못했습니다.");
  }

  const response = await requestRows(tab.id);
  if (!response || !response.ok) {
    throw new Error((response && response.error) || "리뷰 추출 실패");
  }
  return response.rows;
}

exportBtn.addEventListener("click", async () => {
  setStatus("리뷰 추출 중...");
  try {
    const rows = await getRows();
    if (!rows.length) {
      setStatus("추출된 리뷰가 없습니다. 리뷰 영역까지 스크롤 후 다시 시도하세요.");
      return;
    }

    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const filename = `unad_reviews_${Date.now()}.csv`;
    await chrome.downloads.download({ url, filename, saveAs: true });
    setStatus(`CSV 저장 완료 (${rows.length}개)`);
  } catch (err) {
    setStatus(err.message || "오류");
  }
});

copyBtn.addEventListener("click", async () => {
  setStatus("리뷰 추출 중...");
  try {
    const rows = await getRows();
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2));
    setStatus(`JSON 복사 완료 (${rows.length}개)`);
  } catch (err) {
    setStatus(err.message || "오류");
  }
});
