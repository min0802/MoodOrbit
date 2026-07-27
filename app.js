/* Mood Orbit MVP v6
 * - Two-panel emotion/routine care experience
 * - Seven fixed emotion colors
 * - Web Bluetooth integration with Mood Orbit ESP32-C3 firmware v5
 * - Supabase REST insert with offline queue
 */

const APP_VERSION = '6.0.3';
const STORAGE_KEY = 'moodOrbit_DB_v6';
const LEGACY_STORAGE_KEY = 'moodOrbit_DB';
const PREVIOUS_STORAGE_KEY = 'moodOrbit_DB_v5';
const QUEUE_KEY = 'moodOrbit_syncQueue_v6';
const SETTINGS_KEY = 'moodOrbit_cloudSettings_v6';

const BLE_UUIDS = {
  service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e'
};

const DEVICE_IMAGE_DEFAULT = 'assets/device_main.png';

const EMOTIONS = {
  joy: {
    id: 'joy', code: 'JOY', name: '기쁨', color: '#FF9F43',
    uid: '', desc: '기분 좋은 순간과 작은 성취가 마음에 따뜻하게 남아 있어요.',
    imgSrc: 'assets/dome_joy.png',
    deviceSrc: 'assets/device_joy.png'
  },
  sad: {
    id: 'sad', code: 'SADNESS', name: '슬픔', color: '#8A93A6',
    uid: '', desc: '마음이 무겁거나 공허한 상태도 숨기지 않고 그대로 남겨도 괜찮아요.',
    imgSrc: 'assets/dome_sad.png',
    deviceSrc: 'assets/device_dome_sad.png'
  },
  anger: {
    id: 'anger', code: 'ANGER', name: '분노', color: '#FF3B30',
    uid: '', desc: '억울하거나 화가 난 마음이 있다는 사실을 먼저 알아차려 주세요.',
    imgSrc: 'assets/dome_anger.png',
    deviceSrc: 'assets/device_anger.png'
  },
  surprise: {
    id: 'surprise', code: 'SURPRISE', name: '놀람', color: '#FFD43B',
    uid: '', desc: '예상하지 못한 변화로 마음이 크게 흔들린 순간을 기록합니다.',
    imgSrc: 'assets/dome_surprise.png',
    deviceSrc: 'assets/device_dome_surprise.png'
  },
  peace: {
    id: 'peace', code: 'PEACE', name: '평화', color: '#4D96FF',
    uid: '', desc: '마음이 고요하고 안정된 순간의 온도를 오래 기억해 보세요.',
    imgSrc: 'assets/dome_peace.png',
    deviceSrc: 'assets/device_peace.png'
  },
  flutter: {
    id: 'flutter', code: 'EXCITEMENT', name: '설렘', color: '#FF78B7',
    uid: '', desc: '기대와 두근거림이 하루를 조금 더 선명하게 만드는 상태예요.',
    imgSrc: 'assets/dome_flutter.png',
    deviceSrc: 'assets/device_flutter.png'
  },
  irritation: {
    id: 'irritation', code: 'IRRITATION', name: '짜증', color: '#62C370',
    uid: '', desc: '답답하고 예민해진 마음은 잠시 멈춰 쉬어가라는 신호일 수 있어요.',
    imgSrc: 'assets/dome_irritation.png',
    deviceSrc: 'assets/device_irritation.png'
  }
};

const EMOTION_BY_CODE = Object.fromEntries(
  Object.values(EMOTIONS).map((emotion) => [emotion.code, emotion])
);

const DEFAULT_ROUTINES = [
  { id: 'rout-sleep', name: '수면', time: '08:00', desc: '제시간에 편안히 눈뜨기' },
  { id: 'rout-meal', name: '식사', time: '12:30', desc: '부담 없는 한 끼 챙기기' },
  { id: 'rout-cleanup', name: '정리', time: '18:00', desc: '눈앞의 한 곳만 가볍게 정돈하기' },
  { id: 'rout-shower', name: '샤워', time: '21:00', desc: '따뜻한 물로 오늘의 피로 씻어내기' }
];

let db = createDefaultDb();
let activeDomeId = null;
let activeDomeSnapshot = null;
let myOrbitDomes = [];
let selectedOrbitColor = '#8B7CF6';
let audioCtx = null;
let nudgeTimer = null;

const ble = {
  device: null,
  server: null,
  rx: null,
  tx: null,
  connected: false,
  buffer: '',
  deviceId: 'ORBIT_0001',
  learningCode: 'NONE',
  tags: {}
};

let cloudSettings = loadJson(SETTINGS_KEY, {
  supabaseUrl: '',
  supabaseKey: '',
  deviceId: 'ORBIT_0001'
});

let syncQueue = loadJson(QUEUE_KEY, []);

function createDefaultDb() {
  return {
    version: APP_VERSION,
    participantId: makeUuid(),
    myOrbit: null,
    myOrbits: [],
    figureOwnerName: '',
    routines: structuredCloneSafe(DEFAULT_ROUTINES),
    logs: {},
    events: []
  };
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeUuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to parse ${key}`, error);
    return fallback;
  }
}

function saveDb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function saveQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(syncQueue));
  updateSyncUi();
}

function saveCloudSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloudSettings));
}

function getTodayString(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalTimestamp() {
  return new Date().toISOString();
}

function getDayLog(dateKey = getTodayString()) {
  if (!db.logs[dateKey]) {
    db.logs[dateKey] = { emotion: null, emotionMeta: null, routines: {} };
  }
  if (!db.logs[dateKey].routines) db.logs[dateKey].routines = {};
  return db.logs[dateKey];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getDomeInfo(domeId) {
  if (EMOTIONS[domeId]) return EMOTIONS[domeId];
  const customDome = myOrbitDomes.find((dome) => dome.id === domeId);
  if (customDome) return customDome;
  const storedOrbit = Array.isArray(db.myOrbits) ? db.myOrbits.find((orbit) => orbit.id === domeId) : null;
  return storedOrbit ? createMyOrbitDome(storedOrbit) : null;
}

function findEmotionByUid(uid) {
  const normalized = String(uid || '').replaceAll(':', '').toUpperCase();
  return Object.values(EMOTIONS).find((emotion) =>
    emotion.uid && emotion.uid.replaceAll(':', '').toUpperCase() === normalized
  );
}

function migrateLegacyData() {
  const current = loadJson(STORAGE_KEY, null);
  const previous = loadJson(PREVIOUS_STORAGE_KEY, null);
  const legacy = loadJson(LEGACY_STORAGE_KEY, null);
  const source = current || previous || legacy;

  if (!source) {
    db = createDefaultDb();
    saveDb();
    return;
  }

  db = {
    ...createDefaultDb(),
    ...source,
    version: APP_VERSION,
    participantId: source.participantId || makeUuid(),
    routines: Array.isArray(source.routines) && source.routines.length
      ? source.routines
      : structuredCloneSafe(DEFAULT_ROUTINES),
    logs: source.logs || {},
    events: Array.isArray(source.events) ? source.events : [],
    figureOwnerName: source.figureOwnerName || ''
  };

  db.myOrbits = Array.isArray(source.myOrbits) ? source.myOrbits : [];
  if (!db.myOrbits.length && source.myOrbit) {
    db.myOrbits = [{
      id: 'my-dome',
      name: source.myOrbit.name,
      color: source.myOrbit.color,
      updatedAt: source.myOrbit.updatedAt || getLocalTimestamp()
    }];
  }

  Object.values(db.logs).forEach((log) => {
    if (!log.routines) log.routines = {};
    if (!('emotionMeta' in log)) {
      const info = getDomeInfo(log.emotion);
      log.emotionMeta = info ? {
        id: info.id,
        code: info.code || 'CUSTOM',
        name: info.name,
        color: info.color,
        source: 'LEGACY',
        uid: info.uid || null,
        recordedAt: null
      } : null;
    }
  });

  saveDb();
}

function createMyOrbitDome(orbit) {
  return {
    id: orbit.id,
    code: 'CUSTOM',
    name: orbit.name,
    color: orbit.color,
    uid: '',
    desc: '색과 이름을 직접 정해 오늘을 기록하는 커스텀 돔입니다.',
    imgSrc: null,
    deviceSrc: 'assets/device_my.png',
    custom: true
  };
}

function initializeMyOrbit() {
  db.myOrbits = Array.isArray(db.myOrbits) ? db.myOrbits : [];
  myOrbitDomes = db.myOrbits.map(createMyOrbitDome);

}

function showToast(message, type = 'info', timeout = 3200) {
  const region = document.getElementById('toast-region');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), timeout);
}

function setupTabs() {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  if (!Array.isArray(db.myOrbits) || !db.myOrbits.length) switchTab('onboarding');
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tabId}`);
  });

  if (tabId === 'calendar') renderCalendar();
  if (tabId === 'report') updateReport();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function componentToHex(value) {
  return Math.round(value).toString(16).padStart(2, '0').toUpperCase();
}

function hsvToHex(hue, saturation, value) {
  const chroma = value * saturation;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (segment < 1) [red, green, blue] = [chroma, x, 0];
  else if (segment < 2) [red, green, blue] = [x, chroma, 0];
  else if (segment < 3) [red, green, blue] = [0, chroma, x];
  else if (segment < 4) [red, green, blue] = [0, x, chroma];
  else if (segment < 5) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return `#${componentToHex((red + match) * 255)}${componentToHex((green + match) * 255)}${componentToHex((blue + match) * 255)}`;
}

function hexToHsv(hex) {
  const normalized = String(hex || '#8B7CF6').replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  return {
    hue: (hue + 360) % 360,
    saturation: max === 0 ? 0 : delta / max,
    value: max
  };
}
function getFigureTitle() {
  const name = String(db.figureOwnerName || '').trim();
  return name ? `${name}의 오빗 피규어` : '오빗 피규어';
}

function updateFigureTitle() {
  const title = document.getElementById('figure-title-text');
  if (title) title.textContent = getFigureTitle();
}

function setupFigureNameEditor() {
  const button = document.getElementById('figure-name-edit-btn');
  if (!button) return;

  button.addEventListener('click', () => {
    const currentName = String(db.figureOwnerName || '').trim();
    const nextName = prompt('오빗 피규어 앞에 들어갈 이름을 입력하세요.', currentName);
    if (nextName === null) return;

    db.figureOwnerName = nextName.trim().slice(0, 12);
    saveDb();
    updateFigureTitle();
    showToast(db.figureOwnerName ? `${getFigureTitle()}로 저장했습니다.` : '오빗 피규어 이름을 기본값으로 되돌렸습니다.', 'success');
  });
}
function setupOnboarding() {
  const colors = [
    { name: '오빗 퍼플', hex: '#8B7CF6' },
    { name: '민트', hex: '#66D1B2' },
    { name: '로즈', hex: '#F984A8' },
    { name: '선샤인', hex: '#F7C65B' },
    { name: '라벤더', hex: '#C39BF3' },
    { name: '스카이', hex: '#69B8F4' }
  ];

  const palette = document.getElementById('color-palette-container');
  const preview = document.getElementById('custom-dome-preview-box');
  const nameInput = document.getElementById('my-dome-name-input');
  const colorWheel = document.getElementById('my-dome-color-wheel');
  const colorHandle = document.getElementById('my-dome-color-handle');
  const brightnessInput = document.getElementById('my-dome-brightness-input');
  const colorValue = document.getElementById('my-dome-color-value');
  let wheelDragging = false;
  let currentHsv = hexToHsv(selectedOrbitColor);

  const updateWheelHandle = () => {
    if (!colorHandle) return;
    const angle = (currentHsv.hue - 90) * Math.PI / 180;
    const distance = currentHsv.saturation * 50;
    colorHandle.style.left = `${50 + Math.cos(angle) * distance}%`;
    colorHandle.style.top = `${50 + Math.sin(angle) * distance}%`;
    colorHandle.style.background = selectedOrbitColor;
  };

  const syncSelectedColor = (color, { updateHsv = true } = {}) => {
    selectedOrbitColor = color.toUpperCase();
    if (updateHsv) currentHsv = hexToHsv(selectedOrbitColor);
    preview.style.setProperty('--custom-color', selectedOrbitColor);
    if (brightnessInput) brightnessInput.value = Math.round(currentHsv.value * 100);
    if (colorValue) colorValue.textContent = selectedOrbitColor;
    palette.querySelectorAll('.color-option').forEach((item) => {
      item.classList.toggle('selected', item.dataset.color === selectedOrbitColor);
    });
    updateWheelHandle();
  };

  const selectColorFromWheel = (event) => {
    if (!colorWheel) return;
    const rect = colorWheel.getBoundingClientRect();
    const radius = rect.width / 2;
    const x = event.clientX - rect.left - radius;
    const y = event.clientY - rect.top - radius;
    const distance = Math.min(Math.hypot(x, y), radius);
    currentHsv.saturation = clamp(distance / radius, 0, 1);
    currentHsv.hue = (Math.atan2(y, x) * 180 / Math.PI + 90 + 360) % 360;
    syncSelectedColor(hsvToHex(currentHsv.hue, currentHsv.saturation, currentHsv.value), { updateHsv: false });
  };

  nameInput.value = '';
  syncSelectedColor(selectedOrbitColor);

  palette.innerHTML = '';
  colors.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'color-option';
    button.title = option.name;
    button.setAttribute('aria-label', option.name);
    button.style.backgroundColor = option.hex;
    button.dataset.color = option.hex.toUpperCase();
    button.classList.toggle('selected', option.hex.toUpperCase() === selectedOrbitColor.toUpperCase());
    button.addEventListener('click', () => syncSelectedColor(option.hex));
    palette.appendChild(button);
  });

  colorWheel?.addEventListener('pointerdown', (event) => {
    wheelDragging = true;
    colorWheel.setPointerCapture?.(event.pointerId);
    selectColorFromWheel(event);
  });
  colorWheel?.addEventListener('pointermove', (event) => {
    if (wheelDragging) selectColorFromWheel(event);
  });
  colorWheel?.addEventListener('pointerup', (event) => {
    wheelDragging = false;
    colorWheel.releasePointerCapture?.(event.pointerId);
  });
  colorWheel?.addEventListener('pointercancel', () => {
    wheelDragging = false;
  });
  brightnessInput?.addEventListener('input', () => {
    currentHsv.value = Number(brightnessInput.value) / 100;
    syncSelectedColor(hsvToHex(currentHsv.hue, currentHsv.saturation, currentHsv.value), { updateHsv: false });
  });

  document.getElementById('save-onboarding-btn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('오빗의 이름을 먼저 적어주세요.', 'warning');
      nameInput.focus();
      return;
    }

    db.myOrbits = Array.isArray(db.myOrbits) ? db.myOrbits : [];
    const orbit = {
      id: `my-dome-${Date.now()}`,
      name,
      color: selectedOrbitColor,
      updatedAt: getLocalTimestamp()
    };
    db.myOrbits.push(orbit);
    db.myOrbit = orbit;
    saveDb();
    initializeMyOrbit();
    initializeDomesTray();
    nameInput.value = '';
    showToast(`${name} 오빗이 등록되었습니다.`, 'success');
    switchTab('today');
  });
}
function initializeDomesTray() {
  const container = document.getElementById('domes-tray-container');
  container.innerHTML = '';

  [...Object.values(EMOTIONS), ...myOrbitDomes]
    .forEach((dome) => container.appendChild(createTrayItem(dome)));
}

function createTrayItem(dome) {
  const item = document.createElement('div');
  item.className = 'tray-item';
  item.style.setProperty('--item-color', dome.color);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tray-dome';
  button.draggable = true;
  button.dataset.id = dome.id;
  button.title = `${dome.name}: ${dome.desc}`;
  button.setAttribute('aria-label', `${dome.name} 감정돔 올리기`);
  button.style.setProperty('--dome-color', dome.color);

  if (dome.imgSrc) {
    const image = document.createElement('img');
    image.src = dome.imgSrc;
    image.alt = `${dome.name} 감정돔`;
    image.loading = 'eager';
    image.draggable = false;
    button.appendChild(image);
  } else {
    button.classList.add('custom-dome');
  }

  button.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', dome.id);
    event.dataTransfer.effectAllowed = 'copy';
    button.classList.add('dragging');
  });
  button.addEventListener('dragend', () => button.classList.remove('dragging'));
  button.addEventListener('click', () => selectDomeFromWeb(dome.id));

  const label = document.createElement('span');
  label.className = 'tray-label';
  const labelText = document.createElement('span');
  labelText.className = 'tray-label-text';
  labelText.textContent = dome.name;
  label.appendChild(labelText);

  if (dome.custom) {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'tray-delete-btn';
    deleteButton.title = dome.name + ' 오빗 삭제';
    deleteButton.setAttribute('aria-label', dome.name + ' 오빗 삭제');
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      deleteMyOrbitDome(dome.id);
    });
    label.appendChild(deleteButton);
  }

  item.append(button, label);
  return item;
}


function deleteMyOrbitDome(domeId) {
  const dome = getDomeInfo(domeId);
  if (!dome?.custom) return;

  db.myOrbits = (Array.isArray(db.myOrbits) ? db.myOrbits : []).filter((orbit) => orbit.id !== domeId);
  db.myOrbit = db.myOrbits[db.myOrbits.length - 1] || null;
  saveDb();
  initializeMyOrbit();
  initializeDomesTray();

  if (activeDomeId === domeId) {
    removeDomeFromDevice({ source: 'WEB', syncDevice: false, persist: false });
  }

  showToast(`${dome.name} 오빗을 삭제했습니다.`, 'info');
}
function setupDragAndDrop() {
  const dropZone = document.getElementById('device-drop-zone');
  const dock = document.getElementById('device-dome-dock');

  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dock.classList.add('hovered');
  });

  dropZone.addEventListener('dragleave', (event) => {
    if (!dropZone.contains(event.relatedTarget)) dock.classList.remove('hovered');
  });

  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dock.classList.remove('hovered');
    const domeId = event.dataTransfer.getData('text/plain');
    if (domeId) selectDomeFromWeb(domeId);
  });

  dock.addEventListener('click', () => {
    if (activeDomeId) removeDomeFromDevice({ source: 'WEB', syncDevice: true, persist: true });
  });
}

async function selectDomeFromWeb(domeId) {
  const dome = getDomeInfo(domeId);
  if (!dome) return;

  renderDomeOnDevice(dome, true);

  if (dome.custom) {
    recordEmotionSet(dome, {
      source: 'WEB_DEMO',
      uid: null,
      eventId: makeUuid(),
      rawEvent: { type: 'CUSTOM_DOME' }
    });
    showToast('커스텀 돔은 현재 웹 시뮬레이터에서 기록됩니다.', 'success');
    return;
  }

  if (ble.connected) {
    try {
      await sendBleCommand(`EMOTION:${dome.code}`);
      showToast(`${dome.name} 돔을 실제 피규어에 전송했습니다.`, 'success');
      return;
    } catch (error) {
      console.warn(error);
      showToast('기기 전송에 실패해 웹 기록으로 저장합니다.', 'warning');
    }
  }

  recordEmotionSet(dome, {
    source: 'WEB_DEMO',
    uid: null,
    eventId: makeUuid(),
    rawEvent: { type: 'WEB_DEMO' }
  });
}

function setDeviceImage(src = DEVICE_IMAGE_DEFAULT, alt = '무드오빗 피규어') {
  const image = document.getElementById('device-state-image');
  if (!image) return;
  if (image.getAttribute('src') !== src) image.src = src;
  image.alt = alt;
}

function renderDomeOnDevice(dome, playEffects = true) {
  activeDomeId = dome.id;
  activeDomeSnapshot = { ...dome };

  const device = document.getElementById('virtual-orbit-device');
  const stage = document.getElementById('device-drop-zone');
  const glow = document.getElementById('device-led-glow');
  const placeholder = document.getElementById('dock-placeholder-text');
  const caption = document.getElementById('studio-caption');

  device.querySelector('.placed-dome')?.remove();
  device.style.setProperty('--active-color', dome.color);
  stage?.style.setProperty('--active-color', dome.color);
  document.documentElement.style.setProperty('--active-color', dome.color);
  device.dataset.emotion = dome.code || dome.id;
  setDeviceImage(dome.deviceSrc || DEVICE_IMAGE_DEFAULT, `${dome.name} 감정돔이 올라간 무드오빗 피규어`);

  const placed = document.createElement('button');
  placed.type = 'button';
  placed.className = 'placed-dome';
  placed.title = '클릭하면 돔이 내려가고 오늘의 감정 기록이 취소됩니다.';
  placed.setAttribute('aria-label', `${dome.name} 돔 내리기`);
  placed.style.setProperty('--dome-color', dome.color);

  if (dome.deviceSrc) {
    placed.classList.add('device-state-control');
  } else if (dome.imgSrc) {
    const image = document.createElement('img');
    image.src = dome.imgSrc;
    image.alt = `${dome.name} 감정돔이 피규어 위에 올려진 모습`;
    image.draggable = false;
    placed.appendChild(image);
  } else {
    placed.classList.add('custom-dome');
  }

  placed.addEventListener('click', (event) => {
    event.stopPropagation();
    removeDomeFromDevice({ source: 'WEB', syncDevice: true, persist: true });
  });
  placed.addEventListener('dragover', (event) => event.preventDefault());
  placed.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextId = event.dataTransfer.getData('text/plain');
    if (nextId) selectDomeFromWeb(nextId);
  });
  device.appendChild(placed);

  placeholder.hidden = true;
  glow.style.background = dome.color;
  device.classList.add('glow-active');

  if (caption) {
    caption.querySelector('span:last-child').textContent = `${dome.name} 돔이 피규어에 안착했어요`;
  }

  document.getElementById('active-emotion-name').textContent = `${dome.name} 돔이 올라가 있어요`;
  document.getElementById('active-emotion-desc').textContent = dome.desc;
  const swatch = document.getElementById('active-emotion-swatch');
  swatch.style.background = dome.color;
  swatch.style.boxShadow = `0 0 22px ${dome.color}88`;

  document.querySelectorAll('.tray-dome').forEach((button) => {
    button.classList.toggle('active', button.dataset.id === dome.id);
  });

  if (dome.uid) document.getElementById('hw-nfc-uid').textContent = dome.uid;

  if (playEffects) {
    playConfirmationMelody();
    triggerVisualRipple();
  }
}

async function removeDomeFromDevice({ source = 'WEB', syncDevice = false, persist = true, eventId = makeUuid(), uid = null, rawEvent = {} } = {}) {
  const previous = activeDomeSnapshot;

  activeDomeId = null;
  activeDomeSnapshot = null;
  const device = document.getElementById('virtual-orbit-device');
  device.querySelector('.placed-dome')?.remove();
  device.classList.remove('glow-active');
  device.style.setProperty('--active-color', '#A58AF7');
  device.removeAttribute('data-emotion');
  setDeviceImage(DEVICE_IMAGE_DEFAULT);
  const stage = document.getElementById('device-drop-zone');
  stage?.style.setProperty('--active-color', '#A58AF7');
  document.documentElement.style.setProperty('--active-color', '#A58AF7');
  const caption = document.getElementById('studio-caption');
  if (caption) {
    caption.querySelector('span:last-child').textContent = '지금 마음과 가까운 돔을 올려보세요';
  }
  const glow = document.getElementById('device-led-glow');
  glow.style.background = 'var(--empty)';
  document.getElementById('dock-placeholder-text').hidden = false;
  document.getElementById('active-emotion-name').textContent = '아직 올려진 돔이 없어요';
  document.getElementById('active-emotion-desc').textContent = '지금의 마음과 가장 가까운 돔을 골라보세요.';
  const swatch = document.getElementById('active-emotion-swatch');
  swatch.style.background = 'var(--empty)';
  swatch.style.boxShadow = 'none';
  document.querySelectorAll('.tray-dome').forEach((button) => button.classList.remove('active'));
  document.getElementById('hw-nfc-uid').textContent = uid || '없음';

  playToneSequence([{ f: 440, d: 0.1 }, { f: 349.23, d: 0.16, gap: 90 }]);

  if (persist && previous) {
    recordEmotionCancel(previous, { source, uid, eventId, rawEvent });
  }

  if (syncDevice && ble.connected) {
    try {
      await sendBleCommand('OFF');
    } catch (error) {
      showToast('피규어 조명 끄기 명령을 보내지 못했습니다.', 'warning');
    }
  }
}

function recordEmotionSet(dome, { source, uid, eventId, rawEvent }) {
  const normalizedEventId = normalizeUuid(eventId);
  if (db.events.some((event) => event.clientEventId === normalizedEventId)) return;

  const dateKey = getTodayString();
  const recordedAt = getLocalTimestamp();
  const log = getDayLog(dateKey);
  log.emotion = dome.id;
  log.emotionMeta = {
    id: dome.id,
    code: dome.code || 'CUSTOM',
    name: dome.name,
    color: dome.color,
    source,
    uid: uid || null,
    recordedAt
  };

  const event = {
    type: 'emotion',
    action: 'SET',
    clientEventId: normalizedEventId,
    date: dateKey,
    timestamp: recordedAt,
    emotionId: dome.id,
    emotionCode: dome.code || 'CUSTOM',
    emotionName: dome.name,
    color: dome.color,
    source,
    uid: uid || null,
    rawEvent
  };
  addEvent(event);
  saveDb();
  queueSupabaseRecord('emotion_logs', emotionEventToRow(event));
  refreshDataViews();
}

function recordEmotionCancel(dome, { source, uid, eventId, rawEvent }) {
  const normalizedEventId = normalizeUuid(eventId);
  if (db.events.some((event) => event.clientEventId === normalizedEventId)) return;

  const dateKey = getTodayString();
  const timestamp = getLocalTimestamp();
  const log = getDayLog(dateKey);
  log.emotion = null;
  log.emotionMeta = null;

  const event = {
    type: 'emotion',
    action: 'CANCEL',
    clientEventId: normalizedEventId,
    date: dateKey,
    timestamp,
    emotionId: dome.id,
    emotionCode: dome.code || 'CUSTOM',
    emotionName: dome.name,
    color: dome.color,
    source,
    uid: uid || null,
    rawEvent
  };
  addEvent(event);
  saveDb();
  queueSupabaseRecord('emotion_logs', emotionEventToRow(event));
  refreshDataViews();
  showToast('돔을 내려 오늘의 감정 기록을 취소했습니다.', 'info');
}

function normalizeUuid(value) {
  const text = String(value || '');
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(text) ? text : makeUuid();
}

function addEvent(event) {
  db.events.unshift(event);
  db.events = db.events.slice(0, 120);
}

function emotionEventToRow(event) {
  return {
    client_event_id: event.clientEventId,
    participant_id: db.participantId,
    device_id: ble.deviceId || cloudSettings.deviceId || 'WEB_DEMO',
    action: event.action,
    emotion_code: event.emotionCode,
    emotion_name: event.emotionName,
    color_hex: event.color,
    source: event.source,
    nfc_uid: event.uid,
    client_timestamp: event.timestamp,
    raw_event: event.rawEvent || {}
  };
}

function setupRoutineActions() {
  document.getElementById('routine-list-container').addEventListener('click', (event) => {
    const button = event.target.closest('.routine-btn');
    if (!button) return;
    setRoutineStatus(button.dataset.id, button.dataset.action);
  });

  const input = document.getElementById('new-routine-name');
  document.getElementById('add-routine-btn').addEventListener('click', addCustomRoutine);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addCustomRoutine();
  });
}

function addCustomRoutine() {
  const input = document.getElementById('new-routine-name');
  const name = input.value.trim();
  if (!name) return;
  const now = new Date();
  db.routines.push({
    id: `rout-custom-${Date.now()}`,
    name,
    time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    desc: '내가 정한 작은 생존 루틴'
  });
  input.value = '';
  saveDb();
  renderRoutines();
  renderCalendar();
  showToast(`${name} 루틴을 추가했습니다.`, 'success');
}

function setRoutineStatus(routineId, nextStatus) {
  const routine = db.routines.find((item) => item.id === routineId);
  if (!routine) return;

  const dateKey = getTodayString();
  const log = getDayLog(dateKey);
  const current = log.routines[routineId];
  const status = current === nextStatus ? 'clear' : nextStatus;

  if (status === 'clear') delete log.routines[routineId];
  else log.routines[routineId] = status;

  const timestamp = getLocalTimestamp();
  const event = {
    type: 'routine',
    clientEventId: makeUuid(),
    date: dateKey,
    timestamp,
    routineId,
    routineName: routine.name,
    status,
    source: 'WEB'
  };
  addEvent(event);
  saveDb();
  queueSupabaseRecord('routine_logs', {
    client_event_id: event.clientEventId,
    participant_id: db.participantId,
    device_id: ble.deviceId || cloudSettings.deviceId || 'WEB_DEMO',
    routine_id: routineId,
    routine_name: routine.name,
    status,
    source: 'WEB',
    client_timestamp: timestamp,
    raw_event: { date: dateKey }
  });

  if (status === 'done') {
    playToneSequence([{ f: 659.25, d: 0.1 }, { f: 880, d: 0.13, gap: 90 }]);
    showToast(`${routine.name}, 오늘의 완료로 남겼어요.`, 'success');
  } else if (status === 'rest') {
    playToneSequence([{ f: 523.25, d: 0.12 }, { f: 440, d: 0.16, gap: 100 }]);
    showToast(`${routine.name}, 오늘은 쉬어가는 선택으로 남겼어요.`, 'info');
  }

  refreshDataViews();
}

function renderRoutines() {
  const container = document.getElementById('routine-list-container');
  const log = getDayLog();
  container.innerHTML = '';

  db.routines.forEach((routine) => {
    const status = log.routines[routine.id] || 'unchecked';
    const item = document.createElement('article');
    item.className = `routine-item status-${status}`;
    item.innerHTML = `
      <div class="routine-info">
        <span class="routine-name">${escapeHtml(routine.name)}</span>
        <span class="routine-time">${escapeHtml(routine.time)} · ${escapeHtml(routine.desc || '')}</span>
      </div>
      <div class="routine-actions">
        <button class="routine-btn ${status === 'done' ? 'done' : ''}" data-id="${escapeHtml(routine.id)}" data-action="done">완료</button>
        <button class="routine-btn ${status === 'rest' ? 'rest' : ''}" data-id="${escapeHtml(routine.id)}" data-action="rest">쉬어감</button>
      </div>`;
    container.appendChild(item);
  });
  updateTodaySummary();
}

function updateTodaySummary() {
  const log = getDayLog();
  const statuses = Object.values(log.routines || {});
  const done = statuses.filter((status) => status === 'done').length;
  const rest = statuses.filter((status) => status === 'rest').length;
  const emotion = log.emotionMeta?.name;

  const summary = document.getElementById('today-summary');
  if (!emotion && done === 0 && rest === 0) {
    summary.innerHTML = '오늘은 아직 빈 궤도예요. 가장 부담 없는 한 가지부터 시작해도 충분합니다.';
    return;
  }

  const parts = [];
  if (emotion) parts.push(`마음은 <strong>${escapeHtml(emotion)}</strong>으로 기록했어요.`);
  if (done) parts.push(`<strong>${done}개 완료</strong>`);
  if (rest) parts.push(`<strong>${rest}개 쉬어감</strong>`);
  summary.innerHTML = parts.join(' · ');
}

function renderFlowLegend() {
  const container = document.getElementById('flow-legend');
  container.innerHTML = '';
  Object.values(EMOTIONS).forEach((emotion) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-dot" style="--legend-color:${emotion.color}"></span>${escapeHtml(emotion.name)}`;
    container.appendChild(item);
  });
}

function renderCalendar() {
  const grid = document.getElementById('calendar-grid-container');
  grid.innerHTML = '';
  ['일', '월', '화', '수', '목', '금', '토'].forEach((name) => {
    const header = document.createElement('div');
    header.className = 'calendar-day-header';
    header.textContent = name;
    grid.appendChild(header);
  });

  const dates = [];
  for (let offset = 13; offset >= 0; offset--) dates.push(getTodayString(-offset));
  const startDay = new Date(`${dates[0]}T12:00:00`).getDay();
  for (let index = 0; index < startDay; index++) grid.appendChild(document.createElement('div'));

  dates.forEach((dateKey) => {
    const log = db.logs[dateKey] || { emotion: null, emotionMeta: null, routines: {} };
    const emotion = log.emotionMeta || getDomeInfo(log.emotion);
    const date = new Date(`${dateKey}T12:00:00`);
    const cell = document.createElement('article');
    cell.className = `calendar-cell ${emotion || Object.keys(log.routines || {}).length ? '' : 'empty'}`;
    cell.style.setProperty('--emotion-color', emotion?.color || 'var(--empty)');
    cell.title = buildCalendarTitle(dateKey, log, emotion);

    const dateLabel = document.createElement('span');
    dateLabel.className = 'calendar-date';
    dateLabel.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
    cell.appendChild(dateLabel);

    const emotionName = document.createElement('span');
    emotionName.className = 'calendar-emotion-name';
    emotionName.textContent = emotion?.name || '조용한 하루';
    cell.appendChild(emotionName);

    const bar = document.createElement('div');
    bar.className = 'routines-dot-bar';
    db.routines.slice(0, 8).forEach((routine) => {
      const dot = document.createElement('span');
      dot.className = 'routine-dot';
      const status = log.routines?.[routine.id];
      if (status === 'done') dot.classList.add('completed');
      if (status === 'rest') dot.classList.add('rested');
      bar.appendChild(dot);
    });
    cell.appendChild(bar);
    grid.appendChild(cell);
  });
}

function buildCalendarTitle(dateKey, log, emotion) {
  const statuses = Object.values(log.routines || {});
  const done = statuses.filter((status) => status === 'done').length;
  const rest = statuses.filter((status) => status === 'rest').length;
  return `${dateKey}\n감정: ${emotion?.name || '미기록'}\n완료 ${done} · 쉬어감 ${rest}`;
}

function updateReport() {
  const emotionCounts = {};
  let restCount = 0;
  let doneCount = 0;
  let activeDays = 0;

  for (let offset = 6; offset >= 0; offset--) {
    const log = db.logs[getTodayString(-offset)];
    if (!log) continue;
    const statuses = Object.values(log.routines || {});
    const hasActivity = Boolean(log.emotion) || statuses.length > 0;
    if (hasActivity) activeDays++;
    if (log.emotion) emotionCounts[log.emotion] = (emotionCounts[log.emotion] || 0) + 1;
    restCount += statuses.filter((status) => status === 'rest').length;
    doneCount += statuses.filter((status) => status === 'done').length;
  }

  const dominantEntry = Object.entries(emotionCounts).sort((a, b) => b[1] - a[1])[0];
  const dominant = dominantEntry ? getDomeInfo(dominantEntry[0]) : null;
  document.getElementById('stat-emotion-primary').textContent = dominant?.name || '기록 없음';
  document.getElementById('stat-routine-rest').textContent = `${restCount}회`;
  document.getElementById('stat-active-days').textContent = `${activeDays}일`;

  const message = document.getElementById('report-message-content');
  if (activeDays === 0) {
    message.innerHTML = '최근 7일의 기록이 아직 비어 있습니다. 기록을 채우는 것보다 <strong>오늘의 마음을 한 번 알아차리는 것</strong>부터 시작해도 충분해요.';
    return;
  }

  const sentences = [];
  if (dominant) {
    sentences.push(`지난 7일에는 <strong>${escapeHtml(dominant.name)}</strong>의 색이 가장 자주 머물렀어요.`);
  } else {
    sentences.push('감정을 고르지 않은 날에도 일상을 지키려는 작은 선택이 남아 있어요.');
  }

  if (restCount > 0) {
    sentences.push(`<strong>${restCount}번의 쉬어감</strong>은 포기가 아니라, 에너지를 더 잃지 않도록 스스로를 지킨 선택입니다.`);
  }
  if (doneCount > 0) {
    sentences.push(`<strong>${doneCount}번의 완료</strong>도 크기와 상관없이 하루의 궤도를 이어준 소중한 움직임이에요.`);
  }

  if (dominant && ['sad', 'anger', 'irritation'].includes(dominant.id)) {
    sentences.push('이번 주에는 해야 할 일을 늘리기보다 물 한 잔, 짧은 샤워, 잠자리 정리처럼 가장 작은 루틴 하나만 남겨보세요.');
  } else if (dominant) {
    sentences.push('마음이 비교적 가벼운 날의 조건을 한 가지 기억해 두면 다음에 다시 돌아오는 데 도움이 됩니다.');
  }

  sentences.push('기록이 적은 날도 괜찮습니다. 무드오빗은 잘한 날만이 아니라 버틴 날까지 함께 바라봅니다.');
  message.innerHTML = sentences.join(' ');
}

function renderRecentEvents() {
  const container = document.getElementById('recent-emotion-list');
  const events = db.events.filter((event) => event.type === 'emotion').slice(0, 5);
  container.innerHTML = '';

  if (!events.length) {
    container.innerHTML = '<div class="recent-empty">아직 남겨진 마음 기록이 없습니다.</div>';
    return;
  }

  events.forEach((event) => {
    const row = document.createElement('div');
    row.className = 'recent-item';
    const time = new Date(event.timestamp).toLocaleString('ko-KR', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    row.innerHTML = `
      <span class="recent-color" style="--recent-color:${event.color}"></span>
      <span><strong>${escapeHtml(event.emotionName)}</strong> · ${event.action === 'CANCEL' ? '기록 취소' : sourceLabel(event.source)}</span>
      <span>${escapeHtml(time)}</span>`;
    container.appendChild(row);
  });
}

function sourceLabel(source) {
  const labels = { NFC: 'NFC', WEB: '웹', WEB_DEMO: '가상', LEGACY: '이전 기록' };
  return labels[source] || source;
}

function refreshDataViews() {
  renderRoutines();
  renderCalendar();
  updateReport();
  renderRecentEvents();
}

function playConfirmationMelody() {
  playToneSequence([
    { f: 523.25, d: 0.1 },
    { f: 659.25, d: 0.11, gap: 95 },
    { f: 783.99, d: 0.16, gap: 100 }
  ]);
}

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playToneSequence(notes) {
  try {
    const ctx = ensureAudio();
    let cursor = ctx.currentTime;
    notes.forEach((note) => {
      cursor += (note.gap || 0) / 1000;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.f, cursor);
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(0.11, cursor + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + note.d);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + note.d + 0.03);
      cursor += note.d;
    });
  } catch (error) {
    console.warn('Audio feedback unavailable', error);
  }
}

function triggerVisualRipple() {
  const device = document.getElementById('virtual-orbit-device');
  device.classList.remove('sound-active');
  requestAnimationFrame(() => {
    device.classList.add('sound-active');
    setTimeout(() => device.classList.remove('sound-active'), 1300);
  });
}

function setupNudgeDemo() {
  const button = document.getElementById('demo-alert-btn');
  button.addEventListener('click', async () => {
    if (nudgeTimer) return;

    try {
      ensureAudio();
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
    } catch (error) {
      console.warn(error);
    }

    button.disabled = true;
    button.textContent = '🔔 3초 뒤에 찾아갈게요';
    showToast('3초 뒤 피규어와 브라우저에서 부드러운 알림이 시작됩니다.', 'info');

    nudgeTimer = setTimeout(async () => {
      nudgeTimer = null;
      button.disabled = false;
      button.textContent = '🔔 알림 넛지 데모';

      const pending = findNudgeRoutine();
      playToneSequence([
        { f: 523.25, d: 0.13 },
        { f: 587.33, d: 0.13, gap: 70 },
        { f: 659.25, d: 0.13, gap: 70 },
        { f: 783.99, d: 0.25, gap: 80 }
      ]);
      triggerNudgeGlow();

      if (ble.connected) {
        sendBleCommand('ROUTINE_ALERT').catch(() => {
          showToast('피규어에는 알림을 보내지 못했지만 웹 데모는 계속됩니다.', 'warning');
        });
      }

      const body = `${pending.name}을(를) 가볍게 떠올릴 시간이에요. 지금 어렵다면 쉬어감을 선택해도 괜찮아요.`;
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('무드오빗 루틴 알림', { body, icon: 'icons/icon.svg', tag: 'mood-orbit-nudge' });
      } else {
        showToast(body, 'success', 5200);
      }
    }, 3000);
  });
}

function findNudgeRoutine() {
  const statuses = getDayLog().routines;
  return db.routines.find((routine) => !statuses[routine.id]) || db.routines[0] || { name: '작은 루틴' };
}

function triggerNudgeGlow() {
  const device = document.getElementById('virtual-orbit-device');
  const glow = document.getElementById('device-led-glow');
  const previousBackground = glow.style.background;
  glow.style.background = '#8B7CF6';
  device.classList.add('alert-active');
  triggerVisualRipple();
  setTimeout(() => {
    device.classList.remove('alert-active');
    glow.style.background = activeDomeSnapshot?.color || previousBackground || 'var(--empty)';
  }, 2100);
}

function setupBleUi() {
  document.getElementById('ble-connect-btn').addEventListener('click', connectBle);
  document.getElementById('disconnect-btn').addEventListener('click', disconnectBle);
  document.getElementById('led-off-btn').addEventListener('click', () =>
    removeDomeFromDevice({ source: 'WEB', syncDevice: true, persist: Boolean(activeDomeSnapshot) })
  );

  const brightness = document.getElementById('brightness-range');
  brightness.addEventListener('input', () => {
    document.getElementById('brightness-value').textContent = brightness.value;
  });
  brightness.addEventListener('change', () => {
    if (ble.connected) sendBleCommand(`BRIGHTNESS:${brightness.value}`).catch(console.warn);
  });

  document.getElementById('reset-tags-btn').addEventListener('click', async () => {
    if (!confirm('등록된 7개 NFC 감정돔 정보를 모두 초기화할까요?')) return;
    try {
      await sendBleCommand('TAGS:RESET');
      showToast('NFC 등록 초기화 명령을 보냈습니다.', 'success');
    } catch (error) {
      showToast('BLE 연결 후 초기화할 수 있습니다.', 'warning');
    }
  });

  renderTagRegistration();
}

async function connectBle() {
  if (!navigator.bluetooth) {
    showToast('Android Chrome의 HTTPS 주소에서 Web Bluetooth를 사용할 수 있습니다.', 'warning', 5200);
    return;
  }

  const status = document.getElementById('hw-status-text');
  status.textContent = '기기를 찾는 중…';

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'MOOD_ORBIT' }],
      optionalServices: [BLE_UUIDS.service]
    });

    device.addEventListener('gattserverdisconnected', handleBleDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_UUIDS.service);
    const rx = await service.getCharacteristic(BLE_UUIDS.rx);
    const tx = await service.getCharacteristic(BLE_UUIDS.tx);
    await tx.startNotifications();
    tx.addEventListener('characteristicvaluechanged', handleBleChunk);

    ble.device = device;
    ble.server = server;
    ble.rx = rx;
    ble.tx = tx;
    ble.connected = true;
    ble.buffer = '';

    setBleConnectedUi(device.name || 'MOOD_ORBIT');
    await sendBleCommand('STATUS');
    showToast('실제 오빗 피규어와 연결되었습니다.', 'success');
  } catch (error) {
    console.warn('BLE connection failed', error);
    setBleDisconnectedUi();
    if (error?.name !== 'NotFoundError') {
      showToast(`블루투스 연결 실패: ${error.message || error}`, 'error', 5200);
    }
  }
}

function disconnectBle() {
  if (ble.device?.gatt?.connected) ble.device.gatt.disconnect();
  else handleBleDisconnected();
}

function handleBleDisconnected() {
  ble.connected = false;
  ble.server = null;
  ble.rx = null;
  ble.tx = null;
  setBleDisconnectedUi();
  showToast('피규어 연결이 해제되어 가상 작동으로 전환했습니다.', 'warning');
}

function setBleConnectedUi(name) {
  const badge = document.getElementById('device-connection-badge');
  badge.textContent = '기기 연동 완료 · BLE';
  badge.classList.add('connected');
  document.getElementById('hw-status-text').textContent = name;
  document.getElementById('ble-connect-btn').textContent = '연결됨';
  document.getElementById('ble-connect-btn').disabled = true;
  document.getElementById('disconnect-btn').hidden = false;
}

function setBleDisconnectedUi() {
  const badge = document.getElementById('device-connection-badge');
  badge.textContent = '기기 미연동 · 가상 작동';
  badge.classList.remove('connected');
  document.getElementById('hw-status-text').textContent = '가상 시뮬레이터 구동 중';
  document.getElementById('ble-connect-btn').textContent = '실제 ESP32 블루투스 연결';
  document.getElementById('ble-connect-btn').disabled = false;
  document.getElementById('disconnect-btn').hidden = true;
}

async function sendBleCommand(command) {
  if (!ble.connected || !ble.rx) throw new Error('BLE not connected');
  const data = new TextEncoder().encode(`${command}\n`);
  if (typeof ble.rx.writeValueWithoutResponse === 'function') {
    await ble.rx.writeValueWithoutResponse(data);
  } else {
    await ble.rx.writeValue(data);
  }
}

function handleBleChunk(event) {
  const chunk = new TextDecoder().decode(event.target.value);
  ble.buffer += chunk;
  let newline;
  while ((newline = ble.buffer.indexOf('\n')) >= 0) {
    const line = ble.buffer.slice(0, newline).trim();
    ble.buffer = ble.buffer.slice(newline + 1);
    if (line) handleBleLine(line);
  }
}

function parseProtocolLine(line) {
  const [type, ...tokens] = line.split('|');
  const fields = {};
  tokens.forEach((token) => {
    const index = token.indexOf('=');
    if (index > 0) fields[token.slice(0, index)] = token.slice(index + 1);
  });
  return { type, fields, raw: line };
}

function handleBleLine(line) {
  console.log('BLE RX', line);
  if (line === 'READY') return;
  const message = parseProtocolLine(line);
  const { type, fields } = message;

  if (type === 'DOME_EVENT') {
    const dome = EMOTION_BY_CODE[fields.emotion];
    if (!dome) return;
    dome.uid = fields.uid && fields.uid !== 'NONE' ? formatUid(fields.uid) : dome.uid;
    renderDomeOnDevice(dome, true);
    document.getElementById('hw-nfc-uid').textContent = fields.uid || '없음';
    recordEmotionSet(dome, {
      source: fields.source === 'NFC' ? 'NFC' : 'WEB',
      uid: fields.uid === 'NONE' ? null : fields.uid,
      eventId: fields.event_id || makeUuid(),
      rawEvent: message
    });
    return;
  }

  if (type === 'DOME_REMOVED') {
    const dome = EMOTION_BY_CODE[fields.emotion] || activeDomeSnapshot;
    if (dome && !activeDomeSnapshot) activeDomeSnapshot = dome;
    removeDomeFromDevice({
      source: 'NFC',
      syncDevice: false,
      persist: Boolean(dome),
      eventId: fields.event_id || makeUuid(),
      uid: fields.uid || null,
      rawEvent: message
    });
    return;
  }

  if (type === 'TAG_REGISTERED') {
    const dome = EMOTION_BY_CODE[fields.emotion];
    if (dome) {
      dome.uid = formatUid(fields.uid);
      ble.tags[fields.emotion] = fields.uid;
      renderTagRegistration();
      showToast(`${dome.name} NFC 돔이 등록되었습니다.`, 'success');
    }
    return;
  }

  if (type === 'TAG_STATUS') {
    ble.learningCode = fields.learn || 'NONE';
    Object.values(EMOTIONS).forEach((emotion) => {
      const uid = fields[emotion.code] || '';
      emotion.uid = uid && uid !== 'NONE' ? formatUid(uid) : '';
      ble.tags[emotion.code] = uid;
    });
    renderTagRegistration();
    return;
  }

  if (type === 'DEVICE_INFO') {
    ble.deviceId = fields.id || ble.deviceId;
    cloudSettings.deviceId = ble.deviceId;
    saveCloudSettings();
    if (fields.battery) document.getElementById('hw-battery-text').textContent = `${fields.battery}%`;
    return;
  }

  if (type === 'BATTERY_STATUS') {
    document.getElementById('hw-battery-text').textContent = fields.percent ? `${fields.percent}%` : '정보 없음';
    return;
  }

  if (type === 'LED_STATUS') {
    if (fields.brightness) {
      document.getElementById('brightness-range').value = fields.brightness;
      document.getElementById('brightness-value').textContent = fields.brightness;
    }
    return;
  }

  if (type === 'UNKNOWN_TAG') {
    document.getElementById('hw-nfc-uid').textContent = fields.uid || '알 수 없음';
    showToast('등록되지 않은 NFC입니다. 설정에서 감정돔으로 등록해 주세요.', 'warning');
    return;
  }

  if (type === 'ROUTINE_ALERT_STARTED') {
    triggerNudgeGlow();
    return;
  }

  if (type === 'ERR') {
    showToast(`기기 오류: ${fields.code || line}`, 'error');
  }
}

function formatUid(uid) {
  const clean = String(uid || '').replaceAll(':', '').toUpperCase();
  return clean.match(/.{1,2}/g)?.join(':') || clean;
}

function renderTagRegistration() {
  const container = document.getElementById('tag-register-grid');
  container.innerHTML = '';

  Object.values(EMOTIONS).forEach((emotion) => {
    const row = document.createElement('div');
    row.className = 'tag-register-row';
    row.classList.toggle('learning', ble.learningCode === emotion.code);
    const registered = Boolean(emotion.uid);
    row.innerHTML = `
      <span class="tag-color" style="--tag-color:${emotion.color}"></span>
      <span class="tag-name">${escapeHtml(emotion.name)}<br><span class="tag-status">${registered ? escapeHtml(emotion.uid) : '미등록'}</span></span>
      <button class="tag-action" data-code="${emotion.code}">${ble.learningCode === emotion.code ? '취소' : '등록'}</button>`;
    container.appendChild(row);
  });

  container.querySelectorAll('.tag-action').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!ble.connected) {
        showToast('먼저 실제 ESP32 피규어를 연결해 주세요.', 'warning');
        return;
      }
      const code = button.dataset.code;
      try {
        await sendBleCommand(ble.learningCode === code ? 'LEARN:CANCEL' : `LEARN:${code}`);
      } catch (error) {
        showToast('NFC 등록 명령 전송에 실패했습니다.', 'error');
      }
    });
  });
}

function setupCloudSettings() {
  const urlInput = document.getElementById('supabase-url');
  const keyInput = document.getElementById('supabase-key');
  urlInput.value = cloudSettings.supabaseUrl || '';
  keyInput.value = cloudSettings.supabaseKey || '';

  document.getElementById('save-cloud-settings-btn').addEventListener('click', async () => {
    cloudSettings.supabaseUrl = normalizeSupabaseUrl(urlInput.value);
    cloudSettings.supabaseKey = keyInput.value.trim();
    saveCloudSettings();
    updateSyncUi();
    showToast('Supabase 설정을 브라우저에 저장했습니다.', 'success');
    await flushSyncQueue();
  });

  document.getElementById('flush-queue-btn').addEventListener('click', flushSyncQueue);
  window.addEventListener('online', flushSyncQueue);
  updateSyncUi();
}

function normalizeSupabaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function hasCloudConfig() {
  return Boolean(cloudSettings.supabaseUrl && cloudSettings.supabaseKey);
}

function queueSupabaseRecord(table, row) {
  syncQueue.push({ id: makeUuid(), table, row, queuedAt: getLocalTimestamp(), attempts: 0 });
  saveQueue();
  flushSyncQueue();
}

async function flushSyncQueue() {
  if (!syncQueue.length) {
    updateSyncUi();
    return;
  }
  if (!hasCloudConfig() || !navigator.onLine) {
    updateSyncUi();
    return;
  }

  const pending = [...syncQueue];
  for (const item of pending) {
    try {
      await insertSupabase(item.table, item.row);
      syncQueue = syncQueue.filter((queued) => queued.id !== item.id);
      saveQueue();
    } catch (error) {
      console.warn('Supabase sync failed', error);
      const queued = syncQueue.find((entry) => entry.id === item.id);
      if (queued) queued.attempts = (queued.attempts || 0) + 1;
      saveQueue();
      break;
    }
  }
  updateSyncUi();
}

async function insertSupabase(table, row) {
  const response = await fetch(`${cloudSettings.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: cloudSettings.supabaseKey,
      Authorization: `Bearer ${cloudSettings.supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
}

function updateSyncUi() {
  const pill = document.getElementById('sync-pill');
  const text = document.getElementById('sync-text');
  const queueText = document.getElementById('queue-status-text');
  if (!pill || !text || !queueText) return;

  pill.classList.remove('pending', 'error');
  queueText.textContent = `대기 기록 ${syncQueue.length}개`;

  if (!hasCloudConfig()) {
    text.textContent = syncQueue.length ? `브라우저 저장 · 전송 대기 ${syncQueue.length}개` : '브라우저에 안전하게 저장 중';
    if (syncQueue.length) pill.classList.add('pending');
    return;
  }

  if (!navigator.onLine) {
    text.textContent = `오프라인 · 전송 대기 ${syncQueue.length}개`;
    pill.classList.add('pending');
    return;
  }

  text.textContent = syncQueue.length ? `Supabase 전송 대기 ${syncQueue.length}개` : 'Supabase 동기화 완료';
  if (syncQueue.length) pill.classList.add('pending');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('service-worker.js').catch((error) => {
      console.warn('Service worker registration failed', error);
    });
  }
}

function restoreTodayEmotion() {
  const log = db.logs[getTodayString()];
  if (!log?.emotion) return;
  const dome = getDomeInfo(log.emotion);
  if (dome) renderDomeOnDevice(dome, false);
}

function initializeApp() {
  migrateLegacyData();
  initializeMyOrbit();
  setupTabs();
  setupOnboarding();
  setupFigureNameEditor();
  updateFigureTitle();
  setupDragAndDrop();
  setupRoutineActions();
  setupNudgeDemo();
  setupBleUi();
  setupCloudSettings();
  initializeDomesTray();
  renderFlowLegend();
  refreshDataViews();
  restoreTodayEmotion();
  registerServiceWorker();

  if (!window.isSecureContext && location.hostname !== 'localhost') {
    showToast('BLE와 브라우저 알림은 HTTPS로 배포한 주소에서 동작합니다.', 'warning', 6000);
  }
}

document.addEventListener('DOMContentLoaded', initializeApp);
