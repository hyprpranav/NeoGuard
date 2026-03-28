const express = require('express');
const {
  getConfiguredDeviceIp,
  getLatestReading,
  isDatabaseReady,
  normalizeDeviceIp,
  saveReading,
  setConfiguredDeviceIp,
} = require('./database');

async function fetchDeviceSnapshot(deviceIp) {
  const baseUrl = normalizeDeviceIp(deviceIp);

  if (!baseUrl) {
    throw new Error('ESP32 device IP is not configured.');
  }

  const deviceResponse = await fetch(`${baseUrl}/data`);

  if (!deviceResponse.ok) {
    throw new Error(`ESP32 returned HTTP ${deviceResponse.status}`);
  }

  const deviceData = await deviceResponse.json();
  return saveReading({
    ...deviceData,
    deviceIp: deviceData.deviceIp || baseUrl,
    capturedAt: new Date().toISOString(),
  });
}

function createRouter() {
  const router = express.Router();

  router.get('/health', async (_request, response) => {
    const latest = await getLatestReading();
    const configuredIp = getConfiguredDeviceIp();

    response.json({
      ok: true,
      storage: isDatabaseReady() ? 'mysql' : 'memory-cache',
      latestDeviceIp: configuredIp || latest.deviceIp,
    });
  });

  router.get('/data', async (_request, response, next) => {
    try {
      const configuredIp = getConfiguredDeviceIp();

      if (!configuredIp) {
        const latest = await getLatestReading();
        return response.json(latest);
      }

      const liveReading = await fetchDeviceSnapshot(configuredIp);
      return response.json(liveReading);
    } catch (error) {
      return next(error);
    }
  });

  router.post('/device/connect', async (request, response, next) => {
    try {
      const deviceIp = normalizeDeviceIp(request.body?.deviceIp);

      if (!deviceIp) {
        return response.status(400).json({ ok: false, message: 'Provide a valid ESP32 IP address.' });
      }

      setConfiguredDeviceIp(deviceIp);
      const liveReading = await fetchDeviceSnapshot(deviceIp);
      return response.json({ ok: true, data: liveReading });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/readings', async (request, response, next) => {
    try {
      const saved = await saveReading({
        ...request.body,
        capturedAt: new Date().toISOString(),
      });

      response.status(201).json({ ok: true, data: saved });
    } catch (error) {
      next(error);
    }
  });

  router.get('/control/:target/:state', async (request, response, next) => {
    const { target, state } = request.params;

    if (!['heater', 'uv'].includes(target) || !['on', 'off'].includes(state)) {
      return response.status(400).json({ ok: false, message: 'Invalid control path.' });
    }

    try {
      const latest = await getLatestReading();
      const baseUrl = getConfiguredDeviceIp() || normalizeDeviceIp(latest.deviceIp);

      if (!baseUrl || baseUrl === 'Not connected') {
        return response.status(503).json({
          ok: false,
          message: 'ESP32 address is unknown. Enter the device IP in the dashboard first.',
        });
      }

      const deviceResponse = await fetch(`${baseUrl}/${target}/${state}`);

      if (!deviceResponse.ok) {
        return response.status(502).json({
          ok: false,
          message: `ESP32 returned HTTP ${deviceResponse.status}`,
        });
      }

      const deviceData = await deviceResponse.json();
      const merged = await saveReading({
        ...latest,
        ...deviceData,
        deviceIp: deviceData.deviceIp || baseUrl,
        capturedAt: new Date().toISOString(),
      });

      return response.json({ ok: true, data: merged });
    } catch (error) {
      return next(error);
    }
  });

  router.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ ok: false, message: error.message || 'Unexpected server error.' });
  });

  return router;
}

module.exports = {
  createRouter,
};