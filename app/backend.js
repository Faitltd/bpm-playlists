// BPM Playlists app backend (JXA). Called by the app as:
//   osascript -l JavaScript backend.js <op> '<json args>'
// Returns a JSON string.

ObjC.import('Foundation');
// ===== ANALYSIS START =====
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64ToBytes(s) {
  const lut = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | lut[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
  }
  return out.subarray(0, o);
}

function wavToSamples(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, sr = 11025;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]);
    const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') sr = dv.getUint32(p + 12, true);
    if (id === 'data') {
      const len = Math.min(size, bytes.length - p - 8) >> 1;
      const x = new Float32Array(len);
      for (let i = 0; i < len; i++) x[i] = dv.getInt16(p + 8 + i * 2, true) / 32768;
      return { x, sr };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('No audio data');
}

function bpmFromSamples(all, sr) {
  // Middle 60 seconds.
  const span = Math.min(all.length, 60 * sr);
  const start = Math.floor((all.length - span) / 2);
  const x = all.subarray(start, start + span);

  // One-pole lowpass ~2 kHz.
  const a = Math.exp((-2 * Math.PI * 2000) / sr);
  const y = new Float32Array(x.length);
  let z = 0;
  for (let i = 0; i < x.length; i++) { z = (1 - a) * x[i] + a * z; y[i] = z; }

  // Log-energy onset envelope.
  const HOP = 128;
  const n = Math.floor(y.length / HOP);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    let e = 0;
    const o = i * HOP;
    for (let j = 0; j < HOP; j++) e += y[o + j] * y[o + j];
    const le = Math.log(1e-6 + e);
    env[i] = i === 0 ? 0 : Math.max(0, le - prev);
    prev = le;
  }
  const W = 16;
  const onset = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - W); k < Math.min(n, i + W); k++) { s += env[k]; c++; }
    onset[i] = Math.max(0, env[i] - s / c);
  }

  const fps = sr / HOP;
  const ac = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += onset[i] * onset[i + lag];
    return s / (n - lag);
  };
  const minLag = Math.floor((60 * fps) / 200);
  const maxLag = Math.ceil((60 * fps) / 60);
  let best = -1, bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = ac(lag) * prior;
    if (score > best) { best = score; bestLag = lag; }
  }
  // Half-time check: prefer double tempo if its beat is nearly as strong.
  const half = Math.round(bestLag / 2);
  if (half >= minLag && (60 * fps) / half <= 180) {
    const hBest = Math.max(ac(half - 1), ac(half), ac(half + 1));
    if (hBest >= 0.9 * ac(bestLag)) {
      bestLag = [half - 1, half, half + 1].reduce((p, l) => (ac(l) > ac(p) ? l : p), half);
    }
  }
  const a1 = ac(bestLag - 1), b1 = ac(bestLag), c1 = ac(bestLag + 1);
  const d = a1 - 2 * b1 + c1;
  const shift = d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a1 - c1)) / d)) : 0;
  return Math.round((60 * fps) / (bestLag + shift));
}
// ===== ANALYSIS END =====

function shQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

function measureFile(app, path) {
  const tmp = '/tmp/bpm_playlists_app_' + $.NSProcessInfo.processInfo.processIdentifier + '.wav';
  try {
    app.doShellScript('/usr/bin/afconvert -f WAVE -d LEI16@11025 -c 1 ' + shQuote(path) + ' ' + tmp);
    const data = $.NSData.dataWithContentsOfFile(tmp);
    const b64 = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
    const { x, sr } = wavToSamples(b64ToBytes(b64));
    return bpmFromSamples(x, sr);
  } finally {
    app.doShellScript('rm -f ' + tmp);
  }
}

function bpmDistance(a, b, halfDouble) {
  const opts = halfDouble ? [b, b * 2, b / 2] : [b];
  return Math.min(...opts.map((v) => Math.abs(a - v)));
}

function music() { return Application('Music'); }
function library(M) { return M.libraryPlaylists[0]; }

function playlistById(M, id) {
  const p = M.userPlaylists.whose({ persistentID: id })();
  if (!p.length) throw new Error('Playlist not found. Refresh the list.');
  return p[0];
}

function trackById(M, id) {
  const t = library(M).tracks.whose({ persistentID: id })();
  if (!t.length) throw new Error('Song not found in library.');
  return t[0];
}

function rebuildPlaylist(M, name) {
  M.userPlaylists.whose({ name: name })().forEach((p) => M.delete(p)); // deletes the playlist only, never songs
  return M.make({ new: 'userPlaylist', withProperties: { name: name } });
}

function safeBulk(fn, n, fill) {
  try { const v = fn(); if (Array.isArray(v) && v.length === n) return v; } catch (e) {}
  return new Array(n).fill(fill);
}

const ops = {
  playlists() {
    const M = music();
    const pls = M.userPlaylists();
    return pls.map((p) => {
      let count = 0, smart = false;
      try { count = p.tracks.length; } catch (e) {}
      try { smart = p.smart(); } catch (e) {}
      return { id: p.persistentID(), name: p.name(), count, smart };
    }).filter((p) => p.name);
  },

  tracks({ playlistId }) {
    const M = music();
    const pl = playlistById(M, playlistId);
    const ts = pl.tracks;
    const n = ts.length;
    if (!n) return [];
    const ids = ts.persistentID();
    const names = safeBulk(() => ts.name(), n, '');
    const artists = safeBulk(() => ts.artist(), n, '');
    const albums = safeBulk(() => ts.album(), n, '');
    const genres = safeBulk(() => ts.genre(), n, '');
    const bpms = safeBulk(() => ts.bpm(), n, 0);
    const durs = safeBulk(() => ts.duration(), n, 0);
    const list = ts();
    return ids.map((id, i) => {
      let cls = '';
      try { cls = list[i].class(); } catch (e) {}
      return {
        id, name: names[i], artist: artists[i], album: albums[i], genre: genres[i],
        bpm: bpms[i] || 0, duration: Math.round(durs[i] || 0), canMeasure: cls === 'fileTrack'
      };
    });
  },

  detect({ id }) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const M = music();
    const t = trackById(M, id);
    if (t.class() !== 'fileTrack') throw new Error('Streaming songs cannot be measured. Type the BPM instead.');
    const loc = t.location();
    if (!loc) throw new Error('File not found on this Mac.');
    const bpm = measureFile(app, loc.toString());
    if (bpm > 0) { try { t.bpm = bpm; } catch (e) {} }
    return { id, bpm };
  },

  setBpm({ id, bpm }) {
    const M = music();
    const t = trackById(M, id);
    t.bpm = Math.max(0, Math.round(Number(bpm) || 0));
    return { id, bpm: t.bpm() };
  },

  buildActivities({ playlistId, activities, unknownName }) {
    const M = music();
    const pl = playlistById(M, playlistId);
    const list = pl.tracks();
    const bpms = safeBulk(() => pl.tracks.bpm(), list.length, 0);
    const rows = list.map((t, i) => ({ t, bpm: bpms[i] || 0 })).sort((a, b) => a.bpm - b.bpm);
    const out = [];
    activities.forEach((act) => {
      const picks = rows.filter((r) => r.bpm > 0 && r.bpm >= act.min && r.bpm < act.max);
      if (!picks.length) return;
      const np = rebuildPlaylist(M, act.name);
      picks.forEach((r) => M.duplicate(r.t, { to: np }));
      out.push({ name: act.name, count: picks.length });
    });
    const unknown = rows.filter((r) => !r.bpm);
    if (unknown.length && unknownName) {
      const np = rebuildPlaylist(M, unknownName);
      unknown.forEach((r) => M.duplicate(r.t, { to: np }));
      out.push({ name: unknownName, count: unknown.length });
    }
    return out;
  },

  buildMatch({ playlistId, seedId, tolerance, halfDouble }) {
    const M = music();
    const pl = playlistById(M, playlistId);
    const seed = trackById(M, seedId);
    const seedBpm = seed.bpm();
    if (!seedBpm) throw new Error('This song has no BPM yet.');
    const list = pl.tracks();
    const n = list.length;
    const bpms = safeBulk(() => pl.tracks.bpm(), n, 0);
    const ids = safeBulk(() => pl.tracks.persistentID(), n, '');
    const picks = list
      .map((t, i) => ({ t, bpm: bpms[i] || 0, id: ids[i] }))
      .filter((r) => r.bpm > 0 && r.id !== seedId && bpmDistance(r.bpm, seedBpm, halfDouble) <= tolerance)
      .sort((a, b) => bpmDistance(a.bpm, seedBpm, halfDouble) - bpmDistance(b.bpm, seedBpm, halfDouble));
    const name = 'BPM Match: ' + seed.name();
    const np = rebuildPlaylist(M, name);
    M.duplicate(seed, { to: np });
    picks.forEach((r) => M.duplicate(r.t, { to: np }));
    return { name, count: picks.length + 1, id: np.persistentID() };
  },

  libraryIndex() {
    const M = music();
    const ts = library(M).tracks;
    const n = ts.length;
    if (!n) return [];
    const ids = ts.persistentID();
    const names = safeBulk(() => ts.name(), n, '');
    const artists = safeBulk(() => ts.artist(), n, '');
    const genres = safeBulk(() => ts.genre(), n, '');
    const bpms = safeBulk(() => ts.bpm(), n, 0);
    const durs = safeBulk(() => ts.duration(), n, 0);
    return ids.map((id, i) => ({
      id, name: names[i], artist: artists[i], genre: genres[i], bpm: bpms[i] || 0, duration: Math.round(durs[i] || 0)
    }));
  },

  // Create (or replace) a playlist with songs in the given order.
  buildOrdered({ name, ids }) {
    const M = music();
    const np = rebuildPlaylist(M, name);
    let count = 0;
    ids.forEach((id) => {
      try { M.duplicate(trackById(M, id), { to: np }); count++; } catch (e) {}
    });
    return { name, count, id: np.persistentID() };
  },

  // Download song previews (e.g. Deezer 30-second MP3s) and measure their BPM.
  measureUrls({ items }) {
    const app = Application.currentApplication();
    app.includeStandardAdditions = true;
    const pid = $.NSProcessInfo.processInfo.processIdentifier;
    return items.map(({ key, url }, i) => {
      const ext = /\.m4a(\?|$)/i.test(url) ? 'm4a' : 'mp3';
      const tmp = '/tmp/bpm_playlists_prev_' + pid + '_' + i + '.' + ext;
      try {
        app.doShellScript('/usr/bin/curl -sfL -m 20 -o ' + tmp + ' ' + shQuote(url));
        return { key, bpm: measureFile(app, tmp) };
      } catch (e) {
        return { key, bpm: 0 };
      } finally {
        app.doShellScript('rm -f ' + tmp);
      }
    });
  },

  setBpms({ items }) {
    const M = music();
    let saved = 0;
    items.forEach(({ id, bpm }) => {
      try { trackById(M, id).bpm = Math.round(bpm); saved++; } catch (e) {}
    });
    return { saved };
  },

  addTracks({ playlistId, ids }) {
    const M = music();
    const pl = playlistById(M, playlistId);
    const have = new Set(safeBulk(() => pl.tracks.persistentID(), pl.tracks.length, ''));
    let added = 0;
    ids.forEach((id) => {
      if (have.has(id)) return;
      M.duplicate(trackById(M, id), { to: pl });
      added++;
    });
    return { added };
  }
};

function run(argv) {
  const op = argv[0];
  const args = argv[1] ? JSON.parse(argv[1]) : {};
  if (!ops[op]) throw new Error('Unknown operation: ' + op);
  return JSON.stringify(ops[op](args));
}
