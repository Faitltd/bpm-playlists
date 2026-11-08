// Playback: library songs play in the Music app; online candidates play their preview clip here.
import { music } from './bridge.js';

export const player = $state({ musicId: null, musicState: 'stopped', previewKey: null });

let audio = null;
let timer = null;

export async function refresh() {
  try {
    const s = await music('playerState');
    player.musicId = s.id;
    player.musicState = s.state;
  } catch (e) { /* Music not reachable */ }
}

export function startPolling() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, 2000);
}

export const isPlaying = (id) => player.musicId === id && player.musicState === 'playing';

export async function toggleMusic(id) {
  try {
    if (isPlaying(id)) {
      const s = await music('pause');
      player.musicId = s.id; player.musicState = s.state;
    } else {
      stopPreview();
      const s = await music('play', { id });
      player.musicId = s.id; player.musicState = s.state;
    }
  } catch (e) { /* ignore */ }
}

export function togglePreview(key, url) {
  if (player.previewKey === key) { stopPreview(); return; }
  stopPreview();
  if (player.musicState === 'playing') music('pause').then(refresh).catch(() => {});
  audio = new Audio(url);
  audio.volume = 0.9;
  audio.onended = () => { if (player.previewKey === key) player.previewKey = null; };
  audio.onerror = () => { if (player.previewKey === key) player.previewKey = null; };
  audio.play().catch(() => { player.previewKey = null; });
  player.previewKey = key;
}

export function stopPreview() {
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  player.previewKey = null;
}
