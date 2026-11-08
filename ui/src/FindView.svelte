<script>
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { ui, task, notify, persist, ensureLibrary, reloadPlaylistsQuiet, fmtTime } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10, mood } from './lib/analysis.svelte.js';
  import { effectiveBpm } from './lib/session.js';
  import EnergyBadge from './EnergyBadge.svelte';
  import PlayButton from './PlayButton.svelte';
  import { isPlaying, toggleMusic, startPolling } from './lib/player.svelte.js';

  let bpm = $state(ui.findBpm || 120);
  let onlyLiked = $state(false);
  let sortKey = $state('liked'); // liked | closest | plays
  let picked = new SvelteSet();
  let addTarget = $state(null);

  $effect(() => { untrack(() => { ensureLibrary(); startPolling(); }); });
  $effect(() => { ui.findBpm = bpm; });

  const userPlaylists = $derived(ui.playlists.filter((p) => !p.smart));
  const hd = $derived(ui.settings.halfDouble);
  const tol = $derived(ui.settings.tolerance);

  const results = $derived.by(() => {
    const target = Number(bpm) || 0;
    if (!target || !ui.libIndex) return [];
    const rows = ui.libIndex
      .filter((t) => t.bpm > 0)
      .map((t) => {
        const eb = effectiveBpm(t.bpm, target, hd);
        const r = rec(t.id);
        return { ...t, eb: Math.round(eb), d: Math.abs(eb - target), energy: energy10(r), mood: mood(r), like: (t.fav ? 1000 : 0) + (t.rating || 0) * 2 + Math.min(t.plays || 0, 200) };
      })
      .filter((t) => t.d <= tol && (!onlyLiked || t.fav || t.plays > 0 || t.rating > 0));
    const by = {
      liked: (a, b) => b.like - a.like || a.d - b.d,
      closest: (a, b) => a.d - b.d || b.like - a.like,
      plays: (a, b) => (b.plays || 0) - (a.plays || 0) || a.d - b.d
    };
    return rows.sort(by[sortKey]);
  });

  const likedCount = $derived(results.filter((t) => t.fav || t.plays > 0).length);

  function toggle(id) { picked.has(id) ? picked.delete(id) : picked.add(id); }
  function pickAll() { for (const t of results) picked.add(t.id); }

  async function createPlaylist() {
    const ids = (picked.size ? results.filter((t) => picked.has(t.id)) : results).map((t) => t.id);
    if (!ids.length) return;
    await task('Creating playlist', async () => {
      const r = await music('buildOrdered', { name: 'BPM ' + bpm, ids });
      notify('Created "' + r.name + '" with ' + r.count + ' songs.');
      picked.clear();
      await reloadPlaylistsQuiet();
    });
  }

  async function addPicked() {
    if (!addTarget || !picked.size) return;
    const target = ui.playlists.find((p) => p.id === addTarget);
    await task('Adding songs', async () => {
      const r = await music('addTracks', { playlistId: addTarget, ids: [...picked] });
      notify('Added ' + r.added + ' songs to "' + (target?.name || 'playlist') + '".');
      picked.clear();
      await reloadPlaylistsQuiet();
    });
  }
</script>

<header class="main-head">
  <div>
    <h1>Find by BPM</h1>
    <p class="sub">Type a tempo. Songs you've favorited or play most come first.</p>
  </div>
</header>

<div class="find">
  <div class="find-row">
    <label class="big">
      <input type="number" min="40" max="220" bind:value={bpm} class="big-bpm" />
      <span>BPM</span>
    </label>
    <label>Within ±{tol}
      <input type="range" min="1" max="15" bind:value={ui.settings.tolerance} onchange={persist} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={ui.settings.halfDouble} onchange={persist} />
      Count half and double tempo
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={onlyLiked} />
      Only songs I've favorited, rated or played
    </label>
    <label>Sort
      <select bind:value={sortKey}>
        <option value="liked">Liked first</option>
        <option value="closest">Closest BPM</option>
        <option value="plays">Most played</option>
      </select>
    </label>
  </div>

  <div class="find-actions">
    {#if !ui.libIndex}
      <span class="muted">Reading library...</span>
    {:else}
      <span><b>{results.length}</b> songs near {bpm} BPM · {likedCount} you've favorited or played</span>
      <span class="spacer"></span>
      <button class="small" onclick={pickAll} disabled={!results.length}>Select all</button>
      <select bind:value={addTarget}>
        <option value={null}>Add to playlist...</option>
        {#each userPlaylists as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <button onclick={addPicked} disabled={!!ui.busy || !picked.size || !addTarget}>Add {picked.size || ''}</button>
      <button class="primary" onclick={createPlaylist} disabled={!!ui.busy || !results.length}>Create "BPM {bpm}"{picked.size ? ' from ' + picked.size : ''}</button>
    {/if}
  </div>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th class="playcol"></th>
        <th class="pickcol"></th>
        <th>Title</th><th>Artist</th><th>Genre</th>
        <th class="num">Time</th>
        <th class="num">BPM</th>
        <th class="num">Energy</th>
        <th class="num">Plays</th>
        <th>♥</th>
      </tr>
    </thead>
    <tbody>
      {#each results as t (t.id)}
        <tr class:playing={isPlaying(t.id)}>
          <td class="playcol"><PlayButton playing={isPlaying(t.id)} onclick={() => toggleMusic(t.id)} title="Play in Music" /></td>
          <td class="pickcol"><input type="checkbox" checked={picked.has(t.id)} onchange={() => toggle(t.id)} /></td>
          <td class="title">{t.name}</td>
          <td>{t.artist}</td>
          <td class="muted">{t.genre}</td>
          <td class="num muted">{fmtTime(t.duration)}</td>
          <td class="num">{t.bpm}{#if t.eb !== t.bpm}<span class="muted"> → {t.eb}</span>{/if}</td>
          <td class="num"><EnergyBadge level={t.energy} /></td>
          <td class="num muted">{t.plays || ''}</td>
          <td class="fav">{t.fav ? '♥' : t.rating ? '★'.repeat(Math.round(t.rating / 20)) : ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if ui.libIndex && !results.length}
    <p class="empty-note">No songs near {bpm} BPM. Widen the range, or analyze more of your library from <b>Build a session</b>.</p>
  {/if}
</div>

<style>
  .find { padding: 12px 22px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
  .find-row { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
  .find-row label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
  .find-row label.big { flex-direction: row; align-items: baseline; gap: 8px; color: var(--text); font-size: 14px; }
  .big-bpm { width: 110px; font-size: 26px; font-weight: 700; padding: 4px 10px; text-align: center; }
  .find-row input[type='range'] { accent-color: var(--accent); padding: 0; border: none; background: none; width: 120px; }
  .find-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  th.pickcol, td.pickcol { width: 28px; padding-left: 0; padding-right: 0; }
  td.pickcol input { accent-color: var(--accent); }
  .fav { color: var(--accent); }
  .empty-note { padding: 24px; color: var(--muted); text-align: center; }
</style>
