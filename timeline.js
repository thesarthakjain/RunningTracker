/* ============================================================
   Running Milestones — timeline page (timeline.html)
   Upcoming Targets + Completed Milestones, with the sort
   toggle and its glide choreography.
   Shared sheet/parsing/format helpers live in common.js.
   ============================================================ */

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

/* ---------------- Timeline rendering ---------------- */

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

/* ---------------- Sort choreography ---------------- */

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

/* ---------------- Boot ---------------- */

(async function boot() {
  loadFutureTimeline();

  const runs = await fetchSheet(ACTIVITIES_TAB)
    .then(rows => parseActivities(rows))
    .catch(err => {
      console.error("Activities tab:", err);
      return null;
    });

  loadPastTimeline(runs || []);
})();
