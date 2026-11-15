from dotenv import load_dotenv
from spotipy.oauth2 import SpotifyOAuth

load_dotenv()

# Everything the project may ever need, in one place.
# The last three are what the in-browser player needs.
SCOPES = (
    "user-library-read "
    "playlist-read-private "
    "playlist-read-collaborative "
    "user-read-recently-played "
    "user-read-playback-state "
    "user-modify-playback-state "
    "streaming "
    "user-read-email "
    "user-read-private"
)


def make_auth(open_browser=True):
    """Builds the Spotify login helper. It reads your 3 SPOTIPY_ values from .env
    and keeps the saved token in the .cache file."""
    return SpotifyOAuth(scope=SCOPES, open_browser=open_browser)