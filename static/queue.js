// ======================================================================
//  Spotify Pins - the queue
//  A "+" button on every row adds that song to your REAL Spotify queue,
//  and a drawer shows what's coming up next.
//  Needs app.js and player.js loaded first.
// ======================================================================

const QUEUE_POLL_MS = 8000;   // while the drawer is open, look again this often
const QUEUE_SHOW_MAX = 30;    // how many "next from this list" songs to draw

// ---------- Build the drawer, the toast and the toggle button ----------
const queueDrawer = document.createElement("aside");
queueDrawer.className = "queue-drawer";
queueDrawer.hidden = true;
queueDrawer.innerHTML =
  `<div class="queue-head"><h3>Queue</h3>` +
  `<button class="queue-close" aria-label="Close queue">${ICONS.close}</button></div>` +
  `<div class="queue-body"></div>`;
document.body.appendChild(queueDrawer);
const queueBody = queueDrawer.querySelector(".queue-body");

const toast = document.createElement("div");
toast.className = "toast";
toast.hidden = true;
document.body.appendChild(toast);

const queueToggle = document.createElement("button");
queueToggle.className = "ctrl";
queueToggle.id = "btn-queue";
queueToggle.setAttribute("aria-label", "Show queue");
queueToggle.title = "Queue";
queueToggle.innerHTML = ICONS.queue;
document.querySelector(".controls").appendChild(queueToggle);

// ---------- A small message that fades away ----------
let toastTimer;
function showToast(text, kind = "") {
  toast.textContent = text;
  toast.className = "toast " + kind; // kind is "error" or ""
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), kind === "error" ? 4500 : 2200);
}

// ---------- Add a song to the end of the Spotify queue ----------
async function addToQueue(songId) {
  const item = itemsById.get(songId);
  const title = item ? item.song.title : "that song";
  try {
    const token = await getToken();
    // No device_id on purpose: Spotify adds it to whichever device is playing right
    // now (this tab, or your phone if that's where the music is).
    const response = await fetch(
      `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent("spotify:track:" + songId)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.ok) {
      showToast(`Added “${title}” to your queue`);
      if (!queueDrawer.hidden) setTimeout(fetchQueue, 500); // give Spotify a moment
    } else if (response.status === 404) {
      showToast("Nothing is playing yet. Start a song first, then add to the queue.", "error");
    } else if (response.status === 403) {
      showToast("Spotify wouldn’t add it. This needs Premium and an active player.", "error");
    } else {
      showToast(`Couldn’t add to the queue (error ${response.status}).`, "error");
    }
  } catch (error) {
    showToast(error.message, "error");
  }
}

// ---------- Read the queue back from Spotify ----------
let queueRequest = 0; // numbers each request so a slow, old answer can't overwrite a newer one

async function fetchQueue() {
  const mine = ++queueRequest;
  try {
    const token = await getToken();
    const response = await fetch("https://api.spotify.com/v1/me/player/queue", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (mine !== queueRequest) return;

    if (response.status === 401 || response.status === 403) {
      throw new Error("Spotify won’t show the queue yet. Run python login.py once (it asks for one new permission), then refresh this page.");
    }
    if (response.status === 204 || response.status === 404) {
      renderQueue({ currently_playing: null, queue: [] });
      return;
    }
    if (!response.ok) throw new Error(`Spotify answered with error ${response.status}.`);

    const payload = await response.json();
    if (mine !== queueRequest) return;
    renderQueue(payload);
  } catch (error) {
    if (mine !== queueRequest) return;
    queueBody.innerHTML = `<p class="queue-empty error">${escapeHtml(error.message)}</p>`;
  }
}

function queueItemHtml(track) {
  const images = (track.album && track.album.images) || [];
  const image = images[images.length - 1] || images[0];
  const artists = (track.artists || []).map((a) => a.name).join(", ") || (track.show && track.show.name) || "";
  const cover = image
    ? `<img src="${escapeHtml(image.url)}" alt="" width="40" height="40" loading="lazy">`
    : `<div class="qi-cover"></div>`;
  return (
    `<div class="queue-item">${cover}` +
    `<div class="qi-text"><div class="qi-title" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</div>` +
    `<div class="qi-artist">${escapeHtml(artists)}</div></div></div>`
  );
}

function queueSection(title, tracks, extraNote = "") {
  if (tracks.length === 0) return "";
  return (
    `<h4 class="queue-title">${escapeHtml(title)}</h4>` +
    tracks.map(queueItemHtml).join("") +
    (extraNote ? `<p class="queue-note">${escapeHtml(extraNote)}</p>` : "")
  );
}

function renderQueue(payload) {
  const now = payload.currently_playing;
  const upcoming = payload.queue || [];

  // Spotify gives one combined list. We know which songs come from the list we
  // started, in order, so anything else must be something you queued by hand.
  let queued = upcoming;
  let fromList = [];
  const place = now ? queueIndex.get(now.id) : undefined;
  if (place !== undefined) {
    const expected = playQueue.slice(place + 1).map(idOfUri);
    queued = [];
    let next = 0;
    for (const track of upcoming) {
      if (next < expected.length && track.id === expected[next]) {
        fromList.push(track);
        next += 1;
      } else {
        queued.push(track);
      }
    }
  }

  const hidden = Math.max(0, fromList.length - QUEUE_SHOW_MAX);
  let html = "";
  if (now) html += queueSection("Now playing", [now]);
  html += queueSection(place !== undefined ? "Next in queue" : "Next up", queued);
  html += queueSection(
    "Next from this list",
    fromList.slice(0, QUEUE_SHOW_MAX),
    hidden ? `+ ${hidden} more songs coming from this list` : ""
  );

  if (!now && queued.length === 0 && fromList.length === 0) {
    html = `<p class="queue-empty">Nothing is playing. Start a song, and what comes next will show up here.</p>`;
  } else if (queued.length === 0 && place !== undefined) {
    html += `<p class="queue-note">Nothing queued by hand. Use the + on any song to add it.</p>`;
  }
  queueBody.innerHTML = html;
}

// ---------- Open and close the drawer ----------
let queuePoll = null;

function openQueue() {
  queueDrawer.hidden = false;
  queueToggle.classList.add("active");
  queueBody.innerHTML = `<p class="queue-empty">Loading…</p>`;
  fetchQueue();
  // Songs you add from your phone don't tell this page, so look again every few seconds
  queuePoll = setInterval(fetchQueue, QUEUE_POLL_MS);
}

function closeQueue() {
  queueDrawer.hidden = true;
  queueToggle.classList.remove("active");
  clearInterval(queuePoll);
  queuePoll = null;
}

queueToggle.addEventListener("click", () => (queueDrawer.hidden ? openQueue() : closeQueue()));
queueDrawer.querySelector(".queue-close").addEventListener("click", closeQueue);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !queueDrawer.hidden) closeQueue();
});

// ---------- The "+" buttons in the list ----------
rowsBox.addEventListener("click", (event) => {
  const button = event.target.closest(".queue-btn");
  if (button) addToQueue(button.dataset.song);
});

// Double-clicking the + must not also start playing the row.
// (Capture phase: this runs before the row's own double-click handler.)
rowsBox.addEventListener(
  "dblclick",
  (event) => {
    if (event.target.closest(".queue-btn")) event.stopImmediatePropagation();
  },
  true
);

// ---------- Refresh when the song changes ----------
// player.js sets up the Spotify player when Spotify's script is ready. We let it
// do that, then add one more listener of our own.
const setUpPlayer = window.onSpotifyWebPlaybackSDKReady;
let lastQueueTrack = null;
window.onSpotifyWebPlaybackSDKReady = () => {
  setUpPlayer();
  sdkPlayer.addListener("player_state_changed", (state) => {
    const track = state && state.track_window && state.track_window.current_track;
    if (!track || track.id === lastQueueTrack) return;
    lastQueueTrack = track.id;
    if (!queueDrawer.hidden) setTimeout(fetchQueue, 600);
  });
};