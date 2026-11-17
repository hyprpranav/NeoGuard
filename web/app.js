const DEVICE_ID = 'neoguard-one (Serial)';

let auth = null;
let database = null;
let currentUser = null;
let lastFirebaseSaveTime = 0;
const FIREBASE_SAVE_INTERVAL_MS = 3000;

if (window.firebase && window.NEOGUARD_FIREBASE_CONFIG) {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.NEOGUARD_FIREBASE_CONFIG);
    }
    auth = firebase.auth();
    database = firebase.database();
  } catch (err) {
    console.warn('Firebase init error:', err);
  }
}

const state = {
  latest: null,
  isLive: false,
  history: [],
  manualProfile: {
    birthWeightKg: '',
    gestationalAgeWeeks: '',
    feedingIntervalMinutes: '',
    sleepDurationHours: '',
    vaccinationStatus: '',
    symptoms: '',
  },
};

const HEATER_PIN = '0000';

const elements = {
  connectSerialBtn: document.getElementById('connect-serial-btn'),
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
  lastSyncTime: document.getElementById('last-sync-time'),
  aiState: document.getElementById('ai-state'),
  healthScore: document.getElementById('health-score'),
  riskLevel: document.getElementById('risk-level'),
  offlineQueue: document.getElementById('offline-queue'),
  emergencyState: document.getElementById('emergency-state'),
  aiRecommendation: document.getElementById('ai-recommendation'),
  aiReason: document.getElementById('ai-reason'),
  heaterStatus: document.getElementById('heater-status'),
  heaterModeStatus: document.getElementById('heater-mode-status'),
  uvModeStatus: document.getElementById('uv-mode-status'),
  btnHeaterAuto: document.getElementById('btn-heater-auto'),
  btnHeaterOn: document.getElementById('btn-heater-on'),
  btnHeaterOff: document.getElementById('btn-heater-off'),
  btnUvOn: document.getElementById('btn-uv-on'),
  btnUvOff: document.getElementById('btn-uv-off'),
  relayStatus: document.getElementById('relay-status'),
  emergencyCard: document.getElementById('emergency-card'),
  commandStatus: document.getElementById('command-status'),
  historyCard: document.getElementById('history-card'),
  historyNote: document.getElementById('history-note'),
  historyLastLive: document.getElementById('history-last-live'),
  viewHistoryButton: document.getElementById('view-history-btn'),
  downloadHistoryButton: document.getElementById('download-history-btn'),
  historyModal: document.getElementById('history-modal'),
  historyList: document.getElementById('history-list'),
  historyCloseButton: document.getElementById('history-close-btn'),
  birthWeight: document.getElementById('birth-weight'),
  gestationalAge: document.getElementById('gestational-age'),
  feedingInterval: document.getElementById('feeding-interval'),
  sleepDuration: document.getElementById('sleep-duration'),
  vaccinationStatus: document.getElementById('vaccination-status'),
  symptoms: document.getElementById('symptoms'),
  saveProfileButton: document.getElementById('save-profile-btn'),
  resetProfileButton: document.getElementById('reset-profile-btn'),
  buttons: Array.from(document.querySelectorAll('button[data-target]')),
};

function formatNumber(value, digits = 1, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value)) || value === 0) {
    return `--${suffix}`;
  }
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function applySafetyClass(text) {
  if (!text) return 'warning';
  const normalized = text.toLowerCase();
  if (normalized.includes('critical') || normalized.includes('fault') || normalized.includes('overheat') || normalized.includes('check')) return 'danger';
  if (normalized.includes('normal') || normalized.includes('stable')) return 'safe';
  return 'warning';
}

function render(data) {
  state.latest = data;
  state.isLive = true;

  elements.babyTemp.textContent = formatNumber(data.babyTemp, 1, '°C');
  elements.envTemp.textContent = formatNumber(data.envTemp, 1, '°C');
  elements.spo2.textContent = formatNumber(data.spo2, 0, '%');
  elements.heartRate.textContent = formatNumber(data.heartRate, 0, ' bpm');
  elements.pulse.textContent = formatNumber(data.pulse, 0, ' bpm');

  const sensorDataAvailable = data.babyTempValid || data.envTempValid || data.spo2Valid || data.heartRateValid;
  if (!sensorDataAvailable && (data.babyTemp === undefined || data.babyTemp === 0)) {
    elements.safetyCondition.textContent = 'Sensor data failed';
    elements.safetyCondition.className = 'danger';
  } else {
    elements.safetyCondition.textContent = data.stateName || 'Active';
    elements.safetyCondition.className = applySafetyClass(data.stateName);
  }

  elements.heaterState.textContent = data.heaterOn ? 'ON' : 'OFF';
  elements.heaterState.className = data.heaterOn ? 'safe' : 'warning';
  elements.relayState.textContent = data.safetyRelayOn ? 'ARMED' : 'DISABLED';
  elements.relayState.className = data.safetyRelayOn ? 'safe' : 'danger';

  // Synchronize hardware button styling with live state
  updateControlButtonsUI(data);
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString();
  const dateStr = now.toLocaleDateString();
  elements.lastSyncTime.textContent = timeStr;
  if (elements.historyLastLive) {
    elements.historyLastLive.textContent = `Last frame synced at ${timeStr}`;
  }

  // Push to local rolling telemetry history buffer (up to 50 records)
  state.history.unshift({
    timestamp: timeStr,
    date: dateStr,
    isoTimestamp: now.toISOString(),
    babyTemp: data.babyTemp,
    envTemp: data.envTemp,
    spo2: data.spo2,
    heartRate: data.heartRate,
    pulse: data.pulse,
    healthScore: data.healthScore,
    riskLevel: data.riskLevel || 'Normal',
    stateName: data.stateName || 'STABLE',
    heaterOn: data.heaterOn,
    uvOn: data.uvOn,
    emergencyAlert: data.emergencyAlert
  });
  if (state.history.length > 100) {
    state.history.pop();
  }

  updateAiWidgets(data);
  applyLiveState();

  // Save to Firebase Realtime Database associated with the logged-in user
  saveTelemetryToFirebase(data);
}

function saveTelemetryToFirebase(data) {
  if (!database || !currentUser || !currentUser.uid) {
    return;
  }

  const now = Date.now();
  const isUrgent = data.emergencyAlert || (state.latest && state.latest.heaterOn !== data.heaterOn);
  if (!isUrgent && (now - lastFirebaseSaveTime < FIREBASE_SAVE_INTERVAL_MS)) {
    return;
  }
  lastFirebaseSaveTime = now;

  const currentDate = new Date();
  const dateStr = currentDate.toLocaleDateString();
  const timeStr = currentDate.toLocaleTimeString();
  const isoStr = currentDate.toISOString();

  const payload = {
    timestamp: isoStr,
    date: dateStr,
    time: timeStr,
    epoch: now,
    babyTemp: Number(data.babyTemp) || 0,
    babyTempValid: Boolean(data.babyTempValid),
    envTemp: Number(data.envTemp) || 0,
    envTempValid: Boolean(data.envTempValid),
    spo2: Number(data.spo2) || 0,
    spo2Valid: Boolean(data.spo2Valid),
    heartRate: Number(data.heartRate) || 0,
    heartRateValid: Boolean(data.heartRateValid),
    pulse: Number(data.pulse) || 0,
    heaterOn: Boolean(data.heaterOn),
    heaterAutoMode: Boolean(data.heaterAutoMode),
    safetyRelayOn: Boolean(data.safetyRelayOn),
    healthScore: Number(data.healthScore) || 0,
    riskLevel: data.riskLevel || 'Normal',
    stateName: data.stateName || 'STABLE',
    emergencyAlert: Boolean(data.emergencyAlert),
    uvOn: Boolean(data.uvOn),
    userEmail: currentUser.email || 'unknown',
    userName: currentUser.name || 'User',
    device: DEVICE_ID
  };

  // 1. Push into user's historical telemetry records in Firebase
  database.ref(`users/${currentUser.uid}/telemetryHistory`).push(payload).catch((err) => {
    console.warn('Failed to push telemetry to Firebase:', err.message);
  });

  // 2. Update user's latest telemetry and last sync status
  database.ref(`users/${currentUser.uid}/latestTelemetry`).set(payload).catch(() => {});
  database.ref(`users/${currentUser.uid}/lastConnectedAt`).set(isoStr).catch(() => {});

  if (elements.cloudState) {
    elements.cloudState.textContent = 'ONLINE (CLOUD SYNCED)';
    elements.cloudState.className = 'safe';
  }
}

function loadUserSavedTelemetry(uid) {
  if (!database || !uid) return;
  try {
    const ref = database.ref(`users/${uid}/telemetryHistory`).limitToLast(100);
    ref.on('value', (snapshot) => {
      const val = snapshot.val();
      if (val) {
        const records = Object.entries(val).map(([id, r]) => ({
          id,
          timestamp: r.time || (r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '--'),
          date: r.date || (r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ''),
          isoTimestamp: r.timestamp,
          babyTemp: r.babyTemp,
          envTemp: r.envTemp,
          spo2: r.spo2,
          heartRate: r.heartRate,
          pulse: r.pulse,
          healthScore: r.healthScore,
          riskLevel: r.riskLevel || 'Normal',
          stateName: r.stateName || 'STABLE',
          heaterOn: r.heaterOn,
          uvOn: r.uvOn,
          emergencyAlert: r.emergencyAlert
        })).reverse(); // latest first

        if (!state.isLive || state.history.length === 0) {
          state.history = records;
          if (records[0] && elements.historyLastLive) {
            elements.historyLastLive.textContent = `Last cloud record: ${records[0].date} ${records[0].timestamp}`;
          }
        }
      }
    });
  } catch (err) {
    console.warn('Failed to load user saved telemetry:', err);
  }
}

function updateAiWidgets(data) {
  const score = Number(data.healthScore);
  elements.healthScore.textContent = Number.isFinite(score) ? `${Math.round(score)}/100` : '--/100';
  elements.riskLevel.textContent = data.riskLevel || 'Normal';
  elements.aiState.textContent = data.stateName || 'Offline-ready';
  elements.aiRecommendation.textContent = data.recommendation || 'Continue monitoring';
  elements.aiReason.textContent = data.reason || 'Telemetry processed by Edge AI';
  elements.offlineQueue.textContent = '0 (Serial)';
  elements.emergencyState.textContent = data.emergencyAlert ? 'ACTIVE' : 'CLEAR';
  elements.emergencyCard.textContent = data.emergencyAlert ? 'ACTIVE' : 'CLEAR';

  elements.heaterStatus.textContent = data.heaterOn ? 'ON' : 'OFF';
  elements.heaterStatus.className = data.heaterOn ? 'safe' : 'warning';
  elements.relayStatus.textContent = data.safetyRelayOn ? 'ARMED' : 'DISABLED';
  elements.relayStatus.className = data.safetyRelayOn ? 'safe' : 'danger';
}

function applyLiveState() {
  if (state.isLive) {
    elements.cloudState.textContent = currentUser ? 'ONLINE (CLOUD SYNCED)' : 'ONLINE (SERIAL)';
    elements.cloudState.className = 'safe';
    elements.wifiState.textContent = 'SERIAL ACTIVE';
    elements.wifiState.className = 'safe';
    elements.commandStatus.textContent = `Device connected. Telemetry streaming live.`;
  } else {
    elements.cloudState.textContent = 'OFFLINE';
    elements.cloudState.className = 'danger';
    elements.commandStatus.textContent = 'Awaiting serial connection...';
  }
}

// ----------------- Serial Communication Logic -----------------
let port;
let reader;
let outputStream;
let readPromise;

async function connectSerial() {
  if (port) return; // Already connected
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });

    const encoder = new TextEncoderStream();
    outputStream = encoder.writable.getWriter();
    encoder.readable.pipeTo(port.writable);

    elements.deviceId.value = 'SERIAL PORT ACTIVE';
    if (elements.connectSerialBtn) {
      elements.connectSerialBtn.textContent = 'Connected';
      elements.connectSerialBtn.disabled = true;
    }

    state.isLive = true;
    applyLiveState();

    readPromise = readLoop();
  } catch (error) {
    console.error('Serial connection failed:', error);
    elements.commandStatus.textContent = 'Port access denied or failed.';
  }
}

async function readLoop() {
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable);
  reader = decoder.readable.getReader();

  let partialLine = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      partialLine += value;
      let lines = partialLine.split('\n');
      partialLine = lines.pop();

      for (const line of lines) {
        if (line.trim().startsWith('{')) {
          try {
            const data = JSON.parse(line.trim());
            render(data);
          } catch (e) {
            console.warn('JSON Parse error on serial data:', e, 'Line:', line);
          }
        }
      }
    }
  } catch (error) {
    console.error('Read loop error', error);
  } finally {
    reader.releaseLock();
  }
}

function updateControlButtonsUI(data) {
  if (!data) return;

  // 1. Synchronize Heating Pad Controls UI
  const isAuto = Boolean(data.heaterAutoMode);
  const isHeaterOn = Boolean(data.heaterOn);

  const btnAuto = elements.btnHeaterAuto || document.querySelector('button[data-target="heater"][data-state="auto"]');
  const btnHeaterOn = elements.btnHeaterOn || document.querySelector('button[data-target="heater"][data-state="on"]');
  const btnHeaterOff = elements.btnHeaterOff || document.querySelector('button[data-target="heater"][data-state="off"]');

  if (btnAuto && btnHeaterOn && btnHeaterOff) {
    if (isAuto) {
      btnAuto.classList.remove('secondary');
      btnHeaterOn.classList.add('secondary');
      btnHeaterOff.classList.add('secondary');
      if (elements.heaterModeStatus) {
        elements.heaterModeStatus.textContent = isHeaterOn 
          ? 'Mode: Auto (Warming ON)' 
          : 'Mode: Auto (Target 35-37°C)';
      }
    } else {
      btnAuto.classList.add('secondary');
      if (isHeaterOn) {
        btnHeaterOn.classList.remove('secondary');
        btnHeaterOff.classList.add('secondary');
        if (elements.heaterModeStatus) {
          elements.heaterModeStatus.textContent = 'Mode: Manual (Forced ON)';
        }
      } else {
        btnHeaterOn.classList.add('secondary');
        btnHeaterOff.classList.remove('secondary');
        if (elements.heaterModeStatus) {
          elements.heaterModeStatus.textContent = 'Mode: Manual (Forced OFF)';
        }
      }
    }
  }

  // 2. Synchronize UV Sterilization Controls UI
  const isUvOn = Boolean(data.uvOn);
  const btnUvOn = elements.btnUvOn || document.querySelector('button[data-target="uv"][data-state="on"]');
  const btnUvOff = elements.btnUvOff || document.querySelector('button[data-target="uv"][data-state="off"]');

  if (btnUvOn && btnUvOff) {
    if (isUvOn) {
      btnUvOn.classList.remove('secondary');
      btnUvOff.classList.add('secondary');
      if (elements.uvModeStatus) {
        elements.uvModeStatus.textContent = 'Status: ON (Pin 26 HIGH)';
        elements.uvModeStatus.style.color = '#38bdf8';
      }
    } else {
      btnUvOn.classList.add('secondary');
      btnUvOff.classList.remove('secondary');
      if (elements.uvModeStatus) {
        elements.uvModeStatus.textContent = 'Status: OFF (Pin 26 LOW)';
        elements.uvModeStatus.style.color = '#94a3b8';
      }
    }
  }
}

async function sendCommand(target, controlState) {
  if (!outputStream) {
    elements.commandStatus.textContent = 'Port not connected. Click "Connect Port" first.';
    return;
  }

  elements.commandStatus.textContent = `Sending ${target} ${controlState}...`;

  try {
    let payload;
    if (target === 'heater') {
      if (controlState === 'auto') {
        payload = JSON.stringify({ heaterAutoMode: true, heater: 'auto' }) + '\n';
        updateControlButtonsUI({ 
          heaterAutoMode: true, 
          heaterOn: false, 
          uvOn: state.latest ? state.latest.uvOn : false 
        });
      } else {
        const isOn = controlState === 'on';
        if (isOn) {
          const pin = window.prompt('Enter 4-digit heater safety PIN (Hint 0000)');
          if (pin !== HEATER_PIN) {
            elements.commandStatus.textContent = 'Invalid PIN. Heater ON cancelled.';
            return;
          }
        }
        payload = JSON.stringify({ heaterAutoMode: false, heaterOn: isOn, heater: isOn ? 'on' : 'off' }) + '\n';
        updateControlButtonsUI({ 
          heaterAutoMode: false, 
          heaterOn: isOn, 
          uvOn: state.latest ? state.latest.uvOn : false 
        });
      }
    } else if (target === 'uv') {
      const isUvOn = controlState === 'on';
      payload = JSON.stringify({ uvOn: isUvOn, uv: isUvOn, uvAction: isUvOn ? 'on' : 'off' }) + '\n';
      updateControlButtonsUI({ 
        heaterAutoMode: state.latest ? state.latest.heaterAutoMode : true, 
        heaterOn: state.latest ? state.latest.heaterOn : false, 
        uvOn: isUvOn 
      });
    } else {
      payload = JSON.stringify({ [target + 'On']: controlState === 'on' }) + '\n';
    }

    await outputStream.write(payload);
    elements.commandStatus.textContent = `${target.toUpperCase()} ${controlState.toUpperCase()} command sent successfully`;
  } catch (error) {
    console.error('Serial command failed:', error);
    elements.commandStatus.textContent = `Send Error: ${error.message}`;
  }
}

// ----------------- Profile Forms -----------------
function applyManualProfileToForm(profile = {}) {
  elements.birthWeight.value = profile.birthWeightKg ?? '';
  elements.gestationalAge.value = profile.gestationalAgeWeeks ?? '';
  elements.feedingInterval.value = profile.feedingIntervalMinutes ?? '';
  elements.sleepDuration.value = profile.sleepDurationHours ?? '';
  elements.vaccinationStatus.value = profile.vaccinationStatus ?? '';
  elements.symptoms.value = profile.symptoms ?? '';
}

function readManualProfileForm() {
  return {
    birthWeightKg: elements.birthWeight.value,
    gestationalAgeWeeks: elements.gestationalAge.value,
    feedingIntervalMinutes: elements.feedingInterval.value,
    sleepDurationHours: elements.sleepDuration.value,
    vaccinationStatus: elements.vaccinationStatus.value,
    symptoms: elements.symptoms.value,
  };
}

function openHistoryModal() {
  if (!elements.historyModal) return;
  const accountEmail = currentUser ? currentUser.email : (elements.userEmail ? elements.userEmail.textContent : 'Local Session');
  if (!state.history || state.history.length === 0) {
    elements.historyList.innerHTML = `<p style="color: #bac4ff; text-align: center; padding: 24px;">No telemetry frames recorded yet for <strong>${accountEmail}</strong>. Connect your device via USB to stream and record live data into your account.</p>`;
  } else {
    elements.historyList.innerHTML = `
      <div style="font-size: 0.78rem; color: #38bdf8; margin-bottom: 10px; padding: 8px 12px; background: rgba(56, 189, 248, 0.12); border-radius: 8px; border: 1px solid rgba(56, 189, 248, 0.25);">
        Telemetry records stored in Firebase for account: <strong>${accountEmail}</strong> (${state.history.length} records)
      </div>
    ` + state.history.map((item) => `
      <div class="history-row">
        <strong>${item.stateName || 'STABLE'} &mdash; Baby: ${formatNumber(item.babyTemp, 1, '°C')} | Env: ${formatNumber(item.envTemp, 1, '°C')} (Health: ${formatNumber(item.healthScore, 0, '/100')})</strong>
        <small>SpO2: ${formatNumber(item.spo2, 0, '%')} | HR: ${formatNumber(item.heartRate, 0, ' bpm')} | Pulse: ${formatNumber(item.pulse, 0, ' bpm')} | Heater: ${item.heaterOn ? 'ON' : 'OFF'} | UV: ${item.uvOn ? 'ON' : 'OFF'} &bull; ${(item.date ? item.date + ' ' : '')}${item.timestamp}</small>
      </div>
    `).join('');
  }
  elements.historyModal.classList.add('open');
  elements.historyModal.setAttribute('aria-hidden', 'false');
}

function closeHistoryModal() {
  if (!elements.historyModal) return;
  elements.historyModal.classList.remove('open');
  elements.historyModal.setAttribute('aria-hidden', 'true');
}

function downloadHistoryCsv() {
  if (!state.history || state.history.length === 0) {
    alert('No telemetry data collected yet to download.');
    return;
  }
  const accountEmail = currentUser ? currentUser.email : (elements.userEmail ? elements.userEmail.textContent : 'operator');
  const headers = ['Date', 'Time', 'ISO_Timestamp', 'State', 'BabyTemp_C', 'EnvTemp_C', 'SpO2_Percent', 'HeartRate_BPM', 'Pulse_BPM', 'HealthScore', 'RiskLevel', 'Heater', 'UV', 'EmergencyAlert', 'AccountEmail'];
  const rows = state.history.map((h) => [
    `"${h.date || new Date().toLocaleDateString()}"`,
    `"${h.timestamp || new Date().toLocaleTimeString()}"`,
    `"${h.isoTimestamp || new Date().toISOString()}"`,
    `"${h.stateName || 'STABLE'}"`,
    h.babyTemp !== null && h.babyTemp !== undefined ? h.babyTemp : '',
    h.envTemp !== null && h.envTemp !== undefined ? h.envTemp : '',
    h.spo2 !== null && h.spo2 !== undefined ? h.spo2 : '',
    h.heartRate !== null && h.heartRate !== undefined ? h.heartRate : '',
    h.pulse !== null && h.pulse !== undefined ? h.pulse : '',
    h.healthScore !== null && h.healthScore !== undefined ? h.healthScore : '',
    `"${h.riskLevel || 'Normal'}"`,
    h.heaterOn ? 'ON' : 'OFF',
    h.uvOn ? 'ON' : 'OFF',
    h.emergencyAlert ? 'YES' : 'NO',
    `"${accountEmail}"`
  ].join(','));
  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (accountEmail || 'telemetry').replace(/[^a-zA-Z0-9]/g, '_');
  a.download = `neoguard-${safeName}-records-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function bindControls() {
  if (elements.connectSerialBtn) {
    elements.connectSerialBtn.addEventListener('click', connectSerial);
  }

  elements.buttons.forEach((button) => {
    button.addEventListener('click', () => {
      sendCommand(button.dataset.target, button.dataset.state);
    });
  });

  elements.saveProfileButton.addEventListener('click', () => {
    state.manualProfile = readManualProfileForm();
    localStorage.setItem('neowarm-profile-serial', JSON.stringify(state.manualProfile));
    elements.commandStatus.textContent = 'Profile saved locally (Offline)';
  });

  elements.resetProfileButton.addEventListener('click', () => {
    localStorage.removeItem('neowarm-profile-serial');
    applyManualProfileToForm({});
    elements.commandStatus.textContent = 'Profile reset';
  });

  if (elements.viewHistoryButton) {
    elements.viewHistoryButton.addEventListener('click', openHistoryModal);
  }

  if (elements.historyCloseButton) {
    elements.historyCloseButton.addEventListener('click', closeHistoryModal);
  }

  if (elements.downloadHistoryButton) {
    elements.downloadHistoryButton.addEventListener('click', downloadHistoryCsv);
  }

  if (elements.historyModal) {
    elements.historyModal.addEventListener('click', (e) => {
      if (e.target === elements.historyModal) closeHistoryModal();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.style.display = 'inline-block';
    logoutBtn.addEventListener('click', () => {
      if (auth) {
        auth.signOut().catch(() => {});
      }
      localStorage.removeItem('neoguard-auth');
      localStorage.removeItem('neoguard-user');
      window.location.href = '/auth.html';
    });
  }
}

function initializeDashboard() {
  bindControls();

  try {
    const stored = JSON.parse(localStorage.getItem('neowarm-profile-serial') || '{}');
    applyManualProfileToForm(stored);
  } catch (e) { }

  applyLiveState();

  // 1. Check Firebase Auth
  if (auth) {
    auth.onAuthStateChanged((user) => {
      if (user) {
        currentUser = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || user.email.split('@')[0]
        };
        elements.userEmail.textContent = user.email;
        elements.userName.textContent = `Welcome, ${currentUser.name}`;
        localStorage.setItem('neoguard-user', JSON.stringify({ uid: user.uid, email: user.email, name: currentUser.name }));
        loadUserSavedTelemetry(user.uid);
      } else {
        // Fallback to cached user if available
        try {
          const cached = JSON.parse(localStorage.getItem('neoguard-user') || '{}');
          if (cached.email && cached.uid) {
            currentUser = cached;
            elements.userEmail.textContent = cached.email;
            elements.userName.textContent = `Welcome, ${cached.name || cached.email.split('@')[0]}`;
            loadUserSavedTelemetry(cached.uid);
          } else {
            elements.userName.textContent = 'Welcome, Operator';
            elements.userEmail.textContent = 'Serial Mode';
          }
        } catch (e) {
          elements.userName.textContent = 'Welcome, Operator';
          elements.userEmail.textContent = 'Serial Mode';
        }
      }
    });
  } else {
    // Non-Firebase fallback
    try {
      const user = JSON.parse(localStorage.getItem('neoguard-user') || '{}');
      if (user.email) {
        currentUser = user;
        elements.userEmail.textContent = user.email;
        const displayName = user.name || user.email.split('@')[0];
        elements.userName.textContent = `Welcome, ${displayName}`;
      } else {
        elements.userName.textContent = 'Welcome, Operator';
        elements.userEmail.textContent = 'Serial Mode';
      }
    } catch (e) {
      elements.userName.textContent = 'Welcome, Operator';
      elements.userEmail.textContent = 'Serial Mode';
    }
  }
}

initializeDashboard();
