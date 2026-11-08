// Recommendations: new songs by similar artists that fit a BPM and energy target.
import { similarArtistTracks, topTracks, songKey } from './online.js';
import { analyzeCandidate, energy10, mood } from './analysis.svelte.js';
import { effectiveBpm } from './session.js';

// opts: { targetBpm, targetEnergy (1-10 or 0), seedArtists [] or artists [{id,name,rank}], tolerance, energyTol, halfDouble, library [{name, artist}] }
// onUpdate(list, done, total) is called as songs are analyzed. Resolves to the final list.
export async function recommend(opts, onUpdate, isCancelled = () => false) {
  const { targetBpm, targetEnergy = 0, seedArtists = [], artists = null, tolerance = 5, energyTol = 2, halfDouble = true, library = [] } = opts;
  const exclude = new Set(library.map((t) => songKey(t.name, t.artist)));
  const candidates = artists ? await topTracks(artists, { exclude }) : await similarArtistTracks(seedArtists, { exclude });
  if (isCancelled()) return [];
  if (!candidates.length) throw new Error(artists ? 'No songs with previews for those artists.' : 'No similar artists found for ' + seedArtists.join(', ') + '.');

  const dist = (bpm) => Math.abs(effectiveBpm(bpm, targetBpm, halfDouble) - targetBpm);
  const matches = [];
  let done = 0, next = 0;
  onUpdate?.([], 0, candidates.length);

  async function worker() {
    while (next < candidates.length && !isCancelled()) {
      const c = candidates[next++];
      const r = await analyzeCandidate(c);
      done++;
      if (r.tempo) {
        const bd = dist(r.tempo);
        const e = energy10(r);
        const ed = targetEnergy && e ? Math.abs(e - targetEnergy) : 0;
        if (bd <= tolerance && ed <= energyTol) {
          matches.push({ ...c, bpm: r.tempo, energy: e, mood: mood(r), bd, ed, reason: reason(r.tempo, e, targetBpm, halfDouble) });
          matches.sort((a, b) => (a.artistRank || 99) - (b.artistRank || 99) || a.bd + a.ed * 2 - (b.bd + b.ed * 2));
        }
      }
      onUpdate?.([...matches], done, candidates.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  return matches;
}

function reason(bpm, energy, target, halfDouble) {
  const eb = effectiveBpm(bpm, target, halfDouble);
  let s = bpm + ' BPM';
  if (eb !== bpm) s += ' (' + (eb > bpm ? 'double' : 'half') + ' time ' + Math.round(eb) + ')';
  if (energy) s += ' · energy ' + energy;
  return s;
}
