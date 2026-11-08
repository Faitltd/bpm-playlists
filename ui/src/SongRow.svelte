<script>
  // One song row used by every list.
  import EnergyBadge from './EnergyBadge.svelte';
  import PlayButton from './PlayButton.svelte';
  import { isPlaying, toggleMusic, player, togglePreview } from './lib/player.svelte.js';

  let {
    id = null,          // library track id (plays in Music)
    previewKey = null,  // online candidate (plays preview)
    previewUrl = '',
    title = '', sub = '', bpm = 0, bpmNote = '', energy = 0,
    unsure = false, fav = false, highlight = false,
    onbpm = null,       // (value) => void, makes the BPM editable
    children = null     // trailing controls
  } = $props();

  const playing = $derived(id ? isPlaying(id) : player.previewKey === previewKey);
  function play() {
    if (id) toggleMusic(id);
    else togglePreview(previewKey, previewUrl);
  }
</script>

<div class="row" class:playing class:highlight>
  <PlayButton {playing} onclick={play} title={id ? 'Play in Music' : 'Play preview'} />
  <div class="text">
    <div class="t">{title}{#if fav}<span class="fav">♥</span>{/if}</div>
    {#if sub}<div class="s">{sub}</div>{/if}
  </div>
  {#if onbpm}
    <input class="bpm" class:missing={!bpm} class:unsure type="number" min="0" max="300" value={bpm || ''} placeholder="?"
      title={unsure ? 'Measured, but the clips disagreed. Worth a check.' : ''} onchange={(e) => onbpm(e.currentTarget.value)} />
  {:else}
    <span class="bpmv">{bpm || '–'}{#if bpmNote}<span class="note">{bpmNote}</span>{/if}</span>
  {/if}
  <EnergyBadge level={energy} />
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--line); min-height: 44px; }
  .row:hover { background: var(--hover); }
  .row.highlight { background: var(--sel); }
  .text { flex: 1; min-width: 0; }
  .t, .s { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t { font-weight: 500; }
  .s { color: var(--muted); font-size: 12px; }
  .playing .t { color: var(--accent); }
  .fav { color: var(--accent); margin-left: 6px; font-size: 12px; }
  .bpm { width: 62px; text-align: right; padding: 3px 6px; }
  .bpm.missing { border-color: var(--warn); }
  .bpm.unsure { border-style: dashed; border-color: var(--warn); }
  .bpmv { width: 62px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .note { color: var(--muted); font-weight: 400; font-size: 11px; margin-left: 3px; }
  .extra { display: flex; gap: 6px; align-items: center; }
</style>
