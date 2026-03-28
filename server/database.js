const mysql = require('mysql2/promise');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'neoguard',
};

let pool;
let databaseReady = false;
let configuredDeviceIp = normalizeDeviceIp(process.env.ESP32_BASE_URL || '');
let latestCache = {
  deviceIp: configuredDeviceIp || 'Not connected',
  babyTemp: null,
  envTemp: null,
  spo2: null,
  heartRate: null,
  pulse: null,
  heaterOn: false,
  uvOn: false,
  safetyRelayOn: false,
  safetyCondition: 'Awaiting device data',
  sensorFault: false,
  capturedAt: null,
};

function normalizeDeviceIp(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed || /not connected|not detected/i.test(trimmed)) {
    return '';
  }

  const withProtocol = trimmed.startsWith('http://') || trimmed.startsWith('https://')
    ? trimmed
    : `http://${trimmed}`;

  return withProtocol.replace(/\/+$/, '');
}

async function initializeDatabase() {
  try {
    const bootstrapConnection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      multipleStatements: true,
    });

    await bootstrapConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``
    );
    await bootstrapConnection.end();

    pool = mysql.createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS neonatal_readings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        device_ip VARCHAR(64) NOT NULL,
        baby_temp DECIMAL(5,2) NULL,
        env_temp DECIMAL(5,2) NULL,
        spo2 DECIMAL(5,2) NULL,
        heart_rate DECIMAL(6,2) NULL,
        pulse DECIMAL(6,2) NULL,
        heater_on TINYINT(1) NOT NULL DEFAULT 0,
        uv_on TINYINT(1) NOT NULL DEFAULT 0,
        safety_relay_on TINYINT(1) NOT NULL DEFAULT 1,
        safety_condition VARCHAR(128) NOT NULL,
        sensor_fault TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    databaseReady = true;
    console.log(`MySQL ready at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } catch (error) {
    databaseReady = false;
    console.warn('MySQL unavailable, continuing with in-memory cache only.');
    console.warn(error.message);
  }
}

function normalizeReading(payload) {
  latestCache = {
    deviceIp: payload.deviceIp || configuredDeviceIp || latestCache.deviceIp,
    babyTemp: payload.babyTemp ?? latestCache.babyTemp,
    envTemp: payload.envTemp ?? latestCache.envTemp,
    spo2: payload.spo2 ?? latestCache.spo2,
    heartRate: payload.heartRate ?? latestCache.heartRate,
    pulse: payload.pulse ?? latestCache.pulse,
    heaterOn: Boolean(payload.heaterOn),
    uvOn: Boolean(payload.uvOn),
    safetyRelayOn: Boolean(payload.safetyRelayOn),
    safetyCondition: payload.safetyCondition || latestCache.safetyCondition,
    sensorFault: Boolean(payload.sensorFault),
    capturedAt: payload.capturedAt || new Date().toISOString(),
  };

  return latestCache;
}

function setConfiguredDeviceIp(deviceIp) {
  configuredDeviceIp = normalizeDeviceIp(deviceIp);

  if (configuredDeviceIp) {
    latestCache.deviceIp = configuredDeviceIp;
  }

  return configuredDeviceIp;
}

function getConfiguredDeviceIp() {
  return configuredDeviceIp || normalizeDeviceIp(latestCache.deviceIp);
}

async function saveReading(payload) {
  const normalized = normalizeReading(payload);

  if (!databaseReady || !pool) {
    return normalized;
  }

  await pool.execute(
    `
      INSERT INTO neonatal_readings (
        device_ip,
        baby_temp,
        env_temp,
        spo2,
        heart_rate,
        pulse,
        heater_on,
        uv_on,
        safety_relay_on,
        safety_condition,
        sensor_fault
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      normalized.deviceIp,
      normalized.babyTemp,
      normalized.envTemp,
      normalized.spo2,
      normalized.heartRate,
      normalized.pulse,
      normalized.heaterOn,
      normalized.uvOn,
      normalized.safetyRelayOn,
      normalized.safetyCondition,
      normalized.sensorFault,
    ]
  );

  return normalized;
}

async function getLatestReading() {
  if (!databaseReady || !pool) {
    return latestCache;
  }

  const [rows] = await pool.query(`
    SELECT
      device_ip AS deviceIp,
      baby_temp AS babyTemp,
      env_temp AS envTemp,
      spo2,
      heart_rate AS heartRate,
      pulse,
      heater_on AS heaterOn,
      uv_on AS uvOn,
      safety_relay_on AS safetyRelayOn,
      safety_condition AS safetyCondition,
      sensor_fault AS sensorFault,
      created_at AS capturedAt
    FROM neonatal_readings
    ORDER BY id DESC
    LIMIT 1
  `);

  if (!rows.length) {
    return latestCache;
  }

  return normalizeReading(rows[0]);
}

function isDatabaseReady() {
  return databaseReady;
}

module.exports = {
  getConfiguredDeviceIp,
  initializeDatabase,
  normalizeDeviceIp,
  saveReading,
  setConfiguredDeviceIp,
  getLatestReading,
  isDatabaseReady,
};