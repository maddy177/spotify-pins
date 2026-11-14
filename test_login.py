from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyOAuth

# Reads your .env file and loads the 3 SPOTIPY_ values into memory
load_dotenv()

# The permissions we're asking you to approve
SCOPES = (
    "user-library-read "
    "playlist-read-private "
    "playlist-read-collaborative "
    "user-read-recently-played "
    "user-read-playback-state "
    "user-modify-playback-state"
)

# SpotifyOAuth handles the login + token. It finds your client ID, secret
# and redirect URI from the environment variables load_dotenv() just loaded.
sp = spotipy.Spotify(auth_manager=SpotifyOAuth(scope=SCOPES))

# First real API request: "who am I?"
me = sp.current_user()
print("Logged in as:", me["display_name"])
print("User ID:", me["id"])