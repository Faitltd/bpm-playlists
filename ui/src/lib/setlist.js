// Ordering a setlist: small BPM steps, energy rising to a peak around 70% then easing off.
import { effectiveBpm } from './session.js';

export function djOrder(tracks, halfDouble = true) {
  const valid = tracks.filter((t) => t.tempo > 0);
  const rest = tracks.filter((t) => !(t.tempo > 0));
  if (valid.length < 2) return [...valid, ...rest];
  const energies = valid.map((t) => t.energy || 5);
  const lo = Math.min(...energies), hi = Math.max(...energies);
  const n = valid.length;
  const desired = (i) => {
    const p = n === 1 ? 0 : i / (n - 1);
    return p <= 0.7 ? lo + (hi - lo) * (p / 0.7) : hi - (hi - lo) * 0.6 * ((p - 0.7) / 0.3);
  };
  const remaining = [...valid];
  const out = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const want = desired(i);
    let best = null, bestCost = Infinity;
    for (const t of remaining) {
      let cost = Math.abs((t.energy || 5) - want) * 2;
      if (prev) cost += Math.abs(effectiveBpm(t.tempo, prev.tempo, halfDouble) - prev.tempo) / 3;
      else cost += t.tempo / 200; // start slower
      if (cost < bestCost) { bestCost = cost; best = t; }
    }
    out.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    prev = best;
  }
  return [...out, ...rest];
}

export function bySpeed(tracks) {
  return [...tracks].sort((a, b) => (a.tempo || 999) - (b.tempo || 999));
}

export function setlistText(tracks) {
  return tracks.map((t, i) =>
    (i + 1) + '. ' + (t.artist ? t.artist + ' - ' : '') + t.title +
    (t.tempo ? '  (' + t.tempo + ' BPM' + (t.energy ? ', energy ' + t.energy : '') + ')' : '') + '\n   ' + t.permalink
  ).join('\n');
}
