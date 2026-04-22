// 請尋找 renderHistoryItems 函式並替換成這段
function renderHistoryItems(data) {
  console.log("=== 偵測到資料，開始渲染清單 ===");
  const list = document.getElementById('historyList');
  if (!list) return;

  if (!data || data.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">目前沒有歷史紀錄</div>';
    return;
  }

  let html = "";
  data.forEach((item, idx) => {
    console.log("處理項目:", item.Equipment);
    // 支援多種日期欄位名稱，確保萬無一失
    let rawDate = item.Resolved_At || item.ResolvedTimestamp || item.Timestamp;
    let displayDate = "未知時間";
    if (rawDate) {
      const d = new Date(rawDate);
      displayDate = isNaN(d.getTime()) ? rawDate : d.toLocaleString('zh-TW', { hour12: false });
    }

    html += `
      <div class="history-item" style="border:1px solid #444; margin-bottom:8px; padding:10px; border-radius:8px; background:rgba(255,255,255,0.05);">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div><span class="history-tag" style="background:#27ae60; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-right:8px;">已修復</span><strong style="color:var(--accent-gold);">${item.Equipment || '未知器材'} x ${item.Quantity || 0}</strong></div>
        </div>
        <div style="margin-top:8px; color:#aaa; font-size:12px;">
          <div>👤 報修人：${item.Reporter || '匿名'}</div>
          <div>⏰ 修復時間：${displayDate}</div>
        </div>
      </div>
    `;
  });
  list.innerHTML = html;
  console.log("=== 渲染成功 ===");
}
