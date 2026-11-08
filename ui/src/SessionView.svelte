<script>
  import { untrack } from 'svelte';
  import { ui, task, notify, ensureLibrary, reloadPlaylistsQuiet, fmtTime } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10, analyzeMany, stats } from './lib/analysis.svelte.js';
  import { PRESETS, presetSegments, fillSession, effectiveBpm } from './lib/session.js';
  import { recommend } from './lib/recommend.js';
  import { openInAppleMusic } from './lib/online.js';
  import { startPolling } from './lib/player.svelte.js';
  import SongRow from './SongRow.svelte';

  let presetId = $state('run');
  let length = $state(45);
  let targetBpm = $state(160);
  let more = $state(false);
  let sourceIds = $state([]);
  let sourceTrackIds = $state(null);
  let genres = $state([]);
  let segments = $state([]);
  let touched = $state(false);
  let seed = $state(1);
  let result = $state(null);
  let name = $state('Session: Run');
  let gapRecs = $state({});

  const preset = $derived(PRESETS.find((p) => p.id === presetId));
  const userPlaylists = $derived(ui.playlists.filter((p) => !p.smart && !/^BPM|^Session:/.test(p.name)));

  $effect(() => { untrack(() => { ensureLibrary(); startPolling(); }); });
  $effect(() => { if (!touched) segments = presetSegments(preset, length, targetBpm); });
  $effect(() => {
    const ids = [...sourceIds];
    if (!ids.length) { sourceTrackIds = null; return; }
    (async () => {
      const set = new Set();
      for (const id of ids) { try { for (const t of await music('tracks', { playlistId: id })) set.add(t.id); } catch (e) {} }
      sourceTrackIds = set;
    })();
  });

  function choose(p) {
    presetId = p.id; length = p.length; targetBpm = p.targetBpm; touched = false; result = null; gapRecs = {};
    if (PRESETS.some((x) => name === 'Session: ' + x.name)) name = 'Session: ' + p.name;
  }

  const pool = $derived.by(() => {
    const g = new Set(genres);
    return (ui.libIndex || [])
      .filter((t) => (!sourceTrackIds || sourceTrackIds.has(t.id)) && (!g.size || g.has(t.genre || '')))
      .map((t) => { const r = rec(t.id); return { ...t, bpm: t.bpm || r?.tempo || 0, energy: energy10(r), instr: r?.instr ?? null }; });
  });
  const poolStats = $derived(stats(pool.map((t) => t.id)));
  const poolTodo = $derived(pool.filter((t) => !rec(t.id) || (rec(t.id).miss && !t.bpm)));
  const genreCounts = $derived.by(() => {
    const m = new Map();
    for (const t of ui.libIndex || []) if (!sourceTrackIds || sourceTrackIds.has(t.id)) m.set(t.genre || '', (m.get(t.genre || '') || 0) + 1);
    return [...m.entries()].filter(([g]) => g).sort((a, b) => b[1] - a[1]).slice(0, 20);
  });
  const planned = $derived(segments.reduce((a, s) => a + s.minutes, 0));

  const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function analyzePool() {
    const list = poolTodo;
    await task('Analyzing', async () => {
      ui.progress = { done: 0, total: list.length };
      await analyzeMany(list, (done, total) => (ui.progress = { done, total }));
      notify('Analyzed ' + list.length + ' songs.');
    });
  }

  function build() {
    if (!pool.length) return notify('No songs to draw from.', 'error');
    gapRecs = {};
    result = fillSession($state.snapshot(segments), pool, {
      tolerance: ui.settings.tolerance, energyTol: ui.settings.energyTol, halfDouble: ui.settings.halfDouble,
      instrumental: !!preset.instrumental, seed
    });
  }
  function shuffle() { seed = (seed % 100000) + 17; build(); }
  function remove(pi, ti) { const p = result.plan[pi]; const t = p.tracks[ti]; p.tracks.splice(ti, 1); p.seconds -= t.duration; result.total -= t.duration; }

  async function create() {
    const ids = result.plan.flatMap((p) => p.tracks.map((t) => t.id));
    if (!ids.length) return;
    await task('Creating playlist', async () => {
      const r = await music('buildOrdered', { name: name.trim() || 'Session', ids });
      notify('Created "' + r.name + '" in Music with ' + r.count + ' songs.');
      await reloadPlaylistsQuiet();
    });
  }

  function seedArtists(seg) {
    const hd = ui.settings.halfDouble;
    const d = (t) => Math.abs(effectiveBpm(t.bpm, seg.bpm, hd) - seg.bpm) + (t.energy ? Math.abs(t.energy - seg.energy) * 2 : 3);
    return [...pool].filter((t) => t.bpm).sort((a, b) => d(a) - d(b)).map((t) => t.artist).filter((a, i, arr) => a && arr.indexOf(a) === i).slice(0, 3);
  }

  async function findForGap(gap) {
    const i = gap.index;
    gapRecs[i] = { state: 'loading', list: [], done: 0, total: 0, error: '' };
    const seeds = seedArtists(gap.segment);
    if (!seeds.length) { gapRecs[i] = { state: 'error', list: [], error: 'Analyze some songs first.' }; return; }
    try {
      const list = await recommend({
        targetBpm: gap.segment.bpm, targetEnergy: gap.segment.energy, seedArtists: seeds,
        tolerance: ui.settings.tolerance, energyTol: ui.settings.energyTol, halfDouble: ui.settings.halfDouble, library: ui.libIndex || []
      }, (l, done, total) => { gapRecs[i] = { ...gapRecs[i], list: l, done, total }; });
      gapRecs[i] = { state: 'done', list, done: list.length, total: list.length, error: '' };
    } catch (e) { gapRecs[i] = { state: 'error', list: [], error: e.message }; }
  }

  // Chart
  const W = 1000, H = 90;
  const chart = $derived.by(() => {
    const total = Math.max(1, result ? Math.max(result.total, planned * 60) : planned * 60);
    let x = 0;
    const segs = segments.map((s) => { const w = (s.minutes * 60 / total) * W; const o = { ...s, x, w }; x += w; return o; });
    const bars = [];
    if (result) { let tx = 0; for (const p of result.plan) for (const t of p.tracks) { const w = (t.duration / total) * W; bars.push({ x: tx, w, h: ((t.energy || 1) / 10) * (H - 20), t }); tx += w; } }
    return { segs, bars };
  });
</script>

<div class="bar wrap">
  {#each PRESETS as p (p.id)}
    <button class="chip" class:on={p.id === presetId} onclick={() => choose(p)}>{p.icon} {p.name}</button>
  {/each}
</div>

<div class="bar">
  <label class="inl">Length <input type="number" min="5" max="300" bind:value={length} onchange={() => (touched = false)} /> min</label>
  <label class="inl">Target <input type="number" min="40" max="220" bind:value={targetBpm} onchange={() => (touched = false)} /> BPM</label>
  <button class="link" onclick={() => (more = !more)}>{more ? 'Fewer options' : 'More options'}</button>
  <span class="spacer"></span>
  {#if ui.libIndex && poolTodo.length}
    <button onclick={analyzePool} disabled={!!ui.busy} title="Analyze songs so they can be placed by energy">Analyze {poolTodo.length}</button>
  {/if}
  <button class="primary" onclick={build} disabled={!ui.libIndex || !!ui.busy}>Build</button>
</div>

{#if more}
  <div class="more">
    <div class="opt"><span class="lbl">Songs from</span>
      <div class="chips">
        <button class="chip sm" class:on={!sourceIds.length} onclick={() => (sourceIds = [])}>Whole library</button>
        {#each userPlaylists as p (p.id)}<button class="chip sm" class:on={sourceIds.includes(p.id)} onclick={() => (sourceIds = toggleIn(sourceIds, p.id))}>{p.name}</button>{/each}
      </div>
    </div>
    {#if genreCounts.length > 1}
      <div class="opt"><span class="lbl">Genres</span>
        <div class="chips">
          <button class="chip sm" class:on={!genres.length} onclick={() => (genres = [])}>All</button>
          {#each genreCounts as [g, n] (g)}<button class="chip sm" class:on={genres.includes(g)} onclick={() => (genres = toggleIn(genres, g))}>{g} <span class="muted">{n}</span></button>{/each}
        </div>
      </div>
    {/if}
    <div class="opt"><span class="lbl">Segments</span>
      <div class="seg-grid">
        {#each segments as s, i (i)}
          <input type="text" bind:value={s.name} oninput={() => (touched = true)} />
          <input type="number" min="1" bind:value={s.minutes} oninput={() => (touched = true)} title="Minutes" />
          <input type="number" min="40" max="220" bind:value={s.bpm} oninput={() => (touched = true)} title="BPM" />
          <input type="number" min="1" max="10" bind:value={s.energy} oninput={() => (touched = true)} title="Energy 1 to 10" />
          <button class="link" onclick={() => { segments.splice(i, 1); touched = true; }}>✕</button>
        {/each}
      </div>
      <div class="row">
        <button class="small" onclick={() => { segments.push({ name: 'Part ' + (segments.length + 1), minutes: 10, bpm: targetBpm, energy: 6 }); touched = true; }}>Add segment</button>
        <button class="small" onclick={() => (touched = false)}>Reset</button>
        <span class="hint">name · minutes · BPM · energy</span>
      </div>
    </div>
    <div class="opt"><span class="lbl">Name</span><input type="text" bind:value={name} /></div>
    <p class="hint">{pool.length} songs to draw from, {poolStats.analyzed} analyzed. {preset.hint}</p>
  </div>
{/if}

<svg class="chart" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-label="Session curve">
  {#each chart.segs as s (s.name + s.x)}
    <rect x={s.x} y="0" width={s.w} height={H} class="seg-bg" />
    <rect x={s.x} y={H - 16 - ((s.energy / 10) * (H - 20))} width={s.w} height="2" class="seg-line" />
    <text x={s.x + 6} y="13" class="seg-label">{s.name} · {s.bpm}</text>
  {/each}
  {#each chart.bars as b, i (i)}
    <rect x={b.x + 1} y={H - 16 - b.h} width={Math.max(1, b.w - 2)} height={b.h} class="barr" style="--h: {Math.round(210 - (((b.t.energy || 1) - 1) / 9) * 210)}">
      <title>{b.t.name} · {b.t.bpm} BPM · energy {b.t.energy || '?'}</title>
    </rect>
  {/each}
</svg>

<div class="list">
  {#if !result}
    <p class="note">Pick a preset and click Build. Songs are chosen so tempo and energy move smoothly.</p>
  {:else}
    <div class="bar">
      <span>{fmtTime(result.total)} filled of {planned} min{result.gaps.length ? ' · ' + result.gaps.length + ' gaps' : ''}</span>
      <span class="spacer"></span>
      <button onclick={shuffle}>Shuffle</button>
      <button class="primary" onclick={create} disabled={!!ui.busy}>Create in Music</button>
    </div>
    {#each result.plan as p, pi (pi)}
      {@const gap = result.gaps.find((g) => g.index === pi)}
      <h3 class="seg-h">{p.segment.name} <span class="muted">{p.segment.bpm} BPM · energy {p.segment.energy} · {fmtTime(p.seconds)}</span></h3>
      {#each p.tracks as t, ti (t.id)}
        <SongRow id={t.id} title={t.name} sub={t.artist} bpm={t.bpm} energy={t.energy} fav={t.fav}
          bpmNote={Math.round(effectiveBpm(t.bpm, p.segment.bpm, ui.settings.halfDouble)) !== t.bpm ? '→' + Math.round(effectiveBpm(t.bpm, p.segment.bpm, ui.settings.halfDouble)) : ''}>
          <button class="link" onclick={() => remove(pi, ti)} title="Remove">✕</button>
        </SongRow>
      {/each}
      {#if gap}
        {@const gr = gapRecs[pi]}
        <div class="gap">
          <span>Missing {Math.round(gap.missing / 60)} min near {gap.segment.bpm} BPM.</span>
          {#if !gr}<button class="small" onclick={() => findForGap(gap)}>Find songs</button>
          {:else if gr.state === 'loading'}<span class="hint">{gr.total ? 'Checking ' + gr.done + ' of ' + gr.total : 'Finding similar artists...'}</span>
          {:else if gr.state === 'error'}<span class="hint error">{gr.error}</span>{/if}
          {#if gr?.list?.length}
            {#each gr.list.slice(0, 12) as r (r.key)}
              <SongRow previewKey={r.key} previewUrl={r.url} title={r.title} sub={r.artist} bpm={r.bpm} energy={r.energy}>
                <button class="small" onclick={() => openInAppleMusic(r.title, r.artist)}>Open</button>
              </SongRow>
            {/each}
            <span class="hint">Add in Apple Music, then Build again.</span>
          {:else if gr?.state === 'done'}<span class="hint">Nothing found. Widen the ranges in Settings.</span>{/if}
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .inl { display: flex; align-items: center; gap: 6px; }
  .inl input { width: 70px; }
  .more { padding: 6px 16px 10px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
  .opt { display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: start; }
  .lbl { font-size: 12px; color: var(--muted); padding-top: 5px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .seg-grid { display: grid; grid-template-columns: 1fr 70px 70px 70px auto; gap: 5px 6px; align-items: center; }
  .chart { width: calc(100% - 32px); margin: 10px 16px 0; height: 90px; border-radius: 8px; background: var(--card); border: 1px solid var(--line); flex-shrink: 0; }
  .seg-bg { fill: transparent; stroke: var(--line); }
  .seg-line { fill: var(--muted); opacity: 0.6; }
  .seg-label { font-size: 11px; fill: var(--muted); }
  .barr { fill: hsl(var(--h) 80% 50% / 0.55); }
  .seg-h { padding: 14px 10px 4px; }
  .gap { margin: 6px 10px; padding: 8px 10px; border: 1px dashed var(--warn); border-radius: 8px; display: flex; flex-direction: column; gap: 6px; }
  .gap > span:first-child { color: var(--warn); font-weight: 500; }
</style>
