from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyOAuth

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
    # Spotify renamed the "tracks" field to "items" in Feb 2026,
    # so we check both names to be safe.
    for key in ("items", "tracks"):
        info = pl.get(key)
        if isinstance(info, dict) and "total" in info:
            return info["total"]
    return "?"


# Spotify sends playlists in pages of up to 50. We keep asking for the
# next page until there isn't one.
playlists = []
page = sp.current_user_playlists(limit=50)
while page:
    for pl in page["items"]:
        if pl:  # skip empty entries, just in case
            playlists.append(pl)
    page = sp.next(page) if page["next"] else None

owned = [p for p in playlists if p["owner"]["id"] == my_id]
followed = [p for p in playlists if p["owner"]["id"] != my_id]

print(f"Total playlists: {len(playlists)}")
print(f"Owned by you:    {len(owned)}")
print(f"Followed:        {len(followed)}")

print("\n--- First 15 playlists ---")
for pl in playlists[:15]:
    tag = "OWN   " if pl["owner"]["id"] == my_id else "FOLLOW"
    print(f"[{tag}] {pl['name']}  ({track_count(pl)} songs)")