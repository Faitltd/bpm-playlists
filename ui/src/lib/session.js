// Session builder: turns a purpose (run, spin, yoga...) into a tempo and energy curve,
// then fills it from analyzed songs with smooth transitions.

const seg = (name, minutes, bpm, energy) => ({ name, minutes: Math.max(1, Math.round(minutes)), bpm: Math.round(bpm), energy });

export const PRESETS = [
  {
    id: 'run', name: 'Run', icon: '🏃', targetBpm: 160, length: 45,
    hint: 'Steady cadence. 160 to 180 BPM for most runners; half-time songs (80 to 90) count.',
    segs: (L, t) => [seg('Warm-up', 5, t - 12, 4), seg('Run', L - 10, t, 7), seg('Cool-down', 5, t - 18, 3)]
  },
  {
    id: 'intervals', name: 'Intervals', icon: '⚡', targetBpm: 165, length: 40,
    hint: 'Three-minute pushes with two-minute recoveries.',
    segs: (L, t) => {
      const s = [seg('Warm-up', 5, t - 15, 4)];
      let rem = L - 10, i = 1;
      while (rem > 0) {
        s.push(seg('Push ' + i, Math.min(3, rem), t + 5, 8)); rem -= 3;
        if (rem > 0) { s.push(seg('Recover ' + i, Math.min(2, rem), t - 15, 5)); rem -= 2; }
        i++;
      }
      s.push(seg('Cool-down', 5, t - 20, 3));
      return s;
    }
  },
  {
    id: 'spin', name: 'Spin class', icon: '🚴', targetBpm: 128, length: 45,
    hint: 'Climbs around 85 to 95 BPM, sprints at the target.',
    segs: (L, t) => {
      const block = Math.max(3, Math.round((L - 12) / 4));
      return [
        seg('Warm-up', 5, t - 30, 4), seg('Climb 1', block, t - 38, 6), seg('Sprint 1', block, t, 8),
        seg('Recover', 2, t - 25, 5), seg('Climb 2', block, t - 36, 7), seg('Sprint 2', block, t + 2, 9),
        seg('Cool-down', 5, t - 35, 3)
      ];
    }
  },
  {
    id: 'yoga', name: 'Yoga', icon: '🧘', targetBpm: 95, length: 60,
    hint: 'Low energy throughout, a gentle peak in the middle.',
    segs: (L, t) => [
      seg('Centering', 5, t - 25, 2), seg('Flow', (L - 15) * 0.6, t, 4), seg('Peak', (L - 15) * 0.4, t + 10, 5),
      seg('Wind-down', 5, t - 15, 3), seg('Rest', 5, t - 30, 1)
    ]
  },
  {
    id: 'focus', name: 'Focus', icon: '🎯', targetBpm: 110, length: 90,
    hint: 'Steady, low energy, instrumental where possible.',
    instrumental: true,
    segs: (L, t) => [seg('Focus', L, t, 4)]
  },
  {
    id: 'party', name: 'Party', icon: '🎉', targetBpm: 124, length: 90,
    hint: 'Energy rises one level at a time to a peak, then eases off.',
    segs: (L, t) => [
      seg('Opening', L * 0.25, t - 6, 5), seg('Build', L * 0.3, t - 2, 7), seg('Peak', L * 0.3, t + 2, 9), seg('Last call', L * 0.15, t - 3, 6)
    ]
  },
  {
    id: 'chill', name: 'Chill', icon: '🌙', targetBpm: 95, length: 60,
    hint: 'Relaxed and even.',
    segs: (L, t) => [seg('Chill', L, t, 3)]
  },
  {
    id: 'custom', name: 'Custom', icon: '✏️', targetBpm: 120, length: 60,
    hint: 'Edit the segments below.',
    segs: (L, t) => [seg('Part 1', L / 2, t - 5, 5), seg('Part 2', L / 2, t, 7)]
  }
];

export function presetSegments(preset, length, targetBpm) {
  return preset.segs(Math.max(5, length), targetBpm).filter((s) => s.minutes > 0);
}

// The tempo a song plays at relative to a target: a 82 BPM song is 164 for a runner.
export function effectiveBpm(bpm, target, halfDouble) {
  if (!halfDouble) return bpm;
  return [bpm, bpm * 2, bpm / 2].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// pool: [{ id, name, artist, genre, bpm, duration, energy (1-10 or 0), instr (0-1 or null) }]
export function fillSession(segments, pool, opts = {}) {
  const { tolerance = 5, halfDouble = true, energyTol = 2, instrumental = false, seed = 1, variety = 1 } = opts;
  const rnd = mulberry32(seed);
  const used = new Set();
  const plan = [];
  const gaps = [];
  let prev = null;

  for (const s of segments) {
    const need = s.minutes * 60;
    let have = 0;
    const picks = [];
    while (have < need - 45) {
      let bestT = null, bestScore = Infinity;
      for (const t of pool) {
        if (used.has(t.id) || !t.bpm || !t.duration) continue;
        const eb = effectiveBpm(t.bpm, s.bpm, halfDouble);
        const bd = Math.abs(eb - s.bpm);
        if (bd > tolerance) continue;
        const ed = t.energy ? Math.abs(t.energy - s.energy) : 1.5;
        if (ed > energyTol) continue;
        let sc = bd + ed * 2;
        if (prev) {
          const pb = effectiveBpm(prev.bpm, s.bpm, halfDouble);
          sc += Math.max(0, Math.abs(eb - pb) - 3) * 0.5;
          if (prev.energy && t.energy) sc += Math.max(0, Math.abs(t.energy - prev.energy) - 1) * 1.5;
          if (prev.artist === t.artist) sc += 2;
        }
        if (instrumental && t.instr != null) sc += (1 - t.instr) * 3;
        if (t.duration > need - have + 90) sc += 1; // avoid long overshoot
        sc += rnd() * 1.5 * variety;
        if (sc < bestScore) { bestScore = sc; bestT = t; }
      }
      if (!bestT) break;
      used.add(bestT.id);
      picks.push(bestT);
      have += bestT.duration;
      prev = bestT;
    }
    plan.push({ segment: s, tracks: picks, seconds: have });
    if (have < need - 45) gaps.push({ index: plan.length - 1, segment: s, missing: need - have });
  }
  return { plan, gaps, total: plan.reduce((a, p) => a + p.seconds, 0) };
}
