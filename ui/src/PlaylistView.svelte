<script>
  import { untrack } from 'svelte';
  import { ui, task, notify, applyBpm, reloadPlaylistsQuiet, loadTracks, ensureLibrary } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10, analyzeMany, stats } from './lib/analysis.svelte.js';
  import { startPolling } from './lib/player.svelte.js';
  import SongRow from './SongRow.svelte';

  $effect(() => { untrack(() => startPolling()); });

  const selected = $derived(ui.playlists.find((p) => p.id === ui.selectedId));
  const st = $derived(stats(ui.tracks.map((t) => t.id)));
  const todo = $derived(ui.tracks.filter((t) => !rec(t.id) || (rec(t.id).miss && !t.bpm)).length);
  const sorted = $derived([...ui.tracks].sort((a, b) => (a.bpm || 9999) - (b.bpm || 9999)));

  async function choose(e) {
    ui.selectedId = e.currentTarget.value || null;
    ui.seed = null;
    await loadTracks();
  }

  async function saveBpm(t, value) {
    const bpm = Math.round(Number(value) || 0);
    if (bpm === t.bpm) return;
    try { const r = await music('setBpm', { id: t.id, bpm }); applyBpm(t.id, r.bpm); }
    catch (e) { notify(e.message, 'error'); }
  }

  async function analyze() {
    const list = ui.tracks.filter((t) => !rec(t.id) || (rec(t.id).miss && !t.bpm));
    await task('Analyzing', async () => {
      ui.progress = { done: 0, total: list.length };
      await analyzeMany(list, (done, total, t) => { ui.progress = { done, total }; if (t.bpm) applyBpm(t.id, t.bpm); });
      notify('Analyzed ' + list.length + ' songs.');
    });
  }

  async function split() {
    await task('Splitting by BPM', async () => {
      const suffix = ui.settings.perSource ? ' (' + selected.name + ')' : '';
      const res = await music('buildActivities', {
        playlistId: ui.selectedId,
        activities: $state.snapshot(ui.settings.activities).map((a) => ({ ...a, name: a.name + suffix })),
        unknownName: ui.settings.unknownName ? ui.settings.unknownName + suffix : ''
      });
      notify(res.length ? 'Created ' + res.map((r) => r.name + ' (' + r.count + ')').join(', ') : 'No songs matched a range.');
      await reloadPlaylistsQuiet();
    });
  }

  async function match(t) { ui.seed = t; await ensureLibrary(); }
</script>

<div class="bar">
  <select class="pick" value={ui.selectedId || ''} onchange={choose}>
    <option value="">Choose a playlist...</option>
    {#each ui.playlists as p (p.id)}<option value={p.id}>{p.name} ({p.count})</option>{/each}
  </select>
  {#if selected}
    {#if todo}<button onclick={analyze} disabled={!!ui.busy}>Analyze {todo}</button>{/if}
    <span class="spacer"></span>
    <button onclick={split} disabled={!!ui.busy || !ui.tracks.length} title="One playlist per BPM range, set in Settings">Split by BPM</button>
  {/if}
</div>

<div class="list">
  {#if !selected}
    <p class="note">Pick a playlist to see each song's BPM and energy. Click Match on a song to find more like it.</p>
  {:else}
    {#if st.analyzed}<p class="note">{ui.tracks.length} songs, {st.analyzed} analyzed. Click a BPM to correct it.</p>{/if}
    {#each sorted as t (t.id)}
      {@const r = rec(t.id)}
      <SongRow id={t.id} title={t.name} sub={t.artist + (t.genre ? ' · ' + t.genre : '')} bpm={t.bpm} energy={energy10(r)}
        unsure={!!t.bpm && r?.conf === 'low'} highlight={ui.seed?.id === t.id} onbpm={(v) => saveBpm(t, v)}>
        <button class="small" onclick={() => match(t)} disabled={!!ui.busy}>Match</button>
      </SongRow>
    {/each}
  {/if}
</div>

<style>
  .pick { max-width: 360px; }
</style>
