/* ============================================================
   Running Milestones — shared layer (index.html + timeline.html)
   Sheet fetching, raw-export parsing, date/format helpers, theme.
   ============================================================ */

const SHEET_ID = "1YRHuUMLQ0J7Nhu76l6jzs8XJykrZYbEc68CJCzuAS1s";
const ACTIVITIES_TAB = "Activities";
const FUTURE_TAB = "Future Tracker";
const PAST_TAB = "Past tracker";
const IMAGE_FOLDER = "./images";
const YEAR = 2026;

const SEASON_LABEL = String(YEAR);
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_ABBR = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };

/* ---------------- Sheet fetching ---------------- */

async function fetchSheet(tab) {
  // Primary: opensheet (uses the sheet's first row as keys — perfect for a raw CSV import)
  try {
    const res = await fetch(`https://opensheet.elk.sh/${SHEET_ID}/${encodeURIComponent(tab)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (e) { /* fall through to gviz */ }

  // Fallback: Google's native public-sheet endpoint (sheet must be "Anyone with the link: Viewer")
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch sheet tab "${tab}" (${res.status})`);
  const text = await res.text();
  const json = JSON.parse(text.slice(text.indexOf("(") + 1, text.lastIndexOf(")")));
  const cols = (json.cols || []).map(c => c.label || "");
  return (json.table.rows || []).map(r => {
    const o = {};
    (r.c || []).forEach((c, i) => { o[cols[i]] = c == null || c.v == null ? "" : c.v; });
    return o;
  });
}

/* ---------------- Parsing helpers ---------------- */

function parseFlexibleDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const s = String(value).trim();
  if (!s) return null;

  // gviz-style Date object literal: Date(2026,6,7,10,30,0)
  let m = s.match(/^Date\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+),\s*(\d+),\s*(\d+))?\)/);
  if (m) return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

  // Excel serial number
  const n = Number(s);
  if (!isNaN(n) && n > 20000 && n < 80000) {
    return new Date(Math.round((n - 25569) * 86400000));
  }

  // Standard / ISO / "2026-07-07T10:30:00"
  let d = new Date(s);
  if (!isNaN(d)) return d;

  // "7 Jul 2026" / "28 Feb 2026"
  m = s.match(/^(\d{1,2})[ .\/-]([A-Za-z]{3,})[ .\/,-]+(\d{4})$/);
  if (m && MONTHS_ABBR[m[2].slice(0, 3).toUpperCase()] != null) {
    return new Date(+m[3], MONTHS_ABBR[m[2].slice(0, 3).toUpperCase()], +m[1]);
  }

  // "Jul 7, 2026"
  m = s.match(/^([A-Za-z]{3,})[ .\/-](\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS_ABBR[m[1].slice(0, 3).toUpperCase()] != null) {
    return new Date(+m[3], MONTHS_ABBR[m[1].slice(0, 3).toUpperCase()], +m[2]);
  }

  return null;
}

function pickCell(row, keys) {
  const norm = {};
  for (const k of Object.keys(row)) norm[k.toLowerCase().trim()] = row[k];
  for (const key of keys) {
    const v = norm[key.toLowerCase()];
    if (v != null && String(v).trim() !== "") return v;
  }
  return "";
}

function toSeconds(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  const num = Number(s.replace(/,/g, ""));
  if (!isNaN(num) && /^[\d.,]+$/.test(s)) return num; // already seconds
  const m = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
  const m2 = s.match(/^(\d+)m(?:[: ]?(\d+)s)?$/i);
  if (m2) return (+m2[1]) * 60 + (+m2[2] || 0);
  return null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(String(value).replace(/[, ]/g, ""));
  return isNaN(num) ? null : num;
}

/* ---------------- Activities parsing (raw export, no normalization) ---------------- */

const RAW_COLS = {
  id:      ["activity id", "id", "activityid"],
  name:    ["name", "activity name", "title"],
  type:    ["activity type", "type", "sport type", "sport"],
  start:   ["start date", "start date local", "start time local", "activity date", "start date/time", "start time"],
  distance:["distance (m)", "distance (meters)", "distance(m)", "distance", "distanz"],
  moving:  ["moving time (s)", "moving time(s)", "moving time", "moving time (seconds)", "moving time (secs)"],
  elapsed: ["elapsed time (s)", "elapsed time(s)", "elapsed time", "elapsed time (seconds)", "elapsed time (secs)", "duration"],
  elev:    ["total elevation gain (m)", "total elevation gain", "elevation gain"],
  hr:      ["average heartrate (bpm)", "average heart rate (bpm)", "average heartrate", "average heart rate"],
  commute: ["commute", "commuting"],
};

function parseActivities(rows) {
  const seen = new Set();
  const runs = [];
  for (const row of rows) {
    const type = String(pickCell(row, RAW_COLS.type));
    if (!/run/i.test(type)) continue; // runs, trail runs, run/walk only

    const start = parseFlexibleDate(pickCell(row, RAW_COLS.start));
    if (!start || start.getFullYear() !== YEAR) continue; // 2026 only

    const distanceM = toNumber(pickCell(row, RAW_COLS.distance));
    const moving = toSeconds(pickCell(row, RAW_COLS.moving));
    const elapsed = toSeconds(pickCell(row, RAW_COLS.elapsed));
    const km = distanceM != null ? distanceM / 1000 : null;
    if (km == null || km <= 0) continue;

    const name = String(pickCell(row, RAW_COLS.name)).trim() || "Untitled run";

    // De-dupe on real activity identity. The Activity ID column is unreliable:
    // Google Sheets mangles large IDs into scientific notation (e.g. "2.10E+10"),
    // collapsing distinct runs that share a rounded value.
    const dedupeKey = `${start.getTime()}|${km.toFixed(2)}|${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Only keep the ID if it is a genuine integer (safe for /activities/<id> links).
    const idRaw = String(pickCell(row, RAW_COLS.id)).trim();
    const id = /^\d{4,}$/.test(idRaw) ? idRaw : null;

    runs.push({
      id,
      name,
      type,
      start,
      iso: isoDate(start),
      km,
      moving: moving != null ? moving : elapsed,
      elapsed: elapsed != null ? elapsed : moving,
      elev: toNumber(pickCell(row, RAW_COLS.elev)),
      hr: toNumber(pickCell(row, RAW_COLS.hr)),
      commute: /^1$|^true$/i.test(String(pickCell(row, RAW_COLS.commute)).trim()),
    });
  }
  runs.sort((a, b) => a.start - b.start);
  return runs;
}

/* ---------------- Date / time formatting ---------------- */

function pad(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtDate(d) { return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; }

function fmtDuration(sec) {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return s > 0 ? `${m}m ${pad(s)}s` : `${m}m`;
  return `${s}s`;
}

function fmtPace(secPerKm) {
  if (secPerKm == null || !isFinite(secPerKm)) return "—";
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}:${pad(s)}`;
}

function fmtKm(km) {
  return km != null ? (km < 10 ? km.toFixed(2) : km.toFixed(1)) : "—";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function isRaceName(name) {
  return /race|marathon|\bhm\b|half|10k\b|5k\b|\b5km\b|\b10km\b|duat|tri|iaf|fun\s*run|run\s*for/i.test(name);
}

/* ---------------- Theme toggle (shared, persisted) ---------------- */

(function initTheme() {
  const btn = document.getElementById("theme-btn");
  if (!btn) return;
  const apply = t => {
    document.documentElement.dataset.theme = t;
    btn.textContent = t === "dark" ? "☀" : "☾";
  };
  const saved = localStorage.getItem("rt2026.theme");
  apply(saved === "light" ? "light" : "dark");
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("rt2026.theme", next);
    apply(next);
  });
})();
