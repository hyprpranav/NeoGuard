const state = {
  latest: null,
  connectedIp: '',
  pollHandle: null,
};

const elements = {
  connectButton: document.getElementById('connect-device'),
  deviceIp: document.getElementById('device-ip'),
  deviceIpInput: document.getElementById('device-ip-input'),
  babyTemp: document.getElementById('baby-temp'),
  envTemp: document.getElementById('env-temp'),
  spo2: document.getElementById('spo2'),
  heartRate: document.getElementById('heart-rate'),
  pulse: document.getElementById('pulse'),
  safetyCondition: document.getElementById('safety-condition'),
  heaterState: document.getElementById('heater-state'),
  relayState: document.getElementById('relay-state'),
  commandStatus: document.getElementById('command-status'),
  buttons: Array.from(document.querySelectorAll('button[data-target]')),
};

function normalizeDeviceIp(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }

  return `http://${trimmed.replace(/\/+$/, '')}`;
}

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
  state.connectedIp = data.deviceIp || state.connectedIp;

  elements.deviceIp.textContent = data.deviceIp || 'Not connected';
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
}

async function fetchLatest() {
  const response = await fetch('/api/data');

  if (!response.ok) {
    throw new Error(`Dashboard fetch failed with ${response.status}`);
  }

  const data = await response.json();
  render(data);
}

async function fetchHealth() {
  const response = await fetch('/api/health');

  if (!response.ok) {
    throw new Error(`Health check failed with ${response.status}`);
  }

  return response.json();
}

async function connectDevice() {
  const normalizedIp = normalizeDeviceIp(elements.deviceIpInput.value);

  if (!normalizedIp) {
    elements.commandStatus.textContent = 'Enter the ESP32 IP address first';
    return;
  }

  elements.commandStatus.textContent = `Connecting to ${normalizedIp}...`;
  elements.connectButton.disabled = true;

  try {
    const response = await fetch('/api/device/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceIp: normalizedIp }),
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || 'Unable to connect to ESP32.');
    }

    localStorage.setItem('neoguard-device-ip', normalizedIp);
    render(result.data);
    elements.commandStatus.textContent = 'ESP32 connected';
  } catch (error) {
    elements.commandStatus.textContent = error.message;
  } finally {
    elements.connectButton.disabled = false;
  }
}

async function sendCommand(target, controlState) {
  elements.commandStatus.textContent = `Sending ${target} ${controlState}...`;
  elements.buttons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const response = await fetch(`/api/control/${target}/${controlState}`);
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || 'Control command failed.');
    }

    render(result.data);
    elements.commandStatus.textContent = `${target.toUpperCase()} ${controlState.toUpperCase()} confirmed`;
  } catch (error) {
    elements.commandStatus.textContent = error.message;
  } finally {
    elements.buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function bindControls() {
  elements.connectButton.addEventListener('click', () => {
    connectDevice();
  });

  elements.deviceIpInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      connectDevice();
    }
  });

  elements.buttons.forEach((button) => {
    button.addEventListener('click', () => {
      sendCommand(button.dataset.target, button.dataset.state);
    });
  });
}

async function initializeDashboard() {
  bindControls();

  const rememberedIp = localStorage.getItem('neoguard-device-ip');
  if (rememberedIp) {
    elements.deviceIpInput.value = rememberedIp.replace(/^https?:\/\//, '');
  }

  try {
    const health = await fetchHealth();

    if (health.latestDeviceIp && health.latestDeviceIp !== 'Not connected') {
      state.connectedIp = health.latestDeviceIp;
      elements.deviceIp.textContent = health.latestDeviceIp;
      elements.deviceIpInput.value = health.latestDeviceIp.replace(/^https?:\/\//, '');
    }

    if (state.connectedIp) {
      await fetchLatest();
      elements.commandStatus.textContent = 'Live data connected';
    } else {
      elements.commandStatus.textContent = 'Enter ESP32 IP and press Connect';
    }
  } catch (error) {
    elements.commandStatus.textContent = error.message;
  }

  state.pollHandle = window.setInterval(() => {
    if (!state.connectedIp) {
      return;
    }

    fetchLatest().catch((error) => {
      elements.commandStatus.textContent = error.message;
    });
  }, 4000);
}

initializeDashboard();