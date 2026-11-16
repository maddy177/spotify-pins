# 🎧 Spotify Pins

**One list of every song you've ever added to any of your Spotify playlists.**

If you keep dozens of playlists, songs you saved months ago get buried in playlists you no longer listen to. Spotify Pins pulls every playlist you own into one searchable, sortable list, so you can see what you added recently, find where a forgotten song is hiding, and play everything by one artist no matter which playlists it's spread across.

## Features

- **One row per song**, even if it's in five playlists. A `+4 more` pill opens a popup listing every playlist it's in, with the date you added it to each. Click one to jump into that playlist.
- **Sort and search** by date added (newest or oldest first), title, artist, or how many playlists a song is in.
- **Artists tab**: every artist in your library with a song count. Click one (or click an artist's name under any song) to see all their songs, then press Play.
- **Plays music in the page** through Spotify's Web Playback SDK, with a seek bar, volume, shuffle, play/pause on the spacebar, and a queue that keeps going past Spotify's 100-song request limit.
- **Sync button** to refresh your library without touching the terminal.
- Songs added by other people to your playlists are stored but hidden unless you pick them in the "Added by" filter.

## How it works

```
Spotify Web API ──(sync.py)──▶ SQLite file ──▶ Flask server ──▶ web page (HTML/CSS/JS)
                                                                    │
                                          Spotify Web Playback SDK ─┘  (music plays in the tab)
```

`sync.py` downloads your playlists once and stores them locally, so searching and sorting is instant and never waits on Spotify. The Flask server serves the page and the data. The page does all the filtering in the browser.

## What you need

- Python 3.10 or newer
- A **Spotify Premium** account (required by Spotify for playback and for developer apps)
- Chrome or Edge (the player needs a browser with Widevine support)
- A free Spotify developer app (steps below)

## Setup

1. **Create a Spotify app** at <https://developer.spotify.com/dashboard>.
   - Redirect URI: `http://127.0.0.1:9090/callback`
   - Tick both **Web API** and **Web Playback SDK** under "APIs used".
   - Copy the Client ID and Client Secret.
2. **Get the code and install**:
   ```
   git clone https://github.com/YOUR-USERNAME/spotify-pins.git
   cd spotify-pins
   python -m pip install -r requirements.txt
   ```
3. **Add your keys.** Copy `.env.example` to `.env` and fill in the three values. Never commit `.env`.
4. **Log in once**: `python login.py`. Your browser opens, you click Agree, and it prints the permissions it received.
5. **Load your library**: `python sync.py` (about 30 seconds).
6. **Start the app**: `python server.py`, then open <http://127.0.0.1:5050>.

After that, use the **Sync library** button in the page whenever you've changed your playlists.

## Using it

| Do this | To get this |
|---|---|
| Click a song's cover, or double-click a row | Play it, followed by the rest of the list |
| **Play** / **Shuffle** under the heading | Play everything currently in the list |
| Click `+N more` | See every playlist a song is in |
| Click an artist's name | See all your songs by that artist |
| `Space` | Play / pause |

## Project structure

```
server.py        Flask server: serves the page, the song data, the login token, the sync
sync.py          Downloads your playlists from Spotify into spotify_pins.db
spotify_auth.py  The login settings (permissions) shared by everything
login.py         One-time login helper
static/          The web page: index.html, style.css, app.js, player.js, sync.js
experiments/     Earlier steps and the first Streamlit prototype
```

## Good to know

- **Only playlists you own are included.** Since 2026, Spotify only returns the songs of playlists you own or collaborate on, so followed playlists are skipped.
- Local files (uploaded from your own computer) are skipped because they have no Spotify ID.
- Songs in the page play in **this browser tab**, so keep the tab open.
- Spotify limits apps in development mode: the owner needs Premium, and only a few users can be authorized. This is a personal tool, not something to host for others.
- **Security:** the server only listens on `127.0.0.1` (your own computer). It hands your Spotify login token to the page, so never expose it to a network or the internet.

## Troubleshooting

| What you see | What to do |
|---|---|
| "Not logged in with playback permission" | Run `python login.py` |
| Player says it can't run in this browser | Use Chrome or Edge in a normal window |
| "Spotify says this account can't stream here" | The account needs Premium |
| Sync fails right away | Run `python login.py` again, then retry |
| `WinError 10013` when logging in | Windows blocked the port. Pick another port, and change it in both `.env` and the Spotify dashboard |

## Disclaimer

An independent personal project. Not affiliated with or endorsed by Spotify.