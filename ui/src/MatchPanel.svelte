<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { ui, task, notify, reloadPlaylistsQuiet } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10, analyzeTrack } from './lib/analysis.svelte.js';
  import { genreScore } from './lib/genre.js';
  import { recommend } from './lib/recommend.js';
  import { openInAppleMusic } from './lib/online.js';
  import { effectiveBpm } from './lib/session.js';
  import SongRow from './SongRow.svelte';

  const seed = $derived(ui.seed);
  const seedEnergy = $derived(energy10(rec(seed.id)));
  const inPlaylist = $derived(new Set(ui.tracks.map((t) => t.id)));
  const userPlaylists = $derived(ui.playlists.filter((p) => !p.smart));

  let picked = new SvelteSet();
  let addTarget = $state(null);
  let online = $state({ state: 'idle', list: [], done: 0, total: 0, error: '', forId: null });

  $effect(() => { if (!addTarget) addTarget = ui.selectedId; });
  $effect(() => { seed.id; picked.clear(); online = { state: 'idle', list: [], done: 0, total: 0, error: '', forId: null }; });

  const dist = (b) => Math.abs(effectiveBpm(b, seed.bpm, ui.settings.halfDouble) - seed.bpm);

  const libRecs = $derived.by(() => {
    if (!seed?.bpm || !ui.libIndex) return [];
    return ui.libIndex
      .filter((t) => t.bpm > 0 && !inPlaylist.has(t.id) && t.id !== seed.id)
      .map((t) => {
        const e = energy10(rec(t.id));
        const ed = seedEnergy && e ? Math.abs(e - seedEnergy) : 1;
        return { ...t, energy: e, g: genreScore(seed.genre, t.genre), d: dist(t.bpm), ed };
      })
      .filter((t) => t.d <= ui.settings.tolerance && t.ed <= ui.settings.energyTol && (t.g >= 2 || (t.energy && seedEnergy && t.ed <= 1)))
      .sort((a, b) => b.g - a.g || a.d + a.ed * 2 - (b.d + b.ed * 2))
      .slice(0, 60);
  });

  async function analyzeSeed() {
    await task('Analyzing', async () => {
      const r = await analyzeTrack(seed);
      if (!seed.bpm && r.tempo) { await music('setBpm', { id: seed.id, bpm: r.tempo }); seed.bpm = r.tempo; }
      if (r.miss) notify('Not found online. Type its BPM in the list.', 'error');
    });
  }

  async function addPicked() {
    if (!addTarget || !picked.size) return;
    await task('Adding', async () => {
      const r = await music('addTracks', { playlistId: addTarget, ids: [...picked] });
      notify('Added ' + r.added + ' songs.');
      picked.clear();
      await reloadPlaylistsQuiet();
      if (addTarget === ui.selectedId) ui.tracks = await music('tracks', { playlistId: ui.selectedId });
    });
  }

  async function findOnline() {
    const forId = seed.id;
    online = { state: 'loading', list: [], done: 0, total: 0, error: '', forId };
    try {
      const list = await recommend({
        targetBpm: seed.bpm, targetEnergy: seedEnergy, seedArtists: [seed.artist],
        tolerance: ui.settings.tolerance, energyTol: ui.settings.energyTol, halfDouble: ui.settings.halfDouble, library: ui.libIndex || []
      }, (l, done, total) => { if (online.forId === forId) online = { ...online, list: l, done, total }; }, () => online.forId !== forId);
      if (online.forId === forId) online = { ...online, state: 'done', list };
    } catch (e) {
      if (online.forId === forId) online = { ...online, state: 'error', error: e.message };
    }
  }

  function toggle(id) { picked.has(id) ? picked.delete(id) : picked.add(id); }
</script>

<aside class="panel">
  <div class="panel-head">
    <div>
      <div class="eyebrow">Like this</div>
      <h2>{seed.name}</h2>
      <p class="sub">{seed.artist} · {seed.bpm ? seed.bpm + ' BPM' : 'no BPM'}{seedEnergy ? ' · energy ' + seedEnergy : ''}</p>
    </div>
    <button class="link" onclick={() => (ui.seed = null)}>Close</button>
  </div>

  {#if !seed.bpm}
    <button class="block" onclick={analyzeSeed} disabled={!!ui.busy}>Analyze this song</button>
  {:else}
    <section>
      <h3>In your library <span class="count">{libRecs.length}</span></h3>
      {#if !ui.libIndex}
        <p class="hint">Reading library...</p>
      {:else if libRecs.length}
        <div class="recs">
          {#each libRecs as r (r.id)}
            <SongRow id={r.id} title={r.name} sub={r.artist} bpm={r.bpm} energy={r.energy} fav={r.fav}>
              <input type="checkbox" checked={picked.has(r.id)} onchange={() => toggle(r.id)} />
            </SongRow>
          {/each}
        </div>
        <div class="add-row">
          <select bind:value={addTarget}>
            {#each userPlaylists as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          </select>
          <button onclick={addPicked} disabled={!!ui.busy || !picked.size}>Add {picked.size || ''}</button>
        </div>
      {:else}
        <p class="hint">Nothing close in your library yet.</p>
      {/if}
    </section>

    <section>
      <h3>New songs {#if online.state === 'done'}<span class="count">{online.list.length}</span>{/if}</h3>
      {#if online.state === 'idle'}
        <button class="block" onclick={findOnline}>Find songs online</button>
        <p class="hint">By artists similar to {seed.artist}, at this tempo and energy. About a minute.</p>
      {:else if online.state === 'error'}
        <p class="hint error">{online.error}</p>
        <button class="block" onclick={findOnline}>Try again</button>
      {:else}
        {#if online.state === 'loading'}
          <p class="hint">{online.total ? 'Checking ' + online.done + ' of ' + online.total + '...' : 'Finding similar artists...'}</p>
        {/if}
        {#if online.list.length}
          <div class="recs">
            {#each online.list as r (r.key)}
              <SongRow previewKey={r.key} previewUrl={r.url} title={r.title} sub={r.artist} bpm={r.bpm} energy={r.energy}>
                <button class="small" onclick={() => openInAppleMusic(r.title, r.artist)} title="Open in Apple Music to add it">Open</button>
              </SongRow>
            {/each}
          </div>
        {:else if online.state === 'done'}
          <p class="hint">Nothing fit. Widen the ranges in Settings and try again.</p>
        {/if}
      {/if}
    </section>
  {/if}
</aside>
