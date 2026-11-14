import os
import sqlite3
from datetime import datetime, timezone

from flask import Flask, jsonify

DB_FILE = "spotify_pins.db"

app = Flask(__name__)
app.json.ensure_ascii = False   # show emoji/accents as real characters, not \u codes
app.json.sort_keys = False      # keep the field order we write below


def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row   # lets us read columns by name: row["title"]
    return conn


@app.route("/")
def home():
    return "Spotify Pins server is running. Try <a href='/api/songs'>/api/songs</a>"


@app.route("/api/songs")
def api_songs():
    if not os.path.exists(DB_FILE):
        return jsonify(error=f"{DB_FILE} not found. Run sync.py first."), 500

    conn = get_connection()
    rows = conn.execute(
        """
        SELECT a.song_id, a.playlist_id, a.added_at, a.added_by,
               s.name AS title, s.artists, s.album, s.image_url,
               p.name AS playlist_name, p.owner_id
        FROM appearances a
        JOIN songs s     ON s.song_id = a.song_id
        JOIN playlists p ON p.playlist_id = a.playlist_id
        ORDER BY a.added_at DESC
        """
    ).fetchall()
    playlist_rows = conn.execute(
        "SELECT playlist_id, name FROM playlists ORDER BY name COLLATE NOCASE"
    ).fetchall()
    conn.close()

    # Collapse the rows into one entry per song. Because the query is sorted
    # newest-first, each song's playlist list ends up newest-first too.
    songs = {}
    for r in rows:
        song = songs.get(r["song_id"])
        if song is None:
            song = songs[r["song_id"]] = {
                "id": r["song_id"],
                "title": r["title"],
                "artists": r["artists"],
                "album": r["album"],
                "image": r["image_url"],
                "playlists": [],
            }
        song["playlists"].append(
            {
                "id": r["playlist_id"],
                "name": r["playlist_name"],
                "added_at": r["added_at"],
                "added_by": r["added_by"],
                "by_me": r["added_by"] == r["owner_id"],
            }
        )

    synced = datetime.fromtimestamp(os.path.getmtime(DB_FILE), tz=timezone.utc)

    return jsonify(
        synced_at=synced.isoformat(),
        playlists=[{"id": p["playlist_id"], "name": p["name"]} for p in playlist_rows],
        songs=list(songs.values()),
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)