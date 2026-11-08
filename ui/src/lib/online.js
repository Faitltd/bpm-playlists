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

// Find one artist on Deezer: exact full name first ("Sultan + Shepard"), then the first-named artist.
async function findArtist(name) {
  const tryName = async (n) => {
    const res = await dz('/search/artist?limit=5&q=' + enc(n));
    return (res.data || []).find((x) => simple(x.name) === simple(n)) || null;
  };
  try {
    const full = await tryName(name);
    if (full) return full;
    const first = cleanArtist(name);
    if (first !== name) { const a = await tryName(first); if (a) return a; }
    const res = await dz('/search/artist?limit=1&q=' + enc(first));
    return (res.data || [])[0] || null;
  } catch (e) { return null; }
}

// Artists similar to the given artists, ranked. Returns [{ id, name, rank, from }].
export async function similarArtists(artistNames, { max = 24 } = {}) {
  const related = new Map();
  const seedIds = new Set();
  const seeds = artistNames.filter(Boolean).slice(0, 4);
  for (const name of seeds) {
    try {
      const a = await findArtist(name);
      if (!a) continue;
      seedIds.add(a.id);
      const rel = (await dz('/artist/' + a.id + '/related?limit=20')).data || [];
      rel.forEach((r, i) => {
        const cur = related.get(r.id);
        const score = 20 - i + (cur ? cur.score + 10 : 0); // artists related to several seeds rise
        related.set(r.id, { id: r.id, name: r.name, score, from: cur ? cur.from + ', ' + name : name });
      });
    } catch (e) { /* skip */ }
  }
  return [...related.values()].filter((a) => !seedIds.has(a.id)).sort((a, b) => b.score - a.score).slice(0, max)
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

// Top songs by the given artists ([{ id, name }]). Returns candidates with preview URLs.
export async function topTracks(artists, { perArtist = 5, exclude = new Set() } = {}) {
  const out = [];
  const seen = new Set();
  for (const ra of artists) {
    try {
      const top = (await dz('/artist/' + ra.id + '/top?limit=' + perArtist)).data || [];
      for (const t of top) {
        const key = songKey(t.title, t.artist?.name);
        if (!t.preview || seen.has(key) || exclude.has(key)) continue;
        seen.add(key);
        out.push({ key: 'dz:' + t.id, skey: key, title: t.title, artist: t.artist?.name || ra.name, artistRank: ra.rank || 0, url: t.preview, link: t.link, source: 'deezer' });
      }
    } catch (e) { /* skip */ }
  }
  return out;
}

// Convenience: similar artists, then their top songs.
export async function similarArtistTracks(artistNames, opts = {}) {
  const artists = await similarArtists(artistNames, { max: opts.maxArtists || 20 });
  return topTracks(artists, opts);
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
