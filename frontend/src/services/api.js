/**
 * Axios client for the Phoswatch REST API.
 *
 * All requests go to '/api/*' which nginx proxies to the backend service
 * (http://backend:3000) inside the Docker network. The JWT lives in
 * localStorage and is attached automatically.
 */
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const tok = localStorage.getItem('phoswatch.token');
  if (tok) config.headers.Authorization = `Bearer ${tok}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.endsWith('/auth/login')) {
      // Token expired: push user back to login.
      localStorage.removeItem('phoswatch.token');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// --- typed-ish helpers ------------------------------------------------------
export const Auth = {
  login: (username, password) => api.post('/auth/login', { username, password }).then(r => r.data),
  me:    () => api.get('/auth/me').then(r => r.data),
  changePassword: (oldPassword, newPassword) =>
    api.post('/auth/change-password', { oldPassword, newPassword }).then(r => r.data),
};

export const Equipment = {
  list:   (params)   => api.get('/equipment', { params }).then(r => r.data),
  get:    (id)       => api.get(`/equipment/${id}`).then(r => r.data),
  sensors:(id)       => api.get(`/equipment/${id}/sensors`).then(r => r.data),
  health: ()         => api.get('/equipment/health').then(r => r.data),
  setStatus: (id, status) => api.patch(`/equipment/${id}/status`, { status }).then(r => r.data),
};

export const Sensors = {
  list:     (params) => api.get('/sensors', { params }).then(r => r.data),
  get:      (id)     => api.get(`/sensors/${id}`).then(r => r.data),
  latest:   ()       => api.get('/sensors/latest').then(r => r.data),
  readings: (id, params) => api.get(`/sensors/${id}/readings`, { params }).then(r => r.data),
};

export const Alarms = {
  list:  (params)    => api.get('/alarms', { params }).then(r => r.data),
  stats: ()          => api.get('/alarms/stats').then(r => r.data),
  ack:   (id)        => api.post(`/alarms/${id}/ack`).then(r => r.data),
  clear: (id)        => api.post(`/alarms/${id}/clear`).then(r => r.data),
};

export const Predictions = {
  anomaly:  (sensor_id, window_minutes = 30) =>
    api.post('/predictions/anomaly', { sensor_id, window_minutes }).then(r => r.data),
  failure:  (equipment_id, horizon_days = 7) =>
    api.post('/predictions/failure', { equipment_id, horizon_days }).then(r => r.data),
  rul:      (equipment_id) => api.get(`/predictions/rul/${equipment_id}`).then(r => r.data),
  anomalyHistory: (sensor_id) => api.get(`/predictions/anomaly/${sensor_id}/history`).then(r => r.data),
  failureHistory: (equipment_id) => api.get(`/predictions/failure/${equipment_id}/history`).then(r => r.data),
  mlHealth: () => api.get('/predictions/health').then(r => r.data),
};

export const Maintenance = {
  list:   (params)   => api.get('/maintenance', { params }).then(r => r.data),
  create: (data)     => api.post('/maintenance', data).then(r => r.data),
  update: (id, data) => api.patch(`/maintenance/${id}`, data).then(r => r.data),
  remove: (id)       => api.delete(`/maintenance/${id}`).then(r => r.data),
};

export const Users = {
  list:   ()              => api.get('/users').then(r => r.data),
  create: (u)             => api.post('/users', u).then(r => r.data),
  active: (id, is_active) => api.patch(`/users/${id}/active`, { is_active }).then(r => r.data),
  role:   (id, role)      => api.patch(`/users/${id}/role`, { role }).then(r => r.data),
  remove: (id)            => api.delete(`/users/${id}`).then(r => r.data),
};

export const Reports = {
  equipmentXlsxUrl: (id, from, to) => `/api/reports/equipment/${id}/xlsx?from=${from}&to=${to}`,
  equipmentPdfUrl:  (id, from, to) => `/api/reports/equipment/${id}/pdf?from=${from}&to=${to}`,
  alarmsXlsxUrl:    (from, to)     => `/api/reports/alarms/xlsx?from=${from}&to=${to}`,
  summaryPdfUrl:    (from, to)     => `/api/reports/summary/pdf?from=${from}&to=${to}`,
  /** Report endpoints need the JWT as a header, so we fetch the blob in JS. */
  fetchBlob: async (url) => {
    const r = await api.get(url.replace('/api', ''), { responseType: 'blob' });
    return r.data;
  },
};

export default api;
