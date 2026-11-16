import sys
import sqlite3

sys.stdout.reconfigure(encoding="utf-8")

conn = sqlite3.connect("spotify_pins.db")

# Default view: only songs YOU added (the added_by of each entry matches
# the playlist owner, who is you). Others' additions stay stored but hidden.
ONLY_MINE = "a.added_by = p.owner_id"


def playlists_of(song_id):
    """All playlist names a song is in, most recently added first."""
    rows = conn.execute(
        f"""
        SELECT p.name
        FROM appearances a
        JOIN playlists p ON p.playlist_id = a.playlist_id
        WHERE a.song_id = ? AND {ONLY_MINE}
        ORDER BY a.added_at DESC
        """,
        (song_id,),
    ).fetchall()
    return [r[0] for r in rows]


def show_playlists(names):
    if len(names) == 1:
        return names[0]
    return f"{names[0]}  +{len(names) - 1} more"


# One row per song. MAX gives the latest date, COUNT how many playlists.
songs = conn.execute(
    f"""
    SELECT s.song_id, s.name, s.artists, MAX(a.added_at) AS latest, COUNT(*) AS n
    FROM appearances a
    JOIN songs s ON s.song_id = a.song_id
    JOIN playlists p ON p.playlist_id = a.playlist_id
    WHERE {ONLY_MINE}
    GROUP BY s.song_id
    ORDER BY latest DESC
    """
).fetchall()

total_in_db = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
print(f"Songs in the 'All' view (added by you): {len(songs)}")
print(f"Songs in the database in total:         {total_in_db}")

print("\n--- 15 newest ---")
for song_id, name, artists, latest, n in songs[:15]:
    print(f"{latest[:10]}  {name} - {artists}  [{show_playlists(playlists_of(song_id))}]")

print("\n--- 5 most forgotten (oldest 'latest' date) ---")
for song_id, name, artists, latest, n in reversed(songs[-5:]):
    print(f"{latest[:10]}  {name} - {artists}  [{show_playlists(playlists_of(song_id))}]")

print("\n--- 5 songs in the most playlists ---")
for song_id, name, artists, latest, n in sorted(songs, key=lambda s: s[4], reverse=True)[:5]:
    print(f"{n} playlists: {name} - {artists}")
    print(f"             {', '.join(playlists_of(song_id))}")