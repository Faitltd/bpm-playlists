<script>
  import { onMount } from 'svelte';
  import { ui, init, refreshPlaylists, selectPlaylist, persist, notify, DEFAULT_ACTIVITIES } from './lib/state.svelte.js';
  import { openUrl } from './lib/bridge.js';
  import PlaylistView from './PlaylistView.svelte';
  import MatchPanel from './MatchPanel.svelte';
  import SessionView from './SessionView.svelte';
  import FindView from './FindView.svelte';

  let search = $state('');
  let showSettings = $state(false);
  let showActivities = $state(false);
  let draft = $state(null);

  const filteredPlaylists = $derived(
    ui.playlists.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()))
  );

  onMount(init);

  function openSettings() {
    const s = ui.settings;
    draft = { tolerance: s.tolerance, energyTol: s.energyTol, halfDouble: s.halfDouble, unknownName: s.unknownName, perSource: s.perSource };
    showSettings = true;
  }

  function saveSettingsDraft() {
    Object.assign(ui.settings, {
      tolerance: Math.max(1, Math.min(20, Math.round(Number(draft.tolerance) || 5))),
      energyTol: Math.max(1, Math.min(5, Math.round(Number(draft.energyTol) || 2))),
      halfDouble: !!draft.halfDouble,
      unknownName: draft.unknownName.trim(),
      perSource: !!draft.perSource
    });
    persist();
    showSettings = false;
    notify('Settings saved.');
  }

  function openActivities() {
    draft = structuredClone($state.snapshot(ui.settings.activities));
    showActivities = true;
  }

  function saveActivities() {
    ui.settings.activities = draft
      .filter((a) => a.name.trim())
      .map((a) => ({ name: a.name.trim(), min: Number(a.min) || 0, max: Number(a.max) || 999 }))
      .sort((a, b) => a.min - b.min);
    persist();
    showActivities = false;
    notify('Activities saved.');
  }
</script>

<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <span class="logo">♪</span>
      <span>BPM Playlists</span>
    </div>

    <button class="nav" class:active={ui.view === 'find'} onclick={() => { ui.view = 'find'; ui.seed = null; }}>
      <span class="nav-icon">♩</span> Find by BPM
    </button>
    <button class="nav" class:active={ui.view === 'session'} onclick={() => { ui.view = 'session'; ui.seed = null; }}>
      <span class="nav-icon">◎</span> Build a session
    </button>

    <input class="search" placeholder="Search playlists" bind:value={search} />
    <div class="pl-head">
      <span>Playlists</span>
      <button class="link" onclick={refreshPlaylists} disabled={!!ui.busy} title="Reload from Music">Refresh</button>
    </div>
    <ul class="pl-list">
      {#each filteredPlaylists as p (p.id)}
        <li>
          <button class="pl" class:active={ui.view === 'playlist' && p.id === ui.selectedId} class:generated={/^BPM|^Session:/.test(p.name)} onclick={() => selectPlaylist(p.id)}>
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
    {#if ui.view === 'find'}
      <FindView />
    {:else if ui.view === 'session'}
      <SessionView />
    {:else if !ui.selectedId}
      <div class="empty">
        <h1>Pick a playlist</h1>
        <p>Choose a playlist on the left to see each song's BPM and energy, type a tempo in <b>Find by BPM</b>, or click <b>Build a session</b> to plan a run, class or party from your library.</p>
      </div>
    {:else}
      <PlaylistView />
    {/if}
  </main>

  {#if ui.seed}
    <MatchPanel />
  {/if}
</div>

<footer class="status">
  {#if ui.busy}
    <span class="spinner"></span>
    <span>{ui.busy}{ui.progress ? ' · ' + ui.progress.done + ' of ' + ui.progress.total : ''}</span>
    {#if ui.progress?.total}
      <span class="bar"><span style="width: {(ui.progress.done / ui.progress.total) * 100}%"></span></span>
    {/if}
  {:else}
    <span class="muted">Ready</span>
  {/if}
  <span class="spacer"></span>
  <button class="link muted" onclick={() => openUrl('https://reccobeats.com')}>Audio analysis by ReccoBeats</button>
  <span class="muted">·</span>
  <button class="link muted" onclick={() => openUrl('https://www.deezer.com')}>Song data from Deezer</button>
</footer>

{#if ui.toast}
  <div class="toast" class:error={ui.toast.kind === 'error'}>
    <span>{ui.toast.text}</span>
    <button class="link" onclick={() => (ui.toast = null)}>Dismiss</button>
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
      <label>
        Match within ± energy levels (1 to 10 scale)
        <input type="number" min="1" max="5" bind:value={draft.energyTol} />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={draft.halfDouble} />
        Count half and double tempo as a match
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={draft.perSource} />
        Add the source playlist's name to activity playlists
      </label>
      <label>
        Playlist name for songs without BPM (leave empty to skip)
        <input type="text" bind:value={draft.unknownName} />
      </label>
      <p class="hint">Analysis results are stored on this Mac in Library/Application Support/BPM Playlists.</p>
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
