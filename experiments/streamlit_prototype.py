import os
import re
import sqlite3
from datetime import datetime

import pandas as pd
import streamlit as st

DB_FILE = "spotify_pins.db"

st.set_page_config(page_title="Spotify Pins", page_icon="🎧", layout="wide")

# Every sort option, and how to apply it. (column, ascending?)
SORT_OPTIONS = {
    "Date added (new → old)": ("latest", False),
    "Date added (old → new)": ("latest", True),
    "Title (A → Z)": ("title", True),
    "Artist (A → Z)": ("artists", True),
    "Most playlists first": ("n_playlists", False),
}

ADDED_BY_OPTIONS = ["Added by me", "Added by others", "Everyone"]


def esc(text):
    """Escape characters that Streamlit's markdown would treat as formatting.
    Without this, a title like 'bbno$' or '*star*' would render wrongly."""
    return re.sub(r"([!-/:-@\[-`{-~])", r"\\\1", str(text or ""))


# ---------- Load data ----------
@st.cache_data
def load_data(db_mtime):
    # db_mtime is only here so the cache refreshes when sync.py rewrites the
    # database file. Streamlit remembers results per argument value.
    conn = sqlite3.connect(DB_FILE)
    df = pd.read_sql_query(
        """
        SELECT a.song_id, a.playlist_id, a.added_at, a.added_by,
               s.name AS title, s.artists, s.album, s.image_url,
               p.name AS playlist, p.owner_id
        FROM appearances a
        JOIN songs s     ON s.song_id = a.song_id
        JOIN playlists p ON p.playlist_id = a.playlist_id
        """,
        conn,
    )
    conn.close()
    df["added_at"] = pd.to_datetime(df["added_at"], utc=True, errors="coerce").dt.tz_localize(None)
    df["by_me"] = df["added_by"] == df["owner_id"]
    return df


if not os.path.exists(DB_FILE):
    st.error(f"Can't find {DB_FILE}. Run `python sync.py` first to create it.")
    st.stop()

db_mtime = os.path.getmtime(DB_FILE)
df = load_data(db_mtime)

# ---------- Sidebar: filters ----------
with st.sidebar:
    st.header("Filters")
    search = st.text_input("Search", placeholder="song, artist, album or playlist")
    sort_label = st.selectbox("Sort by", list(SORT_OPTIONS))
    added_by_mode = st.selectbox("Added by", ADDED_BY_OPTIONS)

    playlist_lookup = (
        df.drop_duplicates("playlist_id")
        .set_index("playlist_id")["playlist"]
        .sort_values(key=lambda s: s.str.lower())
    )
    chosen_playlists = st.multiselect(
        "Only these playlists",
        options=list(playlist_lookup.index),
        format_func=lambda pid: playlist_lookup[pid],
        help="Leave empty to see songs from all playlists.",
    )

# ---------- Apply filters ----------
# "base" = rows after the added-by filter. The detail panel uses this.
if added_by_mode == "Added by me":
    base = df[df["by_me"]]
elif added_by_mode == "Added by others":
    base = df[~df["by_me"]]
else:
    base = df

view = base

# Playlist filter works like opening those playlists: you see only the entries
# (and dates) that belong to them.
if chosen_playlists:
    view = view[view["playlist_id"].isin(chosen_playlists)]

# Search works per song: if any field matches, the song stays with all its rows.
query = search.strip()
if query:
    hit = (
        view["title"].str.contains(query, case=False, regex=False, na=False)
        | view["artists"].str.contains(query, case=False, regex=False, na=False)
        | view["album"].str.contains(query, case=False, regex=False, na=False)
        | view["playlist"].str.contains(query, case=False, regex=False, na=False)
    )
    view = view[view["song_id"].isin(view.loc[hit, "song_id"].unique())]

# ---------- Collapse to one row per song ----------
view = view.sort_values("added_at", ascending=False)  # so playlist lists are newest-first

songs = (
    view.groupby("song_id", sort=False)
    .agg(
        title=("title", "first"),
        artists=("artists", "first"),
        album=("album", "first"),
        image_url=("image_url", "first"),
        latest=("added_at", "max"),
        playlists=("playlist", list),
    )
    .reset_index()
)
songs["n_playlists"] = songs["playlists"].apply(len)
songs["playlist_label"] = songs["playlists"].apply(
    lambda names: names[0] if len(names) == 1 else f"{names[0]}  +{len(names) - 1} more"
)

sort_col, ascending = SORT_OPTIONS[sort_label]
if sort_col in ("title", "artists"):
    songs = songs.sort_values(sort_col, ascending=ascending, key=lambda s: s.str.lower())
else:
    songs = songs.sort_values(sort_col, ascending=ascending, na_position="last")
songs = songs.reset_index(drop=True)

# ---------- Page ----------
st.title("🎧 All Songs")
synced = datetime.fromtimestamp(db_mtime).strftime("%d %b %Y, %H:%M")
st.caption(
    f"{len(songs):,} songs  ·  {view['playlist_id'].nunique()} playlists  ·  "
    f"last synced {synced}"
)

if songs.empty:
    st.info("No songs match these filters.")
    st.stop()

left, right = st.columns([3, 1.4], gap="large")

with left:
    table = songs[["image_url", "title", "artists", "album", "playlist_label", "latest"]]
    event = st.dataframe(
        table,
        hide_index=True,
        width="stretch",
        height=640,
        row_height=56,
        on_select="rerun",
        selection_mode="single-row",
        key="song_table",
        column_config={
            "image_url": st.column_config.ImageColumn("", width="small"),
            "title": st.column_config.TextColumn("Title", width="large"),
            "artists": st.column_config.TextColumn("Artist", width="medium"),
            "album": st.column_config.TextColumn("Album", width="medium"),
            "playlist_label": st.column_config.TextColumn("Playlists", width="medium"),
            "latest": st.column_config.DateColumn("Date added", format="DD MMM YYYY"),
        },
    )

with right:
    selected = event.selection.rows
    if not selected:
        st.markdown("#### Song details")
        st.caption(
            "Tick the box at the left edge of any row to see every playlist "
            "that song is in."
        )
    else:
        song = songs.iloc[selected[0]]
        if isinstance(song["image_url"], str) and song["image_url"]:
            st.image(song["image_url"], width="stretch")
        st.markdown(f"### {esc(song['title'])}")
        st.markdown(esc(song["artists"]))
        if song["album"]:
            st.caption(f"💿 {song['album']}")

        detail = base[base["song_id"] == song["song_id"]].sort_values(
            "added_at", ascending=False
        )
        st.markdown(f"**In {len(detail)} playlist{'s' if len(detail) != 1 else ''}**")
        detail_table = pd.DataFrame(
            {
                "Playlist": detail["playlist"].values,
                "Added": detail["added_at"].values,
                "By": ["me" if m else str(b) for m, b in zip(detail["by_me"], detail["added_by"])],
            }
        )
        st.dataframe(
            detail_table,
            hide_index=True,
            width="stretch",
            column_config={
                "Added": st.column_config.DateColumn("Added", format="DD MMM YYYY"),
            },
        )