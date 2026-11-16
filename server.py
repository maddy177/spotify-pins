import os
import sqlite3
import threading
from datetime import datetime, timezone

import spotipy
from flask import Flask, jsonify, request

from spotify_auth import make_auth
from sync import run_sync

DB_FILE = "spotify_pins.db"

app = Flask(__name__)
app.json.ensure_ascii = False   # show emoji/accents as real characters, not \u codes
app.json.sort_keys = False      # keep the field order we write below

# Used only to hand the saved login token to the browser's player.
# open_browser=False: the server must never pop up a login window by itself.
auth = make_auth(open_browser=False)


# What the Sync button is doing right now. The sync runs in a background
# thread; the page asks /api/sync/status every moment to show progress.
sync_lock = threading.Lock()
sync_state = {
    "running": False,
    "done": 0,
    "total": 0,
    "error": None,
    "summary": None,
}


def get_valid_token():
    """The saved login token (refreshed if it expired), or None if there isn't a
    usable one. Never opens a browser or waits for anyone to type."""
    return auth.validate_token(auth.cache_handler.get_cached_token())


def get_connection():
    conn = sqlite3.connect(DB_FILE, timeout=30)
    conn.row_factory = sqlite3.Row   # lets us read columns by name: row["title"]
    return conn


def load_artist_map(conn):
    """song_id -> [{"id": ..., "name": ...}, ...] in credit order.
    Returns an empty map if the artist tables don't exist yet (that's the
    case until you run sync.py once with the new version)."""
    try:
        rows = conn.execute(
            """
            SELECT sa.song_id, a.artist_id, a.name
            FROM song_artists sa
            JOIN artists a ON a.artist_id = sa.artist_id
            ORDER BY sa.song_id, sa.position
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    result = {}
    for r in rows:
        result.setdefault(r["song_id"], []).append({"id": r["artist_id"], "name": r["name"]})
    return result


@app.route("/")
def home():
    return app.send_static_file("index.html")


@app.route("/api/token")
def api_token():
    # Reads the saved token. If it has expired, spotipy refreshes it for us.
    # If there is no token, or it lacks the playback permissions, we get None.
    token_info = get_valid_token()
    if not token_info:
        response = jsonify(error="Not logged in with playback permission. Run: python login.py")
        response.status_code = 401
    else:
        response = jsonify(token=token_info["access_token"], expires_at=token_info["expires_at"])
    response.headers["Cache-Control"] = "no-store"
    return response


def sync_worker(access_token):
    """Runs in its own thread so the page doesn't freeze while we sync."""
    def progress(done, total):
        with sync_lock:
            sync_state.update(done=done, total=total)

    try:
        sp = spotipy.Spotify(auth=access_token)
        summary = run_sync(sp, progress)
        with sync_lock:
            sync_state.update(running=False, error=None, summary=summary)
    except Exception as error:  # show any failure in the page instead of dying silently
        with sync_lock:
            sync_state.update(running=False, error=str(error), summary=None)


@app.route("/api/sync", methods=["POST"])
def api_sync_start():
    # Browsers attach this header only to requests made by our own page.
    # Other websites can't add it without our permission, so they can't
    # trigger a sync behind your back.
    if request.headers.get("X-Requested-With") != "spotify-pins":
        return jsonify(error="Forbidden"), 403

    token_info = get_valid_token()
    if not token_info:
        return jsonify(error="Not logged in. Run: python login.py"), 401

    with sync_lock:
        if sync_state["running"]:
            return jsonify(error="A sync is already running."), 409
        sync_state.update(running=True, done=0, total=0, error=None, summary=None)

    threading.Thread(target=sync_worker, args=(token_info["access_token"],), daemon=True).start()
    return jsonify(started=True), 202


@app.route("/api/sync/status")
def api_sync_status():
    with sync_lock:
        response = jsonify(dict(sync_state))
    response.headers["Cache-Control"] = "no-store"
    return response


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
    artist_map = load_artist_map(conn)
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
                "artist_list": artist_map.get(r["song_id"], []),
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