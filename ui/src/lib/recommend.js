// Recommendations: new songs by similar artists that fit a BPM and energy target.
import { similarArtistTracks, topTracks, songKey } from './online.js';
import { analyzeCandidate, energy10, mood } from './analysis.svelte.js';
import { effectiveBpm } from './session.js';

// opts: { targetBpm, targetEnergy (1-10 or 0), seedArtists [] or artists [{id,name,rank}],
//         tolerance, energyTol, halfDouble, library [{name, artist}], perArtist, minResults }
// onUpdate(list, done, total, usable) is called as songs are analyzed. Resolves to the final list.
// Each result has fit=true when inside the ranges; near misses are appended (fit=false) when few fit.
export async function recommend(opts, onUpdate, isCancelled = () => false) {
  const { targetBpm, targetEnergy = 0, seedArtists = [], artists = null, tolerance = 5, energyTol = 2,
    halfDouble = true, library = [], perArtist = 8, minResults = 8 } = opts;
  const exclude = new Set(library.map((t) => songKey(t.name, t.artist)));
  const candidates = artists ? await topTracks(artists, { exclude, perArtist }) : await similarArtistTracks(seedArtists, { exclude, perArtist });
  if (isCancelled()) return [];
  if (!candidates.length) throw new Error(artists ? 'No songs with previews for those artists.' : 'No similar artists found for ' + seedArtists.join(', ') + '.');

  const dist = (bpm) => Math.abs(effectiveBpm(bpm, targetBpm, halfDouble) - targetBpm);
  const scored = [];
  let done = 0, next = 0, usable = 0;

  const assemble = () => {
    const fit = scored.filter((c) => c.fit).sort((a, b) => (a.artistRank || 99) - (b.artistRank || 99) || a.score - b.score);
    if (fit.length >= minResults) return fit;
    const near = scored.filter((c) => !c.fit).sort((a, b) => a.score - b.score).slice(0, minResults - fit.length);
    return [...fit, ...near];
  };

  onUpdate?.([], 0, candidates.length, 0);
  async function worker() {
    while (next < candidates.length && !isCancelled()) {
      const c = candidates[next++];
      const r = await analyzeCandidate(c);
      done++;
      if (r.tempo) {
        usable++;
        const bd = dist(r.tempo);
        const e = energy10(r);
        const ed = targetEnergy && e ? Math.abs(e - targetEnergy) : 0;
        scored.push({
          ...c, bpm: r.tempo, energy: e, mood: mood(r), bd, ed,
          fit: bd <= tolerance && ed <= energyTol,
          score: bd + ed * 2,
          reason: reason(r.tempo, e, targetBpm, halfDouble)
        });
      }
      onUpdate?.(assemble(), done, candidates.length, usable);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  return assemble();
}

function reason(bpm, energy, target, halfDouble) {
  const eb = effectiveBpm(bpm, target, halfDouble);
  let s = bpm + ' BPM';
  if (eb !== bpm) s += ' (' + (eb > bpm ? 'double' : 'half') + ' time ' + Math.round(eb) + ')';
  if (energy) s += ' · energy ' + energy;
  return s;
}
