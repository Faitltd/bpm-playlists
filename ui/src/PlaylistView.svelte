<script>
  import { ui, task, notify, applyBpm, reloadPlaylistsQuiet, fmtTime, ensureLibrary } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { analysis, rec, energy10, mood, analyzeMany, stats } from './lib/analysis.svelte.js';
  import EnergyBadge from './EnergyBadge.svelte';

  let sortKey = $state('bpm');
  let sortDir = $state(1);

  const selected = $derived(ui.playlists.find((p) => p.id === ui.selectedId));
  const sortedTracks = $derived(
    [...ui.tracks].sort((a, b) => {
      let r;
      if (sortKey === 'bpm') r = (a.bpm || 9999) - (b.bpm || 9999);
      else if (sortKey === 'energy') r = (energy10(rec(a.id)) || 99) - (energy10(rec(b.id)) || 99);
      else r = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''));
      return r * sortDir;
    })
  );
  const missingCount = $derived(ui.tracks.filter((t) => !t.bpm).length);
  const unsureCount = $derived(ui.tracks.filter((t) => t.bpm && rec(t.id)?.conf === 'low').length);
  const st = $derived(stats(ui.tracks.map((t) => t.id)));

  function setSort(k) {
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = 1; }
  }

  async function saveBpm(t, value) {
    const bpm = Math.round(Number(value) || 0);
    if (bpm === t.bpm) return;
    try {
      const r = await music('setBpm', { id: t.id, bpm });
      applyBpm(t.id, r.bpm);
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  async function analyze(all = false) {
    const list = ui.tracks.filter((t) => all || !analysis.tracks[t.id] || (analysis.tracks[t.id].miss && !t.bpm));
    if (!list.length) return notify('Every song here is analyzed.');
    await task('Analyzing songs', async () => {
      ui.progress = { done: 0, total: list.length };
      await analyzeMany(list, (done, total, t) => {
        ui.progress = { done, total };
        if (t.bpm) applyBpm(t.id, t.bpm);
      }, { overwrite: all });
      const s = stats(list.map((t) => t.id));
      notify('Analyzed ' + s.analyzed + ' of ' + list.length + ' songs.' + (s.missing ? ' ' + s.missing + ' could not be found online; type their BPM.' : ''));
    });
  }

  async function buildActivities() {
    await task('Building activity playlists', async () => {
      const suffix = ui.settings.perSource ? ' (' + selected.name + ')' : '';
      const res = await music('buildActivities', {
        playlistId: ui.selectedId,
        activities: $state.snapshot(ui.settings.activities).map((a) => ({ ...a, name: a.name + suffix })),
        unknownName: ui.settings.unknownName ? ui.settings.unknownName + suffix : ''
      });
      notify(res.length ? 'Created ' + res.map((r) => r.name + ' (' + r.count + ')').join(', ') : 'No songs matched any activity.');
      await reloadPlaylistsQuiet();
    });
  }

  async function openMatch(t) {
    ui.seed = t;
    await ensureLibrary();
  }
</script>

<header class="main-head">
  <div>
    <h1>{selected.name}</h1>
    <p class="sub">
      {ui.tracks.length} songs
      {#if st.analyzed}· {st.analyzed} analyzed{/if}
      {#if missingCount}· <span class="warn">{missingCount} without BPM</span>{/if}
      {#if unsureCount}· <span class="warn">{unsureCount} BPM worth checking</span>{/if}
    </p>
  </div>
  <div class="actions">
    {#if st.todo || st.missing}
      <button onclick={() => analyze(false)} disabled={!!ui.busy}>Analyze {st.todo + st.missing} songs</button>
    {:else if ui.tracks.length}
      <button onclick={() => analyze(true)} disabled={!!ui.busy} title="Analyze every song again">Re-analyze</button>
    {/if}
    <button class="primary" onclick={buildActivities} disabled={!!ui.busy || !ui.tracks.length}>Build activity playlists</button>
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
        <th class="sortable num" onclick={() => setSort('energy')}>Energy {sortKey === 'energy' ? (sortDir > 0 ? '↑' : '↓') : ''}</th>
        <th>Mood</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each sortedTracks as t (t.id)}
        {@const r = rec(t.id)}
        <tr class:seed={ui.seed?.id === t.id}>
          <td class="title">{t.name}</td>
          <td>{t.artist}</td>
          <td class="muted">{t.genre}</td>
          <td class="num muted">{fmtTime(t.duration)}</td>
          <td class="num">
            <input class="bpm" class:missing={!t.bpm} class:unsure={t.bpm && r?.conf === 'low'} type="number" min="0" max="300" value={t.bpm || ''} placeholder="?"
              title={r?.conf === 'low' ? 'Measured, but the clips disagreed. Worth a check.' : r?.conf === 'high' ? 'Measured, two clips agree' : ''}
              onchange={(e) => saveBpm(t, e.currentTarget.value)} />
          </td>
          <td class="num"><EnergyBadge level={energy10(r)} /></td>
          <td class="muted">{mood(r)}</td>
          <td class="num"><button class="small" onclick={() => openMatch(t)} disabled={!!ui.busy}>Match</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
