const DEVICE_ID = 'neoguard-one';

const state = {
  latest: null,
  user: null,
  deviceId: DEVICE_ID,
  telemetryRef: null,
  statusRef: null,
};

const elements = {
  logoutButton: document.getElementById('logout-btn'),
  deviceId: document.getElementById('device-id-input'),
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
  elements.safetyCondition.textContent = data.safetyCondition || 'Awaiting device data';
  elements.safetyCondition.className = applySafetyClass(data.safetyCondition);
  elements.heaterState.textContent = data.heaterOn ? 'ON' : 'OFF';
  elements.heaterState.className = data.heaterOn ? 'safe' : 'warning';
  elements.relayState.textContent = data.safetyRelayOn ? 'ARMED' : 'DISABLED';
  elements.relayState.className = data.safetyRelayOn ? 'safe' : 'danger';
  elements.cloudState.textContent = 'SYNCED';
  elements.cloudState.className = 'safe';
}

function renderConnection(connectionStatus) {
  const connected = Boolean(connectionStatus?.wifiConnected);
  elements.wifiState.textContent = connected ? 'CONNECTED' : 'OFFLINE';
  elements.wifiState.className = connected ? 'safe' : 'danger';
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
      render(data);
    }
  });

  state.statusRef.on('value', (snapshot) => {
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

function bindControls() {
  elements.deviceId.value = state.deviceId;
  elements.logoutButton.addEventListener('click', handleLogout);

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
    window.location.href = './auth.html';
  });
}

function observeAuth() {
  auth.onAuthStateChanged((user) => {
    state.user = user;

    if (!user) {
      localStorage.removeItem('neoguard-auth');
      localStorage.removeItem('neoguard-user');
      unsubscribeFromDevice();
      window.location.href = './auth.html';
      return;
    }

    const userDataStr = localStorage.getItem('neoguard-user');
    const userData = JSON.parse(userDataStr || '{}');
    elements.userEmail.textContent = user.email;
    elements.commandStatus.textContent = `Listening for device ${state.deviceId}`;
    subscribeToDevice();
  });
}

function initializeDashboard() {
  bindControls();
  observeAuth();
}

initializeDashboard();