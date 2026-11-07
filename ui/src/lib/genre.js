// Genre similarity between Apple Music genres ("Dance", "Hip-Hop/Rap")
// and GetSongBPM artist genres ("house", "electronic", "hip hop").
const GROUPS = [
  ['electronic', 'electronica', 'dance', 'house', 'deep house', 'melodic house', 'progressive house', 'tech house',
    'techno', 'melodic techno', 'edm', 'trance', 'downtempo', 'chill', 'chillout', 'chillwave', 'ambient', 'idm',
    'dubstep', 'drum and bass', 'drum & bass', 'dnb', 'breakbeat', 'bass', 'bass music', 'garage', 'uk garage',
    'future bass', 'electro', 'electro house', 'synthwave', 'nu disco', 'disco', 'trip hop', 'glitch hop', 'big room'],
  ['hip hop', 'hip-hop', 'rap', 'hip-hop/rap', 'trap', 'boom bap', 'lo-fi', 'lofi', 'instrumental hip hop', 'glitch hop', 'trip hop'],
  ['r&b', 'rnb', 'r&b/soul', 'soul', 'neo soul', 'funk', 'motown', 'disco'],
  ['rock', 'alternative', 'alternative rock', 'indie', 'indie rock', 'punk', 'pop punk', 'grunge', 'hard rock',
    'metal', 'heavy metal', 'emo', 'post-rock', 'classic rock', 'garage rock'],
  ['pop', 'dance pop', 'synthpop', 'synth-pop', 'electropop', 'k-pop', 'indie pop', 'teen pop', 'dance'],
  ['country', 'americana', 'folk', 'bluegrass', 'singer/songwriter', 'singer-songwriter', 'acoustic'],
  ['jazz', 'blues', 'swing', 'bebop', 'smooth jazz', 'acid jazz', 'easy listening', 'vocal', 'standards', 'big band', 'lounge'],
  ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'latin pop', 'urbano latino'],
  ['reggae', 'dancehall', 'ska', 'dub', 'roots reggae', 'calypso', 'soca'],
  ['classical', 'soundtrack', 'score', 'instrumental', 'new age', 'piano', 'orchestral'],
  ['world', 'afrobeats', 'afrobeat', 'afro house', 'amapiano', 'world music']
];

export function norm(g) {
  return String(g || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function splitGenres(g) {
  return norm(g).split(/[\/,;]| & (?!b)/).map((s) => s.trim()).filter(Boolean).concat([norm(g)]);
}

// 3 = same genre, 2 = same family, 1 = shares a word, 0 = unrelated
export function genreScore(a, b) {
  const as = new Set(splitGenres(a)), bs = new Set(splitGenres(b));
  if (!as.size || !bs.size) return 0;
  for (const x of as) if (bs.has(x)) return 3;
  for (const grp of GROUPS) {
    const g = new Set(grp);
    if ([...as].some((x) => g.has(x)) && [...bs].some((x) => g.has(x))) return 2;
  }
  const words = (s) => new Set([...s].join(' ').split(/[\s-]+/).filter((w) => w.length > 2));
  const aw = words(as), bw = words(bs);
  for (const w of aw) if (bw.has(w)) return 1;
  return 0;
}

export function bestGenreScore(seedGenre, genres) {
  return Math.max(0, ...(genres || []).map((g) => genreScore(seedGenre, g)));
}
