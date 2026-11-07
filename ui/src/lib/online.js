import { httpJson, openUrl } from './bridge.js';
import { bestGenreScore } from './genre.js';

const enc = encodeURIComponent;

export function cleanTitle(t) {
  return String(t || '')
    .replace(/\s*[\(\[](feat\.?|ft\.?|with|prod\.?)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(single|ep|remaster(ed)?( \d{4})?|radio edit)$/i, '')
    .trim();
}

function cleanArtist(a) {
  return String(a || '').split(/\s*(,|&|feat\.?|ft\.?| x | and )\s*/i)[0].trim();
}

const simple = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function asArray(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function apiBase(settings) {
  return (settings.apiBase || 'https://api.getsong.co').replace(/\/+$/, '');
}

// Look up one song's BPM by title and artist.
export async function lookupBpm(settings, title, artist) {
  const lookup = 'song:' + cleanTitle(title) + ' artist:' + cleanArtist(artist);
  const url = apiBase(settings) + '/search/?api_key=' + enc(settings.apiKey) + '&type=both&limit=10&lookup=' + enc(lookup);
  const data = await httpJson(url);
  const results = asArray(data.search).filter((r) => r && r.tempo);
  if (!results.length) return 0;
  const want = simple(cleanArtist(artist));
  const wantTitle = simple(cleanTitle(title));
  const scored = results.map((r) => {
    const names = asArray(r.artist).map((a) => simple(a.name));
    const artistOk = names.some((n) => n && (n.includes(want) || want.includes(n)));
    const titleOk = simple(r.song_title) === wantTitle;
    return { r, s: (artistOk ? 2 : 0) + (titleOk ? 1 : 0) };
  }).sort((a, b) => b.s - a.s);
  if (scored[0].s < 2) return 0; // artist must match
  return Math.round(Number(scored[0].r.tempo)) || 0;
}

// Songs near a BPM from GetSongBPM, ranked by genre similarity to the seed.
export async function recommend(settings, seed, { tolerance, halfDouble, excludeKeys }) {
  const bpms = new Set();
  const spread = Math.min(tolerance, 3);
  for (let d = -spread; d <= spread; d++) bpms.add(seed.bpm + d);
  if (halfDouble) {
    if (seed.bpm * 2 <= 220) bpms.add(seed.bpm * 2);
    if (seed.bpm / 2 >= 40) bpms.add(Math.round(seed.bpm / 2));
  }
  const seen = new Map();
  const errors = [];
  for (const b of bpms) {
    if (b < 40 || b > 220) continue;
    try {
      const data = await httpJson(apiBase(settings) + '/tempo/?api_key=' + enc(settings.apiKey) + '&bpm=' + b + '&limit=250');
      for (const s of asArray(data.tempo)) {
        const artists = asArray(s.artist);
        const artistName = artists.map((a) => a.name).filter(Boolean).join(', ');
        const key = (s.song_title + '|' + artistName).toLowerCase();
        if (seen.has(key)) continue;
        const genres = artists.flatMap((a) => asArray(a.genres));
        seen.set(key, {
          key,
          title: s.song_title,
          artist: artistName,
          bpm: Math.round(Number(s.tempo)) || b,
          genres,
          year: s.album?.year || '',
          uri: s.song_uri,
          score: bestGenreScore(seed.genre, genres)
        });
      }
    } catch (e) {
      errors.push(e.message);
      if (/API key|rate limit/i.test(e.message)) break;
    }
  }
  if (!seen.size && errors.length) throw new Error(errors[0]);
  // excludeKeys: [{ name, artist }] songs already in the library
  const exclude = new Set((excludeKeys || []).map((k) => simple(cleanTitle(k.name) + '|' + cleanArtist(k.artist))));
  for (const r of seen.values()) r.exKey = simple(cleanTitle(r.title) + '|' + cleanArtist(r.artist));
  const dist = (x) => Math.min(Math.abs(x - seed.bpm), halfDouble ? Math.abs(x - seed.bpm * 2) : 999, halfDouble ? Math.abs(x - seed.bpm / 2) : 999);
  return [...seen.values()]
    .filter((r) => r.score >= 2 && !exclude.has(r.exKey))
    .sort((a, b) => b.score - a.score || dist(a.bpm) - dist(b.bpm))
    .slice(0, 40);
}

// Find the song on Apple Music (free iTunes Search API) and open it in the Music app.
export async function openInAppleMusic(title, artist) {
  const term = cleanTitle(title) + ' ' + cleanArtist(artist);
  try {
    const data = await httpJson('https://itunes.apple.com/search?entity=song&limit=10&term=' + enc(term));
    const want = simple(cleanArtist(artist));
    const hit = asArray(data.results).find((r) => simple(r.artistName).includes(want)) || asArray(data.results)[0];
    if (hit?.trackViewUrl) {
      await openUrl(hit.trackViewUrl.replace(/^https:\/\//, 'music://'));
      return true;
    }
  } catch (e) { /* fall through to search */ }
  await openUrl('music://music.apple.com/us/search?term=' + enc(term));
  return false;
}
