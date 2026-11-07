# bpm-playlists

Sort an Apple Music (formerly iTunes) playlist into activity playlists by BPM, or build a playlist of songs that match one song's tempo. Runs on macOS with the built-in Music app. Free, no installs, no accounts.

## What it does

**Activity playlists.** Reads one of your playlists and splits it by tempo, each sorted slowest to fastest:

| Playlist | BPM |
|---|---|
| BPM: Relax | under 90 |
| BPM: Yoga | 90 to 109 |
| BPM: Walk | 110 to 124 |
| BPM: Workout | 125 to 139 |
| BPM: Run | 140 to 159 |
| BPM: HIIT | 160 and up |
| BPM: Unknown | songs with no BPM |

**Match mode.** Name a song and get `BPM Match: <song>`: that song first, then every song within 5 BPM of it, closest first. Songs at half or double the tempo also count.

**BPM detection.** Songs with an empty BPM field are measured from the audio file, and the result is saved to the song's Get Info.

## Requirements

- macOS with the Music app
- Nothing to install. Uses `osascript` and `afconvert`, both built into macOS.

## Install

1. Click **Code**, then **Download ZIP** on this page.
2. Double-click the ZIP in your Downloads folder to unzip it.

Or clone it:

```
git clone https://github.com/Faitltd/bpm-playlists.git
```

## Use

1. Open **Terminal** (press **Cmd+Space**, type `Terminal`, press **Return**).
2. Type `cd ` (with a space), drag the unzipped `bpm-playlists` folder into the Terminal window, and press **Return**.
3. Run one of these, replacing the names with your own:

Activity playlists:

```
osascript -l JavaScript bpm-playlists.js "My Playlist"
```

Match one song:

```
osascript -l JavaScript bpm-playlists.js "My Playlist" --match "Song Title"
```

4. The first time, macOS asks if Terminal may control Music. Click **OK**.
5. Open Music. The new playlists are in the sidebar under **Playlists**.

Type names exactly as they appear in Music. Running the script again rebuilds the `BPM: ...` playlists. Your songs and other playlists are never changed, except that a measured BPM is saved to the song.

## Apple Music subscription songs

Songs streamed or downloaded through an Apple Music subscription are copy-protected, so their audio cannot be measured. They go to **BPM: Unknown** unless the song already has a BPM. To add one:

1. Right-click the song, click **Get Info**, then the **Info** tab.
2. Type the BPM in the **BPM** box and click **OK**.
3. Run the script again.

To find a song's BPM, search it on [GetSongBPM](https://getsongbpm.com), [SongBPM](https://songbpm.com) or [Beatport](https://www.beatport.com).

Songs you own as files (imported CDs, iTunes Store purchases, MP3s) are measured automatically.

## Customize

Open `bpm-playlists.js` in TextEdit and edit the settings at the top:

- `ACTIVITIES`: playlist names and BPM ranges (min included, max excluded)
- `MATCH_TOLERANCE`: how close a match must be, in BPM (default 5)
- `MATCH_HALF_DOUBLE`: also match half and double tempo (default true)
- `SAVE_DETECTED_BPM`: save measured BPMs to songs (default true)

## How BPM detection works

The middle 60 seconds of the song is converted to mono 11 kHz audio with `afconvert`. The script builds an onset envelope from changes in loudness, then autocorrelates it across 60 to 200 BPM, weighted toward common tempos, with a check for half-time readings.

## License

MIT. See [LICENSE](LICENSE).
