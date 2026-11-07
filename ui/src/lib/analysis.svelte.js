// Audio analysis: BPM, energy, mood for every song, stored on this Mac.
import { analyzeUrl, loadStore, saveStore, music } from './bridge.js';
import { findPreviews } from './online.js';

export const analysis = $state({ tracks: {}, online: {}, loaded: false });

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveStore({ tracks: $state.snapshot(analysis.tracks), online: $state.snapshot(analysis.online) }).catch(() => {});
  }, 800);
}

export async function loadAnalysis() {
  const s = await loadStore();
  analysis.tracks = s.tracks || {};
  analysis.online = s.online || {};
  analysis.loaded = true;
}

export const rec = (id) => analysis.tracks[id] || null;
export const hasFeatures = (id) => !!(analysis.tracks[id] && !analysis.tracks[id].miss && analysis.tracks[id].energy != null);

// Energy on a 1 to 10 scale.
export function energy10(r) {
  if (!r || r.energy == null) return 0;
  return Math.min(10, Math.max(1, Math.round(r.energy * 10)));
}

export function mood(r) {
  if (!r || r.valence == null) return '';
  if (r.valence < 0.3) return 'Dark';
  if (r.valence < 0.6) return 'Even';
  return 'Bright';
}

export function describe(r) {
  if (!r || r.miss) return '';
  const parts = [];
  if (r.energy != null) parts.push('energy ' + energy10(r));
  const m = mood(r);
  if (m) parts.push(m.toLowerCase());
  if (r.instr > 0.6) parts.push('instrumental');
  if (r.dance > 0.7) parts.push('danceable');
  if (r.acoustic > 0.6) parts.push('acoustic');
  return parts.join(', ');
}

function normalize(f, src) {
  const n = (v) => (v == null || isNaN(Number(v)) ? null : Math.round(Number(v) * 1000) / 1000);
  return {
    tempo: Math.round(Number(f.tempo) || 0),
    energy: n(f.energy), dance: n(f.danceability), valence: n(f.valence),
    acoustic: n(f.acousticness), instr: n(f.instrumentalness), speech: n(f.speechiness),
    loud: n(f.loudness), src
  };
}

// Do two tempo estimates agree, allowing half or double time?
function agree(a, b, pct = 0.04) {
  if (!a || !b) return false;
  return [b, b * 2, b / 2].some((v) => Math.abs(a - v) <= Math.max(2, v * pct));
}

// Decide the BPM from local measurements of each preview clip, with ReccoBeats as a tie-breaker.
// Returns { tempo, conf } where conf is high | medium | low.
function decideTempo(locals, recco) {
  const L = locals.filter((x) => x > 0);
  const closest = (v) => (recco ? [v, v * 2, v / 2].reduce((p, c) => (Math.abs(c - recco) < Math.abs(p - recco) ? c : p)) : v);
  const inRange = (v) => (v >= 68 && v <= 180 ? v : v < 68 ? v * 2 : v / 2);
  if (L.length >= 2) {
    if (agree(L[0], L[1])) {
      let v = L[0];
      if (!agree(L[0], L[1], 0.0001) && recco) v = Math.round(closest(L[0]));
      return { tempo: Math.round(inRange(v)), conf: 'high' };
    }
    if (recco) {
      const pick = L.reduce((p, c) => (Math.abs(closest(c) - recco) < Math.abs(closest(p) - recco) ? c : p));
      return { tempo: Math.round(inRange(pick)), conf: agree(pick, recco) ? 'medium' : 'low' };
    }
    return { tempo: Math.round(inRange(L[0])), conf: 'low' };
  }
  if (L.length === 1) return { tempo: Math.round(inRange(L[0])), conf: agree(L[0], recco) ? 'high' : recco ? 'low' : 'medium' };
  if (recco) return { tempo: Math.round(inRange(recco)), conf: 'low' };
  return { tempo: 0, conf: 'none' };
}

async function localBpms(key, previews) {
  if (!previews.length) return [];
  try {
    const m = await music('measureUrls', { items: previews.map((p, i) => ({ key: key + ':' + i, url: p.url })) });
    return previews.map((p, i) => m.find((x) => x.key === key + ':' + i)?.bpm || 0);
  } catch (e) {
    return [];
  }
}

// Analyze one library song. t: { id, name, artist, canMeasure }
export async function analyzeTrack(t) {
  let r = null;
  try {
    const previews = await findPreviews(t.name, t.artist);
    if (previews.length) {
      const [feat, locals] = await Promise.all([
        analyzeUrl(previews[0].url).then((f) => normalize(f, previews[0].source)).catch(() => null),
        localBpms(t.id, previews)
      ]);
      const d = decideTempo(locals, feat?.tempo || 0);
      r = { ...(feat || {}), tempo: d.tempo, conf: d.conf, recco: feat?.tempo || 0, src: previews.map((p) => p.source).join('+') };
      if (!r.tempo) r = null;
    }
    if (!r && t.canMeasure) {
      const d = await music('detect', { id: t.id });
      if (d.bpm) r = { tempo: d.bpm, conf: 'medium', src: 'file' };
    }
  } catch (e) {
    r = null;
  }
  if (!r) r = { tempo: 0, miss: true };
  r.at = Date.now();
  analysis.tracks[t.id] = r;
  scheduleSave();
  return r;
}

async function featuresFromUrl(key, url, src) {
  const [feat, locals] = await Promise.all([
    analyzeUrl(url).then((f) => normalize(f, src)).catch(() => null),
    localBpms(key, [{ url }])
  ]);
  const d = decideTempo(locals, feat?.tempo || 0);
  if (!d.tempo) throw new Error('Could not analyze preview.');
  return { ...(feat || {}), tempo: d.tempo, conf: d.conf, src };
}

// Analyze many songs, a few at a time. Fills empty BPMs in Music as it goes.
export async function analyzeMany(list, onProgress, { parallel = 4, overwrite = false } = {}) {
  let next = 0, done = 0;
  const toSet = [];
  const flush = async () => {
    if (!toSet.length) return;
    const items = toSet.splice(0);
    try { await music('setBpms', { items }); } catch (e) {}
  };
  async function worker() {
    while (next < list.length) {
      const t = list[next++];
      const r = await analyzeTrack(t);
      const write = r.tempo && (!t.bpm || (overwrite && r.conf !== 'low' && r.tempo !== t.bpm));
      if (write) { t.bpm = r.tempo; toSet.push({ id: t.id, bpm: r.tempo }); }
      done++;
      onProgress?.(done, list.length, t);
      if (toSet.length >= 15) await flush();
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, list.length) }, worker));
  await flush();
}

// Analyze an online candidate (has a preview URL). Cached by key.
export async function analyzeCandidate(c) {
  const hit = analysis.online[c.key];
  if (hit) return hit;
  let r;
  try { r = await featuresFromUrl(c.key, c.url, c.source || 'deezer'); }
  catch (e) { r = { tempo: 0, miss: true }; }
  r.at = Date.now();
  analysis.online[c.key] = r;
  scheduleSave();
  return r;
}

export function stats(ids) {
  let analyzed = 0, missing = 0;
  for (const id of ids) {
    const r = analysis.tracks[id];
    if (r && !r.miss) analyzed++;
    else if (r?.miss) missing++;
  }
  return { analyzed, missing, todo: ids.length - analyzed - missing, total: ids.length };
}
