// ======================================================================
//  Spotify Pins - player
//  Uses Spotify's Web Playback SDK: this browser tab becomes a Spotify
//  device called "Spotify Pins", and we tell it what to play.
//  Needs app.js loaded first (it uses currentList, rowsBox and ICONS).
// ======================================================================

// ---------- Settings you can tweak ----------
const BATCH_SIZE = 100;          // Spotify accepts at most 100 songs per play request
const HANDOFF_EARLY_MS = 1500;   // start the next batch this long before the last song ends
const VOLUME_KEY = "spotify-pins-volume";

const VOLUME_ICONS = {
  on:
    '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/>' +
    '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  off:
    '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3z"/>' +
    '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const REPEAT_ICONS = {
  all:
    '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
  one:
    '<svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>' +
    '<path d="M13 15V9h-1l-2 1v1h1.5v4H13z"/></svg>',
};

// ---------- The page elements ----------
const npCover = document.getElementById("np-cover");
const npTitle = document.getElementById("np-title");
const npArtist = document.getElementById("np-artist");
const btnPrev = document.getElementById("btn-prev");
const btnPlay = document.getElementById("btn-play");
const btnNext = document.getElementById("btn-next");
const btnMute = document.getElementById("btn-mute");
const seekSlider = document.getElementById("seek");
const volumeSlider = document.getElementById("volume");
const timeNow = document.getElementById("time-now");
const timeTotal = document.getElementById("time-total");
const statusLine = document.getElementById("player-status");
const playAllButton = document.getElementById("play-all");
const shuffleButton = document.getElementById("shuffle-all");
const btnRepeat = document.getElementById("btn-repeat");

// ---------- State ----------
let sdkPlayer = null;      // Spotify's player object
let deviceId = null;       // this tab's "device id" once Spotify says it's ready
let currentTrackId = null; // the song playing right now (to highlight its row)
let lastState = null;      // the most recent report from Spotify
let repeatMode = "off";    // "off", "all" (repeat the whole list) or "one" (repeat this song)
let repeatChangedAt = 0;   // when WE last changed repeat (see syncRepeatFromState)
let repeatBusy = false;

// The playing position. Spotify only tells us when something CHANGES (a new
// song, pause, seek), so between those moments we calculate the position
// ourselves from the last report plus the time that has passed.
let hasTrack = false;
let paused = true;
let duration = 0;
let positionAtReport = 0;
let reportedAt = 0;
let seeking = false; // true while you are dragging the seek bar

// A "session" = everything you asked to play with one click. Spotify takes at
// most 100 songs at a time, so a long session is sent in batches.
let playQueue = [];        // every song (as a Spotify URI) of this session, in order
let queueIndex = new Map();// song id -> its place in playQueue
let batchStart = 0;        // playQueue[batchStart .. batchEnd) is what Spotify holds right now
let batchEnd = 0;
let handoffTimer = null;
let handoffBusy = false;

// ---------- Small helpers ----------
const idOfUri = (uri) => uri.split(":")[2];

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = String(totalSeconds % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function setFill(slider, percent) {
  slider.style.setProperty("--fill", `${percent}%`);
}

function setStatus(text, kind = "") {
  statusLine.textContent = text;
  statusLine.className = "player-status " + kind; // kind is "ok", "error" or ""
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

btnPrev.innerHTML = ICONS.prev;
btnPlay.innerHTML = ICONS.play;
btnNext.innerHTML = ICONS.next;

// Ask our own server for the saved login token
async function getToken() {
  const response = await fetch("/api/token", { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `token request failed (${response.status})`);
  }
  return body.token;
}

// ---------- Volume ----------
let volume = 70;       // 0 to 100
let volumeBeforeMute = 70;

try {
  const saved = Number(localStorage.getItem(VOLUME_KEY));
  if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved)) {
    volume = Math.min(100, Math.max(0, saved));
  }
} catch (error) {
  // storage can be unavailable (private windows); we just use the default
}
if (volume > 0) volumeBeforeMute = volume;

function applyVolume(value) {
  volume = Math.min(100, Math.max(0, Number(value)));
  if (volume > 0) volumeBeforeMute = volume;
  volumeSlider.value = volume;
  setFill(volumeSlider, volume);
  btnMute.innerHTML = volume === 0 ? VOLUME_ICONS.off : VOLUME_ICONS.on;
  btnMute.setAttribute("aria-label", volume === 0 ? "Unmute" : "Mute");
  if (sdkPlayer) sdkPlayer.setVolume(volume / 100);
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch (error) {
    // not saving is fine
  }
}

volumeSlider.addEventListener("input", () => applyVolume(volumeSlider.value));
btnMute.addEventListener("click", () => applyVolume(volume === 0 ? volumeBeforeMute : 0));
applyVolume(volume);

// ---------- Show what's playing ----------
function renderState(state) {
  if (!state || !state.track_window || !state.track_window.current_track) {
    hasTrack = false;
    currentTrackId = null;
    seekSlider.disabled = true;
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

  // Remember this report so we can work out the position between reports
  hasTrack = true;
  paused = state.paused;
  duration = state.duration || 0;
  positionAtReport = state.position || 0;
  reportedAt = performance.now();
  seekSlider.disabled = false;
  seekSlider.max = duration;
  timeTotal.textContent = formatTime(duration);
  updatePositionDisplay();

  // Spotify sometimes swaps a song for an equivalent version; "linked_from"
  // holds the id of the one we originally asked for.
  currentTrackId = (track.linked_from && track.linked_from.id) || track.id;
  markPlayingRow();

  // "Playing · 12 of 214"
  const place = queueIndex.get(currentTrackId);
  if (place !== undefined) {
    setStatus(`${state.paused ? "Paused" : "Playing"} · ${place + 1} of ${playQueue.length}`, "ok");
  }

  lastState = state;
  syncRepeatFromState(state);
  scheduleHandoff(state);
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

// ---------- The seek bar ----------
function currentPosition() {
  if (!hasTrack) return 0;
  if (paused) return positionAtReport;
  return Math.min(duration, positionAtReport + (performance.now() - reportedAt));
}

function updatePositionDisplay() {
  const position = currentPosition();
  seekSlider.value = position;
  timeNow.textContent = formatTime(position);
  setFill(seekSlider, duration ? (position / duration) * 100 : 0);
}

setInterval(() => {
  if (hasTrack && !seeking) updatePositionDisplay();
}, 250);

// While you drag: only update the numbers. When you let go: really jump there.
seekSlider.addEventListener("input", () => {
  seeking = true;
  const wanted = Number(seekSlider.value);
  timeNow.textContent = formatTime(wanted);
  setFill(seekSlider, duration ? (wanted / duration) * 100 : 0);
});
seekSlider.addEventListener("change", () => {
  const wanted = Number(seekSlider.value);
  positionAtReport = wanted;
  reportedAt = performance.now();
  seeking = false;
  if (sdkPlayer) sdkPlayer.seek(wanted);
});

// ---------- Starting playback ----------
// Sends one batch of songs to Spotify. Returns true if Spotify accepted it.
async function playUris(uris) {
  if (!sdkPlayer || !deviceId) {
    setStatus("The player isn’t ready yet. Give it a moment.", "error");
    return false;
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
      return false;
    }
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    return false;
  }
}

// Sends playQueue[from ... from + BATCH_SIZE] to Spotify
async function sendBatch(from) {
  const to = Math.min(from + Math.max(2, BATCH_SIZE), playQueue.length);
  const accepted = await playUris(playQueue.slice(from, to));
  if (accepted) {
    batchStart = from;
    batchEnd = to;
    if (!hasTrack) setStatus("Starting…", "ok");
  }
  return accepted;
}

// Start a new session from the songs currently on screen
function playFrom(songId, { shuffle = false } = {}) {
  if (currentList.length === 0) return;

  let order = currentList;
  let start = 0;
  if (shuffle) {
    order = shuffled(currentList);
  } else if (songId) {
    start = Math.max(0, order.findIndex((item) => item.song.id === songId));
  }

  clearTimeout(handoffTimer);
  // Keep the WHOLE list (not just the part after the clicked song), so that
  // Previous can still walk back above the song you started from.
  playQueue = order.map((item) => `spotify:track:${item.song.id}`);
  queueIndex = new Map(playQueue.map((uri, i) => [idOfUri(uri), i]));
  batchStart = start;
  batchEnd = start;
  sendBatch(start);
}

// ---------- Continuing past the first batch ----------
// Spotify plays a batch and then stops. Shortly before the LAST song of a
// batch ends, we send the next batch so the music carries on.
function onLastSongOfBatch(state) {
  if (batchEnd <= batchStart) return false;
  const track = state.track_window.current_track;
  const lastId = idOfUri(playQueue[batchEnd - 1]);
  return track.id === lastId || (track.linked_from && track.linked_from.id === lastId);
}

// True when the batch Spotify holds reaches the very end of the whole list
function atEndOfList() {
  return batchEnd >= playQueue.length;
}

async function handoff() {
  clearTimeout(handoffTimer);
  if (handoffBusy || playQueue.length === 0) return;
  // At the end of the list we stop, unless "repeat the list" is on: then back to the top
  if (atEndOfList() && repeatMode !== "all") return;
  const from = atEndOfList() ? 0 : batchEnd;
  handoffBusy = true;
  try {
    await sendBatch(from);
  } finally {
    handoffBusy = false;
  }
}

function scheduleHandoff(state) {
  clearTimeout(handoffTimer);
  if (repeatMode === "one") return; // Spotify itself keeps replaying this song
  if (atEndOfList() && repeatMode !== "all") return;
  if (!onLastSongOfBatch(state)) return;

  // Spotify already stopped at the end of the batch: carry on right away
  const stoppedAtEnd =
    state.paused && state.position === 0 && state.track_window.next_tracks.length === 0;
  if (stoppedAtEnd) {
    handoff();
    return;
  }
  if (state.paused) return; // you paused it yourself: wait

  const remaining = duration - currentPosition();
  handoffTimer = setTimeout(handoff, Math.max(0, remaining - HANDOFF_EARLY_MS));
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
shuffleButton.addEventListener("click", () => playFrom(null, { shuffle: true }));

function togglePlayback() {
  if (!sdkPlayer) return;
  if (sdkPlayer.activateElement) sdkPlayer.activateElement();
  sdkPlayer.togglePlay();
}

btnPlay.addEventListener("click", togglePlayback);

// ---------- The Previous button, the way Spotify does it ----------
const RESTART_AFTER_MS = 3000; // played longer than this: Previous restarts the song

function restartSong() {
  positionAtReport = 0; // update our own clock right away, don't wait for Spotify
  reportedAt = performance.now();
  updatePositionDisplay();
  sdkPlayer.seek(0);
}

function goToPrevious() {
  if (!sdkPlayer || !hasTrack) return;

  // 1) You've been listening for a while: just start this song again
  if (currentPosition() > RESTART_AFTER_MS) {
    restartSong();
    return;
  }

  const place = queueIndex.get(currentTrackId);

  // 2) A song we didn't start (for example from your phone): let Spotify decide
  if (place === undefined) {
    sdkPlayer.previousTrack();
    return;
  }

  // 3) The very first song of the list: there is nothing before it
  if (place === 0) {
    restartSong();
    return;
  }

  // 4) The song before it is still inside the batch Spotify holds: step back normally
  if (place - 1 >= batchStart) {
    sdkPlayer.previousTrack();
    return;
  }

  // 5) The song before it is in an earlier batch (or above the song you clicked
  //    to start): Spotify can't see it, so send it again, starting one song earlier
  sendBatch(place - 1);
}

btnPrev.addEventListener("click", goToPrevious);
btnNext.addEventListener("click", () => sdkPlayer && sdkPlayer.nextTrack());

// ---------- The repeat button ----------
// Click order, like Spotify: off -> repeat the list -> repeat this song -> off.
// "Repeat this song" is Spotify's own. "Repeat the list" is done by us (see handoff),
// because Spotify's own version would only loop the (up to) 100 songs it holds.
const REPEAT_TEXT = {
  off: "Repeat: off",
  all: "Repeat: the whole list",
  one: "Repeat: this song",
};

function renderRepeat() {
  btnRepeat.innerHTML = repeatMode === "one" ? REPEAT_ICONS.one : REPEAT_ICONS.all;
  btnRepeat.classList.toggle("active", repeatMode !== "off");
  btnRepeat.title = REPEAT_TEXT[repeatMode];
  btnRepeat.setAttribute("aria-label", REPEAT_TEXT[repeatMode]);
}

// Asks Spotify to repeat the current song ("track") or to stop ("off")
async function setSpotifyRepeat(wanted) {
  if (!deviceId) {
    setStatus("The player isn’t ready yet. Give it a moment.", "error");
    return false;
  }
  try {
    const token = await getToken();
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/repeat?state=${wanted}&device_id=${encodeURIComponent(deviceId)}`,
      { method: "PUT", headers: { Authorization: `Bearer ${token}` } }
    );
    if (!response.ok) {
      console.error("Repeat request failed:", response.status, await response.text());
      setStatus(`Spotify wouldn’t change repeat (error ${response.status}).`, "error");
      return false;
    }
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    return false;
  }
}

async function cycleRepeat() {
  if (repeatBusy) return;
  repeatBusy = true;
  try {
    const next = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
    // Spotify only needs to hear about it when "repeat this song" starts or stops
    if (next === "one" || repeatMode === "one") {
      const accepted = await setSpotifyRepeat(next === "one" ? "track" : "off");
      if (!accepted) return;
    }
    repeatMode = next;
    repeatChangedAt = performance.now();
    renderRepeat();
    // What should happen at the end of this song may have changed, so look again
    if (lastState) scheduleHandoff(lastState);
  } finally {
    repeatBusy = false;
  }
}

// If repeat is changed somewhere else (say, on your phone), follow along.
// Spotify reports it as: 0 = off, 1 = repeat the list, 2 = repeat the song.
function syncRepeatFromState(state) {
  if (typeof state.repeat_mode !== "number") return;
  if (performance.now() - repeatChangedAt < 2000) return; // a report from before our own click
  let mode = repeatMode;
  if (state.repeat_mode === 2) mode = "one";
  else if (state.repeat_mode === 1 && repeatMode === "off") mode = "all";
  else if (state.repeat_mode === 0 && repeatMode === "one") mode = "off";
  if (mode !== repeatMode) {
    repeatMode = mode;
    renderRepeat();
  }
}

btnRepeat.addEventListener("click", cycleRepeat);
renderRepeat();

// Spacebar = play/pause, like in Spotify. It works wherever the keyboard focus is
// (even on a button you just clicked), except while you are typing in a text box.
function isTypingTarget(element) {
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    // sliders and buttons don't use the space bar, so they don't count as typing
    return !["range", "button", "submit", "reset"].includes(element.type);
  }
  return false;
}

let spaceHandled = false; // true between pressing and releasing a space we used

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTypingTarget(event.target)) return;

  event.preventDefault(); // stops a focused button from being "pressed" by the space bar
  spaceHandled = true;
  if (!event.repeat) togglePlayback(); // holding the key down shouldn't flicker pause/play
});

// Some browsers press a focused button when the space bar is RELEASED, so cancel that too
document.addEventListener("keyup", (event) => {
  if (event.code === "Space" && spaceHandled) {
    event.preventDefault();
    spaceHandled = false;
  }
});

// After you choose something in a dropdown it keeps keyboard focus, and the space
// bar would then re-open it instead of pausing. Let go of it once you've chosen.
document.addEventListener("change", (event) => {
  if (event.target.tagName === "SELECT") event.target.blur();
});

// ---------- Connect to Spotify ----------
// Spotify's script (loaded at the bottom of index.html) calls this when it is ready.
window.onSpotifyWebPlaybackSDKReady = () => {
  sdkPlayer = new Spotify.Player({
    name: "Spotify Pins",
    volume: volume / 100,
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