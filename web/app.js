const DEVICE_ID = 'neoguard-one (Serial)';

const state = {
  latest: null,
  isLive: false,
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
  if (!sensorDataAvailable && (data.babyTemp===undefined || data.babyTemp===0)) {
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
  elements.lastSyncTime.textContent = new Date().toLocaleTimeString();

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
    if(elements.connectSerialBtn) {
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
          } catch(e) {
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
  
  if (target === 'heater' && controlState === 'on') {
    const pin = window.prompt('Enter 4-digit heater safety PIN (Hint 0000)');
    if (pin !== HEATER_PIN) {
      elements.commandStatus.textContent = 'Invalid PIN. Heater ON cancelled.';
      return;
    }
  }

  elements.commandStatus.textContent = `Sending ${target} ${controlState}...`;
  
  try {
    const payload = JSON.stringify({ [target + 'On']: controlState === 'on' }) + '\n';
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

function bindControls() {
  if(elements.connectSerialBtn) {
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
}

function initializeDashboard() {
  bindControls();
  
  try {
    const stored = JSON.parse(localStorage.getItem('neowarm-profile-serial') || '{}');
    applyManualProfileToForm(stored);
  } catch (e) {}

  applyLiveState();
  elements.userName.textContent = 'Welcome, Local User';
  elements.userEmail.textContent = 'Offline Mode';
}

initializeDashboard();