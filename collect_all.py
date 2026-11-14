import sys
from collections import Counter

from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.exceptions import SpotifyException

# Makes the terminal show accented characters properly
sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

SCOPES = (
    "user-library-read "
    "playlist-read-private "
    "playlist-read-collaborative "
    "user-read-recently-played "
    "user-read-playback-state "
    "user-modify-playback-state"
)

sp = spotipy.Spotify(auth_manager=SpotifyOAuth(scope=SCOPES))
my_id = sp.current_user()["id"]

# ---------- 1. All playlists, then keep only the ones you own ----------
all_playlists = []
page = sp.current_user_playlists(limit=50)
while page:
    for pl in page["items"]:
        if pl:
            all_playlists.append(pl)
    page = sp.next(page) if page["next"] else None

playlists = [p for p in all_playlists if p["owner"]["id"] == my_id]
print(f"{len(all_playlists)} playlists in library, {len(playlists)} owned by you.")
print("Fetching songs, this takes a bit...")

# ---------- 2. All songs in each owned playlist ----------
rows = []      # one row per (song, playlist) pair
failed = []    # playlists Spotify refused (shouldn't happen for owned ones)

for i, pl in enumerate(playlists, start=1):
    try:
        data = sp._get(f"playlists/{pl['id']}/items", limit=50, offset=0)
        while data:
            for entry in data["items"]:
                song = entry.get("item") or entry.get("track")
                if not song:  # deleted or unavailable song
                    continue
                rows.append({
                    "playlist_id": pl["id"],
                    "playlist_name": pl["name"],
                    "song_id": song.get("id"),
                    "song_name": song.get("name"),
                    "artists": ", ".join(a["name"] for a in song.get("artists", [])),
                    "album": (song.get("album") or {}).get("name"),
                    "added_at": entry.get("added_at"),
                    "added_by": (entry.get("added_by") or {}).get("id"),
                    "is_local": entry.get("is_local"),
                    "type": song.get("type"),
                })
            data = sp.next(data) if data.get("next") else None
    except SpotifyException as e:
        failed.append((pl["name"], e.http_status))

    if i % 10 == 0:
        print(f"  ...{i}/{len(playlists)} done")

# ---------- 3. Summary ----------
print("\n=== SUMMARY ===")
print(f"Playlists fetched OK: {len(playlists) - len(failed)}")
print(f"Playlists refused:    {len(failed)}")
for name, status in failed:
    print(f"   - {name} (HTTP {status})")

print(f"\nTotal rows (song-in-playlist pairs): {len(rows)}")
unique_ids = {r["song_id"] for r in rows if r["song_id"]}
print(f"Unique songs (by ID):                {len(unique_ids)}")
print(f"Local files (no Spotify ID):         {sum(1 for r in rows if not r['song_id'])}")
print(f"Non-song items (podcasts etc.):      {sum(1 for r in rows if r['type'] not in ('track', None))}")

count_per_song = Counter(r["song_id"] for r in rows if r["song_id"])
multi = sum(1 for n in count_per_song.values() if n > 1)
print(f"Songs that appear in 2+ playlists:   {multi}")

print("\nWho added the songs:")
for who, n in Counter(r["added_by"] for r in rows).most_common(5):
    print(f"   {'YOU' if who == my_id else who}: {n}")

dated = [r for r in rows if r["added_at"]]
dated.sort(key=lambda r: r["added_at"], reverse=True)
print(f"\nOldest added_at: {dated[-1]['added_at']}")
print(f"Newest added_at: {dated[0]['added_at']}")

print("\n--- 10 most recently added songs ---")
for r in dated[:10]:
    print(f"{r['added_at'][:10]}  {r['song_name']} - {r['artists']}  [{r['playlist_name']}]")