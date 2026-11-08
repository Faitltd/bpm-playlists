<script>
  import { SvelteSet } from 'svelte/reactivity';
  import { ui, task, notify, persist, reloadPlaylistsQuiet } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { rec, energy10, describe, analyzeTrack, analyzeMany } from './lib/analysis.svelte.js';
  import { genreScore } from './lib/genre.js';
  import { recommend } from './lib/recommend.js';
  import { openInAppleMusic } from './lib/online.js';
  import { effectiveBpm } from './lib/session.js';
  import EnergyBadge from './EnergyBadge.svelte';
  import PlayButton from './PlayButton.svelte';
  import { player, isPlaying, toggleMusic, togglePreview } from './lib/player.svelte.js';

  const seed = $derived(ui.seed);
  const seedRec = $derived(rec(seed.id));
  const seedEnergy = $derived(energy10(seedRec));
  const selected = $derived(ui.playlists.find((p) => p.id === ui.selectedId));
  const playlistIds = $derived(new Set(ui.tracks.map((t) => t.id)));
  const userPlaylists = $derived(ui.playlists.filter((p) => !p.smart));

  let picked = new SvelteSet();
  let addTarget = $state(null);
  $effect(() => { if (!addTarget) addTarget = ui.selectedId; });

  let online = $state({ state: 'idle', list: [], done: 0, total: 0, error: '', forId: null });

  // Reset online results when the seed changes.
  $effect(() => {
    seed.id;
    picked.clear();
    online = { state: 'idle', list: [], done: 0, total: 0, error: '', forId: null };
  });

  const dist = (bpm) => Math.abs(effectiveBpm(bpm, seed.bpm, ui.settings.halfDouble) - seed.bpm);

  const libRecs = $derived.by(() => {
    if (!seed?.bpm || !ui.libIndex) return [];
    return ui.libIndex
      .filter((t) => t.bpm > 0 && !playlistIds.has(t.id) && t.id !== seed.id)
      .map((t) => {
        const e = energy10(rec(t.id));
        const g = genreScore(seed.genre, t.genre);
        const ed = seedEnergy && e ? Math.abs(e - seedEnergy) : 1;
        return { ...t, energy: e, g, d: dist(t.bpm), ed };
      })
      .filter((t) => t.d <= ui.settings.tolerance && t.ed <= ui.settings.energyTol && (t.g >= 2 || (t.energy && seedEnergy && t.ed <= 1)))
      .sort((a, b) => b.g - a.g || a.d + a.ed * 2 - (b.d + b.ed * 2))
      .slice(0, 100);
  });

  const libUnanalyzed = $derived.by(() => {
    if (!seed || !ui.libIndex) return [];
    return ui.libIndex.filter((t) => !playlistIds.has(t.id) && !rec(t.id) && genreScore(seed.genre, t.genre) >= 2);
  });

  async function analyzeSeed() {
    await task('Analyzing ' + seed.name, async () => {
      const r = await analyzeTrack(seed);
      if (!seed.bpm && r.tempo) {
        await music('setBpm', { id: seed.id, bpm: r.tempo });
        seed.bpm = r.tempo;
      }
      if (r.miss) notify('Could not find this song online. Type its BPM in the table.', 'error');
    });
  }

  async function analyzeLibrary() {
    const list = libUnanalyzed.slice(0, 200);
    await task('Analyzing library songs', async () => {
      ui.progress = { done: 0, total: list.length };
      await analyzeMany(list, (done, total) => (ui.progress = { done, total }));
      notify('Analyzed ' + list.length + ' songs.');
    });
  }

  async function buildMatch() {
    if (!seed.bpm) return notify('Give this song a BPM first.', 'error');
    await task('Creating match playlist', async () => {
      const r = await music('buildMatch', {
        playlistId: ui.selectedId, seedId: seed.id, tolerance: ui.settings.tolerance, halfDouble: ui.settings.halfDouble
      });
      notify('Created "' + r.name + '" with ' + r.count + ' songs.');
      await reloadPlaylistsQuiet();
    });
  }

  async function addPicked() {
    if (!addTarget || !picked.size) return;
    const ids = [...picked];
    const target = ui.playlists.find((p) => p.id === addTarget);
    await task('Adding songs', async () => {
      const r = await music('addTracks', { playlistId: addTarget, ids });
      notify('Added ' + r.added + ' songs to "' + (target?.name || 'playlist') + '".');
      picked.clear();
      await reloadPlaylistsQuiet();
      if (addTarget === ui.selectedId) ui.tracks = await music('tracks', { playlistId: ui.selectedId });
    });
  }

  async function findOnline() {
    if (!seed.bpm) return notify('Give this song a BPM first.', 'error');
    const forId = seed.id;
    online = { state: 'loading', list: [], done: 0, total: 0, error: '', forId };
    try {
      const list = await recommend({
        targetBpm: seed.bpm, targetEnergy: seedEnergy, seedArtists: [seed.artist],
        tolerance: ui.settings.tolerance, energyTol: ui.settings.energyTol, halfDouble: ui.settings.halfDouble,
        library: ui.libIndex || []
      }, (l, done, total) => {
        if (online.forId === forId) online = { ...online, list: l, done, total };
      }, () => online.forId !== forId);
      if (online.forId === forId) online = { ...online, state: 'done', list };
    } catch (e) {
      if (online.forId === forId) online = { ...online, state: 'error', error: e.message };
    }
  }

  function toggle(id) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
  }
</script>

<aside class="panel">
  <div class="panel-head">
    <div>
      <div class="eyebrow">Match</div>
      <h2>{seed.name}</h2>
      <p class="sub">{seed.artist} · {seed.genre || 'No genre'}</p>
      <p class="sub">
        {seed.bpm ? seed.bpm + ' BPM' : 'No BPM'}
        {#if seedRec && !seedRec.miss}· <EnergyBadge level={seedEnergy} /> {describe(seedRec)}{/if}
      </p>
    </div>
    <button class="link" onclick={() => (ui.seed = null)}>Close</button>
  </div>

  {#if !seedRec || seedRec.miss || !seed.bpm}
    <button class="block" onclick={analyzeSeed} disabled={!!ui.busy}>Analyze this song</button>
  {/if}

  <div class="controls">
    <label>
      Within ±{ui.settings.tolerance} BPM
      <input type="range" min="1" max="15" bind:value={ui.settings.tolerance} onchange={persist} />
    </label>
    <label>
      Within ±{ui.settings.energyTol} energy
      <input type="range" min="1" max="5" bind:value={ui.settings.energyTol} onchange={persist} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={ui.settings.halfDouble} onchange={persist} />
      Count half and double tempo
    </label>
    <button class="primary block" onclick={buildMatch} disabled={!!ui.busy || !seed.bpm}>
      Create "BPM Match: {seed.name}"
    </button>
    <p class="hint">From songs in {selected?.name}.</p>
  </div>

  <section>
    <h3>From your library <span class="count">{libRecs.length}</span></h3>
    {#if !seed.bpm}
      <p class="hint">Analyze this song or type its BPM to see matches.</p>
    {:else if !ui.libIndex}
      <p class="hint">Reading library...</p>
    {:else}
      {#if libRecs.length}
        <ul class="recs">
          {#each libRecs as r (r.id)}
            <li>
              <label class="rec">
                <input type="checkbox" checked={picked.has(r.id)} onchange={() => toggle(r.id)} />
                <PlayButton playing={isPlaying(r.id)} onclick={(e) => { e.preventDefault(); toggleMusic(r.id); }} title="Play in Music" />
                <span class="rec-text">
                  <span class="rec-title">{r.name}</span>
                  <span class="rec-sub">{r.artist} · {r.genre}</span>
                </span>
                <EnergyBadge level={r.energy} />
                <span class="badge">{r.bpm}</span>
              </label>
            </li>
          {/each}
        </ul>
        <div class="add-row">
          <select bind:value={addTarget}>
            {#each userPlaylists as p (p.id)}
              <option value={p.id}>{p.name}</option>
            {/each}
          </select>
          <button onclick={addPicked} disabled={!!ui.busy || !picked.size}>Add {picked.size || ''}</button>
        </div>
      {:else}
        <p class="hint">No library songs match yet.</p>
      {/if}
      {#if libUnanalyzed.length}
        <p class="hint">
          {libUnanalyzed.length} library songs in a similar genre aren't analyzed.
          <button class="link" disabled={!!ui.busy} onclick={analyzeLibrary}>Analyze {Math.min(200, libUnanalyzed.length)}</button>
        </p>
      {/if}
    {/if}
  </section>

  <section>
    <h3>New songs to add {#if online.state === 'done'}<span class="count">{online.list.length}</span>{/if}</h3>
    {#if online.state === 'idle'}
      <button class="block" onclick={findOnline} disabled={!seed.bpm}>Find songs online</button>
      <p class="hint">Top songs by artists similar to {seed.artist}, analyzed and kept when tempo and energy fit. About a minute.</p>
    {:else if online.state === 'error'}
      <p class="hint error">{online.error}</p>
      <button class="block" onclick={findOnline}>Try again</button>
    {:else}
      {#if online.state === 'loading'}
        <p class="hint">{online.total ? 'Analyzing ' + online.done + ' of ' + online.total + ' songs...' : 'Finding similar artists...'}</p>
      {/if}
      {#if online.list.length}
        <ul class="recs">
          {#each online.list as r (r.key)}
            <li class="rec">
              <PlayButton playing={player.previewKey === r.key} onclick={() => togglePreview(r.key, r.url)} title="Play 30-second preview" />
              <span class="rec-text">
                <span class="rec-title">{r.title}</span>
                <span class="rec-sub">{r.artist} · {r.reason}</span>
              </span>
              <EnergyBadge level={r.energy} />
              <button class="small" onclick={() => openInAppleMusic(r.title, r.artist)}>Open</button>
            </li>
          {/each}
        </ul>
        <p class="hint">Open shows the song in Apple Music. Click + there to add it to your library.</p>
      {:else if online.state === 'done'}
        <p class="hint">Nothing by similar artists fit this tempo and energy. Widen the ranges and try again.</p>
      {/if}
      {#if online.state === 'done'}
        <button class="block" onclick={findOnline}>Search again</button>
      {/if}
    {/if}
  </section>
</aside>
