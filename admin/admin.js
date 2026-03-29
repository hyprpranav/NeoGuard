if (!window.NEOGUARD_FIREBASE_CONFIG) {
  alert('Missing firebase-config.js');
  throw new Error('Missing NEOGUARD_FIREBASE_CONFIG');
}

firebase.initializeApp(window.NEOGUARD_FIREBASE_CONFIG);
const auth = firebase.auth();
const database = firebase.database();

let currentUser = null;
let adminTelemetryRef = null;
let adminStatusRef = null;

const adminElements = {
  deviceSelect: document.getElementById('admin-device-select'),
  status: document.getElementById('admin-device-status'),
  babyTemp: document.getElementById('admin-baby-temp'),
  envTemp: document.getElementById('admin-env-temp'),
  spo2: document.getElementById('admin-spo2'),
  heartRate: document.getElementById('admin-heart-rate'),
  pulse: document.getElementById('admin-pulse'),
  wifi: document.getElementById('admin-wifi'),
  heater: document.getElementById('admin-heater'),
  uv: document.getElementById('admin-uv')
};

const demoDevices = {
  'neoguard-two': {
    babyTemp: 36.7,
    envTemp: 29.4,
    spo2: 98,
    heartRate: 132,
    pulse: 130,
    wifiConnected: false,
    heaterOn: false,
    uvOn: false
  },
  'neoguard-three': {
    babyTemp: 36.9,
    envTemp: 30.2,
    spo2: 97,
    heartRate: 128,
    pulse: 127,
    wifiConnected: false,
    heaterOn: true,
    uvOn: false
  }
};

auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = './auth.html';
    return;
  }

  const userDataStr = localStorage.getItem('neoguard-user');
  const userObj = JSON.parse(userDataStr || '{}');
  
  if (userObj.role !== 'admin') {
    window.location.href = './web/index.html';
    return;
  }

  currentUser = { uid: user.uid, email: user.email, ...userObj };
  loadPendingUsers();
  loadAllUsers();
  loadDeviceLogs();
  setupDeviceSection();
});

function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

  const titles = {
    'pending-users': 'Pending User Approvals',
    'user-management': 'User Management',
    'device-logs': 'Device Logs',
    'devices': 'Device Monitor',
    'settings': 'System Settings'
  };
  document.getElementById('section-title').textContent = titles[sectionId] || 'Admin Dashboard';
}

function formatMetric(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return `--${suffix}`;
  }
  return `${Number(value)}${suffix}`;
}

function renderAdminDevice(data) {
  adminElements.babyTemp.textContent = formatMetric(data.babyTemp, '°C');
  adminElements.envTemp.textContent = formatMetric(data.envTemp, '°C');
  adminElements.spo2.textContent = formatMetric(data.spo2, '%');
  adminElements.heartRate.textContent = formatMetric(data.heartRate, ' bpm');
  adminElements.pulse.textContent = formatMetric(data.pulse, ' bpm');
  adminElements.heater.textContent = data.heaterOn ? 'ON' : 'OFF';
  adminElements.uv.textContent = data.uvOn ? 'ON' : 'OFF';
}

function renderAdminConnection(status) {
  adminElements.wifi.textContent = status?.wifiConnected ? 'CONNECTED' : 'OFFLINE';
}

function clearAdminSubscriptions() {
  if (adminTelemetryRef) {
    adminTelemetryRef.off();
    adminTelemetryRef = null;
  }
  if (adminStatusRef) {
    adminStatusRef.off();
    adminStatusRef = null;
  }
}

function subscribeAdminToDevice(deviceId) {
  clearAdminSubscriptions();

  if (deviceId !== 'neoguard-one') {
    const demo = demoDevices[deviceId];
    renderAdminDevice(demo);
    renderAdminConnection({ wifiConnected: false });
    adminElements.status.textContent = `${deviceId} is a demo source.`;
    return;
  }

  adminElements.status.textContent = 'Listening to live telemetry from neoguard-one...';
  adminTelemetryRef = database.ref(`devices/${deviceId}/telemetry/latest`);
  adminStatusRef = database.ref(`devices/${deviceId}/status/connection`);

  adminTelemetryRef.on('value', (snapshot) => {
    const data = snapshot.val() || {};
    renderAdminDevice(data);
  });

  adminStatusRef.on('value', (snapshot) => {
    renderAdminConnection(snapshot.val() || {});
  });
}

function setupDeviceSection() {
  if (!adminElements.deviceSelect) {
    return;
  }

  subscribeAdminToDevice(adminElements.deviceSelect.value);
  adminElements.deviceSelect.addEventListener('change', (event) => {
    subscribeAdminToDevice(event.target.value);
  });
}

async function loadPendingUsers() {
  const ref = database.ref('users');
  const snapshot = await ref.orderByChild('status').equalTo('pending').once('value');
  const users = snapshot.val() || {};

  const html = Object.entries(users).map(([uid, user]) => `
    <div class="card user-card">
      <div class="user-info">
        <div class="user-name">${user.name}</div>
        <div class="user-email">${user.email}</div>
        <div class="user-status pending">PENDING VERIFICATION</div>
      </div>
      <div class="user-actions">
        <button class="btn-approve" onclick="approveUser('${uid}', '${user.email}')">Approve</button>
        <button class="btn-reject" onclick="rejectUser('${uid}')">Reject</button>
      </div>
    </div>
  `).join('');

  document.getElementById('pending-users-list').innerHTML = html || '<div class="empty-state">No pending approvals</div>';
}

async function loadAllUsers() {
  const ref = database.ref('users');
  const snapshot = await ref.once('value');
  const users = snapshot.val() || {};

  const rows = Object.entries(users).map(([uid, user]) => `
    <tr>
      <td>${user.name}</td>
      <td>${user.email}</td>
      <td class="status-${user.status}">${user.status.toUpperCase()}</td>
      <td>${user.role || 'operator'}</td>
      <td>
        <button class="btn-reset" onclick="resetUserPassword('${user.email}')">Reset Password</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('user-table-body').innerHTML = rows || '<tr><td colspan="5" style="text-align: center; color: #bac4ff;">No users found</td></tr>';
}

async function approveUser(uid, email) {
  if (!confirm(`Approve ${email}?`)) return;

  await database.ref(`users/${uid}/status`).set('approved');
  
  await sendApprovalEmail(email);
  
  loadPendingUsers();
  loadAllUsers();
  alert(`User ${email} approved!`);
}

async function rejectUser(uid) {
  if (!confirm('Reject this user?')) return;

  await database.ref(`users/${uid}/status`).set('rejected');
  loadPendingUsers();
  loadAllUsers();
  alert('User rejected');
}

async function resetUserPassword(email) {
  if (!confirm(`Send password reset to ${email}?`)) return;

  try {
    await auth.sendPasswordResetEmail(email);
    alert(`Password reset email sent to ${email}`);
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

async function sendApprovalEmail(email) {
  // In production, use Cloud Functions or backend API
  console.log(`Approval email would be sent to ${email}`);
}

async function loadDeviceLogs() {
  const ref = database.ref(`devices/neoguard-one/telemetry/history`);
  const snapshot = await ref.orderByChild('createdAt').limitToLast(20).once('value');
  const logs = snapshot.val() || {};

  const html = Object.values(logs).reverse().map(log => `
    <div class="log-entry">
      <div><strong>Baby Temp:</strong> ${log.babyTemp || '--'}°C</div>
      <div><strong>SpO2:</strong> ${log.spo2 || '--'}%</div>
      <div><strong>Heart Rate:</strong> ${log.heartRate || '--'} bpm</div>
      <div class="log-time">${new Date(log.createdAt).toLocaleString()}</div>
    </div>
  `).join('');

  document.getElementById('logs-container').innerHTML = html || '<div class="empty-state">No device logs</div>';
}

function downloadLogs() {
  const ref = database.ref(`devices/neoguard-one/telemetry/history`);
  ref.once('value', (snapshot) => {
    const logs = snapshot.val() || {};
    const csv = 'timestamp,baby_temp,env_temp,spo2,heart_rate,pulse,heater_on,uv_on\n' + 
      Object.values(logs).map(log => 
        `${log.createdAt},${log.babyTemp},${log.envTemp},${log.spo2},${log.heartRate},${log.pulse},${log.heaterOn},${log.uvOn}`
      ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neoguard-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  });
}

function handleLogout() {
  clearAdminSubscriptions();
  localStorage.removeItem('neoguard-auth');
  localStorage.removeItem('neoguard-user');
  auth.signOut().then(() => {
    window.location.href = './auth.html';
  });
}
