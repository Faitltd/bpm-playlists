<script>
  let { playing = false, onclick, title = '' } = $props();
</script>

<button class="play" class:on={playing} {onclick} title={title || (playing ? 'Pause' : 'Play')} aria-label={playing ? 'Pause' : 'Play'}>
  {#if playing}
    <svg viewBox="0 0 12 12" width="10" height="10"><rect x="2" y="1.5" width="3" height="9" rx="0.8" /><rect x="7" y="1.5" width="3" height="9" rx="0.8" /></svg>
  {:else}
    <svg viewBox="0 0 12 12" width="10" height="10"><path d="M3 1.5v9l7-4.5z" /></svg>
  {/if}
</button>

<style>
  .play {
    width: 24px; height: 24px; padding: 0; border-radius: 50%;
    display: inline-grid; place-items: center; color: var(--muted); background: transparent; border-color: transparent;
  }
  .play svg { fill: currentColor; }
  .play:hover { color: var(--accent); background: var(--sel); border-color: transparent; }
  .play.on { color: #fff; background: var(--accent); }
</style>
