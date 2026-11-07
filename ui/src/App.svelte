<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { music, loadSettings, saveSettings, openUrl } from './lib/bridge.js';
  import { genreScore } from './lib/genre.js';
  import { findSong, measurePreviews, recommend, openInAppleMusic } from './lib/online.js';

  const DEFAULT_ACTIVITIES = [
    { name: 'BPM: Relax', min: 0, max: 90 },
    { name: 'BPM: Yoga', min: 90, max: 110 },
    { name: 'BPM: Walk', min: 110, max: 125 },
    { name: 'BPM: Workout', min: 125, max: 140 },
    { name: 'BPM: Run', min: 140, max: 160 },
    { name: 'BPM: HIIT', min: 160, max: 999 }
  ];

  let settings = $state({
    tolerance: 5,
    halfDouble: true,
    unknownName: 'BPM: Unknown',
    perSource: true,
    activities: structuredClone(DEFAULT_ACTIVITIES)
  });

  let playlists = $state([]);
  let selectedId = $state(null);
  let tracks = $state([]);
  let search = $state('');
  let sortKey = $state('bpm');
  let sortDir = $state(1);

  let busy = $state('');
  let progress = $state(null);
  let toast = $state(null);
  let toastTimer;

  let showSettings = $state(false);
  let showActivities = $state(false);
  let draft = $state(null);

  let seed = $state(null);
  let libIndex = $state(null);
  let libPicked = new SvelteSet();
  let addTarget = $state(null);
  let onlineRecs = $state([]);
  let onlineState = $state('idle'); // idle | loading | done | error
  let onlineError = $state('');
  let onlineProgress = $state(null);

  const selected = $derived(playlists.find((p) => p.id === selectedId));
  const filteredPlaylists = $derived(
    playlists.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
  );
  const sortedTracks = $derived(
    [...tracks].sort((a, b) => {
      const k = sortKey;
      let r;
      if (k === 'bpm') r = (a.bpm || 9999) - (b.bpm || 9999);
      else r = String(a[k] || '').localeCompare(String(b[k] || ''));
      return r * sortDir;
    })
  );
  const missingCount = $derived(tracks.filter((t) => !t.bpm).length);
  const measurableMissing = $derived(tracks.filter((t) => !t.bpm && t.canMeasure).length);
  const playlistIds = $derived(new Set(tracks.map((t) => t.id)));
  const userPlaylists = $derived(playlists.filter((p) => !p.smart));

  const libRecs = $derived.by(() => {
    if (!seed || !libIndex) return [];
    return libIndex
      .filter((t) => t.bpm > 0 && !playlistIds.has(t.id) && t.id !== seed.id)
      .map((t) => ({ ...t, g: genreScore(seed.genre, t.genre), d: dist(t.bpm, seed.bpm) }))
      .filter((t) => t.g >= 2 && t.d <= settings.tolerance)
      .sort((a, b) => b.g - a.g || a.d - b.d)
      .slice(0, 100);
  });

  const libNoBpm = $derived.by(() => {
    if (!seed || !libIndex) return [];
    return libIndex.filter((t) => !t.bpm && !playlistIds.has(t.id) && genreScore(seed.genre, t.genre) >= 2);
  });

  function dist(a, b) {
    const opts = settings.halfDouble ? [b, b * 2, b / 2] : [b];
    return Math.min(...opts.map((v) => Math.abs(a - v)));
  }

  function fmtTime(s) {
    if (!s) return '';
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function notify(text, kind = 'ok') {
    toast = { text, kind };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), kind === 'error' ? 9000 : 5000);
  }

  async function task(label, fn) {
    if (busy) return;
    busy = label;
    try {
      await fn();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      busy = '';
      progress = null;
    }
  }

  function persist() {
    saveSettings($state.snapshot(settings)).catch(() => {});
  }

  onMount(async () => {
    const saved = await loadSettings();
    Object.assign(settings, saved);
    if (!Array.isArray(settings.activities) || !settings.activities.length) {
      settings.activities = structuredClone(DEFAULT_ACTIVITIES);
    }
    await refreshPlaylists();
  });

  async function refreshPlaylists() {
    await task('Loading playlists', async () => {
      playlists = await music('playlists');
      if (selectedId && !playlists.some((p) => p.id === selectedId)) selectedId = null;
    });
    if (selectedId) await loadTracks();
  }

  async function selectPlaylist(id) {
    if (busy) return;
    selectedId = id;
    seed = null;
    addTarget = id;
    await loadTracks();
  }

  async function loadTracks() {
    if (!selectedId) return;
    await task('Loading songs', async () => {
      tracks = await music('tracks', { playlistId: selectedId });
    });
  }

  function setSort(k) {
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = 1; }
  }

  async function saveBpm(t, value) {
    const bpm = Math.round(Number(value) || 0);
    if (bpm === t.bpm) return;
    try {
      const r = await music('setBpm', { id: t.id, bpm });
      t.bpm = r.bpm;
      if (libIndex) {
        const li = libIndex.find((x) => x.id === t.id);
        if (li) li.bpm = r.bpm;
      }
      if (seed && seed.id === t.id) seed.bpm = r.bpm;
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  async function measureMissing() {
    await task('Measuring BPM from audio', async () => {
      const todo = tracks.filter((t) => !t.bpm && t.canMeasure);
      progress = { done: 0, total: todo.length };
      let ok = 0;
      for (const t of todo) {
        try {
          const r = await music('detect', { id: t.id });
          if (r.bpm) { t.bpm = r.bpm; ok++; }
        } catch (e) { /* skip this song */ }
        progress.done++;
      }
      notify('Measured ' + ok + ' of ' + todo.length + ' songs.');
    });
  }

  // Find each song on Deezer; use Deezer's BPM if it has one, otherwise measure the preview.
  async function lookupMissing(list, label) {
    await task(label, async () => {
      progress = { done: 0, total: list.length };
      const found = [];
      const toMeasure = [];
      for (const t of list) {
        try {
          const hit = await findSong(t.name, t.artist);
          if (hit?.bpm) { t.bpm = hit.bpm; found.push({ id: t.id, bpm: hit.bpm }); progress.done++; }
          else if (hit?.preview) toMeasure.push({ key: t.id, url: hit.preview, t });
          else progress.done++;
        } catch (e) {
          if (/Too many/i.test(e.message)) throw e;
          progress.done++;
        }
        if (found.length >= 20) await music('setBpms', { items: found.splice(0) });
      }
      await measurePreviews(toMeasure, (res) => {
        for (const r of res) {
          const item = toMeasure.find((x) => x.key === r.key);
          if (item && r.bpm) { item.t.bpm = r.bpm; found.push({ id: item.t.id, bpm: r.bpm }); }
          progress.done++;
        }
      });
      if (found.length) await music('setBpms', { items: found });
      const total = list.filter((t) => t.bpm).length;
      notify('Found BPM for ' + total + ' of ' + list.length + ' songs. Saved to Music. Check any that look off.');
    });
    // keep playlist rows and library index in sync
    if (libIndex) for (const t of tracks) {
      const li = libIndex.find((x) => x.id === t.id);
      if (li && t.bpm) li.bpm = t.bpm;
    }
  }

  async function buildActivities() {
    await task('Building activity playlists', async () => {
      const suffix = settings.perSource ? ' (' + selected.name + ')' : '';
      const res = await music('buildActivities', {
        playlistId: selectedId,
        activities: $state.snapshot(settings.activities).map((a) => ({ ...a, name: a.name + suffix })),
        unknownName: settings.unknownName ? settings.unknownName + suffix : ''
      });
      notify(res.length ? 'Created ' + res.map((r) => r.name + ' (' + r.count + ')').join(', ') : 'No songs matched any activity.');
      playlists = await music('playlists');
    });
  }

  async function openMatch(t) {
    seed = t;
    libPicked.clear();
    onlineRecs = [];
    onlineState = 'idle';
    onlineError = '';
    if (!libIndex) {
      await task('Reading your library', async () => {
        libIndex = await music('libraryIndex');
      });
    }
  }

  async function buildMatch() {
    if (!seed?.bpm) return notify('Give this song a BPM first.', 'error');
    await task('Creating match playlist', async () => {
      const r = await music('buildMatch', {
        playlistId: selectedId, seedId: seed.id, tolerance: settings.tolerance, halfDouble: settings.halfDouble
      });
      notify('Created "' + r.name + '" with ' + r.count + ' songs.');
      playlists = await music('playlists');
    });
  }

  async function addPicked() {
    if (!addTarget || !libPicked.size) return;
    const ids = [...libPicked];
    const target = playlists.find((p) => p.id === addTarget);
    await task('Adding songs', async () => {
      const r = await music('addTracks', { playlistId: addTarget, ids });
      notify('Added ' + r.added + ' songs to "' + (target?.name || 'playlist') + '".');
      libPicked.clear();
      playlists = await music('playlists');
      if (addTarget === selectedId) tracks = await music('tracks', { playlistId: selectedId });
    });
  }

  async function loadOnline() {
    if (!seed?.bpm) return notify('Give this song a BPM first.', 'error');
    const forSeed = seed.id;
    onlineState = 'loading';
    onlineError = '';
    onlineRecs = [];
    onlineProgress = null;
    try {
      const res = await recommend($state.snapshot(seed), {
        tolerance: settings.tolerance,
        halfDouble: settings.halfDouble,
        excludeKeys: (libIndex || []).map((t) => ({ name: t.name, artist: t.artist }))
      }, (list, done, total) => {
        if (seed?.id !== forSeed) return;
        onlineRecs = list;
        onlineProgress = { done, total };
      });
      if (seed?.id !== forSeed) return;
      onlineRecs = res;
      onlineState = 'done';
    } catch (e) {
      if (seed?.id !== forSeed) return;
      onlineError = e.message;
      onlineState = 'error';
    }
  }

  function openSettings() {
    draft = { tolerance: settings.tolerance, halfDouble: settings.halfDouble, unknownName: settings.unknownName, perSource: settings.perSource };
    showSettings = true;
  }

  function saveSettingsDraft() {
    Object.assign(settings, {
      tolerance: Math.max(1, Math.min(20, Math.round(Number(draft.tolerance) || 5))),
      halfDouble: !!draft.halfDouble,
      unknownName: draft.unknownName.trim(),
      perSource: !!draft.perSource
    });
    persist();
    showSettings = false;
    notify('Settings saved.');
  }

  function openActivities() {
    draft = structuredClone($state.snapshot(settings.activities));
    showActivities = true;
  }

  function saveActivities() {
    settings.activities = draft
      .filter((a) => a.name.trim())
      .map((a) => ({ name: a.name.trim(), min: Number(a.min) || 0, max: Number(a.max) || 999 }))
      .sort((a, b) => a.min - b.min);
    persist();
    showActivities = false;
    notify('Activities saved.');
  }

  function toggleLib(id) {
    if (libPicked.has(id)) libPicked.delete(id);
    else libPicked.add(id);
  }
</script>

<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <span class="logo">♪</span>
      <span>BPM Playlists</span>
    </div>
    <input class="search" placeholder="Search playlists" bind:value={search} />
    <div class="pl-head">
      <span>Playlists</span>
      <button class="link" onclick={refreshPlaylists} disabled={!!busy} title="Reload from Music">Refresh</button>
    </div>
    <ul class="pl-list">
      {#each filteredPlaylists as p (p.id)}
        <li>
          <button class="pl" class:active={p.id === selectedId} class:generated={p.name.startsWith('BPM')} onclick={() => selectPlaylist(p.id)}>
            <span class="pl-name">{p.name}</span>
            <span class="pl-count">{p.count}</span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="side-foot">
      <button class="ghost" onclick={openActivities}>Activities</button>
      <button class="ghost" onclick={openSettings}>Settings</button>
    </div>
  </aside>

  <main class="main">
    {#if !selected}
      <div class="empty">
        <h1>Pick a playlist</h1>
        <p>Choose a playlist on the left to see each song's BPM, build activity playlists, or find songs that match.</p>
      </div>
    {:else}
      <header class="main-head">
        <div>
          <h1>{selected.name}</h1>
          <p class="sub">
            {tracks.length} songs
            {#if missingCount}· <span class="warn">{missingCount} without BPM</span>{/if}
          </p>
        </div>
        <div class="actions">
          {#if measurableMissing}
            <button onclick={measureMissing} disabled={!!busy}>Measure {measurableMissing} from audio</button>
          {/if}
          {#if missingCount}
            <button onclick={() => lookupMissing(tracks.filter((t) => !t.bpm), 'Looking up BPMs online')} disabled={!!busy}>
              Look up {missingCount} BPMs online
            </button>
          {/if}
          <button class="primary" onclick={buildActivities} disabled={!!busy || !tracks.length}>Build activity playlists</button>
        </div>
      </header>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sortable" onclick={() => setSort('name')}>Title {sortKey === 'name' ? (sortDir > 0 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => setSort('artist')}>Artist {sortKey === 'artist' ? (sortDir > 0 ? '↑' : '↓') : ''}</th>
              <th class="sortable" onclick={() => setSort('genre')}>Genre {sortKey === 'genre' ? (sortDir > 0 ? '↑' : '↓') : ''}</th>
              <th class="num">Time</th>
              <th class="sortable num" onclick={() => setSort('bpm')}>BPM {sortKey === 'bpm' ? (sortDir > 0 ? '↑' : '↓') : ''}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each sortedTracks as t (t.id)}
              <tr class:seed={seed?.id === t.id}>
                <td class="title">{t.name}</td>
                <td>{t.artist}</td>
                <td class="muted">{t.genre}</td>
                <td class="num muted">{fmtTime(t.duration)}</td>
                <td class="num">
                  <input
                    class="bpm"
                    class:missing={!t.bpm}
                    type="number"
                    min="0"
                    max="300"
                    value={t.bpm || ''}
                    placeholder="?"
                    onchange={(e) => saveBpm(t, e.currentTarget.value)}
                  />
                </td>
                <td class="num">
                  <button class="small" onclick={() => openMatch(t)} disabled={!!busy}>Match</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </main>

  {#if seed}
    <aside class="panel">
      <div class="panel-head">
        <div>
          <div class="eyebrow">Match</div>
          <h2>{seed.name}</h2>
          <p class="sub">{seed.artist} · {seed.genre || 'No genre'} · {seed.bpm ? seed.bpm + ' BPM' : 'No BPM'}</p>
        </div>
        <button class="link" onclick={() => (seed = null)}>Close</button>
      </div>

      <div class="controls">
        <label>
          Within ±{settings.tolerance} BPM
          <input type="range" min="1" max="15" bind:value={settings.tolerance} onchange={persist} />
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={settings.halfDouble} onchange={persist} />
          Include half and double tempo
        </label>
        <button class="primary block" onclick={buildMatch} disabled={!!busy || !seed.bpm}>
          Create "BPM Match: {seed.name}"
        </button>
        <p class="hint">Uses songs from {selected?.name}.</p>
      </div>

      <section>
        <h3>From your library <span class="count">{libRecs.length}</span></h3>
        {#if !seed.bpm}
          <p class="hint">Type a BPM for this song to see matches.</p>
        {:else if !libIndex}
          <p class="hint">Reading library...</p>
        {:else}
          {#if libRecs.length}
            <ul class="recs">
              {#each libRecs as r (r.id)}
                <li>
                  <label class="rec">
                    <input type="checkbox" checked={libPicked.has(r.id)} onchange={() => toggleLib(r.id)} />
                    <span class="rec-text">
                      <span class="rec-title">{r.name}</span>
                      <span class="rec-sub">{r.artist} · {r.genre}</span>
                    </span>
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
              <button onclick={addPicked} disabled={!!busy || !libPicked.size}>Add {libPicked.size || ''}</button>
            </div>
          {:else}
            <p class="hint">No library songs in a similar genre with a matching BPM yet.</p>
          {/if}
          {#if libNoBpm.length}
            <p class="hint">
              {libNoBpm.length} library songs in a similar genre have no BPM.
              <button class="link" disabled={!!busy} onclick={() => lookupMissing(libNoBpm.slice(0, 150), 'Looking up library BPMs')}>
                Look up {Math.min(150, libNoBpm.length)} online
              </button>
            </p>
          {/if}
        {/if}
      </section>

      <section>
        <h3>New songs to add {#if onlineState === 'done'}<span class="count">{onlineRecs.length}</span>{/if}</h3>
        {#if onlineState === 'idle'}
          <button class="block" onclick={loadOnline} disabled={!seed.bpm}>Find songs online</button>
          <p class="hint">Top songs by artists similar to {seed.artist}, measured and kept if the BPM matches. Takes about a minute.</p>
        {:else if onlineState === 'error'}
          <p class="hint error">{onlineError}</p>
          <button class="block" onclick={loadOnline}>Try again</button>
        {:else}
          {#if onlineState === 'loading'}
            <p class="hint">
              {onlineProgress ? 'Measuring ' + onlineProgress.done + ' of ' + onlineProgress.total + ' songs...' : 'Finding similar artists...'}
            </p>
          {/if}
          {#if onlineRecs.length}
            <ul class="recs">
              {#each onlineRecs as r (r.key)}
                <li class="rec">
                  <span class="rec-text">
                    <span class="rec-title">{r.title}</span>
                    <span class="rec-sub">{r.artist}</span>
                  </span>
                  <span class="badge">{r.bpm}</span>
                  <button class="small" onclick={() => openInAppleMusic(r.title, r.artist)}>Open</button>
                </li>
              {/each}
            </ul>
            <p class="hint">Open shows the song in Apple Music. Click + there to add it to your library.</p>
          {:else if onlineState === 'done'}
            <p class="hint">No songs by similar artists matched this BPM. Try a wider range.</p>
          {/if}
          {#if onlineState === 'done'}
            <button class="block" onclick={loadOnline}>Search again</button>
          {/if}
        {/if}
      </section>
    </aside>
  {/if}
</div>

<footer class="status">
  {#if busy}
    <span class="spinner"></span>
    <span>{busy}{progress ? ' · ' + progress.done + ' of ' + progress.total : ''}</span>
    {#if progress?.total}
      <span class="bar"><span style="width: {(progress.done / progress.total) * 100}%"></span></span>
    {/if}
  {:else}
    <span class="muted">Ready</span>
  {/if}
  <span class="spacer"></span>
  <button class="link muted" onclick={() => openUrl('https://www.deezer.com')}>Song data from Deezer</button>
</footer>

{#if toast}
  <div class="toast" class:error={toast.kind === 'error'}>
    <span>{toast.text}</span>
    <button class="link" onclick={() => (toast = null)}>Dismiss</button>
  </div>
{/if}

{#if showSettings}
  <div class="modal-bg" role="presentation" onclick={(e) => e.target === e.currentTarget && (showSettings = false)}>
    <div class="modal">
      <h2>Settings</h2>
      <label>
        Match within ± BPM
        <input type="number" min="1" max="20" bind:value={draft.tolerance} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={draft.halfDouble} />
        Include half and double tempo in matches
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={draft.perSource} />
        Add the source playlist's name to activity playlists
      </label>
      <label>
        Playlist name for songs without BPM (leave empty to skip)
        <input type="text" bind:value={draft.unknownName} />
      </label>
      <p class="hint">Online lookups use the free Deezer and Apple iTunes Search services. No account needed.</p>
      <div class="modal-actions">
        <button onclick={() => (showSettings = false)}>Cancel</button>
        <button class="primary" onclick={saveSettingsDraft}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if showActivities}
  <div class="modal-bg" role="presentation" onclick={(e) => e.target === e.currentTarget && (showActivities = false)}>
    <div class="modal wide">
      <h2>Activities</h2>
      <p class="hint">Each activity becomes a playlist. A song goes in when its BPM is at least the minimum and below the maximum.</p>
      <div class="act-grid">
        <span class="act-label">Playlist name</span><span class="act-label">Min BPM</span><span class="act-label">Max BPM</span><span></span>
        {#each draft as a, i (i)}
          <input type="text" bind:value={a.name} />
          <input type="number" bind:value={a.min} />
          <input type="number" bind:value={a.max} />
          <button class="link" onclick={() => draft.splice(i, 1)}>Remove</button>
        {/each}
      </div>
      <button onclick={() => draft.push({ name: 'BPM: New', min: 100, max: 120 })}>Add activity</button>
      <div class="modal-actions">
        <button onclick={() => (draft = structuredClone(DEFAULT_ACTIVITIES))}>Reset</button>
        <span class="spacer"></span>
        <button onclick={() => (showActivities = false)}>Cancel</button>
        <button class="primary" onclick={saveActivities}>Save</button>
      </div>
    </div>
  </div>
{/if}
