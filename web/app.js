const DEVICE_ID = 'neoguard-one (Serial)';

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
  if (elements.heaterModeStatus) {
    elements.heaterModeStatus.textContent = data.heaterAutoMode ? 'Mode: Auto' : 'Mode: Manual';
  }
  elements.relayState.textContent = data.safetyRelayOn ? 'ARMED' : 'DISABLED';
  elements.relayState.className = data.safetyRelayOn ? 'safe' : 'danger';
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString();
  elements.lastSyncTime.textContent = timeStr;
  if (elements.historyLastLive) {
    elements.historyLastLive.textContent = `Last frame synced at ${timeStr}`;
  }

  // Push to local rolling telemetry history buffer (up to 50 records)
  state.history.unshift({
    timestamp: timeStr,
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
  if (state.history.length > 50) {
    state.history.pop();
  }

  updateAiWidgets(data);
  applyLiveState();
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
    elements.cloudState.textContent = 'ONLINE (SERIAL)';
    elements.cloudState.className = 'safe';
    elements.wifiState.textContent = 'SERIAL';
    elements.wifiState.className = 'safe';
    elements.commandStatus.textContent = `System live via Port.`;
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

async function sendCommand(target, controlState) {
  if (!outputStream) {
    elements.commandStatus.textContent = 'Port not connected';
    return;
  }

  elements.commandStatus.textContent = `Sending ${target} ${controlState}...`;

  try {
    let payload;
    if (target === 'heater') {
      if (controlState === 'auto') {
        payload = JSON.stringify({ heaterAutoMode: true }) + '\n';
      } else {
        const isOn = controlState === 'on';
        if (isOn) {
          const pin = window.prompt('Enter 4-digit heater safety PIN (Hint 0000)');
          if (pin !== HEATER_PIN) {
            elements.commandStatus.textContent = 'Invalid PIN. Heater ON cancelled.';
            return;
          }
        }
        payload = JSON.stringify({ heaterAutoMode: false, heaterOn: isOn }) + '\n';
      }
    } else {
      payload = JSON.stringify({ [target + 'On']: controlState === 'on' }) + '\n';
    }

    await outputStream.write(payload);
    elements.commandStatus.textContent = `${target.toUpperCase()} ${controlState.toUpperCase()} sent to ESP32`;
  } catch (error) {
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
  if (!state.history || state.history.length === 0) {
    elements.historyList.innerHTML = '<p style="color: #bac4ff; text-align: center; padding: 24px;">No telemetry frames recorded yet. Connect your device via USB to stream live data.</p>';
  } else {
    elements.historyList.innerHTML = state.history.map((item) => `
      <div class="history-row">
        <strong>${item.stateName} &mdash; Baby: ${formatNumber(item.babyTemp, 1, '°C')} | Env: ${formatNumber(item.envTemp, 1, '°C')} (Health: ${formatNumber(item.healthScore, 0, '/100')})</strong>
        <small>SpO2: ${formatNumber(item.spo2, 0, '%')} | HR: ${formatNumber(item.heartRate, 0, ' bpm')} | Pulse: ${formatNumber(item.pulse, 0, ' bpm')} | Heater: ${item.heaterOn ? 'ON' : 'OFF'} | UV: ${item.uvOn ? 'ON' : 'OFF'} &bull; ${item.timestamp}</small>
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
  const headers = ['Timestamp', 'State', 'BabyTemp_C', 'EnvTemp_C', 'SpO2_Percent', 'HeartRate_BPM', 'Pulse_BPM', 'HealthScore', 'RiskLevel', 'Heater', 'UV', 'EmergencyAlert'];
  const rows = state.history.map((h) => [
    `"${h.timestamp}"`,
    `"${h.stateName}"`,
    h.babyTemp !== null && h.babyTemp !== undefined ? h.babyTemp : '',
    h.envTemp !== null && h.envTemp !== undefined ? h.envTemp : '',
    h.spo2 !== null && h.spo2 !== undefined ? h.spo2 : '',
    h.heartRate !== null && h.heartRate !== undefined ? h.heartRate : '',
    h.pulse !== null && h.pulse !== undefined ? h.pulse : '',
    h.healthScore !== null && h.healthScore !== undefined ? h.healthScore : '',
    `"${h.riskLevel || 'Normal'}"`,
    h.heaterOn ? 'ON' : 'OFF',
    h.uvOn ? 'ON' : 'OFF',
    h.emergencyAlert ? 'YES' : 'NO'
  ].join(','));
  const csvContent = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `neoguard-telemetry-${new Date().toISOString().slice(0, 10)}.csv`;
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

  try {
    const user = JSON.parse(localStorage.getItem('neoguard-user') || '{}');
    if (user.email) {
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

initializeDashboard();