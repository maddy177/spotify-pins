// ======================================================================
//  Spotify Pins - front end
//  Flow: ask the server for all songs -> keep them in memory ->
//        every time a filter changes, rebuild the list on screen.
// ======================================================================

// ---------- The page elements we need to read from or write to ----------
const searchBox = document.getElementById("search");
const sortSelect = document.getElementById("sort");
const addedBySelect = document.getElementById("added-by");
const playlistList = document.getElementById("playlist-list");
const rowsBox = document.getElementById("rows");
const heading = document.getElementById("heading");
const subtitle = document.getElementById("subtitle");
const tabPlaylists = document.getElementById("tab-playlists");
const tabArtists = document.getElementById("tab-artists");
const artistList = document.getElementById("artist-list");
const artistFilter = document.getElementById("artist-filter");

// ---------- State: things the page needs to remember ----------
let data = null;            // everything the server sent us
let selectedPlaylist = "";  // "" means "all playlists"
let itemsById = new Map();  // song id -> what's currently shown for that song
let currentList = [];       // the songs on screen, in the order shown (the player uses this)
let selectedArtist = "";    // "" means "all artists"
let artistNames = new Map();// artist id -> name
let hasArtists = false;     // false until sync.py has been run with artist support
let lastRenderAt = 0;       // when the list was last redrawn (see the double-click guard)
let activePill = null;      // the "+N more" button whose popup is open

// The popup is created once and reused. It lives outside the list so that
// the list's scrolling can't clip it.
const popup = document.createElement("div");
popup.className = "popup";
popup.hidden = true;
document.body.appendChild(popup);

// ---------- Icons (small drawings, shared with player.js) ----------
const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM20 6v12L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM4 6v12l10.5-6z"/></svg>',
};

// ---------- Small helper functions ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return "unknown";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)}, ${hh}:${mm}`;
}

// Song names can contain characters like < & " that mean something in HTML.
// This turns them into harmless text before we put them on the page.
function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compareText(a, b) {
  return (a || "").localeCompare(b || "", undefined, { sensitivity: "base" });
}

// ---------- The sort options ----------
const SORTERS = {
  "date-desc": (a, b) => b.latest.localeCompare(a.latest),
  "date-asc": (a, b) => a.latest.localeCompare(b.latest),
  "title": (a, b) => compareText(a.song.title, b.song.title),
  "artist": (a, b) => compareText(a.song.artists, b.song.artists),
  "most-playlists": (a, b) =>
    b.apps.length - a.apps.length || b.latest.localeCompare(a.latest),
};

// ---------- Step 1: apply the filters, one entry per song ----------
function buildSongList() {
  const mode = addedBySelect.value;
  const query = searchBox.value.trim().toLowerCase();
  const result = [];

  for (const song of data.songs) {
    if (selectedArtist && !(song.artist_list || []).some((a) => a.id === selectedArtist)) continue;

    // "apps" = this song's playlist entries that survive the filters
    let apps = song.playlists;
    if (mode === "me") apps = apps.filter((p) => p.by_me);
    else if (mode === "others") apps = apps.filter((p) => !p.by_me);
    if (selectedPlaylist) apps = apps.filter((p) => p.id === selectedPlaylist);
    if (apps.length === 0) continue;

    if (query) {
      const searchable = [song.title, song.artists, song.album, ...apps.map((p) => p.name)]
        .join("\n")
        .toLowerCase();
      if (!searchable.includes(query)) continue;
    }

    // The song's date = the latest date among its remaining entries
    let latest = "";
    for (const p of apps) {
      if ((p.added_at || "") > latest) latest = p.added_at;
    }
    result.push({ song, apps, latest });
  }
  return result;
}

// ---------- Step 2: turn one song into a row of HTML ----------

// Each artist becomes its own clickable name. (If the database has no artist
// data yet, we fall back to the plain text.)
function renderArtists(song) {
  const list = song.artist_list || [];
  if (list.length === 0) return escapeHtml(song.artists);
  return list
    .map((a) => `<span class="artist-link" data-artist="${escapeHtml(a.id)}">${escapeHtml(a.name)}</span>`)
    .join(", ");
}

function renderRow({ song, apps, latest }) {
  const extra = apps.length - 1;
  const pill =
    extra > 0
      ? `<button class="more" data-song="${escapeHtml(song.id)}" aria-expanded="false">+${extra} more</button>`
      : "";
  const cover = song.image
    ? `<img class="cover" src="${escapeHtml(song.image)}" alt="" width="40" height="40" loading="lazy">`
    : `<div class="cover" style="background:#2a2a2a"></div>`;

  return `
    <div class="row" data-song="${escapeHtml(song.id)}">
      <div class="cell song">
        <div class="cover-wrap">
          ${cover}
          <button class="play-btn" data-song="${escapeHtml(song.id)}" aria-label="Play">${ICONS.play}</button>
        </div>
        <div class="song-text">
          <div class="title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
          <div class="artist" title="${escapeHtml(song.artists)}">${renderArtists(song)}</div>
        </div>
      </div>
      <div class="cell album" title="${escapeHtml(song.album)}">${escapeHtml(song.album)}</div>
      <div class="cell playlists">
        <span class="pl-name" title="${escapeHtml(apps[0].name)}">${escapeHtml(apps[0].name)}</span>
        ${pill}
      </div>
      <div class="cell date">${formatDate(latest)}</div>
    </div>`;
}

// ---------- Step 3: filter, sort, draw ----------
function update() {
  closePopup(); // the list is about to be redrawn, so any open popup is stale

  const list = buildSongList();
  list.sort(SORTERS[sortSelect.value]);
  currentList = list;
  itemsById = new Map(list.map((item) => [item.song.id, item]));

  // Heading + the small line under it
  const playlistsShown = new Set();
  for (const item of list) for (const p of item.apps) playlistsShown.add(p.id);

  const chosen = data.playlists.find((p) => p.id === selectedPlaylist);
  heading.textContent = selectedArtist
    ? artistNames.get(selectedArtist) || "Artist"
    : chosen ? chosen.name : "All Songs";
  subtitle.textContent =
    `${list.length.toLocaleString()} ${list.length === 1 ? "song" : "songs"}` +
    ` · ${playlistsShown.size} ${playlistsShown.size === 1 ? "playlist" : "playlists"}` +
    ` · last synced ${formatDateTime(data.synced_at)}`;

  // The list itself
  rowsBox.innerHTML = list.length
    ? list.map(renderRow).join("")
    : showMessage("No songs match these filters.");
  rowsBox.scrollTop = 0;
  lastRenderAt = performance.now();

  // If a song is playing, highlight its row again after the redraw
  if (typeof markPlayingRow === "function") markPlayingRow();
}

function showMessage(text) {
  return `<div style="padding: 24px 16px; color: #b3b3b3;">${escapeHtml(text)}</div>`;
}

// ---------- The playlist list in the sidebar ----------
function renderPlaylistList() {
  const items = [{ id: "", name: "All playlists" }, ...data.playlists];
  playlistList.innerHTML = items
    .map(
      (p) =>
        `<li data-id="${escapeHtml(p.id)}" title="${escapeHtml(p.name)}"` +
        `${p.id === selectedPlaylist ? ' class="active"' : ""}>${escapeHtml(p.name)}</li>`
    )
    .join("");
}

// ---------- The artists tab ----------
function renderArtistList() {
  if (!hasArtists) {
    artistList.innerHTML = `<li style="white-space: normal;">Run <b>python sync.py</b> once to load your artists.</li>`;
    return;
  }

  // Count songs per artist, using only songs that pass the "Added by" filter
  const mode = addedBySelect.value;
  const counts = new Map();
  for (const song of data.songs) {
    const visible = song.playlists.some(
      (p) => mode === "all" || (mode === "me" ? p.by_me : !p.by_me)
    );
    if (!visible) continue;
    for (const a of song.artist_list || []) {
      const entry = counts.get(a.id) || { id: a.id, name: a.name, count: 0 };
      entry.count += 1;
      counts.set(a.id, entry);
    }
  }

  const query = artistFilter.value.trim().toLowerCase();
  const items = [...counts.values()]
    .filter((a) => !query || a.name.toLowerCase().includes(query))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));

  artistList.innerHTML =
    `<li data-id="">All artists</li>` +
    items
      .map(
        (a) =>
          `<li data-id="${escapeHtml(a.id)}" title="${escapeHtml(a.name)}">` +
          `<span class="al-name">${escapeHtml(a.name)}</span>` +
          `<span class="al-count">${a.count}</span></li>`
      )
      .join("");
  markActive(artistList, selectedArtist);
}

function showTab(name) {
  const artists = name === "artists";
  tabPlaylists.classList.toggle("active", !artists);
  tabArtists.classList.toggle("active", artists);
  tabPlaylists.setAttribute("aria-selected", String(!artists));
  tabArtists.setAttribute("aria-selected", String(artists));
  playlistList.hidden = artists;
  artistList.hidden = !artists;
  artistFilter.hidden = !artists;
  if (artists) renderArtistList();
}

// Highlight the chosen entry of a sidebar list
function markActive(listEl, id) {
  for (const li of listEl.children) {
    if (li.dataset.id === undefined) continue;
    const isThis = li.dataset.id === id;
    li.classList.toggle("active", isThis);
    if (isThis && !listEl.hidden) li.scrollIntoView({ block: "nearest" });
  }
}

// You are looking at ONE thing at a time: a playlist, or an artist, or everything.
function setSelection({ playlist = "", artist = "" }) {
  selectedPlaylist = playlist;
  selectedArtist = artist;
  markActive(playlistList, selectedPlaylist);
  markActive(artistList, selectedArtist);
  update();
}

// Used by the sidebar AND by the popup: jump into one playlist
function selectPlaylist(id) {
  setSelection({ playlist: id });
}

function selectArtist(id) {
  setSelection({ artist: id });
}

// ---------- The "+N more" popup ----------
function openPopup(pill) {
  const item = itemsById.get(pill.dataset.song);
  if (!item) return;

  const count = item.apps.length;
  const entries = item.apps
    .map((p) => {
      const others = p.by_me
        ? ""
        : ` <span title="${escapeHtml(p.added_by)}">(added by someone else)</span>`;
      return (
        `<li><button class="popup-item" data-id="${escapeHtml(p.id)}">` +
        `<span class="popup-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>` +
        `<span class="popup-date">${formatDate(p.added_at)}${others}</span>` +
        `</button></li>`
      );
    })
    .join("");

  popup.innerHTML =
    `<div class="popup-head">In ${count} playlists</div>` +
    `<ul>${entries}</ul>` +
    `<div class="popup-hint">Click a playlist to open it</div>`;
  popup.hidden = false;

  // Place it under the pill, but keep it on screen
  const rect = pill.getBoundingClientRect();
  const width = popup.offsetWidth;
  const height = popup.offsetHeight;
  const margin = 12;

  let left = Math.min(rect.left, window.innerWidth - width - margin);
  left = Math.max(margin, left);

  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - height - 6); // not enough room below: flip above
  }
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  activePill = pill;
  pill.setAttribute("aria-expanded", "true");
}

function closePopup() {
  popup.hidden = true;
  if (activePill) {
    activePill.setAttribute("aria-expanded", "false");
    activePill = null;
  }
}

// ---------- React to the person using the page ----------
let searchTimer;
searchBox.addEventListener("input", () => {
  // wait 120ms after the last keystroke, so we don't redraw on every letter
  clearTimeout(searchTimer);
  searchTimer = setTimeout(update, 120);
});
sortSelect.addEventListener("change", update);
addedBySelect.addEventListener("change", () => {
  update();
  renderArtistList(); // the counts next to each artist depend on this filter
});

tabPlaylists.addEventListener("click", () => showTab("playlists"));
tabArtists.addEventListener("click", () => showTab("artists"));
artistFilter.addEventListener("input", renderArtistList);

artistList.addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (item && item.dataset.id !== undefined) selectArtist(item.dataset.id);
});

playlistList.addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (item) selectPlaylist(item.dataset.id);
});

// One click listener for the whole page decides what a click meant
document.addEventListener("click", (event) => {
  // Clicking an artist's name under a song: open that artist
  const artistLink = event.target.closest(".artist-link");
  if (artistLink) {
    showTab("artists");
    selectArtist(artistLink.dataset.artist);
    return;
  }

  const pill = event.target.closest(".more");
  if (pill) {
    if (pill === activePill) closePopup();
    else {
      closePopup();
      openPopup(pill);
    }
    return;
  }

  const entry = event.target.closest(".popup-item");
  if (entry) {
    selectPlaylist(entry.dataset.id);
    return;
  }

  if (!event.target.closest(".popup")) closePopup();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePopup();
});

// Clicking an artist's name redraws the list instantly. If that click was the
// first half of a double-click, the second half would land on a brand new row
// and start playing it. So double-clicks right after a redraw are ignored.
// (This listener is registered before player.js's, so it gets to stop it.)
rowsBox.addEventListener("dblclick", (event) => {
  if (performance.now() - lastRenderAt < 600) event.stopImmediatePropagation();
});

// A fixed-position popup would drift away from its pill, so close it instead
rowsBox.addEventListener("scroll", closePopup, { passive: true });
window.addEventListener("resize", closePopup);

// ---------- Loading the data ----------
// Fetches everything from our server and keeps it in `data`.
// (Separate from drawing, so a sync can refresh the data without a page reload.
// A reload would kill the music, because the player lives in this page.)
async function loadData() {
  const response = await fetch("/api/songs", { cache: "no-store" });
  if (!response.ok) throw new Error(`the server answered ${response.status}`);
  data = await response.json();

  artistNames = new Map();
  for (const song of data.songs) {
    for (const a of song.artist_list || []) artistNames.set(a.id, a.name);
  }
  hasArtists = artistNames.size > 0;

  // If what you had selected no longer exists (e.g. you deleted that playlist), reset it
  if (selectedPlaylist && !data.playlists.some((p) => p.id === selectedPlaylist)) selectedPlaylist = "";
  if (selectedArtist && !artistNames.has(selectedArtist)) selectedArtist = "";
}

// Called by sync.js when a sync has finished
async function refreshAfterSync() {
  await loadData();
  renderPlaylistList();
  renderArtistList();
  update();
}

// ---------- Start ----------
async function init() {
  rowsBox.innerHTML = showMessage("Loading your library…");
  try {
    await loadData();
  } catch (error) {
    subtitle.textContent = "Something went wrong";
    rowsBox.innerHTML = showMessage(`Couldn't load your songs: ${error.message}`);
    return;
  }
  renderPlaylistList();
  renderArtistList();
  update();
}

init();