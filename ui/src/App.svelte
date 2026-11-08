<script>
  import { onMount } from 'svelte';
  import { ui, init, persist, notify, DEFAULT_ACTIVITIES } from './lib/state.svelte.js';
  import { openUrl } from './lib/bridge.js';
  import FindView from './FindView.svelte';
  import SessionView from './SessionView.svelte';
  import PlaylistView from './PlaylistView.svelte';
  import MatchPanel from './MatchPanel.svelte';
  import SetlistView from './SetlistView.svelte';

  let showSettings = $state(false);
  let draft = $state(null);

  onMount(() => { ui.view = 'find'; init(); });

  const TABS = [
    { id: 'find', label: 'Find' },
    { id: 'session', label: 'Session' },
    { id: 'playlist', label: 'Playlists' },
    { id: 'setlist', label: 'Setlist' }
  ];

  function go(id) { ui.view = id; ui.seed = null; }

  function openSettings() {
    const s = ui.settings;
    draft = {
      tolerance: s.tolerance, energyTol: s.energyTol, halfDouble: s.halfDouble, unknownName: s.unknownName, perSource: s.perSource,
      activities: structuredClone($state.snapshot(s.activities))
    };
    showSettings = true;
  }

  function saveSettings() {
    Object.assign(ui.settings, {
      tolerance: Math.max(1, Math.min(20, Math.round(Number(draft.tolerance) || 5))),
      energyTol: Math.max(1, Math.min(5, Math.round(Number(draft.energyTol) || 2))),
      halfDouble: !!draft.halfDouble,
      unknownName: draft.unknownName.trim(),
      perSource: !!draft.perSource,
      activities: draft.activities.filter((a) => a.name.trim())
        .map((a) => ({ name: a.name.trim(), min: Number(a.min) || 0, max: Number(a.max) || 999 })).sort((a, b) => a.min - b.min)
    });
    persist();
    showSettings = false;
    notify('Saved.');
  }
</script>

<header class="top">
  <span class="brand"><span class="logo">♪</span></span>
  <nav class="tabs">
    {#each TABS as t (t.id)}
      <button class="tab" class:active={ui.view === t.id} onclick={() => go(t.id)}>{t.label}</button>
    {/each}
  </nav>
  <span class="spacer"></span>
  {#if ui.busy}
    <span class="busy"><span class="spinner"></span>{ui.busy}{ui.progress ? ' ' + ui.progress.done + '/' + ui.progress.total : ''}</span>
  {/if}
  <button class="gear" onclick={openSettings} title="Settings">⚙</button>
</header>

<div class="body">
  <main class="main">
    {#if ui.view === 'find'}<FindView />
    {:else if ui.view === 'session'}<SessionView />
    {:else if ui.view === 'setlist'}<SetlistView />
    {:else}<PlaylistView />{/if}
  </main>
  {#if ui.seed}<MatchPanel />{/if}
</div>

{#if ui.toast}
  <div class="toast" class:error={ui.toast.kind === 'error'}>
    <span>{ui.toast.text}</span>
    <button class="link" onclick={() => (ui.toast = null)}>OK</button>
  </div>
{/if}

{#if showSettings}
  <div class="modal-bg" role="presentation" onclick={(e) => e.target === e.currentTarget && (showSettings = false)}>
    <div class="modal">
      <h2>Settings</h2>
      <div class="two">
        <label>Match within ± BPM <input type="number" min="1" max="20" bind:value={draft.tolerance} /></label>
        <label>Within ± energy (1 to 10) <input type="number" min="1" max="5" bind:value={draft.energyTol} /></label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={draft.halfDouble} /> Count half and double tempo as a match</label>

      <h3>Split by BPM range</h3>
      <p class="hint">Used by "Split by BPM" on the Playlists tab. Min included, max excluded.</p>
      <div class="act-grid">
        {#each draft.activities as a, i (i)}
          <input type="text" bind:value={a.name} />
          <input type="number" bind:value={a.min} />
          <input type="number" bind:value={a.max} />
          <button class="link" onclick={() => draft.activities.splice(i, 1)}>Remove</button>
        {/each}
      </div>
      <div class="row">
        <button class="small" onclick={() => draft.activities.push({ name: 'BPM: New', min: 100, max: 120 })}>Add range</button>
        <button class="small" onclick={() => (draft.activities = structuredClone(DEFAULT_ACTIVITIES))}>Reset</button>
      </div>
      <label class="check"><input type="checkbox" bind:checked={draft.perSource} /> Add the source playlist's name to each</label>
      <label>Playlist for songs without BPM (blank to skip) <input type="text" bind:value={draft.unknownName} /></label>

      <p class="hint">
        Analysis by <button class="link" onclick={() => openUrl('https://reccobeats.com')}>ReccoBeats</button>, song data from
        <button class="link" onclick={() => openUrl('https://www.deezer.com')}>Deezer</button>. Results are stored on this Mac.
      </p>
      <div class="modal-actions">
        <button onclick={() => (showSettings = false)}>Cancel</button>
        <button class="primary" onclick={saveSettings}>Save</button>
      </div>
    </div>
  </div>
{/if}
