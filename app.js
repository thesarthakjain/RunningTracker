/* ============================================================
   Running Milestones — data layer + renderer
   Reads 3 tabs from the Google Sheet (via opensheet, with a
   Google gviz fallback):
     - Activities    : RAW Strava bulk-export CSV, untouched
     - Future Tracker: upcoming goals
     - Past tracker  : curated past milestones
   Computes everything client-side for the 2026 season.
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

/* ---------------- DOM refs ---------------- */

const sectionsContainer = document.getElementById("sections-container");
const futureSection = document.getElementById("future-section");
const pastSection = document.getElementById("past-section");
const futureTimeline = document.getElementById("future-timeline");
const pastTimeline = document.getElementById("past-timeline");
const futureHeading = document.getElementById("future-heading");
const pastHeading = document.getElementById("past-heading");
const sortBtn = document.getElementById("sort-btn");

let isOldestFirst = false;
let isAnimating = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

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

/* ---------------- Milestone computation ---------------- */

function bestInClass(runs, minKm, maxKm) {
  const inClass = runs.filter(r => r.km >= minKm && r.km <= maxKm && r.moving != null);
  if (!inClass.length) return null;
  inClass.sort((a, b) => a.moving - b.moving);
  return inClass[0];
}

function computeMilestones(runs) {
  if (!runs.length) return null;
  const byMoving = [...runs].sort((a, b) => (b.moving || 0) - (a.moving || 0));
  const byDistance = [...runs].sort((a, b) => b.km - a.km);
  const first = runs[0];
  const longestDist = byDistance[0];
  const longestTime = byMoving[0];
  const fast5 = bestInClass(runs, 4.9, 5.6);
  const fast10 = bestInClass(runs, 9.9, 11.0);
  const firstRace = runs.find(r => isRaceName(r.name)) || null;

  return {
    first, longestDist, longestTime, fast5, fast10, firstRace,
    totals: {
      count: runs.length,
      km: runs.reduce((s, r) => s + r.km, 0),
      time: runs.reduce((s, r) => s + (r.moving || 0), 0),
    },
  };
}

function isRaceName(name) {
  return /race|marathon|\bhm\b|half|10k\b|5k\b|\b5km\b|\b10km\b|duat|tri|iaf|fun\s*run|run\s*for/i.test(name);
}

/* ---------------- Streaks ---------------- */

function isoWeekNumber(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7; // Mon = 0
  t.setDate(t.getDate() - day + 3); // Thursday of this ISO week
  const jan4 = new Date(t.getFullYear(), 0, 4);
  jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3);
  return 1 + Math.round((t - jan4) / (7 * 86400000));
}

function weekKey(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;
  t.setDate(t.getDate() - day + 3);
  return `${t.getFullYear()}-W${isoWeekNumber(t)}`;
}

function weekKeyToThursday(key) {
  const [y, w] = key.split("-W").map(Number);
  const jan4 = new Date(y, 0, 4);
  jan4.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + 3);
  const thu = new Date(jan4);
  thu.setDate(jan4.getDate() + (w - 1) * 7);
  return thu;
}

function prevWeekKey(key) {
  const thu = weekKeyToThursday(key);
  thu.setDate(thu.getDate() - 7);
  return `${thu.getFullYear()}-W${isoWeekNumber(thu)}`;
}

function computeStreaks(runs) {
  const active = new Set(runs.map(r => weekKey(r.start)));
  let current = 0;
  let key = weekKey(new Date());
  if (!active.has(key)) key = prevWeekKey(key); // current week may still be in progress
  while (active.has(key)) { current++; key = prevWeekKey(key); }

  // best streak across all active weeks
  const sorted = [...active].map(k => k.split("-W").map(Number)).sort((a, b) =>
    a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);
  let best = 0, runLen = 0, prev = null;
  for (const [y, w] of sorted) {
    runLen = (prev && prev[0] === y && prev[1] === w - 1) ? runLen + 1 : 1;
    best = Math.max(best, runLen);
    prev = [y, w];
  }

  return { current, best, activeWeeks: active.size };
}

/* ---------------- Rendering: overview + milestones ---------------- */

function statCard(label, value, unit, sub) {
  return `<div class="stat-card">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}${unit ? `<span class="unit">${unit}</span>` : ""}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
  </div>`;
}

function renderOverview(runs, milestones) {
  const section = document.getElementById("overview");
  const status = document.getElementById("overview-status");
  const hero = document.getElementById("hero-stats");

  if (!runs.length) {
    status.textContent = `No ${SEASON_LABEL} runs found in the Activities tab yet. (Make sure the raw Strava export is pasted in, including its header row.)`;
    status.classList.add("error");
    return;
  }

  status.hidden = true;
  hero.hidden = false;

  const t = milestones.totals;
  const avgPace = t.time > 0 ? t.time / t.km : null;
  hero.innerHTML =
    statCard("Runs", t.count, "runs") +
    statCard("Distance", fmtKm(t.km), "km") +
    statCard("Moving time", fmtDuration(t.time), "") +
    statCard("Avg pace", fmtPace(avgPace), "/km");

  const newest = runs[runs.length - 1];
  document.getElementById("data-as-of").textContent =
    `data as of ${fmtDate(newest.start)}`;
}

function milestoneCard(icon, label, value, unit, run, valueFmt) {
  const v = !run ? "—" : valueFmt ? valueFmt(run) : (value == null ? fmtKm(run.km) : value);
  const sub = run
    ? `<span>${escapeHtml(run.name)}</span><span class="m-date">${fmtDate(run.start)}</span>`
    : `<span class="m-date">not yet in ${SEASON_LABEL} data</span>`;
  const link = run ? `<a class="strava-mini" href="https://www.strava.com/activities/${encodeURIComponent(run.id)}" target="_blank" rel="noopener noreferrer">Strava ↗</a>` : `<span class="m-date"></span>`;
  return `<div class="milestone-card">
    <div class="m-label"><span>${icon}</span> ${label}</div>
    <div class="m-value">${v}${unit ? `<span class="unit">${unit}</span>` : ""}</div>
    <div class="m-meta" title="${escapeHtml(run ? run.name : "")}">${sub}</div>
    ${run ? `<div class="m-meta" style="justify-content:flex-end">${link}</div>` : ""}
  </div>`;
}

function renderMilestones(runs, m) {
  const section = document.getElementById("milestone-section");
  const grid = document.getElementById("milestone-grid");
  section.hidden = false;
  grid.innerHTML =
    milestoneCard("🏁", "First run", null, null, m.first) +
    milestoneCard("📏", "Longest distance", m.longestDist ? fmtKm(m.longestDist.km) : "—", "km", m.longestDist) +
    milestoneCard("⏱️", "Longest time", m.longestTime ? fmtDuration(m.longestTime.moving) : "—", "", m.longestTime) +
    milestoneCard("⚡", "Fastest 5k", m.fast5 ? fmtPace(m.fast5.moving / m.fast5.km) : "—", "/km", m.fast5) +
    milestoneCard("🏃", "Fastest 10k", m.fast10 ? fmtPace(m.fast10.moving / m.fast10.km) : "—", "/km", m.fast10) +
    milestoneCard("🏆", "First race", m.firstRace ? fmtKm(m.firstRace.km) : "—", "km", m.firstRace);
}

/* ---------------- Rendering: consistency ---------------- */

function renderStreak(runs, runsByDay, streaks) {
  const card = document.getElementById("streak-card");
  card.hidden = false;
  const activeDays = Object.keys(runsByDay).length;
  card.innerHTML = `
    <div class="streak-hero">
      <span class="streak-flame">🔥</span>
      <span class="streak-number">${streaks.current}</span>
      <span class="streak-unit">week${streaks.current === 1 ? "" : "s"} streak</span>
    </div>
    <div class="streak-stats">
      <div class="streak-stat">
        <div class="stat-label">Best streak</div>
        <div class="stat-value">${streaks.best}<span class="unit">wk</span></div>
      </div>
      <div class="streak-stat">
        <div class="stat-label">Active weeks</div>
        <div class="stat-value">${streaks.activeWeeks}</div>
      </div>
      <div class="streak-stat">
        <div class="stat-label">Run days</div>
        <div class="stat-value">${activeDays}</div>
      </div>
    </div>
    <div class="streak-note">A week counts if you ran at least once in it (Mon–Sun). Streaks are Strava-style.</div>`;
}

function renderHeatmap(runs, runsByDay) {
  const wrap = document.getElementById("heatmap-wrap");
  wrap.hidden = false;

  const seasonEnd = new Date(YEAR, 11, 31);
  const today = new Date();

  // Always render the whole year (Mon–Sun weeks); older weeks are hidden on
  // mobile via CSS so the grid fits ~6 months on a phone.
  const startMonday = new Date(YEAR, 0, 1);
  startMonday.setDate(startMonday.getDate() - ((startMonday.getDay() + 6) % 7));
  const todayMonday = new Date(today);
  todayMonday.setDate(todayMonday.getDate() - ((todayMonday.getDay() + 6) % 7));
  const endMonday = new Date(Math.min(todayMonday, new Date(seasonEnd)));
  endMonday.setDate(endMonday.getDate() - ((endMonday.getDay() + 6) % 7));
  const endMondayClamped = endMonday < startMonday ? new Date(startMonday) : endMonday;

  // Weeks older than this get the "old" class (hidden on small screens)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 182); // ~6 months

  let cols = 0;
  const cells = [];
  for (let monday = new Date(startMonday); monday <= endMondayClamped; monday.setDate(monday.getDate() + 7)) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + d);
      const iso = isoDate(day);
      const entry = runsByDay[iso];
      let cellCls = "hm-cell", tip = `${fmtDate(day)}`;
      if (day > seasonEnd || day > today) {
        cellCls += " future";
      } else if (entry) {
        cellCls += entry.km < 8 ? " lv1" : entry.km < 12 ? " lv2" : " lv3";
        tip += ` · ${fmtKm(entry.km)} km · ${entry.runs.length} run${entry.runs.length > 1 ? "s" : ""}`;
      } else {
        tip += ` · no run`;
      }
      cells.push(`<div class="${cellCls}" title="${escapeHtml(tip)}"></div>`);
    }
    cols++;
  }
  // Wrap each week in a column so mobile can hide whole weeks
  let weekHtml = "";
  for (let c = 0; c < cols; c++) {
    const isOld = new Date(startMonday.getTime() + c * 7 * 86400000) < cutoff;
    weekHtml += `<div class="hm-col${isOld ? " old" : ""}">${cells.slice(c * 7, c * 7 + 7).join("")}</div>`;
  }
  document.getElementById("heatmap").innerHTML = weekHtml;

  // month labels — one slot per week column (so slots hide in sync with
  // .hm-col on mobile); the name goes in the slot of the week containing the 1st
  const labelCol = new Array(cols).fill("");
  for (let mIdx = 0; mIdx < 12; mIdx++) {
    const firstOfMonth = new Date(YEAR, mIdx, 1);
    const weekMonday = new Date(firstOfMonth);
    weekMonday.setDate(firstOfMonth.getDate() - ((firstOfMonth.getDay() + 6) % 7));
    const c = Math.round((weekMonday - startMonday) / (7 * 86400000));
    if (c >= 0 && c < cols) labelCol[c] = MONTHS_SHORT[mIdx];
  }
  let html = "";
  for (let c = 0; c < cols; c++) {
    const isOld = new Date(startMonday.getTime() + c * 7 * 86400000) < cutoff;
    html += `<span class="hm-month-slot${isOld ? " old" : ""}">${labelCol[c]}</span>`;
  }
  document.getElementById("heatmap-months").innerHTML = html;
}

/* ---------------- Rendering: charts ---------------- */

function renderMonthlyChart(runs) {
  const kmByMonth = new Array(12).fill(0);
  const countByMonth = new Array(12).fill(0);
  for (const r of runs) { kmByMonth[r.start.getMonth()] += r.km; countByMonth[r.start.getMonth()]++; }

  const max = Math.max(...kmByMonth, 1);
  const el = document.getElementById("monthly-chart");
  el.innerHTML = kmByMonth.map((km, i) => {
    const h = km === 0 ? 3 : Math.max(6, (km / max) * 100);
    return `<div class="bar ${km === 0 ? "zero" : ""}" style="height:${h}%;animation-delay:${i * 40}ms">
      <span class="bar-tip">${MONTHS_SHORT[i]} · ${fmtKm(km)} km · ${countByMonth[i]} run${countByMonth[i] === 1 ? "" : "s"}</span>
    </div>`;
  }).join("");
  el.insertAdjacentHTML("afterend",
    `<div class="chart-labels">${MONTHS_SHORT.map(m => `<span>${m[0]}</span>`).join("")}</div>`);
}

function renderWeeklyChart(runs) {
  const seasonEnd = new Date(YEAR, 11, 31);
  const today = new Date();
  // Start one week before the first run of the season
  const firstRunMonday = new Date(runs[0].start);
  firstRunMonday.setHours(0, 0, 0, 0);
  firstRunMonday.setDate(firstRunMonday.getDate() - ((firstRunMonday.getDay() + 6) % 7));
  const startMonday = new Date(firstRunMonday);
  startMonday.setDate(startMonday.getDate() - 7);
  let endMonday = new Date(Math.min(today, seasonEnd));
  endMonday.setDate(endMonday.getDate() - ((endMonday.getDay() + 6) % 7));
  if (endMonday < startMonday) endMonday = new Date(startMonday);

  const weeks = [];
  for (let m = new Date(startMonday); m <= endMonday; m.setDate(m.getDate() + 7)) weeks.push(new Date(m));

  const kmByWeek = weeks.map(monday => {
    let km = 0;
    for (const r of runs) {
      const d = new Date(r.start);
      d.setHours(0, 0, 0, 0);
      if (d >= monday && d < new Date(monday.getTime() + 7 * 86400000)) km += r.km;
    }
    return km;
  });

  const W = 560, H = 130, PAD = 10;
  const max = Math.max(...kmByWeek, 1);
  const pts = kmByWeek.map((km, i) => {
    const x = weeks.length === 1 ? W / 2 : PAD + (i / (weeks.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - (km / max) * (H - 2 * PAD);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD} L${pts[0][0].toFixed(1)},${H - PAD} Z`;

  const dots = pts.map((p, i) => {
    const mon = weeks[i];
    const sun = new Date(mon.getTime() + 6 * 86400000);
    const label = `${fmtDate(mon)} – ${fmtDate(sun)} · ${fmtKm(kmByWeek[i])} km`;
    return `<circle class="week-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5"><title>${escapeHtml(label)}</title></circle>`;
  }).join("");

  document.getElementById("weekly-chart").innerHTML =
    `<div class="line-chart-wrap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="weekFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fc5200" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="#fc5200" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path class="week-area" d="${area}"/>
      <path class="week-line" d="${line}"/>
      ${dots}
    </svg></div>`;

  let bestIdx = 0;
  kmByWeek.forEach((km, i) => { if (km > kmByWeek[bestIdx]) bestIdx = i; });
  if (kmByWeek[bestIdx] > 0) {
    const mon = weeks[bestIdx];
    const sun = new Date(mon.getTime() + 6 * 86400000);
    document.getElementById("best-week").innerHTML =
      `Most active week: <b>${fmtDate(mon)} – ${fmtDate(sun)}</b> · <b>${fmtKm(kmByWeek[bestIdx])} km</b>`;
  }
}

/* ---------------- Rendering: personal records ---------------- */

const PR_CLASSES = [
  { label: "5K", min: 4.9, max: 5.6 },
  { label: "10K", min: 9.9, max: 11.0 },
  { label: "3K", min: 2.9, max: 3.5 },
  { label: "15K", min: 14.8, max: 15.8 },
];
const PR_SEEN_KEY = `rt2026.prSeen`;

function renderPRs(runs) {
  const section = document.getElementById("pr-section");
  const grid = document.getElementById("pr-grid");
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(PR_SEEN_KEY) || "{}"); } catch (e) { seen = {}; }

  let newPRs = 0;
  grid.innerHTML = "";
  for (const cls of PR_CLASSES) {
    const best = bestInClass(runs, cls.min, cls.max);
    if (!best) continue;
    const pace = best.moving / best.km;
    const prev = seen[cls.label];
    const isNew = prev != null && pace < prev.pace - 0.5; // >0.5 s/km faster
    if (isNew) newPRs++;
    const link = `<a class="strava-mini" href="https://www.strava.com/activities/${encodeURIComponent(best.id)}" target="_blank" rel="noopener noreferrer">Strava ↗</a>`;
    grid.insertAdjacentHTML("beforeend",
      `<div class="pr-card" data-pr="${cls.label}">
        ${isNew ? `<span class="pr-badge">NEW PR 🎉</span>` : ""}
        <div class="pr-dist">${cls.label} best</div>
        <div class="pr-value">${fmtPace(pace)} <span style="font-size:0.75rem;color:var(--muted)">/km</span></div>
        <div class="pr-meta">
          <span>${escapeHtml(best.name)}</span>
          <span>${fmtDate(best.start)}</span>
        </div>
        <div class="pr-meta" style="justify-content:flex-end">${link}</div>
        ${isNew ? `<button class="pr-ack" data-pr="${cls.label}">Nice! Got it 👌</button>` : ""}
      </div>`);
  }

  if (!grid.children.length) { section.hidden = true; return; }
  section.hidden = false;

  grid.querySelectorAll(".pr-ack").forEach(btn => {
    btn.addEventListener("click", () => {
      const label = btn.dataset.pr;
      const best = bestInClass(runs,
        PR_CLASSES.find(c => c.label === label).min,
        PR_CLASSES.find(c => c.label === label).max);
      seen[label] = { pace: best.moving / best.km, date: best.iso };
      localStorage.setItem(PR_SEEN_KEY, JSON.stringify(seen));
      renderPRs(runs);
    });
  });
}

/* ---------------- Future + Past timelines (ported) ---------------- */

function syncSectionHeading(timelineEl, headingEl) {
  const items = Array.from(timelineEl.querySelectorAll(".timeline-item"));
  const allOpen = items.length > 0 && items.every(item => item.classList.contains("open"));
  headingEl.classList.toggle("all-open", allOpen);
}

function setupHeadingToggle(timelineEl, headingEl) {
  headingEl.classList.add("clickable");
  headingEl.addEventListener("click", () => {
    if (isAnimating) return;
    const items = Array.from(timelineEl.querySelectorAll(".timeline-item"));
    if (!items.length) return;
    const shouldExpand = items.some(item => !item.classList.contains("open"));
    items.forEach(item => {
      if (shouldExpand) {
        item.classList.add("open");
        if (typeof item._loadContent === "function") item._loadContent();
      } else {
        item.classList.remove("open");
      }
    });
    syncSectionHeading(timelineEl, headingEl);
  });
}

function createCollapsibleWrapper(detailsEl) {
  const collapse = document.createElement("div");
  collapse.className = "details-collapse";
  const inner = document.createElement("div");
  inner.className = "details-inner";
  inner.appendChild(detailsEl);
  collapse.appendChild(inner);
  return collapse;
}

function loadFutureTimeline() {
  const statusEl = document.getElementById("future-status");
  return fetchSheet(FUTURE_TAB)
    .then(rows => {
      const validRows = rows.filter(r => (r["Achievement"] || "").toString().trim() !== "");
      if (!validRows.length) {
        statusEl.textContent = "No upcoming targets scheduled right now.";
        return;
      }
      validRows.reverse().forEach(row => {
        const date = (row["Date"] || "").toString().trim();
        const title = (row["Achievement"] || "").toString().trim();
        const goalA = (row["Goal A"] || "").toString().trim();
        const goalB = (row["Goal B"] || "").toString().trim();

        const item = document.createElement("div");
        item.className = "timeline-item";

        const dot = document.createElement("div");
        dot.className = "timeline-dot";
        item.appendChild(dot);

        const header = document.createElement("div");
        header.className = "item-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "item-title-group";
        titleGroup.innerHTML = `
          <span class="chevron">&#9654;</span>
          <span class="item-date">${escapeHtml(date)}</span>
          <span class="item-title">${escapeHtml(title)}</span>
        `;
        header.appendChild(titleGroup);

        const badge = document.createElement("span");
        badge.className = "planned-badge";
        badge.textContent = "Planned";
        header.appendChild(badge);

        item.appendChild(header);

        const details = document.createElement("div");
        details.className = "item-details";
        const goalsGrid = document.createElement("div");
        goalsGrid.className = "goals-grid";

        if (goalA) {
          goalsGrid.innerHTML += `
            <div class="goal-box">
              <div class="goal-label">Goal A</div>
              <div class="goal-value">${escapeHtml(goalA)}</div>
            </div>`;
        }
        if (goalB) {
          goalsGrid.innerHTML += `
            <div class="goal-box">
              <div class="goal-label">Goal B</div>
              <div class="goal-value">${escapeHtml(goalB)}</div>
            </div>`;
        }
        if (!goalA && !goalB) {
          goalsGrid.innerHTML = `<p class="item-description">Targets to be finalized.</p>`;
        }

        details.appendChild(goalsGrid);
        item.appendChild(createCollapsibleWrapper(details));

        titleGroup.addEventListener("click", () => {
          if (isAnimating) return;
          item.classList.toggle("open");
          syncSectionHeading(futureTimeline, futureHeading);
        });

        futureTimeline.appendChild(item);
      });

      statusEl.style.display = "none";
      futureTimeline.style.display = "flex";
      setupHeadingToggle(futureTimeline, futureHeading);
    })
    .catch(err => {
      statusEl.textContent = "Unable to load upcoming runs. Check tab name 'Future Tracker'.";
      statusEl.classList.add("error");
      console.error(err);
    });
}

function loadPastTimeline(runs) {
  const statusEl = document.getElementById("past-status");
  const runsByIso = {};
  for (const r of runs) (runsByIso[r.iso] = runsByIso[r.iso] || []).push(r);

  return fetchSheet(PAST_TAB)
    .then(rows => {
      const validRows = rows.filter(r => (r["Achievement"] || "").toString().trim() !== "");
      if (!validRows.length) {
        statusEl.textContent = "No milestones recorded yet.";
        return;
      }

      validRows.reverse().forEach(row => {
        const id = (row["ID"] || "").toString().trim();
        const dateRaw = (row["Date"] || "").toString().trim();
        const title = (row["Achievement"] || "").toString().trim();
        const desc = (row["Description"] || "").toString().trim();
        const stravaUrl = (row["Strava"] || "").toString().trim();
        const embedCode = (row["Embed Code"] || "").toString().trim();

        const rowDate = parseFlexibleDate(dateRaw);
        const matched = rowDate ? (runsByIso[isoDate(rowDate)] || []) : [];

        const item = document.createElement("div");
        item.className = "timeline-item";

        const dot = document.createElement("div");
        dot.className = "timeline-dot";
        item.appendChild(dot);

        const header = document.createElement("div");
        header.className = "item-header";

        const titleGroup = document.createElement("div");
        titleGroup.className = "item-title-group";
        titleGroup.innerHTML = `
          <span class="chevron">&#9654;</span>
          <span class="item-date">${escapeHtml(dateRaw)}</span>
          <span class="item-title">${escapeHtml(title)}</span>
        `;
        header.appendChild(titleGroup);

        if (isRaceName(title) || (matched[0] && isRaceName(matched[0].name))) {
          const rb = document.createElement("span");
          rb.className = "race-badge";
          rb.textContent = "🏅 Race";
          header.appendChild(rb);
        }
        if (stravaUrl) {
          const stravaBtn = document.createElement("a");
          stravaBtn.className = "strava-link";
          stravaBtn.href = stravaUrl;
          stravaBtn.target = "_blank";
          stravaBtn.rel = "noopener noreferrer";
          stravaBtn.textContent = "Strava ↗";
          header.appendChild(stravaBtn);
        }

        item.appendChild(header);

        const details = document.createElement("div");
        details.className = "item-details";

        if (desc) {
          const descP = document.createElement("p");
          descP.className = "item-description";
          descP.textContent = desc;
          details.appendChild(descP);
        }

        if (matched.length) {
          const strip = document.createElement("div");
          strip.className = "run-strip";
          const totalKm = matched.reduce((s, r) => s + r.km, 0);
          const totalTime = matched.reduce((s, r) => s + (r.moving || 0), 0);
          const avg = totalKm > 0 ? totalTime / totalKm : null;
          strip.innerHTML = [
            `<span><b>${fmtKm(totalKm)}</b> km</span>`,
            `<span><b>${fmtDuration(totalTime)}</b> moving</span>`,
            avg ? `<span><b>${fmtPace(avg)}</b> /km avg pace</span>` : "",
            `<span><b>${matched.length}</b> run${matched.length > 1 ? "s" : ""} that day</span>`,
          ].filter(Boolean).join("");
          details.appendChild(strip);
        }

        let embedLoaded = false;
        const embedContainer = document.createElement("div");
        embedContainer.className = "embed-container";
        details.appendChild(embedContainer);

        let mediaLoaded = false;
        const mediaGrid = document.createElement("div");
        mediaGrid.className = "media-grid";
        details.appendChild(mediaGrid);

        item.appendChild(createCollapsibleWrapper(details));

        item._loadContent = () => {
          if (!mediaLoaded && id) {
            mediaLoaded = true;
            probeAndAttachImage(id, "bib", "Race Bib", mediaGrid);
            probeAndAttachImage(id, "medal", "Medal", mediaGrid);
          }
          if (!embedLoaded && embedCode) {
            embedLoaded = true;
            injectEmbedCode(embedCode, embedContainer);
          }
        };

        titleGroup.addEventListener("click", () => {
          if (isAnimating) return;
          const isOpen = item.classList.toggle("open");
          if (isOpen) item._loadContent();
          syncSectionHeading(pastTimeline, pastHeading);
        });

        pastTimeline.appendChild(item);
      });

      statusEl.style.display = "none";
      pastTimeline.style.display = "flex";
      setupHeadingToggle(pastTimeline, pastHeading);
    })
    .catch(err => {
      statusEl.textContent = "Unable to load milestones. Check sheet sharing & the 'Past tracker' tab.";
      statusEl.classList.add("error");
      console.error(err);
    });
}

function probeAndAttachImage(id, type, label, container) {
  const extensions = ["jpg", "jpeg", "png", "webp"];
  function tryNext(index) {
    if (index >= extensions.length) return;
    const ext = extensions[index];
    const img = new Image();
    img.src = `${IMAGE_FOLDER}/${id}-${type}.${ext}`;
    img.alt = `${label} #${id}`;
    img.onload = () => {
      const card = document.createElement("div");
      card.className = "media-card";
      card.innerHTML = `<div class="media-label">${label}</div>`;
      card.prepend(img);
      container.appendChild(card);
    };
    img.onerror = () => tryNext(index + 1);
  }
  tryNext(0);
}

function injectEmbedCode(htmlString, container) {
  container.innerHTML = htmlString;
  const scripts = container.querySelectorAll("script");
  scripts.forEach(oldScript => {
    const newScript = document.createElement("script");
    Array.from(oldScript.attributes).forEach(attr =>
      newScript.setAttribute(attr.name, attr.value));
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

/* ---------------- Sort choreography (ported) ---------------- */

sortBtn.addEventListener("click", async () => {
  if (isAnimating) return;
  isAnimating = true;
  sortBtn.disabled = true;

  const previouslyOpenItems = Array.from(document.querySelectorAll(".timeline-item.open"));
  const hadOpenItems = previouslyOpenItems.length > 0;

  if (hadOpenItems) {
    previouslyOpenItems.forEach(item => item.classList.remove("open"));
    syncSectionHeading(futureTimeline, futureHeading);
    syncSectionHeading(pastTimeline, pastHeading);
    await wait(340);
  }

  const pastStartTop = pastSection.getBoundingClientRect().top;
  const futureStartTop = futureSection.getBoundingClientRect().top;

  isOldestFirst = !isOldestFirst;
  sectionsContainer.classList.toggle("oldest-first", isOldestFirst);
  sortBtn.textContent = isOldestFirst ? "Sort: Newest to oldest" : "Sort: Oldest to newest";

  const pastDeltaY = pastStartTop - pastSection.getBoundingClientRect().top;
  const futureDeltaY = futureStartTop - futureSection.getBoundingClientRect().top;

  pastSection.style.zIndex = "20";
  futureSection.style.zIndex = "5";
  pastSection.style.backgroundColor = "var(--surface)";
  pastSection.style.borderColor = "var(--border)";

  const GLIDE_DURATION = 1500;
  const GLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

  const pastAnim = pastSection.animate(
    [
      { transform: `translateY(${pastDeltaY}px) scale(1)`, boxShadow: "0 0 0 rgba(0,0,0,0)", offset: 0 },
      { transform: `translateY(${pastDeltaY * 0.72}px) scale(1.03)`, boxShadow: "var(--shadow-lift)", offset: 0.22 },
      { transform: `translateY(${pastDeltaY * 0.18}px) scale(1.03)`, boxShadow: "var(--shadow-lift)", offset: 0.78 },
      { transform: "translateY(0px) scale(1)", boxShadow: "0 0 0 rgba(0,0,0,0)", offset: 1 },
    ],
    { duration: GLIDE_DURATION, easing: GLIDE_EASING }
  );

  const futureAnim = futureSection.animate(
    [
      { transform: `translateY(${futureDeltaY}px) scale(1)`, opacity: 1, offset: 0 },
      { transform: `translateY(${futureDeltaY * 0.72}px) scale(0.95)`, opacity: 0.42, offset: 0.22 },
      { transform: `translateY(${futureDeltaY * 0.18}px) scale(0.95)`, opacity: 0.42, offset: 0.78 },
      { transform: "translateY(0px) scale(1)", opacity: 1, offset: 1 },
    ],
    { duration: GLIDE_DURATION, easing: GLIDE_EASING }
  );

  await Promise.all([pastAnim.finished, futureAnim.finished]);

  pastSection.style.zIndex = "";
  futureSection.style.zIndex = "";
  pastSection.style.backgroundColor = "";
  pastSection.style.borderColor = "";

  if (hadOpenItems) {
    await wait(60);
    previouslyOpenItems.forEach(item => item.classList.add("open"));
    syncSectionHeading(futureTimeline, futureHeading);
    syncSectionHeading(pastTimeline, pastHeading);
    await wait(340);
  }

  isAnimating = false;
  sortBtn.disabled = false;
});

/* ---------------- Theme toggle ---------------- */

(function initTheme() {
  const btn = document.getElementById("theme-btn");
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

/* ---------------- Boot ---------------- */

(async function boot() {
  // Future + past always try (they're independent of the activities tab)
  const pastPromise = fetchSheet(ACTIVITIES_TAB)
    .then(rows => parseActivities(rows))
    .catch(err => {
      console.error("Activities tab:", err);
      return null;
    });

  loadFutureTimeline();

  const runs = await pastPromise;

  if (runs && runs.length) {
    const milestones = computeMilestones(runs);

    const runsByDay = {};
    for (const r of runs) {
      const day = runsByDay[r.iso] || (runsByDay[r.iso] = { km: 0, runs: [] });
      day.km += r.km;
      day.runs.push(r);
    }

    renderOverview(runs, milestones);
    renderMilestones(runs, milestones);
    const streaks = computeStreaks(runs);
    renderStreak(runs, runsByDay, streaks);
    renderHeatmap(runs, runsByDay);
    document.getElementById("consistency-section").hidden = false;
    renderMonthlyChart(runs);
    renderWeeklyChart(runs);
    document.getElementById("trends-section").hidden = false;
    renderPRs(runs);
  } else {
    const status = document.getElementById("overview-status");
    status.textContent = "Couldn't load 2026 runs from the 'Activities' tab — add the raw Strava export there (header row included). Future & past sections below still load.";
    status.classList.add("error");
    document.getElementById("data-as-of").textContent = "no 2026 data";
  }

  loadPastTimeline(runs || []);
})();
