const API_URL = 'https://script.google.com/macros/s/AKfycbyDAPP8Q4dEPmTJVlbFt2HuGUNU5z9cxLbwFmovRmtgc-XJMiWUGpOH2ANLhCd5fwU/exec';

let inventory = [];
let equipmentList = [];

// 緩存變數
let cachePending = null;
let cacheHistory = null;
let cacheRepairPending = null;
let cacheRepairHistory = null;

let lastFetchPending = 0;
let lastFetchHistory = 0;
let lastFetchRepairPending = 0;
let lastFetchRepairHistory = 0;

const CACHE_TIMEOUT = 30000; // 30 秒緩存時間

function showSkeleton(container, count = 3) {
  if (!container) return;
  container.innerHTML = Array(count).fill(0).map(() => `
    <div class="skeleton-card">
      <div style="display:flex; gap:8px; margin-bottom:12px;">
        <div class="skeleton-box" style="width:65px; height:24px; border-radius:5px;"></div>
        <div class="skeleton-box" style="width:65px; height:24px; border-radius:5px;"></div>
      </div>
      <div class="skeleton-box" style="width:40%; height:18px; margin-bottom:10px;"></div>
      <div class="skeleton-box" style="width:70%; height:14px; margin-bottom:6px;"></div>
      <div class="skeleton-box" style="width:55%; height:14px;"></div>
    </div>
  `).join('');
}

window.onload = () => {
  initApp();
};

async function initApp() {
  try {
    await Promise.all([
      fetchData(),
      fetchEquipmentList(),
      fetchRepairData()
    ]);
    
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token === 'BUZI_RETURN_KEY') {
      localStorage.setItem('returnToken', token);
      setTimeout(() => {
        openBorrowModal();
        switchBorrowTab('pending');
      }, 1500);
    }
  } catch (e) {
    console.error("Init failed", e);
  } finally {
    hideLoading();
    updateAdminUI();
  }
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 500);
  }
}

async function fetchData() {
  const loadingStatus = document.getElementById('loadingStatus');
  if (loadingStatus) loadingStatus.textContent = '同步中...';
  try {
    const response = await fetch(`${API_URL}?action=getInventory`);
    inventory = await response.json();
    renderRacks();
    if (loadingStatus) loadingStatus.textContent = '已同步';
  } catch (e) {
    console.error("抓取庫存失敗", e);
  }
}

async function fetchEquipmentList() {
  try {
    const response = await fetch(`${API_URL}?action=getEquipment`);
    equipmentList = await response.json();
    renderRacks();
    
    const selects = [document.getElementById('equipSelect'), document.getElementById('repairEquipSelect')];
    selects.forEach(select => {
      if (!select) return;
      select.innerHTML = '<option value="">(空)</option>';
      const groups = {};
      equipmentList.forEach(item => {
        const cat = item.category || '99-未分類';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(item);
      });
      Object.keys(groups).sort().forEach(catName => {
        const groupEl = document.createElement('optgroup');
        groupEl.label = catName.split('-').pop();
        groups[catName].forEach(item => {
          const opt = document.createElement('option');
          opt.value = item.name;
          opt.textContent = item.name;
          groupEl.appendChild(opt);
        });
        select.appendChild(groupEl);
      });
    });
  } catch (e) {
    console.error("抓取器材清單失敗", e);
  }
}

function renderRacks() {
  const container = document.getElementById('racksContainer');
  if (!container) return;
  container.innerHTML = '';
  
  const statsPool = inventory.filter(d => /^[ABCDE]/i.test(d.Rack_ID));
  const totalSlots = statsPool.filter(d => !d.Status.includes('被') && d.Status !== '停用中').length;
  const occupied = statsPool.filter(d => d.Equipment_Name && !d.Status.includes('被') && d.Status !== '停用中').length;
  
  const totals = {};
  inventory.forEach(d => {
    if (d.Equipment_Name) totals[d.Equipment_Name] = (totals[d.Equipment_Name] || 0) + parseInt(d.Quantity);
  });
  const totalQty = Object.values(totals).reduce((a, b) => a + b, 0);
  
  let lowStockCount = 0;
  if (equipmentList && equipmentList.length > 0) {
    equipmentList.forEach(item => {
      const current = totals[item.name] || 0;
      if (current < item.safety) lowStockCount++;
    });
  }

  document.getElementById('statOccupied').textContent = occupied;
  document.getElementById('statTotalItems').textContent = totalQty;
  const usagePercent = totalSlots > 0 ? ((occupied / totalSlots) * 100).toFixed(1) : 0;
  document.getElementById('statSpace').textContent = usagePercent + '%';
  
  const alertVal = document.getElementById('statAlert');
  const alertCard = document.getElementById('alertCard');
  alertVal.textContent = lowStockCount;
  if (lowStockCount > 0) {
    alertCard.classList.add('alert', 'pulse');
  } else {
    alertCard.classList.remove('alert', 'pulse');
  }

  const rackIds = [...new Set(inventory.map(item => item.Rack_ID))].sort((a, b) => {
    const order = (name) => {
      if (name === "備品區") return 999;
      if (name === "其他器材") return 998;
      if (name.includes("樂活教室")) return 900 + (name.includes("B") ? 1 : 0);
      return name.charCodeAt(0);
    };
    return order(a) - order(b);
  });

  rackIds.forEach(rackId => {
    const isAdmin = !!localStorage.getItem('adminPIN');
    if (rackId === "備品區" && !isAdmin) return;

    const card = document.createElement('div');
    card.className = 'rack-card';
    if (rackId === "備品區" || rackId === "其他器材") card.style.gridColumn = '1 / -1';
    
    card.innerHTML = `<div class="area-title">${rackId === '備品區' ? '備品區 (所有器材備料狀態)' : '區域 ' + rackId}</div><div id="container-${rackId}"></div>`;
    container.appendChild(card);
    
    const rackData = inventory.filter(d => d.Rack_ID === rackId);

    if (rackId === "備品區") {
      const mainContainer = document.getElementById(`container-${rackId}`);
      mainContainer.style.padding = '10px';
      const groups = {};
      equipmentList.forEach(equip => {
        const cat = equip.category || '99-其他';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(equip);
      });

      Object.keys(groups).sort().forEach(catKey => {
        const groupWrapper = document.createElement('div');
        groupWrapper.style.cssText = `border: 1px solid rgba(255, 255, 255, 0.05); background: rgba(255, 255, 255, 0.02); border-radius: 12px; padding: 15px; margin-bottom: 20px;`;
        groupWrapper.innerHTML = `<div style="color: var(--accent-gold); font-size: 14px; font-weight: bold; margin-bottom: 12px; padding-left: 8px; border-left: 3px solid var(--accent-gold);">${catKey.split('-').pop()}</div>`;

        const cardsRow = document.createElement('div');
        cardsRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 12px;`;

        groups[catKey].forEach(equip => {
          const spareData = inventory.find(d => d.Rack_ID === "備品區" && d.Equipment_Name === equip.name);
          const qty = spareData ? spareData.Quantity : 0;
          const sCard = document.createElement('div');
          sCard.className = `slot ${qty > 0 ? 'has-item' : ''}`;
          sCard.style.cssText = `width: 120px !important; height: 85px !important; flex: 0 0 120px !important; display: flex; flex-direction: column; justify-content: center; align-items: center; cursor: pointer; background: #111; border: 1px solid #222;`;
          sCard.innerHTML = `<div class="item-name" style="font-size:13px; margin-bottom:5px;">${equip.name}</div><div class="item-qty" style="font-size:20px; color:var(--accent-gold); font-weight:800;">${qty}</div>`;
          sCard.onclick = () => openSpareModal(equip.name, qty);
          cardsRow.appendChild(sCard);
        });
        groupWrapper.appendChild(cardsRow);
        mainContainer.appendChild(groupWrapper);
      });
    } else {
      const levels = [...new Set(rackData.map(d => d.Level))].sort((a, b) => b - a);
      const innerContainer = document.getElementById(`container-${rackId}`);
      levels.forEach(l => {
        const levelRow = document.createElement('div');
        levelRow.className = 'level-row';
        levelRow.innerHTML = `<div class="level-label">Level ${l}</div>`;
        const slotsRow = document.createElement('div');
        slotsRow.className = 'slots-row';
        const levelData = rackData.filter(d => d.Level == l);

        for (let b = 1; b <= 4; b++) {
          const slotData = levelData.find(d => d.Slot_ID.endsWith(`-${b}`));
          if (!slotData || (slotData.Status && slotData.Status.includes('被'))) continue;
          const slotDiv = document.createElement('div');
          slotDiv.className = 'slot';
          if (slotData.Basket_Size === '大') slotDiv.classList.add('big');
          if (slotData.Equipment_Name) slotDiv.classList.add('has-item');
          if (slotData.Status === '停用中') slotDiv.classList.add('disabled');
          slotDiv.innerHTML = `<div class="slot-id">${slotData.Slot_ID}</div><div class="item-name">${slotData.Status === '停用中' ? 'CLOSED' : (slotData.Equipment_Name || '')}</div><div class="item-qty">${slotData.Status === '停用中' ? '' : (slotData.Quantity > 0 ? slotData.Quantity : '')}</div>`;
          slotDiv.onclick = () => openModal(slotData);
          slotsRow.appendChild(slotDiv);
        }
        levelRow.appendChild(slotsRow);
        innerContainer.appendChild(levelRow);
      });
    }
  });
}

function hideAllModalSections() {
  ['editForm', 'detailContent', 'repairTabs', 'repairForm', 'repairHistory', 'spareForm', 'repairPendingModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; }

function openModal(data) {
  hideAllModalSections();
  const isAdmin = !!localStorage.getItem('adminPIN');
  const isDisabled = data.Status === "停用中";
  document.getElementById('editForm').style.display = 'block';
  document.getElementById('editSlotId').value = data.Slot_ID;
  document.getElementById('editRackId').value = data.Rack_ID;
  document.getElementById('editLevel').value = data.Level;
  document.getElementById('modalTitle').textContent = (isAdmin ? '編輯位置: ' : '位置資訊: ') + data.Slot_ID + (isDisabled ? " [🚫 停用中]" : "");
  document.getElementById('equipSelect').value = data.Equipment_Name || '';
  document.getElementById('qtyInput').value = data.Quantity || 0;
  document.getElementById('sizeSelect').value = data.Basket_Size || '小';
  document.getElementById('noteInput').value = data.Note || '';
  
  const inputs = ['equipSelect', 'qtyInput', 'sizeSelect', 'noteInput'];
  inputs.forEach(id => document.getElementById(id).disabled = !isAdmin || isDisabled);
  document.getElementById('adminButtons').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('guestButtons').style.display = isAdmin ? 'none' : 'flex';
  
  const btnToggle = document.getElementById('btnToggleDisable');
  if (btnToggle) btnToggle.textContent = isDisabled ? '啟用此格' : '停用此格';
  document.getElementById('modalOverlay').style.display = 'flex';
}

document.getElementById('editForm').onsubmit = async (e) => {
  e.preventDefault();
  const payload = {
    action: 'update',
    slotId: document.getElementById('editSlotId').value,
    rackId: document.getElementById('editRackId').value,
    level: parseInt(document.getElementById('editLevel').value),
    equipment: document.getElementById('equipSelect').value,
    qty: parseInt(document.getElementById('qtyInput').value),
    size: document.getElementById('sizeSelect').value,
    note: document.getElementById('noteInput').value,
    password: localStorage.getItem('adminPIN'),
    operator: 'Admin-Modern'
  };
  closeModal();
  try {
    await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
    fetchData();
  } catch (err) { alert('更新失敗'); }
};

async function toggleDisableSlot() {
  const slotId = document.getElementById('editSlotId').value;
  closeModal();
  try {
    await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'toggleDisable', slotId, password: localStorage.getItem('adminPIN') }) });
    fetchData();
  } catch (err) { alert('操作失敗'); }
}

async function clearThisSlot() {
  if (!confirm('確定要清空嗎？')) return;
  document.getElementById('equipSelect').value = '';
  document.getElementById('qtyInput').value = 0;
  document.getElementById('editForm').dispatchEvent(new Event('submit'));
}

function showEquipmentDetail() {
  hideAllModalSections();
  document.getElementById('detailContent').style.display = 'block';
  const rackTotals = {}; const spareTotals = {};
  inventory.forEach(d => {
    if (!d.Equipment_Name || d.Quantity <= 0) return;
    if (d.Rack_ID === "備品區") spareTotals[d.Equipment_Name] = (spareTotals[d.Equipment_Name] || 0) + parseInt(d.Quantity);
    else rackTotals[d.Equipment_Name] = (rackTotals[d.Equipment_Name] || 0) + parseInt(d.Quantity);
  });
  const allEquip = [...new Set([...Object.keys(rackTotals), ...Object.keys(spareTotals)])].sort();
  document.getElementById('detailList').innerHTML = allEquip.map(name => `
    <div style="background:#111; padding: 10px; border-radius: 8px; border: 1px solid #333;">
      <div style="display:flex; justify-content: space-between;"><span>${name}</span><span style="color:var(--accent-gold); font-weight:bold;">${(rackTotals[name]||0) + (spareTotals[name]||0)}</span></div>
      <div style="font-size: 10px; color: #555;">架位: ${rackTotals[name]||0} | 備品: ${spareTotals[name]||0}</div>
    </div>`).join('');
  document.getElementById('modalTitle').textContent = '器材分布詳情';
  document.getElementById('modalOverlay').style.display = 'flex';
}

function showRestockDetail() {
  hideAllModalSections();
  document.getElementById('detailContent').style.display = 'block';
  const totals = {};
  inventory.forEach(d => { if (d.Equipment_Name) totals[d.Equipment_Name] = (totals[d.Equipment_Name] || 0) + parseInt(d.Quantity); });
  const restockList = equipmentList.filter(item => (totals[item.name] || 0) < item.safety);
  document.getElementById('detailList').innerHTML = restockList.map(item => `
    <div style="background:rgba(255,68,68,0.05); padding: 10px; border-radius: 8px; border: 1px solid rgba(255,68,68,0.2);">
      <div style="display:flex; justify-content: space-between;"><span>${item.name}</span><span style="color:#ff8888;">缺 ${item.safety - (totals[item.name]||0)}</span></div>
      <div style="font-size: 10px; color: #555;">目前: ${totals[item.name]||0} / 安全: ${item.safety}</div>
    </div>`).join('');
  document.getElementById('modalTitle').textContent = '待補貨清單';
  document.getElementById('modalOverlay').style.display = 'flex';
}

// --- 維修中心 ---
function openRepairModal() { hideAllModalSections(); document.getElementById('repairTabs').style.display = 'flex'; switchRepairTab('form'); document.getElementById('modalTitle').textContent = '🛠️ 器材維修中心'; document.getElementById('modalOverlay').style.display = 'flex'; }
function switchRepairTab(type) {
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', (i===0 && type==='form') || (i===1 && type==='pending') || (i===2 && type==='history')));
  document.getElementById('repairForm').style.display = type === 'form' ? 'block' : 'none';
  document.getElementById('repairPendingModal').style.display = type === 'pending' ? 'block' : 'none';
  document.getElementById('repairHistory').style.display = type === 'history' ? 'block' : 'none';
  if (type === 'pending') fetchRepairPendingInModal();
  if (type === 'history') fetchRepairHistory();
}

async function fetchRepairData() {
  const isAdmin = !!localStorage.getItem('adminPIN');
  // 此函式用於首頁側邊欄顯示，也使用緩存
  const now = Date.now();
  if (cacheRepairPending && (now - lastFetchRepairPending < CACHE_TIMEOUT)) {
    renderRepairList(cacheRepairPending, isAdmin);
    return;
  }
  
  showSkeleton(document.getElementById('repairList'), 2);
  try {
    const res = await fetch(`${API_URL}?action=getRepair&type=pending`);
    const data = await res.json();
    cacheRepairPending = data;
    lastFetchRepairPending = Date.now();
    renderRepairList(data, isAdmin);
  } catch (e) {}
}

function renderRepairList(data, isAdmin) {
  const list = document.getElementById('repairList');
  const section = document.getElementById('repairSection');
  if (!data || data.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = data.map(item => {
    const timeStr = new Date(item.Timestamp).toLocaleString('zh-TW', { hour12: false });
    return `
      <div class="repair-item" style="display:flex; flex-direction:column; align-items:flex-start; gap:5px;">
        <div style="width:100%; display:flex; justify-content:space-between; align-items:flex-start;">
          <h4 style="margin:0;">${item.Equipment} x ${item.Quantity}</h4>
          ${isAdmin ? `<button class="btn-resolve" onclick="resolveRepair(${item.id})">已修復</button>` : ''}
        </div>
        <p style="margin:0; font-size:12px; color:#ddd;">描述：${item.Note||'無'}</p>
        <p style="margin:0; font-size:11px; color:#aaa;">報修人：${item.Reporter||'匿名'}</p>
        <p style="margin:0; font-size:10px; color:#888;">時間：${timeStr}</p>
      </div>
    `;
  }).join('');
}

async function resolveRepair(id) {
  if (!confirm('確認已修復？')) return;
  try { 
    await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'resolveRepair', repairId: id, password: localStorage.getItem('adminPIN') }) }); 
    // 清除維修相關緩存
    cacheRepairPending = null;
    cacheRepairHistory = null;
    fetchRepairData(); 
    if(document.getElementById('repairPendingModal').style.display === 'block') fetchRepairPendingInModal(); 
  } catch (e) {}
}

async function fetchRepairPendingInModal() {
  const list = document.getElementById('pendingListModal');
  const isAdmin = !!localStorage.getItem('adminPIN');
  
  const now = Date.now();
  if (cacheRepairPending && (now - lastFetchRepairPending < CACHE_TIMEOUT)) {
    renderRepairModalItems(cacheRepairPending, isAdmin);
    return;
  }

  showSkeleton(list, 3);
  try {
    const res = await fetch(`${API_URL}?action=getRepair&type=pending`);
    const data = await res.json();
    cacheRepairPending = data;
    lastFetchRepairPending = Date.now();
    renderRepairModalItems(data, isAdmin);
  } catch (e) { list.innerHTML = '讀取失敗'; }
}

function renderRepairModalItems(data, isAdmin) {
  const list = document.getElementById('pendingListModal');
  if (!data || data.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">目前無待修項目</div>';
    return;
  }
  list.innerHTML = data.map(item => {
    const timeStr = new Date(item.Timestamp).toLocaleString('zh-TW', { hour12: false });
    return `
      <div class="repair-item" style="margin-bottom:12px; display:flex; flex-direction:column; gap:5px; align-items:flex-start;">
        <div style="width:100%; display:flex; justify-content:space-between;">
          <h4 style="margin:0; color:var(--accent-gold);">${item.Equipment} x ${item.Quantity}</h4>
          ${isAdmin ? `<button class="btn-resolve" onclick="resolveRepair(${item.id})">已修復</button>` : ''}
        </div>
        <p style="margin:0; font-size:13px; color:#eee;">描述：${item.Note||'無'}</p>
        <div style="margin-top:5px; border-top:1px solid #333; width:100%; padding-top:5px;">
          <p style="margin:0; font-size:12px; color:#aaa;">報修人：${item.Reporter||'匿名'}</p>
          <p style="margin:0; font-size:11px; color:#777;">報修時間：${timeStr}</p>
        </div>
      </div>
    `;
  }).join('');
}

async function fetchRepairHistory() {
  const list = document.getElementById('historyList');
  
  const now = Date.now();
  if (cacheRepairHistory && (now - lastFetchRepairHistory < CACHE_TIMEOUT)) {
    console.log("Using cached history");
    renderHistoryItems(cacheRepairHistory);
    return;
  }

  showSkeleton(list, 4);
  try {
    const res = await fetch(`${API_URL}?action=getRepair&type=history`);
    const data = await res.json();
    console.log("History data received:", data);
    cacheRepairHistory = data;
    lastFetchRepairHistory = Date.now();
    renderHistoryItems(data);
  } catch (e) { 
    console.error("Fetch history error:", e);
    list.innerHTML = '連線失敗或後端錯誤'; 
  }
}

function renderHistoryItems(data) {
  console.log("Start rendering history items...");
  const list = document.getElementById('historyList');
  if (!list) {
    console.error("Element #historyList not found!");
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">無紀錄</div>';
    return;
  }
  
  try {
    const html = data.map((item, idx) => {
      console.log(`Processing item ${idx}:`, item);
      let resolveTime = '未知';
      if (item.Resolved_At) {
        try {
          const d = new Date(item.Resolved_At);
          resolveTime = isNaN(d.getTime()) ? item.Resolved_At : d.toLocaleString('zh-TW', { hour12: false });
        } catch (e) { resolveTime = item.Resolved_At; }
      }
      
      return `
        <div class="history-item">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div><span class="history-tag">已修復</span><strong>${item.Equipment || '未知器材'} x ${item.Quantity || 0}</strong></div>
          </div>
          <div style="margin-top:5px; color:#888; font-size:11px;">
            <div>報修人：${item.Reporter || '匿名'}</div>
            <div>修復時間：${resolveTime}</div>
          </div>
        </div>
      `;
    }).join('');
    list.innerHTML = html;
    console.log("History rendering complete!");
  } catch (err) {
    console.error("Render history error:", err);
    list.innerHTML = '渲染失敗：' + err.message;
  }
}

document.getElementById('repairForm').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector('button[type="submit"]');
  const originalText = btn.innerText;
  
  const reporterName = document.getElementById('repairReporterName').value;
  const reporterClass = document.getElementById('repairReporterClass').value;
  const fullReporter = reporterClass ? `【${reporterName}】老師 / ${reporterClass}` : `【${reporterName}】老師`;
  
  // 鎖定按鈕避免重複點擊
  btn.disabled = true;
  btn.innerText = "傳送中...";
  btn.style.opacity = "0.7";

  const payload = { 
    action: 'addRepair', 
    equipment: document.getElementById('repairEquipSelect').value, 
    qty: parseInt(document.getElementById('repairQty').value), 
    note: document.getElementById('repairNote').value, 
    reporter: fullReporter 
  };
  
  try { 
    await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) }); 
    cacheRepairPending = null; // 清除緩存以顯示新報修
    alert("報修登記成功！");
    
    // 不關閉視窗，改為切換到「待修復」分頁
    fetchRepairData(); 
    switchRepairTab('pending');
    
    // 清空表單內容
    document.getElementById('repairNote').value = '';
    document.getElementById('repairQty').value = '1';
  } catch (e) {
    alert("報修失敗，請檢查網路連線");
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
    btn.style.opacity = "1";
  }
};

// --- 借用中心 ---
function openBorrowModal() {
  document.getElementById('borrowModal').style.display = 'flex'; switchBorrowTab('form');
  for (let i = 1; i <= 3; i++) {
    const sel = document.getElementById(`borrowEquipSelect${i}`); sel.innerHTML = '<option value="">(無)</option>';
    equipmentList.forEach(item => { const opt = document.createElement('option'); opt.value = item.name; opt.textContent = item.name; sel.appendChild(opt); });
    document.getElementById(`borrowQty${i}`).value = (i===1?1:0);
  }
  const now = new Date(); 
  const dateStr = now.toISOString().split('T')[0];
  document.getElementById('borrowDate').value = dateStr;
  document.getElementById('returnDate').value = dateStr;
  document.getElementById('borrowPeriod').value = "第一節";
  document.getElementById('returnPeriod').value = "第一節";
  document.getElementById('borrowTeacherInput').value = "";
  document.getElementById('borrowTitleInput').value = "老師";
  document.getElementById('borrowClassInput').value = "";
  document.getElementById('borrowPurposeInput').value = "教學用。";
}
function closeBorrowModal() { document.getElementById('borrowModal').style.display = 'none'; }
function switchBorrowTab(type) {
  const tabs = document.querySelectorAll('#borrowModal .tab');
  tabs[0].classList.toggle('active', type === 'form'); 
  tabs[1].classList.toggle('active', type === 'pending'); 
  tabs[2].classList.toggle('active', type === 'history');
  document.getElementById('borrowForm').style.display = type === 'form' ? 'block' : 'none';
  document.getElementById('borrowPending').style.display = type === 'pending' ? 'block' : 'none';
  document.getElementById('borrowHistory').style.display = type === 'history' ? 'block' : 'none';
  if (type === 'pending') fetchBorrowPending();
  if (type === 'history') fetchBorrowHistory();
}

async function submitBorrow(btn) {
  // btn 直接由 HTML 的 this 傳入
  const originalText = btn.innerText;
  const teacherName = document.getElementById('borrowTeacherInput').value.trim();
  const borrowClassValue = document.getElementById('borrowClassInput').value.trim();
  if (!teacherName) return alert("請填寫「借用人姓名」！");
  if (!borrowClassValue) return alert("請填寫「班級」！");

  btn.disabled = true;
  btn.innerText = "處理中...";
  btn.style.opacity = "0.7";

  const teacherTitle = document.getElementById('borrowTitleInput').value || "";
  const teacher = `【${teacherName}】${teacherTitle}`;
  const items = [];
  for (let i = 1; i <= 3; i++) {
    const equip = document.getElementById(`borrowEquipSelect${i}`).value;
    const qty = parseInt(document.getElementById(`borrowQty${i}`).value);
    if (equip && qty > 0) items.push({ equipment: equip, qty: qty });
  }
  
  if (!items.length) {
    btn.disabled = false;
    btn.innerText = originalText;
    btn.style.opacity = "1";
    return alert("請選擇至少一項器材！");
  }

  try {
    const borrowDate = document.getElementById('borrowDate').value;
    const borrowPeriod = document.getElementById('borrowPeriod').value;
    const returnDate = document.getElementById('returnDate').value;
    const returnPeriod = document.getElementById('returnPeriod').value;
    const borrowRangeStr = `${borrowDate} ${borrowPeriod} ~ ${returnDate} ${returnPeriod}`;
    const borrowPurposeValue = document.getElementById('borrowPurposeInput').value || "";
    const fullPurpose = `【${borrowClassValue}】${borrowPurposeValue}`;
    
    await fetch(API_URL, { 
      method: 'POST', 
      body: JSON.stringify({ 
        action: 'submitBorrow', 
        items, 
        teacher, 
        class: fullPurpose, 
        borrowTime: borrowRangeStr 
      }) 
    });
    // 成功送出後，清除緩存，強迫下次讀取新資料
    cachePending = null; 
    alert("借用登記成功！"); 
    switchBorrowTab('pending');
  } catch (e) { 
    alert("登記失敗，請檢查網路連線"); 
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
    btn.style.opacity = "1";
  }
}

async function fetchBorrowPending() {
  const list = document.getElementById('borrowPendingList');
  const isAdmin = !!localStorage.getItem('adminPIN');
  const hasReturnToken = localStorage.getItem('returnToken') === 'BUZI_RETURN_KEY';
  
  // 檢查緩存是否有效
  const now = Date.now();
  if (cachePending && (now - lastFetchPending < CACHE_TIMEOUT)) {
    renderPendingItems(cachePending, isAdmin, hasReturnToken);
    return;
  }

  showSkeleton(list, 3);
  try {
    const res = await fetch(`${API_URL}?action=getBorrow&type=pending`);
    const data = await res.json();
    
    // 更新緩存
    cachePending = data;
    lastFetchPending = Date.now();
    
    renderPendingItems(data, isAdmin, hasReturnToken);
  } catch (e) { 
    list.innerHTML = '讀取失敗'; 
  }
}

function renderPendingItems(data, isAdmin, hasReturnToken) {
  const list = document.getElementById('borrowPendingList');
  if (!data || data.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">目前無借用中器材</div>';
    return;
  }

  const groups = {};
  data.forEach(item => {
    const key = `${item.Teacher}-${item.Class}-${item.Borrow_Range}`;
    if (!groups[key]) {
      groups[key] = { teacher: item.Teacher, class: item.Class, time: item.Borrow_Range, ids: [], items: [] };
    }
    groups[key].ids.push(item.id);
    groups[key].items.push(`${item.Equipment} x ${item.Quantity}`);
  });

  list.innerHTML = Object.values(groups).map(g => `
    <div class="repair-item" style="margin-bottom:15px; padding:15px; border:1px solid #444; background:rgba(255,255,255,0.02); border-radius:10px;">
      <div style="flex:1;">
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
          ${g.items.map(txt => `<span style="background:#222; color:var(--accent-gold); padding:4px 10px; border-radius:5px; font-size:13px; font-weight:bold; border:1px solid #444;">${txt}</span>`).join('')}
        </div>
        <p style="margin:2px 0; font-size:13px; color:#ddd; font-weight:bold;">${g.teacher}</p>
        <p style="margin:2px 0; font-size:12px; color:#aaa;">用途：${g.class}</p>
        <p style="margin:2px 0; font-size:11px; color:#888;">借用時段: ${g.time || '無紀錄'}</p>
      </div>
      <div style="margin-top:10px; text-align:right;">
        ${(isAdmin || hasReturnToken) 
          ? `<button class="btn-resolve" style="width:100%; padding:10px;" onclick="returnBorrowBatch([${g.ids.join(',')}], this)">確認歸還全部</button>` 
          : `<span style="font-size: 11px; color: #3498db; border: 1px solid rgba(52,152,219,0.3); padding: 4px 10px; border-radius: 4px; display:inline-block;">借用中</span>`
        }
      </div>
    </div>
  `).join('');
}

async function returnBorrowBatch(ids, btn) {
  if (!confirm(`確定歸還這 ${ids.length} 樣器材嗎？`)) return;
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = "處理中...";
  try {
    await fetch(API_URL, { 
      method: 'POST', 
      body: JSON.stringify({ action: 'returnBorrowBatch', borrowIds: ids, password: localStorage.getItem('adminPIN') }) 
    });
    // 歸還後，清除所有借用相關緩存
    cachePending = null;
    cacheHistory = null;
    fetchBorrowPending();
  } catch (e) {
    alert("歸還失敗");
    btn.disabled = false;
    btn.innerText = originalText;
  }
}

async function returnBorrow(id) {
  if (!confirm("確認歸還？")) return;
  try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'returnBorrow', borrowId: id, password: localStorage.getItem('adminPIN') }) }); fetchBorrowPending(); } catch (e) {}
}

async function fetchBorrowHistory() {
  const list = document.getElementById('borrowHistoryList');
  
  const now = Date.now();
  if (cacheHistory && (now - lastFetchHistory < CACHE_TIMEOUT)) {
    renderHistoryItems(cacheHistory);
    return;
  }

  showSkeleton(list, 5);
  try {
    const res = await fetch(`${API_URL}?action=getBorrow&type=history`);
    const data = await res.json();
    
    cacheHistory = data;
    lastFetchHistory = Date.now();
    
    renderHistoryItems(data);
  } catch (e) { 
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#ff6666;">讀取失敗</div>'; 
  }
}

function renderHistoryItems(data) {
  const list = document.getElementById('borrowHistoryList');
  if (!data || data.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:20px; color:#555;">目前尚無借用紀錄</div>';
    return;
  }

  const groups = {};
  data.forEach(item => {
    const key = `${item.Teacher}-${item.Class}-${item.Borrow_Range}`;
    if (!groups[key]) {
      groups[key] = { teacher: item.Teacher, class: item.Class, time: item.Borrow_Range, returnedAt: item.Returned_At, items: [] };
    }
    groups[key].items.push(`${item.Equipment} x ${item.Quantity}`);
  });

  list.innerHTML = Object.values(groups).map(g => {
    const returnTime = g.returnedAt ? new Date(g.returnedAt).toLocaleString('zh-TW', { hour12: false }) : '---';
    return `
      <div class="history-item" style="margin-bottom:15px; padding:15px; border-bottom:1px solid #222; background:rgba(255,255,255,0.01); border-radius:8px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
          <div style="display:flex; flex-wrap:wrap; gap:5px;">
            ${g.items.map(txt => `<span style="background:#1a1a1a; color:var(--accent-gold); padding:2px 8px; border-radius:4px; font-size:12px; border:1px solid #333;">${txt}</span>`).join('')}
          </div>
          <span class="history-tag" style="background:#27ae60; color:#fff; font-size:10px; padding:2px 6px; border-radius:4px;">已歸還</span>
        </div>
        <div style="font-size:13px; color:#ddd; font-weight:bold; margin-bottom:4px;">${g.teacher}</div>
        <div style="font-size:12px; color:#999; margin-bottom:2px;">用途：${g.class}</div>
        <div style="font-size:11px; color:#777;">借用：${g.time || '無紀錄'}</div>
        <div style="font-size:11px; color:#777;">歸還：${returnTime}</div>
      </div>
    `;
  }).join('');
}

function generatePrintLabels() {
  const printArea = document.getElementById('printArea'); printArea.innerHTML = '';
  const rackIds = [...new Set(inventory.map(item => item.Rack_ID))].sort();
  rackIds.forEach(rackId => {
    if (rackId === "備品區" || rackId === "其他器材") return;
    const rackData = inventory.filter(d => d.Rack_ID === rackId);
    const page = document.createElement('div'); page.className = 'print-page';
    page.innerHTML = `<div class="print-title">架位 ${rackId}</div>`;
    const grid = document.createElement('div'); grid.className = 'print-grid';
    for (let l = 3; l >= 1; l--) {
      for (let s = 1; s <= 4; s++) {
        const slot = rackData.find(d => d.Level == l && d.Slot_ID.endsWith(`-${s}`));
        if (!slot || (slot.Status && slot.Status.includes('被'))) continue;
        const div = document.createElement('div'); div.className = 'print-slot';
        if (slot.Basket_Size === '大') div.classList.add('big');
        div.innerHTML = `<div class="print-item-name">${slot.Equipment_Name || ''}</div>`;
        grid.appendChild(div);
      }
    }
    page.appendChild(grid); printArea.appendChild(page);
  });
  setTimeout(() => window.print(), 500);
}

function openSpareModal(name, qty) {
  if (!localStorage.getItem('adminPIN')) return alert('僅限管理員');
  hideAllModalSections(); document.getElementById('spareForm').style.display = 'block';
  document.getElementById('modalTitle').textContent = '備品調整';
  document.getElementById('spareEquipTitle').textContent = name;
  document.getElementById('spareQtyInput').value = qty;
  document.getElementById('modalOverlay').style.display = 'flex';
}
document.getElementById('spareForm').onsubmit = async (e) => {
  e.preventDefault();
  try { await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'updateSpare', equipment: document.getElementById('spareEquipTitle').textContent, qty: parseInt(document.getElementById('spareQtyInput').value), password: localStorage.getItem('adminPIN') }) }); closeModal(); fetchData(); } catch (e) {}
};

function toggleAdmin() {
  const current = localStorage.getItem('adminPIN');
  if (current) { if (confirm('登出？')) { localStorage.removeItem('adminPIN'); updateAdminUI(); renderRacks(); } }
  else { const pin = prompt('密碼:'); if (pin === '1234') { localStorage.setItem('adminPIN', pin); updateAdminUI(); renderRacks(); } }
}
function updateAdminUI() {
  const isAdmin = !!localStorage.getItem('adminPIN');
  const statusEl = document.getElementById('adminStatus');
  if (statusEl) { statusEl.textContent = isAdmin ? '🔓 已進入管理模式' : '🔒 管理員登入'; statusEl.style.background = isAdmin ? 'var(--accent-gold)' : 'transparent'; }
  const printBtn = document.getElementById('btnPrintLabels'); if (printBtn) printBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  const alertCard = document.getElementById('alertCard'); if (alertCard) alertCard.style.display = isAdmin ? 'flex' : 'none';
}
