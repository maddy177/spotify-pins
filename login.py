import spotipy
from spotify_auth import make_auth

# Run this once (and again any time the server says you're not logged in).
# It opens your browser, you click Agree, and the token is saved to .cache.
auth = make_auth()
sp = spotipy.Spotify(auth_manager=auth)

me = sp.current_user()
print("Logged in as:", me["display_name"])

token = auth.cache_handler.get_cached_token()
granted = token["scope"].split()
print("\nPermissions granted:")
for scope in granted:
    print("  -", scope)

needed = ["streaming", "user-read-email", "user-read-private", "user-modify-playback-state"]
missing = [s for s in needed if s not in granted]
print("\nPlayback permissions OK" if not missing else f"\nMISSING: {missing}")