// BPM Activity Playlists for the macOS Music app (JXA).
// Usage in Terminal:
//   Activity playlists:
//     osascript -l JavaScript bpm-playlists.js "Source Playlist Name"
//   Match one song's BPM:
//     osascript -l JavaScript bpm-playlists.js "Source Playlist Name" --match "Song Title"
//
// Reads every song in the source playlist. Songs with no BPM get measured
// (downloaded/local files only) and the BPM is saved to the song.
// Then each song is added to the activity playlist that matches its BPM,
// sorted slowest to fastest. Re-running rebuilds the "BPM: ..." playlists.

// ---------- Edit activities and BPM ranges here (min inclusive, max exclusive) ----------
const ACTIVITIES = [
  { name: 'BPM: Relax',   min: 0,   max: 90 },
  { name: 'BPM: Yoga',    min: 90,  max: 110 },
  { name: 'BPM: Walk',    min: 110, max: 125 },
  { name: 'BPM: Workout', min: 125, max: 140 },
  { name: 'BPM: Run',     min: 140, max: 160 },
  { name: 'BPM: HIIT',    min: 160, max: 999 }
];
const UNKNOWN_PLAYLIST = 'BPM: Unknown';
const SAVE_DETECTED_BPM = true;
const MATCH_TOLERANCE = 5;        // +/- BPM for match mode
const MATCH_HALF_DOUBLE = true;   // also match songs at half or double the BPM
// -----------------------------------------------------------------------------------------

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
  if (half >= minLag) {
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

function measureBpm(app, path) {
  const tmp = '/tmp/bpm_playlists_tmp.wav';
  app.doShellScript('/usr/bin/afconvert -f WAVE -d LEI16@11025 -c 1 ' + shQuote(path) + ' ' + tmp);
  const data = $.NSData.dataWithContentsOfFile(tmp);
  const b64 = ObjC.unwrap(data.base64EncodedStringWithOptions(0));
  app.doShellScript('rm -f ' + tmp);
  const { x, sr } = wavToSamples(b64ToBytes(b64));
  return bpmFromSamples(x, sr);
}

function rebuildPlaylist(Music, name) {
  const existing = Music.userPlaylists.whose({ name: name })();
  existing.forEach((p) => Music.delete(p)); // removes the playlist only, never songs
  return Music.make({ new: 'userPlaylist', withProperties: { name: name } });
}

const stats = { measured: 0, failed: 0 };

function trackBpm(app, t) {
  let bpm = t.bpm() || 0;
  if (!bpm && t.class() === 'fileTrack') {
    try {
      const loc = t.location();
      if (loc) {
        bpm = measureBpm(app, loc.toString());
        stats.measured++;
        if (SAVE_DETECTED_BPM && bpm > 0) { try { t.bpm = bpm; } catch (e) {} }
      }
    } catch (e) { stats.failed++; }
  }
  return bpm;
}

function bpmDistance(a, b) {
  const opts = MATCH_HALF_DOUBLE ? [b, b * 2, b / 2] : [b];
  return Math.min(...opts.map((v) => Math.abs(a - v)));
}

function run(argv) {
  const sourceName = argv[0];
  if (!sourceName) return 'Give the source playlist name, e.g.: osascript -l JavaScript bpm-playlists.js "My Mix"';
  const mi = argv.indexOf('--match');
  const matchTitle = mi > -1 ? argv[mi + 1] : null;
  if (mi > -1 && !matchTitle) return 'Give a song title after --match.';

  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const Music = Application('Music');

  const matches = Music.playlists.whose({ name: sourceName })();
  if (matches.length === 0) return 'No playlist named "' + sourceName + '" found.';
  const tracks = matches[0].tracks();

  // Find the seed song: source playlist first, then whole library.
  let seed = null, seedBpm = 0;
  if (matchTitle) {
    seed = tracks.find((t) => t.name().toLowerCase() === matchTitle.toLowerCase()) ||
      Music.libraryPlaylists[0].tracks.whose({ name: matchTitle })()[0] || null;
    if (!seed) return 'No song titled "' + matchTitle + '" found.';
    seedBpm = trackBpm(app, seed);
    if (!seedBpm) return 'Could not get a BPM for "' + matchTitle + '" (streaming-only songs need a BPM typed into Get Info).';
    console.log('Seed: ' + seed.name() + ' at ' + seedBpm + ' BPM');
  }

  const rows = [];
  tracks.forEach((t, i) => {
    const bpm = trackBpm(app, t);
    rows.push({ t, bpm, name: t.name() });
    console.log((i + 1) + '/' + tracks.length + '  ' + (bpm || '?') + ' BPM  ' + t.name());
  });

  if (matchTitle) {
    const seedId = seed.persistentID();
    const picks = rows
      .filter((r) => r.bpm > 0 && r.t.persistentID() !== seedId && bpmDistance(r.bpm, seedBpm) <= MATCH_TOLERANCE)
      .sort((a, b) => bpmDistance(a.bpm, seedBpm) - bpmDistance(b.bpm, seedBpm));
    const pl = rebuildPlaylist(Music, 'BPM Match: ' + seed.name());
    Music.duplicate(seed, { to: pl });
    picks.forEach((r) => Music.duplicate(r.t, { to: pl }));
    return 'Done. "' + seed.name() + '" is ' + seedBpm + ' BPM. Playlist "BPM Match: ' + seed.name() +
      '" has ' + (picks.length + 1) + ' songs (closest BPM first).';
  }

  rows.sort((a, b) => a.bpm - b.bpm);

  const summary = [];
  ACTIVITIES.forEach((act) => {
    const picks = rows.filter((r) => r.bpm >= act.min && r.bpm < act.max && r.bpm > 0);
    if (picks.length === 0) return;
    const pl = rebuildPlaylist(Music, act.name);
    picks.forEach((r) => Music.duplicate(r.t, { to: pl }));
    summary.push(act.name + ': ' + picks.length);
  });

  const unknown = rows.filter((r) => !r.bpm);
  if (unknown.length) {
    const pl = rebuildPlaylist(Music, UNKNOWN_PLAYLIST);
    unknown.forEach((r) => Music.duplicate(r.t, { to: pl }));
    summary.push(UNKNOWN_PLAYLIST + ': ' + unknown.length);
  }

  return 'Done. Measured ' + stats.measured + ' songs' + (stats.failed ? ', ' + stats.failed + ' failed' : '') + '.\n' + summary.join('\n');
}
