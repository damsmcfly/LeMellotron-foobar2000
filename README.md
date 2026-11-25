# Le-Mellotron-foobar2000

## Le Mellotron Standalone Player & scrobbler for foobar2000

A JSplitter panel for foobar2000 that plays the **[Le Mellotron](https://www.lemellotron.com)** web radio, shows what is playing (artist, title, album, cover), keeps a history of played tracks and scrobbles them to **Last.fm**.

Tested with JSplitter 3.9.10 and foobar2000 v2.25.9 portable (x86 Windows).

![Screenshot of "Le-Mellotron-foobar2000", Le Mellotron Standalone Player & scrobbler for foobar2000](https://raw.githubusercontent.com/damsmcfly/Le-Mellotron-foobar2000/refs/heads/main/Le-Mellotron-foobar2000.png)

## Features

- **Play / Stop** button for the radio stream, in a dedicated playlist named "Le Mellotron Stream".
- **Now playing** header: cover art (or a placeholder logo), artist, title, album.
- **Click any field** (artist, title, album) to copy it to the clipboard.
- **Discogs** button (header) and click on a history row's cover thumbnail: opens a Discogs search for that track.
- **Last played** list: up to 200 tracks with a 32x32 cover thumbnail, time, scrollable with the mouse wheel, saved between sessions, with a **Clear** button.
- **Search box** in the footer: filters the history on artist, title and album as you type.
- **Feed selector**: choose between the lemellotron.com feed (main, selected by default) and the radioking.io feed.
- **Automatic fallback**: if the lemellotron.com stream or API fails, the panel switches to the radioking.io stream/API (only when the lemellotron.com feed is selected).
- **Ends with the radio**: starting a local file (MP3, FLAC, any format) while the radio is playing ends the radio session at once: nothing more is polled, shown or scrobbled for the radio.
- **Last.fm scrobbling** with artist / title / album, now-playing updates and an offline retry queue.
- **Track sharing**: the current track is broadcast to other panels (e.g. a "Track Details" panel).

## Installation

1. In foobar2000, add a **JSplitter** panel to your layout (or an empty JSplitter panel).
2. Open its configuration and paste the contents of `lemellotron.js` (or load the file).
3. Click **Play**.

If the search box does not react to typing, open the panel's configuration (right-click the panel > **Configure...**) and make sure **Grab focus** is ticked.

Files created in your foobar2000 profile folder, under `lemellotron-cache\`:

| File | Content |
|------|---------|
| `history.json` | Play history |
| `lastfm_config.json` | Your Last.fm API key and shared secret (created automatically, see below) |
| `lastfm.json` | Last.fm session key, user name, on/off state and pending scrobbles |
| `artwork\cover_*` | Downloaded cover art, in the `artwork` subfolder (old ones are deleted automatically) |
| `thumbs\*` | Covers of the tracks in the history, used for the thumbnails (files no longer used are deleted automatically) |

## Searching the history

The search box sits at the bottom of the panel, to the right of the **Clear** and **Last.fm** buttons.

- Click the box and type. The list is filtered live and the section title becomes `MATCHES (found/total)`.
- Every word you type must appear in the artist, the title or the album, in any order. The search ignores case and accents (`beyonce` finds `Beyoncé`).
- A track without a cover thumbnail shows the radio logo instead.
- The box edits like a Windows text field:
  - **Click** places the caret, **click and drag** selects, **Shift+click** extends the selection.
  - **Double-click** selects a word, **triple-click** (a click right after a double-click) selects everything.
  - Typing, **Backspace** or **Delete** replace or erase the selection.
  - **Left / Right / Home / End** move the caret; with **Shift** they extend the selection, with **Ctrl** Left / Right jump by word.
  - **Ctrl+A** selects all, **Ctrl+C / Ctrl+X** copy or cut the selection, **Ctrl+V** pastes, **Ctrl+Backspace / Ctrl+Delete** delete a word.
  - **Esc** clears the text (a second press leaves the box), **Enter** leaves the box, and the **×** at the right clears the search.
- The box needs about 90 px of free width. In a very narrow panel it is hidden: widen the panel to see it.
- The **Clear** button always empties the whole history, not just the matches.

## Last.fm setup

1. Create an API account at <https://www.last.fm/api/account/create>.
   The **Callback URL** can be left empty (or `http://localhost`): it is not used.
2. Open `lemellotron-cache\lastfm_config.json` (the panel creates it, empty, the first time it runs) and fill in your **API key** and **shared secret**:
   ```json
   {
     "apiKey": "your API key",
     "apiSecret": "your shared secret"
   }
   ```
   The file is read again each time you click the Last.fm button, so there is no need to restart foobar2000.
3. Click the **Last.fm** button in the footer of the panel:
   - **Last.fm: Link**: opens the Last.fm authorization page in your browser. Approve it.
   - **Last.fm: Finish link**: click again to complete the link.
4. The button then shows **Last.fm: On**. Click it to switch scrobbling **Off** and **On** without unlinking. When scrobbles are waiting to be sent, the count is shown, e.g. `On (2)`.

To unlink, delete `lemellotron-cache\lastfm.json`.

> **The credentials are not stored in the script**, so the script can be shared safely. Do not share the `lemellotron-cache` folder: it contains `lastfm_config.json` (your API secret) and `lastfm.json` (your Last.fm session key).

### How scrobbling works

- When a new track is detected, a **Now Playing** update is sent immediately.
- A radio stream has no track length, so the scrobble is sent after `SCROBBLE_DELAY_MS` (currently **30 seconds**) of listening to the same track. Stopping or changing track before that cancels it.
- The scrobble includes the **album** supplied by the radio API.
- The scrobble timestamp is the moment the track was detected (up to 10 seconds after it really started).
- If Last.fm is unreachable, scrobbles stay in the queue (saved in `lastfm.json`) and are retried on the next poll.
- If Last.fm rejects a batch, it is dropped so the queue cannot get stuck. Details are in the foobar console (View > Console).
- If the session becomes invalid, the button goes back to **Link**.

### Using it together with foo_scrobbler_win

To avoid double scrobbles (and album-less ones), exclude the radio from [foo_scrobbler_win](https://github.com/zfoxer/foo_scrobbler_win):

1. Open the plugin's preferences, **Exclusions** tab.
2. Tick **Path contains** and enter `lemellotron`.

All the stream URLs used by the panel contain `lemellotron`, so this excludes them all. Your local files keep scrobbling normally.

## Sharing the current track with other panels

foobar's own tags for the radio stream are usually empty or incomplete, so other panels cannot read the track from title formatting. To solve this, on every poll the panel broadcasts the current track with `window.NotifyOthers`:

- **Channel**: `lemellotron_nowplaying`
- **Message**: a JSON string `{"artist": "...", "title": "...", "album": "...", "cover": "..."}`, or an empty string when the radio is stopped or nothing valid is playing. `cover` is the full path of the downloaded cover image (in the `artwork` folder), or an empty string while there is no cover for the current track. The message is also sent again as soon as a cover download finishes.

Another JSplitter panel can display it by implementing `on_notify_data`:

```js
let radio = null; // { artist, title, album } or null

function on_notify_data(name, info) {
    if (name !== 'lemellotron_nowplaying') return;
    try { radio = info ? JSON.parse(info) : null; } catch (e) { radio = null; }
    window.Repaint();
}
```

Because the message is sent on every poll (10 s), a panel loaded after the radio started catches up within one poll interval. The receiving panel should only use `radio` while a Le Mellotron stream is playing (e.g. check that `fb.GetNowPlaying().Path` contains `lemellotron`), so that stale data is never shown for local files. The cover file is replaced when the next cover is downloaded, so a panel that wants to keep it should load it into memory right away (`gdi.Image`, then `Clone`).

## Configuration

Constants at the top of the script:

| Constant | Default | Purpose |
|----------|---------|---------|
| `STREAM_URL`, `FALLBACK_STREAM_URL` | lemellotron.com / radioking.io | Main and fallback stream addresses |
| `API_URL`, `FALLBACK_API_URL` | lemellotron.com / radioking.io | Main and fallback "current track" metadata APIs |
| `FEED_OPTIONS` | 2 entries | Feeds in the selector menu (the first one is the main feed, with automatic fallback) |
| `STREAM_MATCH`, `FALLBACK_STREAM_MATCH` | `lemellotron` / `radioking` | Text that identifies the radio in the path of the playing item |
| `POLL_INTERVAL_MS` | `10000` | Metadata refresh interval |
| `STREAM_FALLBACK_TIMEOUT_MS` | `5000` | Wait before switching to the fallback stream |
| `MAX_HISTORY` | `200` | Maximum history length |
| `HEADER_HEIGHT`, `HIST_ROW_H`, `SCROLL_STEP_ROWS` | `96`, `26`, `5` | Layout and scrolling |
| `SCROBBLE_DELAY_MS` | `30000` | Listening time before a track is scrobbled |
| `LASTFM_MAX_QUEUE` | `500` | Maximum pending scrobbles kept |

## Code overview

The script is organised in sections, and every function has a comment block above it.

| Section | Role |
|---------|------|
| Constants and `state` | Settings, UI state, fonts, clickable rectangles |
| **Last.fm scrobbling** | MD5 signing, API requests, account linking, now-playing, scrobble queue, footer button |
| Feed helpers | Selected feed, switching feed |
| Time, clipboard and Discogs helpers | Notices, copy to clipboard, Discogs search, hit testing, scrolling |
| History | Load, save, clear and record played tracks |
| History search box | Filtering, drawing and keyboard handling of the search box (`on_char`, `on_key_down`) |
| Playback and stream | Add the stream to a playlist, play, fallback handling |
| Cover art and metadata polling | Poll the API, clean metadata, broadcast the track to other panels, download covers, draw the placeholder logo |
| foobar2000 events and UI | `on_http_request_done`, `on_playback_*`, mouse events, `on_paint`, `on_script_unload` |

### Data flow

```
foobar plays the stream
  -> startPolling(): every 10 s, fetchTrackInfo() calls the metadata API
  -> on_http_request_done(): parses artist / title / album / cover
       -> updates the display
       -> recordHistoryTrack()     (history list)
       -> broadcastNowPlaying()    (current track sent to other panels)
       -> lfmOnTrack()             (Now Playing, then scrobble after 30 s)
       -> lfmFlush()               (sends / retries queued scrobbles)
       -> requestCoverDownload()   (cover art)
```

## Troubleshooting

- **Button says "Last.fm: setup"**: `apiKey` or `apiSecret` is still empty in `lemellotron-cache\lastfm_config.json`. Fill them in and click the button again. If the file contains an error (a missing quote or comma), the console shows "Last.fm config load error".
- **Nothing is scrobbled**: check that the button says **On**, then look in the foobar console for lines starting with "Last.fm".
- **Duplicate scrobbles**: the exclusion in foo_scrobbler_win is not matching. Check the *Path contains* box is ticked.
- **"Stream unavailable"**: both streams failed. Try the other feed in the selector menu.
- **Album missing on Last.fm for some tracks**: the radio API did not provide one for that track, or Last.fm could not match the name.
- **Typing in the search box does nothing, or Windows plays the error sound**: make sure **Grab focus** is ticked in the panel's configuration (right-click the panel > **Configure...**), then click inside the box (its border turns blue when it has focus). Also check that no foobar2000 keyboard shortcut (Preferences > Keyboard Shortcuts) uses the key you type: shortcuts are executed before the panel sees the key.
- **Another panel does not show the radio track**: look in the foobar console for a "Le Mellotron broadcast error" line, which would mean `window.NotifyOthers` is not available in your JSplitter version.
- **The radio keeps scrobbling when I play a local file**: the panel ends the radio session as soon as the playing item is not a radio stream. If it does not, check that the path of the radio items in foobar contains `lemellotron` or `radioking` (see `STREAM_MATCH`).
