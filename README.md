# BPM Playlists

A free Mac app that analyzes your Apple Music library for BPM, energy and mood, builds sessions (run, spin, yoga, focus, party) as a tempo and energy curve filled from your own songs, and recommends new songs that fit.

Audio analysis by [ReccoBeats](https://reccobeats.com). Song data from [Deezer](https://www.deezer.com) and Apple's iTunes Search.

## What it does

**Analyze.** Every song gets a BPM, an energy level (1 to 10) and a mood. Apple Music streaming songs are copy-protected, so the app analyzes the free 30-second preview clips instead. It measures tempo on two different clips of each song and only reports high confidence when they agree; songs it is unsure about are marked so you can check them. BPMs are saved to the song in Music.

**Build a session.** Pick a purpose:

| Preset | Shape |
|---|---|
| Run | Warm-up, steady cadence at your target BPM, cool-down. Half-time songs count (an 82 BPM song runs at 164). |
| Intervals | Three-minute pushes and two-minute recoveries. |
| Spin class | Climbs around 85 to 95 BPM, sprints at the target. |
| Yoga | Low energy with a gentle peak in the middle. |
| Focus | Steady, low energy, instrumental where possible. |
| Party | Energy rises one level at a time to a peak, then eases off. |
| Chill | Relaxed and even. |
| Custom | Edit the segments yourself. |

Set the length and target BPM, choose which playlists and genres to draw from, and click **Build session**. The app fills each segment from your library, keeping BPM steps small and energy moving one level at a time, like a DJ set. Remove songs you don't want, shuffle the picks, then **Create in Music**.

Where your library can't fill a segment, the app shows a gap and can **find songs to add**: top songs by artists similar to what you already have, analyzed and kept only when the tempo and energy fit. **Open** shows the song in Apple Music; click **+** there to add it.

**Find by BPM.** Type a tempo and see every song in your library near it, with the songs you've favorited and play most at the top. Play any of them, add a selection to a playlist, or create a "BPM 124" playlist in one click.

**Playlists.** Open any playlist to see each song's BPM, energy and mood. Type a BPM to correct one. **Build activity playlists** splits a playlist into Relax, Yoga, Walk, Workout, Run and HIIT by BPM. **Match** on any song builds a playlist of songs within a few BPM, suggests similar songs from your library, and finds new ones online.

## Install

1. Go to [Releases](https://github.com/Faitltd/bpm-playlists/releases) and download **BPM-Playlists-mac.zip**.
2. Double-click the zip to unzip it.
3. Drag **BPM Playlists** into your **Applications** folder.
4. The first time, right-click **BPM Playlists** and click **Open**, then click **Open** again. (The app is free and not notarized by Apple, so macOS asks once.)
5. When asked if BPM Playlists may control Music, click **OK**.

Requires macOS 12 or later. No accounts or API keys.

## First run

1. Click **Build a session** in the sidebar.
2. Click **Analyze** next to the song count. A 600-song library takes 20 to 30 minutes. You can keep using your Mac; the app keeps going in the background.
3. Pick a preset, set the length and target BPM, and click **Build session**.
4. Click **Create in Music**. The playlist appears in Music's sidebar and syncs to your phone.

## Notes

- Analysis results are stored on your Mac in `~/Library/Application Support/BPM Playlists/analysis.json`.
- Songs the app can't find online (rare or unreleased tracks) are left without a BPM. Type one in.
- A dashed BPM box means the two clips disagreed. The number shown is the best guess.
- The app cannot add catalog songs to your library by itself; that needs a paid Apple developer account. **Open** takes you to the song in Apple Music instead.

## Command-line script

`bpm-playlists.js` builds activity and match playlists without the app:

```
osascript -l JavaScript bpm-playlists.js "My Playlist"
osascript -l JavaScript bpm-playlists.js "My Playlist" --match "Song Title"
```

It can only measure songs you own as files. Edit the settings at the top of the file to change activities and ranges.

## Build from source

Requires Xcode command line tools and Node.js.

```
git clone https://github.com/Faitltd/bpm-playlists.git
cd bpm-playlists
./build.sh
```

The app is written to `dist/BPM Playlists.app`, with a zip at `dist/BPM-Playlists-mac.zip`.

Project layout:

- `app/main.swift`: the Mac window, the bridge to the interface, preview download and ReccoBeats upload, local storage
- `app/backend.js`: talks to the Music app and measures tempo (JavaScript for Automation)
- `ui/`: the interface, written in Svelte 5
  - `lib/analysis.svelte.js`: analysis pipeline and store
  - `lib/session.js`: presets and the session-filling algorithm
  - `lib/recommend.js`: recommendations from similar artists
- `bpm-playlists.js`: the standalone command-line script

## License

MIT. See [LICENSE](LICENSE).
