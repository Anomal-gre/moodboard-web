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
    destination: (name) => `Dự án đích · ${name}`,
    waitingForProject: 'Mở một dự án Mosa để gửi ảnh.',
    capturedOk: (name) => `Đã lưu ảnh vào ${name}.`,
    capturedQueued: (name) => name ? `Đang chờ lưu vào ${name}.` : 'Ảnh đang chờ dự án Mosa.',
    captureError: 'Không lưu được ảnh. Hãy đồng bộ hàng chờ rồi thử lại.',
    nothingSynced: 'Ảnh vẫn đang chờ dự án đích.',
    connectionLabel: 'Kết nối Mosa cục bộ hoặc website riêng',
    siteLabel: 'URL Mosa riêng (tùy chọn)',
    codeLabel: 'Mã kết nối Mosa cục bộ',
    clearLabel: 'Xóa mã đã lưu',
    saveConnection: 'Lưu kết nối',
    connectionSaved: 'Đã lưu cấu hình kết nối.',
    connectionInvalid: 'URL hoặc mã kết nối không hợp lệ.',
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
    destination: (name) => `Destination · ${name}`,
    waitingForProject: 'Open a Mosa project to send clips.',
    capturedOk: (name) => `Saved to ${name}.`,
    capturedQueued: (name) => name ? `Queued for ${name}.` : 'Queued until a Mosa project is available.',
    captureError: 'Could not save. Sync queued clips and try again.',
    nothingSynced: 'Clips are still waiting for their destination project.',
    connectionLabel: 'Connect local or custom Mosa',
    siteLabel: 'Custom Mosa URL (optional)',
    codeLabel: 'Local Mosa connection code',
    clearLabel: 'Clear saved code',
    saveConnection: 'Save connection',
    connectionSaved: 'Connection settings saved.',
    connectionInvalid: 'Enter a valid Mosa URL or connection code.',
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
const destinationText = document.getElementById('destinationText');
const connectionForm = document.getElementById('connectionForm');
const siteUrl = document.getElementById('siteUrl');
const connectionCode = document.getElementById('connectionCode');
const clearCode = document.getElementById('clearCode');
const clearRow = document.getElementById('clearRow');
const saveConnection = document.getElementById('saveConnection');

let state = {
  connected: false,
  destination: null,
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
  destinationText.textContent = state.destination ? dict.destination(state.destination.projectName) : dict.waitingForProject;
  for (const label of ['connectionLabel', 'siteLabel', 'codeLabel', 'clearLabel', 'saveConnection']) {
    document.getElementById(label).textContent = dict[label];
  }

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
    state.destination = res.destination || null;
    state.queueCount = res.queueCount || 0;
    if (res.settings) {
      state.category = res.settings.category || 'other';
      state.hoverButton = Boolean(res.settings.hoverButton);
      state.lang = res.settings.lang === 'vi' ? 'vi' : 'en';
      state.langManual = Boolean(res.settings.langManual);
      if (document.activeElement !== siteUrl) siteUrl.value = res.settings.mosaUrl || '';
      clearRow.hidden = !res.tokenConfigured;
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
    showFeedback(res?.delivered ? dict.capturedOk(res.projectName) :
      res?.queued ? dict.capturedQueued(res.projectName) : dict.captureError);
    refreshStatus();
  });
});

flushBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'FLUSH_QUEUE' }, (res) => {
    const dict = getDict();
    showFeedback(res?.flushed ? dict.syncedOk(res.flushed) : res?.ok ? dict.nothingSynced : dict.openMosaFirst);
    refreshStatus();
  });
});

connectionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveConnection.disabled = true;
  chrome.runtime.sendMessage({
    type: 'SET_MOSA_CONNECTION', mosaUrl: siteUrl.value.trim(), token: connectionCode.value,
    clearToken: clearCode.checked,
  }, (res) => {
    saveConnection.disabled = false;
    const dict = getDict();
    showFeedback(res?.ok ? dict.connectionSaved : dict.connectionInvalid);
    if (res?.ok) {
      connectionCode.value = '';
      clearCode.checked = false;
      refreshStatus();
    }
  });
});

openMosaBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_MOSA' }, () => {
    window.close();
  });
});

render();
refreshStatus();
