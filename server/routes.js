const express = require('express');
const {
  getConfiguredDeviceIp,
  getLatestReading,
  isDatabaseReady,
  normalizeDeviceIp,
  saveReading,
  setConfiguredDeviceIp,
} = require('./database');

function normalizeProfileInput(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text;
}

function buildProfileQuery(profile) {
  const params = new URLSearchParams();

  if (profile.birthWeight !== undefined) params.set('birthWeight', String(profile.birthWeight));
  if (profile.gestationalAge !== undefined) params.set('gestationalAge', String(profile.gestationalAge));
  if (profile.feedingInterval !== undefined) params.set('feedingInterval', String(profile.feedingInterval));
  if (profile.sleepDuration !== undefined) params.set('sleepDuration', String(profile.sleepDuration));
  if (profile.vaccinationStatus !== undefined) params.set('vaccinationStatus', profile.vaccinationStatus);
  if (profile.symptoms !== undefined) params.set('symptoms', profile.symptoms);

  return params.toString();
}

async function forwardProfileToDevice(profile, deviceIp) {
  const baseUrl = normalizeDeviceIp(deviceIp);

  if (!baseUrl) {
    return null;
  }

  const query = buildProfileQuery(profile);
  const response = await fetch(`${baseUrl}/profile${query ? `?${query}` : ''}`);

  if (!response.ok) {
    throw new Error(`ESP32 returned HTTP ${response.status}`);
  }

  return response.json();
}

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

  router.get('/profile', async (_request, response) => {
    const latest = await getLatestReading();
    response.json({ ok: true, profile: latest.manualProfile || {} });
  });

  router.post('/profile', async (request, response, next) => {
    try {
      const profile = {
        birthWeight: request.body?.birthWeight ?? request.body?.birthWeightKg,
        gestationalAge: request.body?.gestationalAge,
        feedingInterval: request.body?.feedingInterval,
        sleepDuration: request.body?.sleepDuration,
        vaccinationStatus: normalizeProfileInput(request.body?.vaccinationStatus),
        symptoms: normalizeProfileInput(request.body?.symptoms),
      };

      const latest = await getLatestReading();
      const saved = await saveReading({
        ...latest,
        manualProfile: {
          birthWeightKg: Number(profile.birthWeight ?? latest.manualProfile?.birthWeightKg ?? 0) || null,
          gestationalAgeWeeks: Number(profile.gestationalAge ?? latest.manualProfile?.gestationalAgeWeeks ?? 0) || null,
          feedingIntervalMinutes: Number(profile.feedingInterval ?? latest.manualProfile?.feedingIntervalMinutes ?? 0) || null,
          sleepDurationHours: Number(profile.sleepDuration ?? latest.manualProfile?.sleepDurationHours ?? 0) || null,
          vaccinationStatus: profile.vaccinationStatus || latest.manualProfile?.vaccinationStatus || '',
          symptoms: profile.symptoms || latest.manualProfile?.symptoms || '',
        },
        capturedAt: new Date().toISOString(),
      });

      const configuredIp = getConfiguredDeviceIp();
      if (configuredIp) {
        try {
          await forwardProfileToDevice(profile, configuredIp);
        } catch (deviceError) {
          console.warn(deviceError.message);
        }
      }

      response.json({ ok: true, data: saved });
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