/**
 * Smoke test for the backend app factory.
 * Does NOT hit Postgres - pulls the app from app.js directly.
 */
'use strict';

const request = require('supertest');
const { buildApp } = require('../src/app');

describe('GET /health', () => {
  const app = buildApp();

  test('returns OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.service).toBe('backend');
  });

  test('unknown route 404s', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });

  test('auth route requires credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
