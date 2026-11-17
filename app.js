/* ============================================================
   Running Milestones — main dashboard (index.html)
   Overview, milestones, consistency, trends, personal records.
   Shared sheet/parsing/format helpers live in common.js.
   The Upcoming / Completed timeline lives on timeline.html.
   ============================================================ */

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

  return {
    first, longestDist, longestTime, fast5, fast10,
    totals: {
      count: runs.length,
      km: runs.reduce((s, r) => s + r.km, 0),
      time: runs.reduce((s, r) => s + (r.moving || 0), 0),
    },
  };
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
    milestoneCard("🏆", "First race", null, "km", runs.find(r => isRaceName(r.name)) || null);
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

  const max = Math.max(...kmByMonth, 100); // scale always includes the 100k reference line
  const el = document.getElementById("monthly-chart");
  el.innerHTML = kmByMonth.map((km, i) => {
    const h = km === 0 ? 3 : Math.max(6, (km / max) * 100);
    return `<div class="bar ${km === 0 ? "zero" : ""}" style="height:${h}%;animation-delay:${i * 40}ms">
      <span class="bar-tip">${MONTHS_SHORT[i]} · ${fmtKm(km)} km · ${countByMonth[i]} run${countByMonth[i] === 1 ? "" : "s"}</span>
    </div>`;
  }).join("") + [50, 100].map(v =>
    v <= max
      ? `<div class="chart-refline" style="bottom:${(v / max) * 100}%"><span>${v}k</span></div>`
      : ""
  ).join("");
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
  const max = Math.max(...kmByWeek, 30); // scale always includes the 30k reference line
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

  const refY = v => (10 + (v / max) * (H - 2 * PAD)) / H * 100; // % from bottom of the wrap
  const refHtml = [15, 30].map(v =>
    v <= max
      ? `<div class="chart-refline" style="bottom:${refY(v)}%"><span>${v}k</span></div>`
      : ""
  ).join("");

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
    </svg>${refHtml}</div>`;

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

/* ---------------- Boot ---------------- */

(async function boot() {
  const runs = await fetchSheet(ACTIVITIES_TAB)
    .then(rows => parseActivities(rows))
    .catch(err => {
      console.error("Activities tab:", err);
      return null;
    });

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
    status.textContent = "Couldn't load 2026 runs from the 'Activities' tab — add the raw Strava export there (header row included). The timeline page still loads future & past milestones.";
    status.classList.add("error");
    document.getElementById("data-as-of").textContent = "no 2026 data";
  }
})();
