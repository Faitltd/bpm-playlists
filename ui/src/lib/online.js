import { httpJson, openUrl, music } from './bridge.js';

// Online lookups use the free Deezer API (no key) and the free iTunes Search API.
const DZ = 'https://api.deezer.com';
const enc = encodeURIComponent;

export function cleanTitle(t) {
  return String(t || '')
    .replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(single|ep|remaster(ed)?( \d{4})?|radio edit)$/i, '')
    .trim();
}

export function cleanArtist(a) {
  return String(a || '').split(/\s*(,|&|\+|feat\.?|ft\.?| x | and )\s*/i)[0].trim();
}

export const simple = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dz(path) {
  const data = await httpJson(DZ + path);
  if (data && data.error) {
    if (data.error.code === 4) { await sleep(1500); return dz(path); } // quota: wait and retry
    throw new Error('Deezer: ' + (data.error.message || 'request failed'));
  }
  return data;
}

// Find a song on Deezer. Returns { bpm, preview } (bpm is 0 when Deezer has none).
export async function findSong(title, artist) {
  const want = simple(cleanArtist(artist));
  const wantTitle = simple(cleanTitle(title));
  const res = await dz('/search?limit=10&q=' + enc(cleanArtist(artist) + ' ' + cleanTitle(title)));
  const hits = (res.data || []).map((h) => {
    const a = simple(h.artist?.name);
    const artistOk = a && (a.includes(want) || want.includes(a));
    const t = simple(cleanTitle(h.title));
    const titleOk = t === wantTitle || t.startsWith(wantTitle) || wantTitle.startsWith(t);
    return { h, s: (artistOk ? 2 : 0) + (titleOk ? 1 : 0) };
  }).sort((a, b) => b.s - a.s);
  if (!hits.length || hits[0].s < 3) return null;
  const hit = hits[0].h;
  let bpm = 0;
  try {
    const tr = await dz('/track/' + hit.id);
    bpm = Math.round(Number(tr.bpm) || 0);
  } catch (e) { /* measure the preview instead */ }
  return { bpm, preview: hit.preview || '' };
}

// Measure previews in small batches, several at a time. onBatch receives [{ key, bpm }].
export async function measurePreviews(items, onBatch, size = 5, parallel = 4) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++].filter((x) => x.url);
      let res = [];
      if (chunk.length) {
        try { res = await music('measureUrls', { items: chunk.map(({ key, url }) => ({ key, url })) }); }
        catch (e) { res = chunk.map((x) => ({ key: x.key, bpm: 0 })); }
      }
      onBatch(res);
    }
  }
  await Promise.all(Array.from({ length: Math.min(parallel, chunks.length) }, worker));
}

// Songs by artists similar to the seed artist, measured and filtered by BPM.
// onUpdate(list, done, total) is called as results come in.
export async function recommend(seed, { tolerance, halfDouble, excludeKeys }, onUpdate) {
  const artistRes = await dz('/search/artist?limit=5&q=' + enc(cleanArtist(seed.artist)));
  const want = simple(cleanArtist(seed.artist));
  const artist = (artistRes.data || []).find((a) => simple(a.name) === want) || (artistRes.data || [])[0];
  if (!artist) throw new Error('Could not find ' + seed.artist + ' on Deezer.');

  const related = (await dz('/artist/' + artist.id + '/related?limit=20')).data || [];
  if (!related.length) throw new Error('Deezer has no similar artists for ' + artist.name + '.');

  const exclude = new Set((excludeKeys || []).map((k) => simple(cleanTitle(k.name) + '|' + cleanArtist(k.artist))));
  const candidates = [];
  for (const ra of related) {
    try {
      const top = (await dz('/artist/' + ra.id + '/top?limit=4')).data || [];
      for (const t of top) {
        const key = simple(cleanTitle(t.title) + '|' + cleanArtist(t.artist?.name));
        if (exclude.has(key) || candidates.some((c) => c.key === key) || !t.preview) continue;
        candidates.push({ key, title: t.title, artist: t.artist?.name || ra.name, url: t.preview, link: t.link, bpm: 0 });
      }
    } catch (e) { /* skip this artist */ }
  }

  const dist = (x) => {
    const opts = halfDouble ? [seed.bpm, seed.bpm * 2, seed.bpm / 2] : [seed.bpm];
    return Math.min(...opts.map((v) => Math.abs(x - v)));
  };
  const matches = [];
  let done = 0;
  onUpdate([], 0, candidates.length);
  await measurePreviews(candidates, (res) => {
    for (const r of res) {
      const c = candidates.find((x) => x.key === r.key);
      if (!c) continue;
      c.bpm = r.bpm;
      if (r.bpm && dist(r.bpm) <= tolerance) matches.push(c);
    }
    done = Math.min(candidates.length, done + Math.max(res.length, 1));
    matches.sort((a, b) => dist(a.bpm) - dist(b.bpm));
    onUpdate([...matches], done, candidates.length);
  });
  return matches;
}

// Find the song on Apple Music (free iTunes Search API) and open it in the Music app.
export async function openInAppleMusic(title, artist) {
  const term = cleanTitle(title) + ' ' + cleanArtist(artist);
  try {
    const data = await httpJson('https://itunes.apple.com/search?entity=song&limit=10&term=' + enc(term));
    const want = simple(cleanArtist(artist));
    const results = data.results || [];
    const hit = results.find((r) => simple(r.artistName).includes(want)) || results[0];
    if (hit?.trackViewUrl) {
      await openUrl(hit.trackViewUrl.replace(/^https:\/\//, 'music://'));
      return true;
    }
  } catch (e) { /* fall through to search */ }
  await openUrl('music://music.apple.com/us/search?term=' + enc(term));
  return false;
}
