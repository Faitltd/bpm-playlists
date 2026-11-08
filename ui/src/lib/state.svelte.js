// Shared app state and helpers.
import { music, loadSettings, saveSettings } from './bridge.js';
import { loadAnalysis } from './analysis.svelte.js';

export const DEFAULT_ACTIVITIES = [
  { name: 'BPM: Relax', min: 0, max: 90 },
  { name: 'BPM: Yoga', min: 90, max: 110 },
  { name: 'BPM: Walk', min: 110, max: 125 },
  { name: 'BPM: Workout', min: 125, max: 140 },
  { name: 'BPM: Run', min: 140, max: 160 },
  { name: 'BPM: HIIT', min: 160, max: 999 }
];

export const ui = $state({
  settings: {
    tolerance: 5,
    energyTol: 2,
    halfDouble: true,
    unknownName: 'BPM: Unknown',
    perSource: true,
    activities: structuredClone(DEFAULT_ACTIVITIES)
  },
  view: 'playlist', // playlist | session | find
  findBpm: 120,
  playlists: [],
  selectedId: null,
  tracks: [],
  libIndex: null,
  seed: null,
  busy: '',
  progress: null,
  toast: null
});

let toastTimer;

export function notify(text, kind = 'ok') {
  ui.toast = { text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast = null), kind === 'error' ? 9000 : 5000);
}

export async function task(label, fn) {
  if (ui.busy) return;
  ui.busy = label;
  try {
    return await fn();
  } catch (e) {
    notify(e.message, 'error');
  } finally {
    ui.busy = '';
    ui.progress = null;
  }
}

export function persist() {
  saveSettings($state.snapshot(ui.settings)).catch(() => {});
}

export async function init() {
  const saved = await loadSettings();
  Object.assign(ui.settings, saved);
  if (!Array.isArray(ui.settings.activities) || !ui.settings.activities.length) {
    ui.settings.activities = structuredClone(DEFAULT_ACTIVITIES);
  }
  await loadAnalysis();
  await refreshPlaylists();
}

export async function refreshPlaylists() {
  await task('Loading playlists', async () => {
    ui.playlists = await music('playlists');
    if (ui.selectedId && !ui.playlists.some((p) => p.id === ui.selectedId)) ui.selectedId = null;
  });
  if (ui.selectedId) await loadTracks();
}

export async function reloadPlaylistsQuiet() {
  try { ui.playlists = await music('playlists'); } catch (e) {}
}

export async function selectPlaylist(id) {
  if (ui.busy) return;
  ui.view = 'playlist';
  ui.selectedId = id;
  ui.seed = null;
  await loadTracks();
}

export async function loadTracks() {
  if (!ui.selectedId) return;
  await task('Loading songs', async () => {
    ui.tracks = await music('tracks', { playlistId: ui.selectedId });
  });
}

export async function ensureLibrary() {
  if (ui.libIndex) return ui.libIndex;
  await task('Reading your library', async () => {
    ui.libIndex = await music('libraryIndex');
  });
  return ui.libIndex;
}

// Keep playlist rows and library index in step after a BPM changes.
export function applyBpm(id, bpm) {
  for (const t of ui.tracks) if (t.id === id) t.bpm = bpm;
  if (ui.libIndex) for (const t of ui.libIndex) if (t.id === id) t.bpm = bpm;
  if (ui.seed && ui.seed.id === id) ui.seed.bpm = bpm;
}

export function fmtTime(s) {
  if (!s) return '';
  return Math.floor(s / 60) + ':' + String(Math.round(s) % 60).padStart(2, '0');
}

export function fmtMin(s) {
  const m = Math.round(s / 60);
  return m + ' min';
}
