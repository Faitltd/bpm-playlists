<script>
  let { level = 0, title = '' } = $props();
  // 1-3 cool blue, 4-6 green/amber, 7-10 hot
  const hue = $derived(level ? Math.round(210 - ((level - 1) / 9) * 210) : 0);
</script>

{#if level}
  <span class="energy" style="--h: {hue}" title={title || 'Energy ' + level + ' of 10'}>{level}</span>
{:else}
  <span class="energy none">–</span>
{/if}

<style>
  .energy {
    display: inline-block; min-width: 22px; text-align: center;
    font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums;
    border-radius: 5px; padding: 1px 6px;
    background: hsl(var(--h) 80% 50% / 0.18);
    color: hsl(var(--h) 70% 38%);
  }
  @media (prefers-color-scheme: dark) {
    .energy { color: hsl(var(--h) 85% 68%); background: hsl(var(--h) 80% 50% / 0.26); }
  }
  .energy.none { background: transparent; color: var(--muted); font-weight: 400; }
</style>
