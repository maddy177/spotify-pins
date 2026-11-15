// ======================================================================
//  Spotify Pins - player
//  Uses Spotify's Web Playback SDK: this browser tab becomes a Spotify
//  device called "Spotify Pins", and we tell it what to play.
//  Needs app.js loaded first (it uses currentList, rowsBox and ICONS).
// ======================================================================

const npCover = document.getElementById("np-cover");
const npTitle = document.getElementById("np-title");
const npArtist = document.getElementById("np-artist");
const btnPrev = document.getElementById("btn-prev");
const btnPlay = document.getElementById("btn-play");
const btnNext = document.getElementById("btn-next");
const statusLine = document.getElementById("player-status");
const playAllButton = document.getElementById("play-all");

let sdkPlayer = null;      // Spotify's player object
let deviceId = null;       // this tab's "device id" once Spotify says it's ready
let currentTrackId = null; // the song playing right now (to highlight its row)

btnPrev.innerHTML = ICONS.prev;
btnPlay.innerHTML = ICONS.play;
btnNext.innerHTML = ICONS.next;

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.className = "player-status " + kind; // kind is "ok", "error" or ""
}

// Ask our own server for the saved login token
async function getToken() {
  const response = await fetch("/api/token", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `token request failed (${response.status})`);
  }
  return body.token;
}

// ---------- Show what's playing ----------
function renderState(state) {
  if (!state || !state.track_window || !state.track_window.current_track) {
    currentTrackId = null;
    markPlayingRow();
    return;
  }
  const track = state.track_window.current_track;

  npTitle.textContent = track.name;
  npArtist.textContent = track.artists.map((a) => a.name).join(", ");
  const image = track.album && track.album.images && track.album.images[0];
  if (image) {
    npCover.src = image.url;
    npCover.hidden = false;
  }

  btnPlay.innerHTML = state.paused ? ICONS.play : ICONS.pause;

  // Spotify sometimes swaps a song for an equivalent version; "linked_from"
  // holds the id of the one we originally asked for.
  currentTrackId = (track.linked_from && track.linked_from.id) || track.id;
  markPlayingRow();
}

// Called here and from app.js after every redraw of the list
function markPlayingRow() {
  for (const row of rowsBox.querySelectorAll(".row.playing")) {
    row.classList.remove("playing");
  }
  if (!currentTrackId) return;
  const row = rowsBox.querySelector(`.row[data-song="${CSS.escape(currentTrackId)}"]`);
  if (row) row.classList.add("playing");
}

// ---------- Start playing ----------
async function playUris(uris) {
  if (!sdkPlayer || !deviceId) {
    setStatus("The player isn’t ready yet. Give it a moment.", "error");
    return;
  }

  // Browsers only allow sound after a click. This must run right inside the
  // click, before we wait for anything.
  if (sdkPlayer.activateElement) sdkPlayer.activateElement();

  try {
    const token = await getToken();
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris }),
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      console.error("Play request failed:", response.status, detail);
      setStatus(`Spotify refused to start playback (error ${response.status}). Details are in the Console.`, "error");
      return;
    }
    setStatus("Playing in this tab", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

// Play the song with this id, followed by the songs after it in the current list.
// With no id, start from the top. Spotify accepts at most 100 songs at once.
function playFrom(songId) {
  if (currentList.length === 0) return;
  let start = songId ? currentList.findIndex((item) => item.song.id === songId) : 0;
  if (start < 0) start = 0;
  const uris = currentList
    .slice(start, start + 100)
    .map((item) => `spotify:track:${item.song.id}`);
  playUris(uris);
}

// ---------- Buttons ----------
rowsBox.addEventListener("click", (event) => {
  const button = event.target.closest(".play-btn");
  if (button) playFrom(button.dataset.song);
});

// Double-click anywhere on a row to play it, like in Spotify
rowsBox.addEventListener("dblclick", (event) => {
  const row = event.target.closest(".row");
  if (row && !event.target.closest(".more")) playFrom(row.dataset.song);
});

playAllButton.addEventListener("click", () => playFrom(null));

btnPlay.addEventListener("click", () => {
  if (!sdkPlayer) return;
  if (sdkPlayer.activateElement) sdkPlayer.activateElement();
  sdkPlayer.togglePlay();
});
btnPrev.addEventListener("click", () => sdkPlayer && sdkPlayer.previousTrack());
btnNext.addEventListener("click", () => sdkPlayer && sdkPlayer.nextTrack());

// ---------- Connect to Spotify ----------
// Spotify's script (loaded at the bottom of index.html) calls this when it is ready.
window.onSpotifyWebPlaybackSDKReady = () => {
  sdkPlayer = new Spotify.Player({
    name: "Spotify Pins",
    volume: 0.7,
    getOAuthToken: async (giveToken) => {
      try {
        giveToken(await getToken());
      } catch (error) {
        setStatus(error.message, "error");
      }
    },
  });

  sdkPlayer.addListener("ready", ({ device_id }) => {
    deviceId = device_id;
    setStatus("Player ready. This tab is now a Spotify device.", "ok");
  });
  sdkPlayer.addListener("not_ready", () => {
    deviceId = null;
    setStatus("Player went offline. Check your internet connection.", "error");
  });

  sdkPlayer.addListener("player_state_changed", renderState);

  sdkPlayer.addListener("initialization_error", ({ message }) =>
    setStatus(`This browser can’t run the Spotify player: ${message}`, "error"));
  sdkPlayer.addListener("authentication_error", ({ message }) =>
    setStatus(`Login problem: ${message}. Run python login.py, then refresh.`, "error"));
  sdkPlayer.addListener("account_error", ({ message }) =>
    setStatus(`Spotify says this account can’t stream here: ${message}`, "error"));
  sdkPlayer.addListener("playback_error", ({ message }) =>
    setStatus(`Playback error: ${message}`, "error"));
  sdkPlayer.addListener("autoplay_failed", () =>
    setStatus("Your browser blocked autoplay. Click the play button.", "error"));

  sdkPlayer.connect().then((ok) => {
    if (!ok) setStatus("Couldn’t connect to Spotify. Try running python login.py.", "error");
  });
};