<script>
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ui, task, notify, persist, ensureLibrary, reloadPlaylistsQuiet } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10 } from './lib/analysis.svelte.js';
  import { effectiveBpm } from './lib/session.js';
  import { startPolling } from './lib/player.svelte.js';
  import SongRow from './SongRow.svelte';

  let bpm = $state(ui.findBpm || 120);
  let likedOnly = $state(false);
  let picked = new SvelteSet();

  $effect(() => { untrack(() => { ensureLibrary(); startPolling(); }); });
  $effect(() => { ui.findBpm = bpm; });

  const results = $derived.by(() => {
    const target = Number(bpm) || 0;
    if (!target || !ui.libIndex) return [];
    return ui.libIndex
      .filter((t) => t.bpm > 0)
      .map((t) => {
        const eb = Math.round(effectiveBpm(t.bpm, target, ui.settings.halfDouble));
        return { ...t, eb, d: Math.abs(eb - target), energy: energy10(rec(t.id)), like: (t.fav ? 1000 : 0) + Math.min(t.plays || 0, 200) };
      })
      .filter((t) => t.d <= ui.settings.tolerance && (!likedOnly || t.fav || t.plays > 0))
      .sort((a, b) => b.like - a.like || a.d - b.d);
  });

  function toggle(id) { picked.has(id) ? picked.delete(id) : picked.add(id); }

  async function createPlaylist() {
    const ids = (picked.size ? results.filter((t) => picked.has(t.id)) : results).map((t) => t.id);
    if (!ids.length) return;
    await task('Creating playlist', async () => {
      const r = await music('buildOrdered', { name: 'BPM ' + bpm, ids });
      notify('Created "' + r.name + '" in Music with ' + r.count + ' songs.');
      picked.clear();
      await reloadPlaylistsQuiet();
    });
  }
</script>

<div class="bar">
  <label class="big"><input type="number" min="40" max="220" bind:value={bpm} /> BPM</label>
  <label class="rng">±{ui.settings.tolerance} <input type="range" min="1" max="15" bind:value={ui.settings.tolerance} onchange={persist} /></label>
  <label class="check"><input type="checkbox" bind:checked={likedOnly} /> Liked only</label>
  <span class="spacer"></span>
  <button class="primary" onclick={createPlaylist} disabled={!!ui.busy || !results.length}>
    Create playlist{picked.size ? ' (' + picked.size + ')' : ''}
  </button>
</div>

<div class="list">
  {#if !ui.libIndex}
    <p class="note">Reading library...</p>
  {:else if !results.length}
    <p class="note">No songs near {bpm} BPM. Widen the range, or analyze your library on the Session tab.</p>
  {:else}
    <p class="note">{results.length} songs. Favorites and most played first.</p>
    {#each results as t (t.id)}
      <SongRow id={t.id} title={t.name} sub={t.artist} bpm={t.bpm} bpmNote={t.eb !== t.bpm ? '→' + t.eb : ''} energy={t.energy} fav={t.fav}>
        <input type="checkbox" checked={picked.has(t.id)} onchange={() => toggle(t.id)} title="Include in playlist" />
      </SongRow>
    {/each}
  {/if}
</div>

<style>
  .big { display: flex; align-items: baseline; gap: 8px; font-weight: 600; }
  .big input { width: 100px; font-size: 24px; font-weight: 700; text-align: center; padding: 4px 8px; }
  .rng { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .rng input { width: 110px; accent-color: var(--accent); padding: 0; border: none; background: none; }
</style>
