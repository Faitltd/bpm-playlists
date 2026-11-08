<script>
  import { ui, notify, persist, fmtTime } from './lib/state.svelte.js';
  import { music } from './lib/bridge.js';
  import { analysis, energy10, saveSoon } from './lib/analysis.svelte.js';
  import { djOrder, bySpeed, setlistText } from './lib/setlist.js';
  import EnergyBadge from './EnergyBadge.svelte';

  let input = $state('');
  let adding = $state(null); // { done, total }
  let tools = $state(null);
  let installing = $state(false);
  let copied = $state(false);
  let playingUrl = $state(null);

  const list = $derived(analysis.setlist);
  const total = $derived(list.reduce((a, t) => a + (t.duration || 0), 0));

  $effect(() => { music('tools').then((t) => (tools = t)).catch(() => (tools = { ytdlp: null })); });

  function parseLinks(text) {
    return [...new Set((text.match(/https?:\/\/[^\s]+/g) || []).filter((u) => /soundcloud\.com|snd\.sc/.test(u)))];
  }

  async function add() {
    let urls = parseLinks(input);
    if (!urls.length) return notify('Paste SoundCloud links, one per line.', 'error');
    input = '';
    // Expand sets into their tracks.
    const expanded = [];
    for (const u of urls) {
      if (/\/sets\//.test(u)) {
        try { expanded.push(...(await music('soundcloudSet', { url: u })).urls); } catch (e) { expanded.push(u); }
      } else expanded.push(u);
    }
    urls = expanded.filter((u) => !list.some((t) => t.url === u || t.permalink === u));
    if (!urls.length) return notify('Those are already in the setlist.');
    adding = { done: 0, total: urls.length };
    let next = 0;
    async function worker() {
      while (next < urls.length) {
        const u = urls[next++];
        try {
          const r = await music('soundcloud', { url: u });
          if (r.needTools) { tools = { ytdlp: null }; throw new Error('yt-dlp is not installed.'); }
          if (r.error && !r.title) throw new Error(r.error);
          analysis.setlist.push({
            url: u, permalink: r.permalink, title: r.title, artist: r.artist, duration: r.duration, thumbnail: r.thumbnail,
            tempo: r.tempo, conf: r.conf, energy: energy10(r.features), features: r.features || null, note: r.error || ''
          });
          saveSoon();
        } catch (e) {
          notify(e.message, 'error');
        }
        adding = { done: adding.done + 1, total: adding.total };
      }
    }
    await Promise.all([worker(), worker()]);
    adding = null;
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [analysis.setlist[i], analysis.setlist[j]] = [analysis.setlist[j], analysis.setlist[i]];
    saveSoon();
  }
  function remove(i) { analysis.setlist.splice(i, 1); saveSoon(); }
  function clearAll() { analysis.setlist = []; saveSoon(); }
  function order(fn) { analysis.setlist = fn($state.snapshot(analysis.setlist), ui.settings.halfDouble); saveSoon(); }

  async function setBpm(t, v) { t.tempo = Math.round(Number(v) || 0); t.conf = 'user'; saveSoon(); }

  async function copy() {
    try { await navigator.clipboard.writeText(setlistText($state.snapshot(list))); copied = true; setTimeout(() => (copied = false), 2000); }
    catch (e) { notify('Could not copy.', 'error'); }
  }

  async function install() {
    installing = true;
    try {
      const r = await music('installTools');
      if (r.error) notify(r.error, 'error');
      else { tools = r; notify('Installed.'); }
    } catch (e) { notify(e.message, 'error'); }
    installing = false;
  }

  const widget = (t) => 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(t.permalink) +
    '&color=%23fa2d55&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false&visual=false&buying=false&sharing=false&download=false&show_playcount=false';
</script>

<div class="bar">
  <textarea class="links" rows="2" placeholder="Paste SoundCloud links here, one per line (sets work too)" bind:value={input}></textarea>
  <button class="primary" onclick={add} disabled={!!adding || !input.trim() || (tools && !tools.ytdlp)}>Add</button>
</div>

{#if tools && !tools.ytdlp}
  <div class="bar warnbar">
    <span>SoundCloud needs the free tool <b>yt-dlp</b> (and ffmpeg) on this Mac.</span>
    <button onclick={install} disabled={installing}>{installing ? 'Installing...' : 'Install with Homebrew'}</button>
  </div>
{/if}

<div class="bar">
  {#if adding}
    <span class="spinner"></span><span>Fetching and analyzing {adding.done} of {adding.total}. About 15 seconds per song.</span>
  {:else}
    <span class="muted">{list.length} songs{total ? ' · ' + fmtTime(total) : ''}</span>
  {/if}
  <span class="spacer"></span>
  <button onclick={() => order(djOrder)} disabled={list.length < 2}>Order for DJ flow</button>
  <button onclick={() => order(bySpeed)} disabled={list.length < 2}>Slowest first</button>
  <button onclick={copy} disabled={!list.length}>{copied ? 'Copied' : 'Copy setlist'}</button>
  <button class="link" onclick={clearAll} disabled={!list.length}>Clear</button>
</div>

<div class="list">
  {#if !list.length && !adding}
    <p class="note">Paste five SoundCloud links and click Add. Each song is fetched, its BPM measured on the full track, and its energy rated. Then order it for a smooth set and play each one right here.</p>
  {/if}
  {#each list as t, i (t.url)}
    <div class="set-row">
      <div class="num">{i + 1}</div>
      {#if t.thumbnail}<img class="art" src={t.thumbnail} alt="" />{/if}
      <div class="text">
        <div class="t">{t.title}</div>
        <div class="s">{t.artist}{t.duration ? ' · ' + fmtTime(t.duration) : ''}{t.note ? ' · ' + t.note : ''}</div>
        <iframe class="sc" title={t.title} src={widget(t)} height="20" scrolling="no" frameborder="no" allow="autoplay"></iframe>
      </div>
      <input class="bpm" class:missing={!t.tempo} type="number" min="0" max="300" value={t.tempo || ''} placeholder="?" onchange={(e) => setBpm(t, e.currentTarget.value)} title="BPM measured on the full track. Edit if needed." />
      <EnergyBadge level={t.energy} />
      <div class="ctl">
        <button class="link" onclick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
        <button class="link" onclick={() => move(i, 1)} disabled={i === list.length - 1} title="Move down">↓</button>
        <button class="link" onclick={() => remove(i)} title="Remove">✕</button>
      </div>
    </div>
  {/each}
</div>

<style>
  .links { flex: 1; font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; resize: vertical; -webkit-user-select: text; user-select: text; }
  .warnbar { background: var(--sel); }
  .set-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
  .num { width: 22px; text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
  .art { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--hover); }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .t { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc { width: 100%; max-width: 520px; border: 0; height: 20px; border-radius: 4px; }
  .bpm { width: 62px; text-align: right; padding: 3px 6px; }
  .bpm.missing { border-color: var(--warn); }
  .ctl { display: flex; gap: 8px; }
</style>
