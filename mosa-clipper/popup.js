const I18N = {
  vi: {
    connected: 'Đã kết nối',
    offline: 'Chưa mở',
    catLabel: 'Lưu vào phân loại',
    hoverLabel: 'Nút lưu khi rê ảnh',
    captureTab: 'Chụp màn hình tab',
    openMosa: 'Mở Mosa',
    syncNow: 'Đồng bộ',
    queuePending: (n) => `${n} ảnh đang chờ`,
    capturedOk: 'Đã gửi ảnh chụp tab vào Mosa ✓',
    capturedQueued: 'Mosa chưa mở · Đã lưu vào hàng chờ',
    syncedOk: (n) => `Đã đồng bộ ${n} ảnh vào Mosa ✓`,
    openMosaFirst: 'Hãy mở ứng dụng Mosa trước khi đồng bộ',
    footLeft: 'Chuột phải lên ảnh',
    categories: [
      { id: 'other', label: 'Tự động', color: '#8E8E93' },
      { id: 'reference', label: 'Không gian', color: '#007AFF' },
      { id: 'furniture', label: 'Nội thất', color: '#C5A47E' },
      { id: 'material', label: 'Vật liệu', color: '#8D9A7C' },
      { id: 'palette', label: 'Bảng màu', color: '#FF9500' },
      { id: 'sketch', label: 'Bản vẽ', color: '#5856D6' },
    ],
  },
  en: {
    connected: 'Connected',
    offline: 'Offline',
    catLabel: 'Save to category',
    hoverLabel: 'Hover save button',
    captureTab: 'Capture visible tab',
    openMosa: 'Open Mosa',
    syncNow: 'Sync',
    queuePending: (n) => `${n} pending clip${n === 1 ? '' : 's'}`,
    capturedOk: 'Sent tab screenshot to Mosa ✓',
    capturedQueued: 'Mosa is closed · Saved to queue',
    syncedOk: (n) => `Synced ${n} clip${n === 1 ? '' : 's'} to Mosa ✓`,
    openMosaFirst: 'Open Mosa first to sync queued clips',
    footLeft: 'Right-click any image',
    categories: [
      { id: 'other', label: 'Auto', color: '#8E8E93' },
      { id: 'reference', label: 'Space', color: '#007AFF' },
      { id: 'furniture', label: 'Furniture', color: '#C5A47E' },
      { id: 'material', label: 'Material', color: '#8D9A7C' },
      { id: 'palette', label: 'Palette', color: '#FF9500' },
      { id: 'sketch', label: 'Sketch', color: '#5856D6' },
    ],
  },
};

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const catLabel = document.getElementById('catLabel');
const catGrid = document.getElementById('catGrid');
const hoverCard = document.getElementById('hoverCard');
const hoverLabel = document.getElementById('hoverLabel');
const hoverToggle = document.getElementById('hoverToggle');
const captureTabBtn = document.getElementById('captureTabBtn');
const captureTabText = document.getElementById('captureTabText');
const openMosaBtn = document.getElementById('openMosaBtn');
const openMosaText = document.getElementById('openMosaText');
const queueRow = document.getElementById('queueRow');
const queueText = document.getElementById('queueText');
const flushBtn = document.getElementById('flushBtn');
const feedbackBar = document.getElementById('feedbackBar');
const footLeft = document.getElementById('footLeft');
const langBtns = Array.from(document.querySelectorAll('.lang-btn'));

let state = {
  connected: false,
  baseUrl: 'http://127.0.0.1:4313/',
  queueCount: 0,
  category: 'other',
  hoverButton: true,
  lang: 'en',
  langManual: false,
  feedback: '',
};

let feedbackTimer = null;

function getDict() {
  return state.lang === 'vi' ? I18N.vi : I18N.en;
}

function showFeedback(text) {
  state.feedback = text;
  render();
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    state.feedback = '';
    render();
  }, 3000);
}

function render() {
  const dict = getDict();
  document.documentElement.lang = state.lang;

  langBtns.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === state.lang);
  });

  statusPill.classList.toggle('is-ok', state.connected);
  statusText.textContent = state.connected ? dict.connected : dict.offline;

  // 2x3 Tactile Category Chip Grid
  catLabel.textContent = dict.catLabel;
  catGrid.innerHTML = '';
  dict.categories.forEach((cat) => {
    const selected = cat.id === state.category;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `cat-chip${selected ? ' is-selected' : ''}`;
    chip.setAttribute('role', 'radio');
    chip.setAttribute('aria-checked', selected ? 'true' : 'false');
    chip.innerHTML = `
      <span class="cat-chip-left">
        <span class="cat-dot" style="background:${cat.color}"></span>
        <span class="cat-chip-label">${cat.label}</span>
      </span>
      ${
        selected
          ? '<svg class="cat-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
          : ''
      }
    `;
    chip.addEventListener('click', () => {
      state.category = cat.id;
      saveSettings();
      render();
    });
    catGrid.appendChild(chip);
  });

  hoverLabel.textContent = dict.hoverLabel;
  hoverToggle.checked = state.hoverButton;

  if (state.queueCount > 0) {
    queueRow.hidden = false;
    queueText.textContent = dict.queuePending(state.queueCount);
    flushBtn.textContent = dict.syncNow;
  } else {
    queueRow.hidden = true;
  }

  captureTabText.textContent = dict.captureTab;
  openMosaText.textContent = dict.openMosa;
  footLeft.textContent = dict.footLeft;

  if (state.feedback) {
    feedbackBar.hidden = false;
    feedbackBar.textContent = state.feedback;
  } else {
    feedbackBar.hidden = true;
  }
}

function saveSettings() {
  chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: {
      category: state.category,
      hoverButton: state.hoverButton,
      lang: state.lang,
      langManual: state.langManual,
    },
  });
}

function refreshStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (!res) return;
    state.connected = Boolean(res.connected);
    state.baseUrl = res.baseUrl || 'http://127.0.0.1:4313/';
    state.queueCount = res.queueCount || 0;
    if (res.settings) {
      state.category = res.settings.category || 'other';
      state.hoverButton = Boolean(res.settings.hoverButton);
      state.lang = res.settings.lang === 'vi' ? 'vi' : 'en';
      state.langManual = Boolean(res.settings.langManual);
    }
    render();
  });
}

langBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextLang = btn.dataset.lang === 'vi' ? 'vi' : 'en';
    state.lang = nextLang;
    state.langManual = true;
    state.feedback = '';
    saveSettings();
    render();
  });
});

hoverCard.addEventListener('click', (e) => {
  if (e.target === hoverToggle) return;
  state.hoverButton = !state.hoverButton;
  saveSettings();
  render();
});

hoverToggle.addEventListener('change', () => {
  state.hoverButton = hoverToggle.checked;
  saveSettings();
  render();
});

captureTabBtn.addEventListener('click', () => {
  captureTabBtn.disabled = true;
  chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB', category: state.category }, (res) => {
    captureTabBtn.disabled = false;
    const dict = getDict();
    showFeedback(res && res.delivered ? dict.capturedOk : dict.capturedQueued);
    refreshStatus();
  });
});

flushBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FLUSH_QUEUE' }, (res) => {
    const dict = getDict();
    showFeedback(res && res.ok ? dict.syncedOk(res.flushed || 0) : dict.openMosaFirst);
    refreshStatus();
  });
});

openMosaBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_MOSA' }, () => {
    window.close();
  });
});

render();
refreshStatus();
