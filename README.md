# BPM Playlists

A free Mac app that sorts your Apple Music playlists by BPM, builds activity playlists (Relax, Yoga, Walk, Workout, Run, HIIT), and recommends songs that match a song's tempo and genre.

BPM data by [GetSongBPM](https://getsongbpm.com).

## Features

- **See every song's BPM** in any playlist. Edit a BPM by typing it in.
- **Fill missing BPMs** by measuring the audio of songs you own as files, or by looking them up online for any song, including Apple Music streaming songs. BPMs are saved to the song in Music.
- **Build activity playlists.** One click splits a playlist into BPM ranges, each sorted slowest to fastest. Edit the activities and ranges in the app.
- **Match a song.** Pick a song and get a `BPM Match: <song>` playlist of songs within a few BPM of it. Half and double tempo count too.
- **Recommendations:**
  - **From your library:** songs you already have in a similar genre with a matching BPM. Check them and add them to any playlist.
  - **New songs:** songs from the GetSongBPM database at a matching BPM in a similar genre. Click **Open** to see the song in Apple Music, then click **+** there to add it.

## Install

1. Go to [Releases](https://github.com/Faitltd/bpm-playlists/releases) and download **BPM-Playlists-mac.zip**.
2. Double-click the zip to unzip it.
3. Drag **BPM Playlists** into your **Applications** folder.
4. The first time, right-click **BPM Playlists** and click **Open**, then click **Open** again. (The app is free and not notarized by Apple, so macOS asks once.)
5. When asked if BPM Playlists may control Music, click **OK**.

Requires macOS 12 or later.

## Set up online features

Looking up BPMs and finding new songs uses the free GetSongBPM API.

1. Go to [getsongbpm.com/api](https://getsongbpm.com/api) and request a free API key.
2. In BPM Playlists, click **Settings**.
3. Paste the key into **GetSongBPM API key** and click **Save**.

Your key is stored only on your Mac.

## Use

1. Pick a playlist on the left.
2. Songs without a BPM are outlined. Click **Look up BPMs online** or **Measure from audio** to fill them, or type a BPM in.
3. Click **Build activity playlists** to create the BPM playlists.
4. Click **Match** next to a song to:
   - Create a match playlist.
   - See matching songs from your library and add them to a playlist.
   - Click **Find songs online** for new songs, then **Open** to view one in Apple Music.

New playlists appear in the Music app sidebar under **Playlists**. Running a build again replaces the playlists it made before. Your songs and other playlists are never changed, except that BPMs you add are saved to the songs.

## Notes

- Apple Music streaming songs are copy-protected, so their audio cannot be measured. Use **Look up BPMs online** or type the BPM.
- The app cannot add catalog songs to your library by itself. That needs a paid Apple developer account. **Open** takes you to the song in Apple Music instead.
- Online matches are only as good as the GetSongBPM catalog. Newer or less-known songs may be missing.

## Command-line script

`bpm-playlists.js` does the activity and match playlists without the app:

```
osascript -l JavaScript bpm-playlists.js "My Playlist"
osascript -l JavaScript bpm-playlists.js "My Playlist" --match "Song Title"
```

Edit the settings at the top of the file to change activities and ranges.

## Build from source

Requires Xcode command line tools and Node.js.

```
git clone https://github.com/Faitltd/bpm-playlists.git
cd bpm-playlists
./build.sh
```

The app is written to `dist/BPM Playlists.app`, with a zip at `dist/BPM-Playlists-mac.zip`.

Project layout:

- `app/main.swift`: the Mac window and the bridge between the interface and macOS
- `app/backend.js`: talks to the Music app (JavaScript for Automation)
- `ui/`: the interface, written in Svelte
- `bpm-playlists.js`: the standalone command-line script

## License

MIT. See [LICENSE](LICENSE).
