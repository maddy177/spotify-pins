// ======================================================================
//  Spotify Pins - the Sync button
//  Asks the server to re-fetch your playlists from Spotify, shows the
//  progress, and redraws the list when it's done (without reloading the
//  page, so music keeps playing).
//  Needs app.js loaded first (it calls refreshAfterSync).
// ======================================================================

const syncButton = document.getElementById("sync-btn");
const syncMessage = document.getElementById("sync-msg");
let syncing = false;

function setSyncMessage(text, kind = "") {
  syncMessage.textContent = text;
  syncMessage.className = "sync-msg " + kind; // kind is "ok", "error" or ""
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Check the server's progress until it says the sync is over
async function waitForSync() {
  while (true) {
    await wait(700);
    const response = await fetch("/api/sync/status", { cache: "no-store" });
    const status = await response.json();

    if (status.running) {
      setSyncMessage(
        status.total ? `Syncing… ${status.done} of ${status.total} playlists` : "Syncing…"
      );
      continue;
    }
    if (status.error) throw new Error(status.error);

    await refreshAfterSync();
    const songs = status.summary ? status.summary.songs.toLocaleString() : "your";
    setSyncMessage(`Synced · ${songs} songs`, "ok");
    return;
  }
}

async function startSync() {
  if (syncing) return;
  syncing = true;
  syncButton.disabled = true;
  syncButton.classList.add("spinning");
  setSyncMessage("Starting…");

  try {
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "X-Requested-With": "spotify-pins" }, // proves the request comes from this page
    });
    const body = await response.json().catch(() => ({}));
    // 409 means a sync is already running (e.g. started before a refresh): just wait for it
    if (!response.ok && response.status !== 409) {
      throw new Error(body.error || `the server answered ${response.status}`);
    }
    await waitForSync();
  } catch (error) {
    setSyncMessage(error.message, "error");
  } finally {
    syncing = false;
    syncButton.disabled = false;
    syncButton.classList.remove("spinning");
  }
}

syncButton.addEventListener("click", startSync);