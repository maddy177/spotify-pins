import sys
import sqlite3

import spotipy

from spotify_auth import make_auth

DB_FILE = "spotify_pins.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS playlists (
    playlist_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
    song_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    artists     TEXT,
    album       TEXT,
    image_url   TEXT,
    duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS appearances (
    song_id     TEXT NOT NULL REFERENCES songs(song_id),
    playlist_id TEXT NOT NULL REFERENCES playlists(playlist_id),
    added_at    TEXT,
    added_by    TEXT,
    PRIMARY KEY (song_id, playlist_id)
);

CREATE TABLE IF NOT EXISTS artists (
    artist_id TEXT PRIMARY KEY,
    name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS song_artists (
    song_id   TEXT NOT NULL REFERENCES songs(song_id),
    artist_id TEXT NOT NULL REFERENCES artists(artist_id),
    position  INTEGER NOT NULL,
    PRIMARY KEY (song_id, artist_id)
);
"""


def run_sync(sp, progress=None):
    """Fetch every playlist you own from Spotify and rebuild the database.

    sp        - a logged-in spotipy.Spotify object
    progress  - optional function called as progress(done, total) after each playlist

    Returns a dictionary with the counts. Used by the terminal command below
    AND by the Sync button in the page (through server.py).
    """
    my_id = sp.current_user()["id"]

    # ---------- 1. Fetch everything from Spotify (nothing saved yet) ----------
    all_playlists = []
    page = sp.current_user_playlists(limit=50)
    while page:
        for pl in page["items"]:
            if pl:
                all_playlists.append(pl)
        page = sp.next(page) if page["next"] else None

    playlists = [p for p in all_playlists if p["owner"]["id"] == my_id]
    if progress:
        progress(0, len(playlists))

    songs = {}          # song_id -> song details (one entry per song)
    artists = {}        # artist_id -> artist name (one entry per artist)
    song_artists = {}   # (song_id, artist_id) -> position in the credits
    appearances = {}    # (song_id, playlist_id) -> latest add info
    skipped_local = 0
    merged_dupes = 0
    artists_without_id = 0

    for i, pl in enumerate(playlists, start=1):
        data = sp._get(f"playlists/{pl['id']}/items", limit=50, offset=0)
        while data:
            for entry in data["items"]:
                song = entry.get("item") or entry.get("track")
                if not song:
                    continue

                # Local files have no Spotify ID, we're not storing them
                if entry.get("is_local") or not song.get("id"):
                    skipped_local += 1
                    continue

                # Cover art: Spotify lists several sizes, [1] is the ~300px one
                images = (song.get("album") or {}).get("images") or []
                if len(images) >= 2:
                    image_url = images[1]["url"]
                elif images:
                    image_url = images[0]["url"]
                else:
                    image_url = None

                songs[song["id"]] = (
                    song["id"],
                    song.get("name") or "",
                    ", ".join(a["name"] for a in song.get("artists", [])),
                    (song.get("album") or {}).get("name"),
                    image_url,
                    song.get("duration_ms"),
                )

                # Each credited artist, kept by Spotify's artist ID so that
                # "Drake" can never be confused with "Drake Bell"
                for position, artist in enumerate(song.get("artists", [])):
                    name = artist.get("name") or "Unknown artist"
                    artist_id = artist.get("id")
                    if not artist_id:
                        # Safety net in case Spotify ever stops sending IDs
                        artists_without_id += 1
                        artist_id = "name:" + name.lower()
                    artists[artist_id] = name
                    song_artists.setdefault((song["id"], artist_id), position)

                # Same song twice in the same playlist -> keep only the latest date
                key = (song["id"], pl["id"])
                added_at = entry.get("added_at") or ""
                added_by = (entry.get("added_by") or {}).get("id")
                if key in appearances:
                    merged_dupes += 1
                    if added_at <= appearances[key][2]:
                        continue
                appearances[key] = (song["id"], pl["id"], added_at, added_by)

            data = sp.next(data) if data.get("next") else None

        if progress:
            progress(i, len(playlists))

    # ---------- 2. Save to the database (all-or-nothing) ----------
    conn = sqlite3.connect(DB_FILE, timeout=30)  # wait up to 30s if the page is reading
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA)

        with conn:  # the "with" makes this one transaction
            # Clear in this order: tables that point at others go first
            conn.execute("DELETE FROM song_artists")
            conn.execute("DELETE FROM appearances")
            conn.execute("DELETE FROM artists")
            conn.execute("DELETE FROM playlists")
            conn.execute("DELETE FROM songs")

            conn.executemany(
                "INSERT INTO playlists VALUES (?, ?, ?)",
                [(p["id"], p["name"], p["owner"]["id"]) for p in playlists],
            )
            conn.executemany("INSERT INTO songs VALUES (?, ?, ?, ?, ?, ?)", songs.values())
            conn.executemany("INSERT INTO artists VALUES (?, ?)", artists.items())
            conn.executemany("INSERT INTO appearances VALUES (?, ?, ?, ?)", appearances.values())
            conn.executemany(
                "INSERT INTO song_artists VALUES (?, ?, ?)",
                [(song_id, artist_id, pos) for (song_id, artist_id), pos in song_artists.items()],
            )
    finally:
        conn.close()

    return {
        "playlists": len(playlists),
        "songs": len(songs),
        "appearances": len(appearances),
        "artists": len(artists),
        "song_artist_links": len(song_artists),
        "skipped_local": skipped_local,
        "merged_duplicates": merged_dupes,
        "artists_without_id": artists_without_id,
    }


def main():
    """What runs when you type: python sync.py"""
    sys.stdout.reconfigure(encoding="utf-8")
    sp = spotipy.Spotify(auth_manager=make_auth())

    print("Fetching your playlists and songs, this takes a bit...")

    def show_progress(done, total):
        if done and done % 10 == 0:
            print(f"  ...{done}/{total} playlists done")

    summary = run_sync(sp, show_progress)

    print("\n=== SAVED TO", DB_FILE, "===")
    print(f"Playlists:                          {summary['playlists']}")
    print(f"Unique songs:                       {summary['songs']}")
    print(f"Song-in-playlist entries:           {summary['appearances']}")
    print(f"Unique artists:                     {summary['artists']}")
    print(f"Song-artist links:                  {summary['song_artist_links']}")
    print(f"Local files skipped:                {summary['skipped_local']}")
    print(f"Same-playlist duplicates merged:    {summary['merged_duplicates']}")
    print(f"Artists that came without an ID:    {summary['artists_without_id']}")


if __name__ == "__main__":
    main()