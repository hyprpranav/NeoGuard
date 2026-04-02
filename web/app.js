const DEVICE_ID = 'neoguard-one';

const state = {
  latest: null,
  user: null,
  deviceId: DEVICE_ID,
  connection: null,
  isLive: false,
  historyRows: [],
  lastTelemetryEventAt: 0,
  lastConnectionEventAt: 0,
  telemetryRef: null,
  statusRef: null,
};

const HEATER_PIN = '0000';
const LIVE_TIMEOUT_MS = 30000;

const elements = {
  logoutButton: document.getElementById('logout-btn'),
  deviceId: document.getElementById('device-id-input'),
  userName: document.getElementById('user-name'),
  userEmail: document.getElementById('user-email'),
  babyTemp: document.getElementById('baby-temp'),
  envTemp: document.getElementById('env-temp'),
  spo2: document.getElementById('spo2'),
  heartRate: document.getElementById('heart-rate'),
  pulse: document.getElementById('pulse'),
  safetyCondition: document.getElementById('safety-condition'),
  heaterState: document.getElementById('heater-state'),
  relayState: document.getElementById('relay-state'),
  wifiState: document.getElementById('wifi-state'),
  cloudState: document.getElementById('cloud-state'),
  commandStatus: document.getElementById('command-status'),
  historyCard: document.getElementById('history-card'),
  historyNote: document.getElementById('history-note'),
  historyLastLive: document.getElementById('history-last-live'),
  viewHistoryButton: document.getElementById('view-history-btn'),
  downloadHistoryButton: document.getElementById('download-history-btn'),
  historyModal: document.getElementById('history-modal'),
  historyList: document.getElementById('history-list'),
  historyCloseButton: document.getElementById('history-close-btn'),
  buttons: Array.from(document.querySelectorAll('button[data-target]')),
};

if (!window.NEOGUARD_FIREBASE_CONFIG) {
  elements.commandStatus.textContent = 'Missing firebase-config.js';
  throw new Error('Missing window.NEOGUARD_FIREBASE_CONFIG');
}

firebase.initializeApp(window.NEOGUARD_FIREBASE_CONFIG);
const auth = firebase.auth();
const database = firebase.database();

function formatNumber(value, digits = 1, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return `--${suffix}`;
  }

  return `${Number(value).toFixed(digits)}${suffix}`;
}

function applySafetyClass(text) {
  if (!text) {
    return 'warning';
  }

  const normalized = text.toLowerCase();

  if (normalized.includes('critical') || normalized.includes('fault') || normalized.includes('overheat')) {
    return 'danger';
  }

  if (normalized.includes('normal') || normalized.includes('stable')) {
    return 'safe';
  }

  return 'warning';
}

function render(data) {
  state.latest = data;

  elements.babyTemp.textContent = formatNumber(data.babyTemp, 1, '°C');
  elements.envTemp.textContent = formatNumber(data.envTemp, 1, '°C');
  elements.spo2.textContent = formatNumber(data.spo2, 0, '%');
  elements.heartRate.textContent = formatNumber(data.heartRate, 0, ' bpm');
  elements.pulse.textContent = formatNumber(data.pulse, 0, ' bpm');
  const sensorDataAvailable = data.sensorDataAvailable !== false;
  if (!sensorDataAvailable) {
    elements.safetyCondition.textContent = 'Sensor data failed';
    elements.safetyCondition.className = 'danger';
  } else {
    elements.safetyCondition.textContent = data.safetyCondition || 'Awaiting device data';
    elements.safetyCondition.className = applySafetyClass(data.safetyCondition);
  }
  elements.heaterState.textContent = data.heaterOn ? 'ON' : 'OFF';
  elements.heaterState.className = data.heaterOn ? 'safe' : 'warning';
  elements.relayState.textContent = data.safetyRelayOn ? 'ARMED' : 'DISABLED';
  elements.relayState.className = data.safetyRelayOn ? 'safe' : 'danger';

  if (data.updatedAt) {
    elements.historyLastLive.textContent = `Last data: ${formatTimestamp(data.updatedAt)}`;
  }

  applyLiveState();
}

function renderConnection(connectionStatus) {
  state.connection = connectionStatus || {};
  const connected = Boolean(state.connection?.wifiConnected);
  elements.wifiState.textContent = connected ? 'CONNECTED' : 'OFFLINE';
  elements.wifiState.className = connected ? 'safe' : 'danger';
  applyLiveState();
}

function formatTimestamp(value) {
  if (!value) {
    return 'Unknown';
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    return new Date(numeric).toLocaleString();
  }

  return new Date(value).toLocaleString();
}

function isFreshTimestamp(value, timeoutMs) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return false;
  }
  return Date.now() - numeric <= timeoutMs;
}

function isDeviceLive() {
  const telemetryFresh = isFreshTimestamp(state.latest?.updatedAt, LIVE_TIMEOUT_MS);
  const realtimeEventFresh = Date.now() - state.lastTelemetryEventAt <= LIVE_TIMEOUT_MS;
  return telemetryFresh || realtimeEventFresh;
}

function applyLiveState() {
  state.isLive = isDeviceLive();

  if (state.isLive) {
    elements.cloudState.textContent = 'LIVE';
    elements.cloudState.className = 'safe';
    elements.commandStatus.textContent = `System live. Controls enabled for ${state.deviceId}`;
    elements.historyNote.textContent = 'Live sync active. You can still view and download previous data.';
  } else {
    elements.cloudState.textContent = 'DISCONNECTED';
    elements.cloudState.className = 'danger';
    elements.commandStatus.textContent = 'No telemetry for 30 seconds. Manual controls are locked.';
    elements.historyNote.textContent = 'Device is offline or stalled. Previous data is still available.';
  }

  elements.buttons.forEach((button) => {
    button.disabled = !state.isLive;
  });
}

function activeDeviceRoot() {
  return `devices/${state.deviceId}`;
}

function setDeviceId() {
  // Device ID is now fixed as neoguard-one
  elements.commandStatus.textContent = `Using device ${state.deviceId}`;
  subscribeToDevice();
}

function unsubscribeFromDevice() {
  if (state.telemetryRef) {
    state.telemetryRef.off();
    state.telemetryRef = null;
  }

  if (state.statusRef) {
    state.statusRef.off();
    state.statusRef = null;
  }
}

function subscribeToDevice() {
  unsubscribeFromDevice();

  const root = activeDeviceRoot();
  state.telemetryRef = database.ref(`${root}/telemetry/latest`);
  state.statusRef = database.ref(`${root}/status/connection`);

  state.telemetryRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
      state.lastTelemetryEventAt = Date.now();
      render(data);
    }
  });

  state.statusRef.on('value', (snapshot) => {
    state.lastConnectionEventAt = Date.now();
    renderConnection(snapshot.val() || {});
  });
}

function commandPayload(target, controlState) {
  const heaterState = target === 'heater' ? controlState : state.latest?.heaterOn ? 'on' : 'off';
  const uvState = target === 'uv' ? controlState : state.latest?.uvOn ? 'on' : 'off';

  return {
    requestId: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sourceUid: state.user?.uid || 'unknown',
    heaterState,
    uvState,
    requestedAt: new Date().toISOString(),
  };
}

async function sendCommand(target, controlState) {
  if (!state.user) {
    elements.commandStatus.textContent = 'Not authenticated.';
    return;
  }

  if (!state.isLive) {
    elements.commandStatus.textContent = 'System not live. Control commands are disabled.';
    return;
  }

  if (target === 'heater' && controlState === 'on') {
    const pin = window.prompt('Enter 4-digit heater safety PIN');
    if (pin !== HEATER_PIN) {
      elements.commandStatus.textContent = 'Invalid PIN. Heater ON cancelled.';
      return;
    }
  }

  elements.commandStatus.textContent = `Sending ${target} ${controlState}...`;
  elements.buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const payload = commandPayload(target, controlState);
    await database.ref(`${activeDeviceRoot()}/commands/manual`).set(payload);
    elements.commandStatus.textContent = `${target.toUpperCase()} ${controlState.toUpperCase()} sent to cloud`;
  } catch (error) {
    elements.commandStatus.textContent = error.message;
  } finally {
    elements.buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function renderHistoryRows(rows) {
  if (!rows.length) {
    elements.historyList.innerHTML = '<div class="history-row"><strong>No history available</strong><small>Run device once to populate telemetry history.</small></div>';
    return;
  }

  const html = rows.map((row) => {
    const timestamp = formatTimestamp(row.createdAt || row.updatedAt);
    return `
      <div class="history-row">
        <strong>${timestamp}</strong>
        <small>Baby: ${formatNumber(row.babyTemp, 1, '°C')} | Env: ${formatNumber(row.envTemp, 1, '°C')} | SpO2: ${formatNumber(row.spo2, 0, '%')} | HR: ${formatNumber(row.heartRate, 0, ' bpm')} | Pulse: ${formatNumber(row.pulse, 0, ' bpm')}</small>
      </div>
    `;
  }).join('');

  elements.historyList.innerHTML = html;
}

async function loadHistoryRows() {
  try {
    const snapshot = await database.ref(`${activeDeviceRoot()}/telemetry/history`).limitToLast(300).once('value');
    const history = snapshot.val() || {};
    state.historyRows = Object.values(history).sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    renderHistoryRows(state.historyRows);
  } catch (error) {
    elements.historyList.innerHTML = `<div class="history-row"><strong>Failed to load history</strong><small>${error.message}</small></div>`;
  }
}

function openHistoryModal() {
  elements.historyModal.classList.add('open');
  elements.historyModal.setAttribute('aria-hidden', 'false');
  loadHistoryRows();
}

function closeHistoryModal() {
  elements.historyModal.classList.remove('open');
  elements.historyModal.setAttribute('aria-hidden', 'true');
}

function downloadHistoryCsv() {
  const rows = state.historyRows;
  if (!rows.length) {
    elements.commandStatus.textContent = 'No history rows available to download.';
    return;
  }

  const csv = [
    'timestamp,baby_temp,env_temp,spo2,heart_rate,pulse,heater_on,uv_on,safety_condition',
    ...rows.map((row) => `${row.createdAt || row.updatedAt || ''},${row.babyTemp ?? ''},${row.envTemp ?? ''},${row.spo2 ?? ''},${row.heartRate ?? ''},${row.pulse ?? ''},${row.heaterOn ?? ''},${row.uvOn ?? ''},"${(row.safetyCondition || '').replaceAll('"', '""')}"`)
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.deviceId}-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
}

function bindControls() {
  elements.deviceId.value = state.deviceId;
  elements.logoutButton.addEventListener('click', handleLogout);
  elements.viewHistoryButton.addEventListener('click', openHistoryModal);
  elements.downloadHistoryButton.addEventListener('click', downloadHistoryCsv);
  elements.historyCloseButton.addEventListener('click', closeHistoryModal);
  elements.historyModal.addEventListener('click', (event) => {
    if (event.target === elements.historyModal) {
      closeHistoryModal();
    }
  });

  elements.buttons.forEach((button) => {
    button.addEventListener('click', () => {
      sendCommand(button.dataset.target, button.dataset.state);
    });
  });
}

function handleLogout() {
  localStorage.removeItem('neoguard-auth');
  localStorage.removeItem('neoguard-user');
  auth.signOut().then(() => {
    window.location.href = '../auth.html';
  });
}

async function loadUserProfile(user) {
  elements.userEmail.textContent = user.email || '--';
  elements.userName.textContent = 'Welcome';

  try {
    const snapshot = await database.ref(`users/${user.uid}`).once('value');
    const profile = snapshot.val() || {};
    const displayName = profile.name || 'NeoGuard User';
    elements.userName.textContent = `Welcome, ${displayName}`;
  } catch (error) {
    console.log('Unable to load profile:', error.message);
  }
}

function observeAuth() {
  auth.onAuthStateChanged((user) => {
    state.user = user;

    if (!user) {
      localStorage.removeItem('neoguard-auth');
      localStorage.removeItem('neoguard-user');
      unsubscribeFromDevice();
      window.location.href = '../auth.html';
      return;
    }

    const userDataStr = localStorage.getItem('neoguard-user');
    const userData = JSON.parse(userDataStr || '{}');
    loadUserProfile(user);
    elements.commandStatus.textContent = `Listening for device ${state.deviceId}`;
    subscribeToDevice();
    loadHistoryRows();
  });
}

function initializeDashboard() {
  bindControls();
  applyLiveState();
  observeAuth();
}

initializeDashboard();