/**
 * Typed axios client for the ML microservice.
 * Base URL comes from env.ML_SERVICE_URL (Docker: http://ml-service:8000).
 */
'use strict';

const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

const http = axios.create({
  baseURL: env.mlServiceUrl,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url;
    logger.warn('ml call failed', { url, status, msg: err.message });
    return Promise.reject(err);
  }
);

async function health() {
  const { data } = await http.get('/health');
  return data;
}

async function predictAnomaly(payload) {
  const { data } = await http.post('/predict/anomaly', payload);
  return data;
}

async function predictFailure(payload) {
  const { data } = await http.post('/predict/failure', payload);
  return data;
}

async function predictRul(payload) {
  const { data } = await http.post('/predict/rul', payload);
  return data;
}

/** Batch-score the latest reading for every sensor. */
async function scoreBatch(sensorIds) {
  const { data } = await http.post('/predict/anomaly/batch', { sensor_ids: sensorIds });
  return data;
}

module.exports = { http, health, predictAnomaly, predictFailure, predictRul, scoreBatch };
