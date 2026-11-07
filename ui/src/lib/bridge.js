// Talks to the Swift app. Each call returns a Promise.
let nextId = 1;
const pending = new Map();

window.__bridgeReply = (id, res) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (res.ok) p.resolve(res.data);
  else p.reject(new Error(res.error || 'Unknown error'));
};

export function call(cmd, args = {}) {
  const handler = window.webkit?.messageHandlers?.bridge;
  if (!handler) return Promise.reject(new Error('Open this page inside the BPM Playlists app.'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    handler.postMessage({ id, cmd, args });
  });
}

export const music = (op, data = {}) => call('music', { op, data });

export async function httpJson(url) {
  const res = await call('http', { url });
  if (res.status === 429) throw new Error('Too many requests. Wait a minute and try again.');
  if (res.status < 200 || res.status >= 300) throw new Error('Request failed (' + res.status + ').');
  try { return JSON.parse(res.body); } catch (e) { throw new Error('Unexpected response from server.'); }
}

export const openUrl = (url) => call('open', { url });

export async function loadSettings() {
  try { return JSON.parse(await call('getSettings')); } catch (e) { return {}; }
}

export const saveSettings = (s) => call('setSettings', { json: JSON.stringify(s) });
