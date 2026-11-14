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

// ---------- State: things the page needs to remember ----------
let data = null;            // everything the server sent us
let selectedPlaylist = "";  // "" means "all playlists"

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

// ---------- The sort options (same five as before) ----------
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
function renderRow({ song, apps, latest }) {
  const extra = apps.length - 1;
  const pill =
    extra > 0
      ? `<button class="more" data-song="${escapeHtml(song.id)}">+${extra} more</button>`
      : "";
  const cover = song.image
    ? `<img class="cover" src="${escapeHtml(song.image)}" alt="" width="40" height="40" loading="lazy">`
    : `<div class="cover" style="background:#2a2a2a"></div>`;

  return `
    <div class="row">
      <div class="cell song">
        ${cover}
        <div class="song-text">
          <div class="title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
          <div class="artist" title="${escapeHtml(song.artists)}">${escapeHtml(song.artists)}</div>
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
  const list = buildSongList();
  list.sort(SORTERS[sortSelect.value]);

  // Heading + the small line under it
  const playlistsShown = new Set();
  for (const item of list) for (const p of item.apps) playlistsShown.add(p.id);

  const chosen = data.playlists.find((p) => p.id === selectedPlaylist);
  heading.textContent = chosen ? chosen.name : "All Songs";
  subtitle.textContent =
    `${list.length.toLocaleString()} ${list.length === 1 ? "song" : "songs"}` +
    ` · ${playlistsShown.size} ${playlistsShown.size === 1 ? "playlist" : "playlists"}` +
    ` · last synced ${formatDateTime(data.synced_at)}`;

  // The list itself
  rowsBox.innerHTML = list.length
    ? list.map(renderRow).join("")
    : showMessage("No songs match these filters.");
  rowsBox.scrollTop = 0;
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

// ---------- React to the person using the page ----------
let searchTimer;
searchBox.addEventListener("input", () => {
  // wait 120ms after the last keystroke, so we don't redraw on every letter
  clearTimeout(searchTimer);
  searchTimer = setTimeout(update, 120);
});
sortSelect.addEventListener("change", update);
addedBySelect.addEventListener("change", update);

playlistList.addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (!item) return;
  selectedPlaylist = item.dataset.id;
  for (const li of playlistList.children) {
    li.classList.toggle("active", li === item);
  }
  update();
});

// ---------- Start: fetch the songs from our server ----------
async function init() {
  rowsBox.innerHTML = showMessage("Loading your library…");
  try {
    const response = await fetch("/api/songs");
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    data = await response.json();
  } catch (error) {
    subtitle.textContent = "Something went wrong";
    rowsBox.innerHTML = showMessage(`Couldn't load your songs: ${error.message}`);
    return;
  }
  renderPlaylistList();
  update();
}

init();