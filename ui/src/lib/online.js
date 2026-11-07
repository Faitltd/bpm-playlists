// Free online sources: Deezer (previews, similar artists) and Apple's iTunes Search (previews, links).
import { httpJson, openUrl } from './bridge.js';

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
export const songKey = (name, artist) => simple(cleanTitle(name) + '|' + cleanArtist(artist));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dz(path, tries = 3) {
  const data = await httpJson(DZ + path);
  if (data && data.error) {
    if (data.error.code === 4 && tries > 0) { await sleep(1500); return dz(path, tries - 1); }
    throw new Error('Deezer: ' + (data.error.message || 'request failed'));
  }
  return data;
}

function best(list, artist, title, getArtist, getTitle) {
  const want = simple(cleanArtist(artist));
  const wantTitle = simple(cleanTitle(title));
  const scored = (list || []).map((h) => {
    const a = simple(getArtist(h));
    const artistOk = a && want && (a.includes(want) || want.includes(a));
    const t = simple(cleanTitle(getTitle(h)));
    const titleOk = t === wantTitle || (t.length > 3 && (t.startsWith(wantTitle) || wantTitle.startsWith(t)));
    return { h, s: (artistOk ? 2 : 0) + (titleOk ? 1 : 0) };
  }).sort((a, b) => b.s - a.s);
  return scored.length && scored[0].s >= 3 ? scored[0].h : null;
}

// Find 30-second previews for a song from Deezer and Apple (two different clips of the same song).
// Returns [{ url, source, link }], possibly empty.
export async function findPreviews(title, artist) {
  const q = cleanArtist(artist) + ' ' + cleanTitle(title);
  const out = [];
  const [d, a] = await Promise.all([
    dz('/search?limit=10&q=' + enc(q)).catch(() => null),
    httpJson('https://itunes.apple.com/search?entity=song&limit=10&term=' + enc(q)).catch(() => null)
  ]);
  const dh = d && best(d.data, artist, title, (h) => h.artist?.name, (h) => h.title);
  if (dh?.preview) out.push({ url: dh.preview, source: 'deezer', link: dh.link });
  const ah = a && best(a.results, artist, title, (r) => r.artistName, (r) => r.trackName);
  if (ah?.previewUrl) out.push({ url: ah.previewUrl, source: 'itunes', link: ah.trackViewUrl });
  return out;
}

export async function findPreview(title, artist) {
  return (await findPreviews(title, artist))[0] || null;
}

// Top songs by artists similar to the given artists. Returns candidates with preview URLs.
export async function similarArtistTracks(artistNames, { perArtist = 4, maxArtists = 20, exclude = new Set() } = {}) {
  const related = new Map();
  for (const name of artistNames.slice(0, 3)) {
    try {
      const res = await dz('/search/artist?limit=5&q=' + enc(cleanArtist(name)));
      const want = simple(cleanArtist(name));
      const a = (res.data || []).find((x) => simple(x.name) === want) || (res.data || [])[0];
      if (!a) continue;
      const rel = (await dz('/artist/' + a.id + '/related?limit=' + maxArtists)).data || [];
      for (const r of rel) if (!related.has(r.id)) related.set(r.id, r);
    } catch (e) { /* skip */ }
  }
  const out = [];
  const seen = new Set();
  for (const ra of [...related.values()].slice(0, maxArtists * 2)) {
    try {
      const top = (await dz('/artist/' + ra.id + '/top?limit=' + perArtist)).data || [];
      for (const t of top) {
        const key = songKey(t.title, t.artist?.name);
        if (!t.preview || seen.has(key) || exclude.has(key)) continue;
        seen.add(key);
        out.push({ key: 'dz:' + t.id, skey: key, title: t.title, artist: t.artist?.name || ra.name, url: t.preview, link: t.link, source: 'deezer' });
      }
    } catch (e) { /* skip */ }
  }
  return out;
}

// Open a song in the Music app (via Apple's catalog search).
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
  } catch (e) { /* fall through */ }
  await openUrl('music://music.apple.com/us/search?term=' + enc(term));
  return false;
}
