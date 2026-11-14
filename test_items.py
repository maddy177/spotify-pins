from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.exceptions import SpotifyException

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


def track_count(pl):
    for key in ("items", "tracks"):
        info = pl.get(key)
        if isinstance(info, dict) and "total" in info:
            return info["total"]
    return "?"


# Fetch all playlists (same loop as last time)
playlists = []
page = sp.current_user_playlists(limit=50)
while page:
    for pl in page["items"]:
        if pl:
            playlists.append(pl)
    page = sp.next(page) if page["next"] else None


def get_first_page(playlist_id):
    # Spotify's new endpoint is /playlists/{id}/items (the old one was /tracks).
    # We call it directly instead of relying on Spotipy's helper, which may
    # still point at the old address.
    return sp._get(f"playlists/{playlist_id}/items", limit=50, offset=0)


# Test: 2 playlists you own that have songs, plus all 6 followed ones
owned_with_songs = [
    p for p in playlists
    if p["owner"]["id"] == my_id and track_count(p) not in (0, "?")
]
followed = [p for p in playlists if p["owner"]["id"] != my_id]
to_test = owned_with_songs[:2] + followed

for pl in to_test:
    kind = "OWN" if pl["owner"]["id"] == my_id else "FOLLOW"
    print(f"\n[{kind}] {pl['name']}  (collaborative={pl.get('collaborative')})")

    try:
        data = get_first_page(pl["id"])
    except SpotifyException as e:
        print(f"   FAILED: HTTP {e.http_status} - {str(e.msg)[:150]}")
        continue

    entries = data.get("items", [])
    print(f"   Got {len(entries)} entries on first page, total = {data.get('total')}")

    if entries:
        print("   Entry keys:", list(entries[0].keys()))

    for entry in entries[:3]:
        # Feb 2026 renamed "track" to "item"; check both
        song = entry.get("item") or entry.get("track")
        if not song:
            print("   (empty entry)")
            continue
        artists = ", ".join(a["name"] for a in song.get("artists", []))
        print(f"   {song['name']} - {artists}  | added {entry.get('added_at')}")