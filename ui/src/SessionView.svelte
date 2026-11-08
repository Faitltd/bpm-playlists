<script>
  import { untrack } from 'svelte';
  import { ui, task, notify, ensureLibrary, reloadPlaylistsQuiet, fmtTime } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10, analyzeMany, stats } from './lib/analysis.svelte.js';
  import { PRESETS, presetSegments, fillSession, effectiveBpm } from './lib/session.js';
  import { recommend } from './lib/recommend.js';
  import { openInAppleMusic } from './lib/online.js';
  import EnergyBadge from './EnergyBadge.svelte';

  let presetId = $state('run');
  let length = $state(45);
  let targetBpm = $state(160);
  let sourceIds = $state([]); // empty = whole library
  let sourceTrackIds = $state(null); // Set of ids when sourceIds set
  let genres = $state([]); // empty = all
  let segments = $state([]);
  let segmentsTouched = $state(false);
  let showSegments = $state(false);
  let variety = $state(1);
  let shuffleSeed = $state(1);
  let result = $state(null);
  let name = $state('');
  let gapRecs = $state({}); // index -> { state, list, done, total, error }

  const preset = $derived(PRESETS.find((p) => p.id === presetId));
  const userPlaylists = $derived(ui.playlists.filter((p) => !p.smart && !/^BPM|^Session:/.test(p.name)));

  // Rebuild segments from the preset unless the user edited them.
  $effect(() => {
    if (!segmentsTouched) segments = presetSegments(preset, length, targetBpm);
  });

  function choosePreset(p) {
    presetId = p.id;
    length = p.length;
    targetBpm = p.targetBpm;
    segmentsTouched = false;
    result = null;
    gapRecs = {};
    if (!name || PRESETS.some((x) => name === 'Session: ' + x.name)) name = 'Session: ' + p.name;
  }

  $effect(() => { untrack(() => ensureLibrary()); });
  $effect(() => { if (!name) name = 'Session: ' + preset.name; });

  // Load track ids for chosen source playlists.
  $effect(() => {
    const ids = [...sourceIds];
    if (!ids.length) { sourceTrackIds = null; return; }
    (async () => {
      const set = new Set();
      for (const id of ids) {
        try { for (const t of await music('tracks', { playlistId: id })) set.add(t.id); } catch (e) {}
      }
      sourceTrackIds = set;
    })();
  });

  const pool = $derived.by(() => {
    const lib = ui.libIndex || [];
    const g = new Set(genres);
    return lib
      .filter((t) => (!sourceTrackIds || sourceTrackIds.has(t.id)) && (!g.size || g.has(t.genre || '')))
      .map((t) => {
        const r = rec(t.id);
        return { ...t, bpm: t.bpm || r?.tempo || 0, energy: energy10(r), instr: r?.instr ?? null };
      });
  });
  const poolStats = $derived(stats(pool.map((t) => t.id)));
  const poolTodo = $derived(pool.filter((t) => !rec(t.id) || (rec(t.id).miss && !t.bpm)));
  const genreCounts = $derived.by(() => {
    const lib = ui.libIndex || [];
    const m = new Map();
    for (const t of lib) if (!sourceTrackIds || sourceTrackIds.has(t.id)) m.set(t.genre || '', (m.get(t.genre || '') || 0) + 1);
    return [...m.entries()].filter(([g]) => g).sort((a, b) => b[1] - a[1]).slice(0, 24);
  });
  const planned = $derived(segments.reduce((a, s) => a + s.minutes, 0));

  function toggleGenre(g) {
    genres = genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g];
  }
  function toggleSource(id) {
    sourceIds = sourceIds.includes(id) ? sourceIds.filter((x) => x !== id) : [...sourceIds, id];
  }

  async function analyzePool() {
    const list = poolTodo;
    await task('Analyzing songs', async () => {
      ui.progress = { done: 0, total: list.length };
      await analyzeMany(list, (done, total) => (ui.progress = { done, total }));
      notify('Analyzed ' + list.length + ' songs.');
    });
  }

  function build() {
    if (!pool.length) return notify('No songs in the source. Pick another source or genre.', 'error');
    gapRecs = {};
    result = fillSession($state.snapshot(segments), pool, {
      tolerance: ui.settings.tolerance, energyTol: ui.settings.energyTol, halfDouble: ui.settings.halfDouble,
      instrumental: !!preset.instrumental, seed: shuffleSeed, variety
    });
  }

  function reshuffle() {
    shuffleSeed = (shuffleSeed % 100000) + 17;
    build();
  }

  function removeTrack(pi, ti) {
    const p = result.plan[pi];
    const t = p.tracks[ti];
    p.tracks.splice(ti, 1);
    p.seconds -= t.duration;
    result.total -= t.duration;
  }

  async function createInMusic() {
    const ids = result.plan.flatMap((p) => p.tracks.map((t) => t.id));
    if (!ids.length) return notify('Nothing to add yet.', 'error');
    await task('Creating playlist', async () => {
      const r = await music('buildOrdered', { name: name.trim() || 'Session', ids });
      notify('Created "' + r.name + '" with ' + r.count + ' songs in Music.');
      await reloadPlaylistsQuiet();
    });
  }

  function seedArtistsFor(seg) {
    // Artists in the pool closest to this segment's target.
    const hd = ui.settings.halfDouble;
    return [...pool]
      .filter((t) => t.bpm)
      .sort((a, b) => {
        const da = Math.abs(effectiveBpm(a.bpm, seg.bpm, hd) - seg.bpm) + (a.energy ? Math.abs(a.energy - seg.energy) * 2 : 3);
        const db = Math.abs(effectiveBpm(b.bpm, seg.bpm, hd) - seg.bpm) + (b.energy ? Math.abs(b.energy - seg.energy) * 2 : 3);
        return da - db;
      })
      .map((t) => t.artist)
      .filter((a, i, arr) => a && arr.indexOf(a) === i)
      .slice(0, 3);
  }

  async function findForGap(gap) {
    const idx = gap.index;
    gapRecs[idx] = { state: 'loading', list: [], done: 0, total: 0, error: '' };
    const seeds = seedArtistsFor(gap.segment);
    if (!seeds.length) { gapRecs[idx] = { state: 'error', error: 'Analyze some songs first so I know what you like.' }; return; }
    try {
      const list = await recommend({
        targetBpm: gap.segment.bpm, targetEnergy: gap.segment.energy, seedArtists: seeds,
        tolerance: ui.settings.tolerance, energyTol: ui.settings.energyTol, halfDouble: ui.settings.halfDouble,
        library: ui.libIndex || []
      }, (l, done, total) => { gapRecs[idx] = { ...gapRecs[idx], list: l, done, total }; });
      gapRecs[idx] = { state: 'done', list, done: list.length, total: list.length, error: '' };
    } catch (e) {
      gapRecs[idx] = { state: 'error', list: [], error: e.message };
    }
  }

  // Chart geometry
  const W = 1000, H = 110;
  const chart = $derived.by(() => {
    const total = Math.max(1, result ? Math.max(result.total, planned * 60) : planned * 60);
    let x = 0;
    const segs = segments.map((s) => {
      const w = (s.minutes * 60 / total) * W;
      const o = { ...s, x, w };
      x += w;
      return o;
    });
    const bars = [];
    if (result) {
      let tx = 0;
      for (const p of result.plan) {
        for (const t of p.tracks) {
          const w = (t.duration / total) * W;
          bars.push({ x: tx, w, h: ((t.energy || 1) / 10) * (H - 22), t, seg: p.segment });
          tx += w;
        }
      }
    }
    return { segs, bars };
  });
</script>

<header class="main-head">
  <div>
    <h1>Build a session</h1>
    <p class="sub">Pick a purpose. The app shapes a tempo and energy curve and fills it from your library with smooth transitions.</p>
  </div>
</header>

<div class="session">
  <div class="presets">
    {#each PRESETS as p (p.id)}
      <button class="preset" class:active={p.id === presetId} onclick={() => choosePreset(p)}>
        <span class="preset-icon">{p.icon}</span>{p.name}
      </button>
    {/each}
  </div>
  <p class="hint">{preset.hint}</p>

  <div class="controls-row">
    <label>Length <span class="unit">min</span>
      <input type="number" min="5" max="300" bind:value={length} onchange={() => { segmentsTouched = false; }} />
    </label>
    <label>Target BPM
      <input type="number" min="40" max="220" bind:value={targetBpm} onchange={() => { segmentsTouched = false; }} />
    </label>
    <label>Variety
      <input type="range" min="0" max="3" step="1" bind:value={variety} />
    </label>
    <label>Playlist name
      <input type="text" bind:value={name} />
    </label>
  </div>

  <div class="source">
    <div class="source-col">
      <h3>Songs from</h3>
      <div class="chips">
        <button class="chip" class:on={!sourceIds.length} onclick={() => (sourceIds = [])}>Whole library</button>
        {#each userPlaylists as p (p.id)}
          <button class="chip" class:on={sourceIds.includes(p.id)} onclick={() => toggleSource(p.id)}>{p.name}</button>
        {/each}
      </div>
    </div>
    {#if genreCounts.length > 1}
      <div class="source-col">
        <h3>Genres <button class="link" onclick={() => (genres = [])} disabled={!genres.length}>all</button></h3>
        <div class="chips">
          {#each genreCounts as [g, n] (g)}
            <button class="chip" class:on={genres.includes(g)} onclick={() => toggleGenre(g)}>{g} <span class="muted">{n}</span></button>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <div class="pool-bar">
    {#if !ui.libIndex}
      <span class="muted">Reading library...</span>
    {:else}
      <span><b>{pool.length}</b> songs in the pool · {poolStats.analyzed} analyzed
        {#if poolTodo.length}· <span class="warn">{poolTodo.length} not yet</span>{/if}
        {#if poolStats.missing && !poolTodo.length}· {poolStats.missing} not found online{/if}</span>
      {#if poolTodo.length}
        <button class="small" onclick={analyzePool} disabled={!!ui.busy}>Analyze {poolTodo.length}</button>
        <span class="hint">About {Math.ceil(poolTodo.length * 3 / 60)} min. Songs without analysis are placed by BPM only.</span>
      {/if}
    {/if}
    <span class="spacer"></span>
    <button class="link" onclick={() => (showSegments = !showSegments)}>{showSegments ? 'Hide' : 'Edit'} segments ({segments.length}, {planned} min)</button>
  </div>

  {#if showSegments}
    <div class="seg-grid">
      <span class="act-label">Segment</span><span class="act-label">Minutes</span><span class="act-label">BPM</span><span class="act-label">Energy 1–10</span><span></span>
      {#each segments as s, i (i)}
        <input type="text" bind:value={s.name} oninput={() => (segmentsTouched = true)} />
        <input type="number" min="1" bind:value={s.minutes} oninput={() => (segmentsTouched = true)} />
        <input type="number" min="40" max="220" bind:value={s.bpm} oninput={() => (segmentsTouched = true)} />
        <input type="number" min="1" max="10" bind:value={s.energy} oninput={() => (segmentsTouched = true)} />
        <button class="link" onclick={() => { segments.splice(i, 1); segmentsTouched = true; }}>Remove</button>
      {/each}
    </div>
    <div class="row">
      <button class="small" onclick={() => { segments.push({ name: 'Part ' + (segments.length + 1), minutes: 10, bpm: targetBpm, energy: 6 }); segmentsTouched = true; }}>Add segment</button>
      <button class="small" onclick={() => { segmentsTouched = false; }}>Reset to preset</button>
    </div>
  {/if}

  <div class="row build-row">
    <button class="primary" onclick={build} disabled={!ui.libIndex || !!ui.busy}>Build session</button>
    {#if result}
      <button onclick={reshuffle}>Shuffle picks</button>
      <button class="primary" onclick={createInMusic} disabled={!!ui.busy}>Create in Music</button>
      <span class="muted">{fmtTime(result.total)} of {planned} min filled{result.gaps.length ? ' · ' + result.gaps.length + ' gaps' : ''}</span>
    {/if}
  </div>

  <svg class="chart" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-label="Session curve">
    {#each chart.segs as s (s.name + s.x)}
      <rect x={s.x} y="0" width={s.w} height={H} class="seg-bg" />
      <rect x={s.x} y={H - 18 - ((s.energy / 10) * (H - 22))} width={s.w} height="2" class="seg-line" />
      <text x={s.x + 6} y="13" class="seg-label">{s.name} · {s.bpm} · e{s.energy}</text>
    {/each}
    {#each chart.bars as b, i (i)}
      <rect x={b.x + 1} y={H - 18 - b.h} width={Math.max(1, b.w - 2)} height={b.h} class="bar" style="--h: {Math.round(210 - (((b.t.energy || 1) - 1) / 9) * 210)}">
        <title>{b.t.name} · {b.t.artist} · {b.t.bpm} BPM · energy {b.t.energy || '?'}</title>
      </rect>
    {/each}
  </svg>

  {#if result}
    <div class="plan">
      {#each result.plan as p, pi (pi)}
        {@const gap = result.gaps.find((g) => g.index === pi)}
        <section class="plan-seg">
          <h3>{p.segment.name} <span class="muted">· target {p.segment.bpm} BPM, energy {p.segment.energy} · {fmtTime(p.seconds)} of {p.segment.minutes} min</span></h3>
          {#if p.tracks.length}
            <ol class="plan-list">
              {#each p.tracks as t, ti (t.id)}
                <li class="rec">
                  <span class="rec-text">
                    <span class="rec-title">{t.name}</span>
                    <span class="rec-sub">{t.artist} · {t.genre}</span>
                  </span>
                  <span class="muted">{fmtTime(t.duration)}</span>
                  <EnergyBadge level={t.energy} />
                  <span class="badge" title={effectiveBpm(t.bpm, p.segment.bpm, ui.settings.halfDouble) !== t.bpm ? 'Plays as ' + Math.round(effectiveBpm(t.bpm, p.segment.bpm, ui.settings.halfDouble)) : ''}>{t.bpm}</span>
                  <button class="link" onclick={() => removeTrack(pi, ti)} title="Remove">✕</button>
                </li>
              {/each}
            </ol>
          {/if}
          {#if gap}
            {@const gr = gapRecs[pi]}
            <div class="gap">
              <span>Missing {Math.round(gap.missing / 60)} min near {gap.segment.bpm} BPM, energy {gap.segment.energy}.</span>
              {#if !gr}
                <button class="small" onclick={() => findForGap(gap)}>Find songs to add</button>
              {:else if gr.state === 'loading'}
                <span class="hint">{gr.total ? 'Analyzing ' + gr.done + ' of ' + gr.total + '...' : 'Finding similar artists...'}</span>
              {:else if gr.state === 'error'}
                <span class="hint error">{gr.error}</span>
              {/if}
              {#if gr?.list?.length}
                <ul class="recs">
                  {#each gr.list.slice(0, 15) as r (r.key)}
                    <li class="rec">
                      <span class="rec-text">
                        <span class="rec-title">{r.title}</span>
                        <span class="rec-sub">{r.artist} · {r.reason}</span>
                      </span>
                      <EnergyBadge level={r.energy} />
                      <button class="small" onclick={() => openInAppleMusic(r.title, r.artist)}>Open</button>
                    </li>
                  {/each}
                </ul>
                <p class="hint">Add songs in Apple Music, then click Refresh in the sidebar and build again.</p>
              {:else if gr?.state === 'done'}
                <span class="hint">Nothing found online for this spot. Widen the ranges in Settings.</span>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .session { padding: 14px 22px 40px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px; }
  .presets { display: flex; gap: 8px; flex-wrap: wrap; }
  .preset { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 9px; }
  .preset.active { background: var(--sel); border-color: var(--accent); color: var(--accent); font-weight: 600; }
  .preset-icon { font-size: 15px; }
  .controls-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
  .controls-row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
  .controls-row input[type='number'] { width: 90px; }
  .controls-row input[type='text'] { width: 220px; }
  .controls-row input[type='range'] { accent-color: var(--accent); padding: 0; border: none; background: none; width: 110px; }
  .unit { font-weight: 400; }
  .source { display: flex; gap: 24px; flex-wrap: wrap; }
  .source-col { flex: 1; min-width: 280px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { padding: 3px 10px; border-radius: 999px; font-size: 12px; }
  .chip.on { background: var(--sel); border-color: var(--accent); color: var(--accent); }
  .pool-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .seg-grid { display: grid; grid-template-columns: 1fr 90px 90px 110px auto; gap: 6px 8px; align-items: center; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .chart { width: 100%; height: 110px; border-radius: 8px; background: var(--card); border: 1px solid var(--line); }
  .seg-bg { fill: transparent; stroke: var(--line); stroke-width: 1; }
  .seg-line { fill: var(--muted); opacity: 0.6; }
  .seg-label { font-size: 11px; fill: var(--muted); }
  .bar { fill: hsl(var(--h) 80% 50% / 0.55); }
  .plan { display: flex; flex-direction: column; gap: 14px; }
  .plan-seg h3 { margin-bottom: 6px; }
  .plan-list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
  .plan-list li + li { border-top: 1px solid var(--line); }
  .gap { margin-top: 8px; padding: 10px 12px; border: 1px dashed var(--warn); border-radius: 8px; display: flex; flex-direction: column; gap: 8px; }
  .gap > span:first-child { color: var(--warn); font-weight: 500; }
</style>
