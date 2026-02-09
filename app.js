// app.js
// Warframe Farm Planner v2 logic
// Data sources:
// - ResourcesMaster.csv: explicit best nodes per resource with scores
// - ResourcesPlanet.csv: planetary base-drop map for fallback coverage
//
// Toggles:
// - Goal: Maximize efficiency vs Minimize stops
// - Run: Quick run vs Endless run (endless is a hard filter)
//
// Fallback score:
// - If a resource is not explicitly listed for a node, but the node's planet base-drops it, score = 2

const FALLBACK_SCORE = 2;

// ----------------------------
// State
// ----------------------------
let MASTER_ROWS = [];            // normalized rows from ResourcesMaster.csv
let PLANET_DROPS = new Map();    // resourceKey -> Set(planetKey)
let RESOURCES = [];              // unique resources from master
let NODE_META = new Map();       // nodeKey -> { planet, missionType, isEndless, speedScore }
let SELECTED_KEYS = new Set(); // resource keys (normalized)

// Indexes for fast lookup
let EXPLICIT = new Map();        // resourceKey -> Map(nodeKey -> {dropScore, speedScore, ...})

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

function titleCase(s) {
  return String(s ?? "")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function setOutputMessage(msg) {
  const out = document.getElementById("output");
  out.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
}

function copyOutput() {
  const out = document.getElementById("output");
  const text = out.innerText || "";
  navigator.clipboard.writeText(text).catch(() => { });
}

// ----------------------------
// CSV parsing
// ----------------------------
function resourceIconName(resourceName) {
  return String(resourceName ?? "")
    .replace(/\s+/g, ""); // remove spaces only
}


function parseCsv(text) {
  // Minimal CSV parser that handles commas and quotes.
  // Assumes first row is header.
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    // ignore empty trailing lines
    if (row.length === 1 && row[0].trim() === "") return;
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === "\"") {
        const next = text[i + 1];
        if (next === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === ",") {
      pushField();
      i += 1;
      continue;
    }

    if (c === "\n") {
      pushField();
      pushRow();
      i += 1;
      continue;
    }

    if (c === "\r") {
      i += 1;
      continue;
    }

    field += c;
    i += 1;
  }

  pushField();
  pushRow();

  if (rows.length === 0) return [];

  const header = rows[0].map(h => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = rows[r][c] ?? "";
    }
    out.push(obj);
  }
  return out;
}

// ----------------------------
// Data loading + indexing
// ----------------------------
async function loadData() {
  // Make sure these CSV files are next to index.html
  const [masterRes, planetRes] = await Promise.all([
    fetch("ResourcesMaster.csv", { cache: "no-store" }),
    fetch("ResourcesPlanet.csv", { cache: "no-store" }),
  ]);

  if (!masterRes.ok) throw new Error("Could not load ResourcesMaster.csv (put it next to index.html).");
  if (!planetRes.ok) throw new Error("Could not load ResourcesPlanet.csv (put it next to index.html).");

  const masterText = await masterRes.text();
  const planetText = await planetRes.text();

  const master = parseCsv(masterText);
  const planet = parseCsv(planetText);

  MASTER_ROWS = [];

  // Build explicit rows and node meta
  NODE_META = new Map();
  EXPLICIT = new Map();

  for (const row of master) {
    const resource = String(row.resource ?? row.Resource ?? "").trim();
    const node = String(row.node ?? row.Node ?? "").trim();
    const planetName = String(row.planet ?? row.Planet ?? "").trim();
    const missionType = String(row.missionType ?? row.MissionType ?? "").trim();
    const isEndless = String(row.isEndless ?? row.IsEndless ?? "").trim().toLowerCase() === "true";
    const speedScore = Number(row.speedScore ?? row.SpeedScore ?? 0) || 0;
    const dropScore = Number(row.dropScore ?? row.DropScore ?? 0) || 0;

    if (!resource || !node) continue;

    const rKey = norm(resource);
    const nKey = norm(node);

    MASTER_ROWS.push({
      resource,
      node,
      planet: planetName,
      missionType,
      isEndless,
      speedScore,
      dropScore,
      rKey,
      nKey,
      pKey: norm(planetName),
    });

    // node meta (first one wins, assume consistent)
    if (!NODE_META.has(nKey)) {
      NODE_META.set(nKey, {
        node,
        planet: planetName,
        planetKey: norm(planetName),
        missionType: missionType || "Other",
        isEndless,
        // speedScore in meta is not perfect (differs by row sometimes),
        // but is good enough as a general preference signal.
        speedScore,
      });
    }

    if (!EXPLICIT.has(rKey)) EXPLICIT.set(rKey, new Map());
    EXPLICIT.get(rKey).set(nKey, { dropScore, speedScore, isEndless });
  }

  // Unique resources list (from explicit only)
  const uniqueResources = new Map(); // rKey -> displayName (first)
  for (const r of MASTER_ROWS) {
    if (!uniqueResources.has(r.rKey)) uniqueResources.set(r.rKey, r.resource);
  }
  RESOURCES = [...uniqueResources.values()].sort((a, b) => a.localeCompare(b));

  // Planet drops: resource -> set(planets)
  PLANET_DROPS = new Map();
  for (const row of planet) {
    const planetName = String(row.planet ?? row.Planet ?? "").trim();
    const resources = String(row.resources ?? row.Resources ?? "").trim();

    if (!planetName) continue;

    const pKey = norm(planetName);
    const list = resources
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    for (const r of list) {
      const rKey = norm(r);
      if (!PLANET_DROPS.has(rKey)) PLANET_DROPS.set(rKey, new Set());
      PLANET_DROPS.get(rKey).add(pKey);
    }
  }
}

// ----------------------------
// UI: resource list
// ----------------------------
function getSelectedResources() {
  // Return display names from RESOURCES that are selected in state
  const selected = [];
  for (const r of RESOURCES) {
    if (SELECTED_KEYS.has(norm(r))) selected.push(r);
  }
  return selected;
}

function populateResources() {
  const wrap = document.getElementById("resourceList");
  const filter = document.getElementById("resourceFilter").value.trim().toLowerCase();
  wrap.innerHTML = "";

  for (const r of RESOURCES) {
    const rKey = norm(r);
    if (filter && !r.toLowerCase().includes(filter)) continue;

    const row = document.createElement("label");
    row.className = "check";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = r; // display
    cb.checked = SELECTED_KEYS.has(rKey);

    cb.addEventListener("change", () => {
      if (cb.checked) SELECTED_KEYS.add(rKey);
      else SELECTED_KEYS.delete(rKey);
    });

    const icon = document.createElement("img");
    icon.className = "resIcon";
    icon.alt = "";
    icon.loading = "lazy";
    icon.decoding = "async";
    icon.src = `icons/resources/${resourceIconName(r)}.png`;
    icon.onerror = () => {
      icon.src = "icons/resources/_default.png";
    };


    const text = document.createElement("span");
    text.textContent = r;

    row.appendChild(icon);
    row.appendChild(text);
    
    wrap.appendChild(row);
    row.appendChild(cb);

  }
}


function selectAllResources(value) {
  const filter = document.getElementById("resourceFilter").value.trim().toLowerCase();

  for (const r of RESOURCES) {
    const rKey = norm(r);
    // Apply only to currently visible items (respects filter)
    if (filter && !r.toLowerCase().includes(filter)) continue;

    if (value) SELECTED_KEYS.add(rKey);
    else SELECTED_KEYS.delete(rKey);
  }

  populateResources();
}


// ----------------------------
// Toggles
// ----------------------------
function readGoalMode() {
  const el = document.querySelector("input[name='goalMode']:checked");
  return el ? el.value : "efficiency"; // "efficiency" | "stops"
}

function readRunMode() {
  const el = document.querySelector("input[name='runMode']:checked");
  return el ? el.value : "quick"; // "quick" | "endless"
}

function quickMultiplier(speedScore) {
  // speedScore is 1-5; keep bias meaningful but not dominant
  const s = Math.max(0, Math.min(5, Number(speedScore) || 0));
  return 0.6 + 0.4 * (s / 5);
}

// ----------------------------
// Scoring helpers
// ----------------------------
function getExplicitScore(rKey, nKey) {
  const map = EXPLICIT.get(rKey);
  if (!map) return null;
  return map.get(nKey) || null;
}

function planetHasResourceFallback(rKey, planetKey) {
  const set = PLANET_DROPS.get(rKey);
  return Boolean(set && set.has(planetKey));
}

function computeEffScore(scoreObj, runMode, meta) {
  const dropScore = Number(scoreObj.dropScore) || 0;
  const speedScore = Number(scoreObj.speedScore) || 0;

  if (runMode === "quick") {
    const qm = quickMultiplier(speedScore);
    const mm = quickMissionMultiplier(meta?.missionType || "", meta?.isEndless);
    return dropScore * qm * mm;
  }

  // endless mode: no need to bias by mission type because it's already filtered
  return dropScore;
}

function nodeEligibleByRunMode(nMeta, runMode) {
  if (runMode === "endless") return Boolean(nMeta.isEndless);
  return true;
}

function formatNodeLine(nMeta) {
  const mt = nMeta.missionType || "Other";
  const endTag = nMeta.isEndless ? "Endless" : "Quick";
  return `${nMeta.node} (${nMeta.planet}) • ${mt} • ${endTag}`;
}

function quickMissionMultiplier(missionType, isEndless) {
  const mt = norm(missionType);

  // Strongly quick-friendly
  if (mt.includes("capture")) return 1.40;
  if (mt.includes("exterminate")) return 1.30;
  if (mt.includes("rescue")) return 1.22;
  if (mt.includes("sabotage")) return 1.18;

  // Moderate
  if (mt.includes("spy")) return 1.10;
  if (mt.includes("disruption")) return 1.08;
  if (mt.includes("activity")) return 1.20; // Index, etc.

  // Usually slower or rotation-based
  if (mt.includes("survival")) return 0.90;
  if (mt.includes("defense")) return 0.86;
  if (mt.includes("interception")) return 0.85;
  if (mt.includes("excavation")) return 0.92;
  if (mt.includes("mobile defense")) return 0.82;

  // Default neutral
  let mult = 1.0;

  // Small universal penalty for endless when user asked "Quick"
  if (isEndless) mult *= 0.92;

  return mult;
}


// ----------------------------
// Output: close-score grouping
// ----------------------------
function pickTopOptions(scoredList, maxOptions = 3) {
  // scoredList: [{ nodeKey, score, ... }, ...] sorted desc by score
  if (scoredList.length === 0) return [];
  const best = scoredList[0].score;
  const out = [];
  for (const it of scoredList) {
    if (out.length >= maxOptions) break;
    if (it.score >= best * 0.9) out.push(it); // 90% rule
  }
  return out;
}

// ----------------------------
// Planner modes
// ----------------------------
function planMaximizeEfficiency(selectedResources, runMode) {
  // For each resource: pick best node(s) from explicit list only
  const results = [];

  for (const rName of selectedResources) {
    const rKey = norm(rName);
    const explicitMap = EXPLICIT.get(rKey);

    if (!explicitMap || explicitMap.size === 0) {
      results.push({
        resource: rName,
        options: [],
        note: "No explicit data for this resource.",
      });
      continue;
    }

    // Score all candidates (filter endless if needed)
    const scored = [];
    for (const [nKey, s] of explicitMap.entries()) {
      const meta = NODE_META.get(nKey);
      if (!meta) continue;
      if (!nodeEligibleByRunMode(meta, runMode)) continue;

      const eff = computeEffScore(s, runMode, meta);
      scored.push({ nodeKey: nKey, score: eff });
    }

    scored.sort((a, b) => b.score - a.score);
    const options = pickTopOptions(scored, 3).map(o => ({
      ...o,
      meta: NODE_META.get(o.nodeKey),
      score: o.score,
    }));

    results.push({ resource: rName, options });
  }

  return results;
}

function planMinimizeStops(selectedResources, runMode) {
  const remaining = new Set(selectedResources.map(norm));
  const rDisplay = new Map(selectedResources.map(r => [norm(r), r]));

  const route = [];
  const maxStops = 6;

  // Candidate nodes: union of nodes explicit for any selected resource
  const candidateNodes = new Set();
  for (const rKey of remaining) {
    const map = EXPLICIT.get(rKey);
    if (!map) continue;
    for (const nKey of map.keys()) candidateNodes.add(nKey);
  }

  const candidates = [...candidateNodes].filter(nKey => {
    const meta = NODE_META.get(nKey);
    if (!meta) return false;
    return nodeEligibleByRunMode(meta, runMode);
  });

  while (remaining.size > 0 && route.length < maxStops) {
    const scored = [];

    for (const nKey of candidates) {
      const meta = NODE_META.get(nKey);
      if (!meta) continue;

      let total = 0;
      const covered = [];

      for (const rKey of remaining) {
        const explicit = getExplicitScore(rKey, nKey);
        if (explicit) {
          const eff = computeEffScore(explicit, runMode, meta);
          if (eff > 0) {
            total += eff;
            covered.push({
              resource: rDisplay.get(rKey) || rKey,
              via: "explicit",
              score: eff,
            });
          }
          continue;
        }

        // Planet fallback
        if (planetHasResourceFallback(rKey, meta.planetKey)) {
          let fb = FALLBACK_SCORE;
          if (runMode === "quick") {
            fb *= quickMultiplier(meta.speedScore);
            fb *= quickMissionMultiplier(meta.missionType || "", meta.isEndless);
          }
          total += fb;
          covered.push({
            resource: rDisplay.get(rKey) || rKey,
            via: "planet",
            score: fb,
          });
        }
      }

      if (covered.length === 0) continue;

      scored.push({
        nodeKey: nKey,
        score: total,
        meta,
        covered,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    const top = pickTopOptions(scored, 3);
    if (top.length === 0) break;

    // Best option determines what gets covered for the greedy loop
    const best = top[0];

    // Remove covered resources (based on best option)
    for (const c of best.covered) {
      remaining.delete(norm(c.resource));
    }

    route.push({
      options: top.map(opt => ({
        nodeKey: opt.nodeKey,
        score: opt.score,
        meta: opt.meta,
        covered: opt.covered,
      })),
    });
  }

  const missing = [...remaining].map(rKey => rDisplay.get(rKey) || rKey);
  return { route, missing };
}


// ----------------------------
// Rendering
// ----------------------------
function renderEfficiencyPlan(results, runMode) {
  const out = document.getElementById("output");

  const cards = results.map(r => {
    if (!r.options || r.options.length === 0) {
      return `
        <div class="card">
          <div class="cardTop">
            <div class="cardTitle">${escapeHtml(r.resource)}</div>
            <span class="badge type">No data</span>
          </div>
          <div class="subtle small">${escapeHtml(r.note || "No eligible nodes found for this run style.")}</div>
        </div>
      `;
    }

    const opts = r.options.map((o, idx) => {
      const line = formatNodeLine(o.meta);
      const scoreTxt = o.score.toFixed(2);
      const rankTag = idx === 0 ? `<span class="badge ds">Best</span>` : `<span class="badge type">Alt</span>`;
      return `
        <div class="altItem">
          <div class="altTop">
            <span>${escapeHtml(line)}</span>
            ${rankTag}
          </div>
          <div class="altSub">Score: <span class="monoSmall">${escapeHtml(scoreTxt)}</span></div>
        </div>
      `;
    }).join("");

    return `
      <div class="card">
        <div class="cardTop">
          <div class="cardTitle">${escapeHtml(r.resource)}</div>
          <span class="badge type">${escapeHtml(runMode === "endless" ? "Endless" : "Quick")}</span>
        </div>
        <div class="altList">${opts}</div>
      </div>
    `;
  }).join("");

  out.innerHTML = cards || `<div class="empty">No results.</div>`;
}

function renderStopsPlan(plan, selectedResources, runMode) {
  const out = document.getElementById("output");
  const { route, missing } = plan;

  if (!route || route.length === 0) {
    out.innerHTML = `
      <div class="warn">Could not find a plan for the selected resources.</div>
      <div class="monoSmall">Try switching run style, or reduce the selection.</div>
    `;
    return;
  }

  const miss = (missing && missing.length)
    ? `<div class="warn">Missing: ${escapeHtml(missing.join(", "))}</div>`
    : "";

  const cards = route.map((step, stepIdx) => {
    const opts = (step.options || []).map((o, idx) => {
      const line = formatNodeLine(o.meta);
      const scoreTxt = o.score.toFixed(2);
      const rankTag = idx === 0 ? `<span class="badge ds">Best</span>` : `<span class="badge type">Alt</span>`;

      // Show what this option covers (chips), same data as before
      const chips = (o.covered || []).map(c => {
        return `<span class="chip">${escapeHtml(c.resource)}</span>`;
      }).join("");

      return `
        <div class="altItem">
          <div class="altTop">
            <span>${escapeHtml(line)}</span>
            ${rankTag}
          </div>
          <div class="altSub">
            Score: <span class="monoSmall">${escapeHtml(scoreTxt)}</span>
          </div>
          <div class="chips">${chips}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="card">
        <div class="cardTop">
          <div class="cardTitle">Stop #${stepIdx + 1}</div>
          <span class="badge type">${escapeHtml(runMode === "endless" ? "Endless" : "Quick")}</span>
        </div>
        <div class="altList">${opts}</div>
      </div>
    `;
  }).join("");

  out.innerHTML = miss + cards;
}



// ----------------------------
// Main action
// ----------------------------
function planRoute() {
  const selected = getSelectedResources();
  if (selected.length === 0) {
    setOutputMessage("Select at least one resource.");
    return;
  }

  const goal = readGoalMode();   // "efficiency" | "stops"
  const runMode = readRunMode(); // "quick" | "endless"

  if (goal === "efficiency") {
    const results = planMaximizeEfficiency(selected, runMode);
    renderEfficiencyPlan(results, runMode);
    return;
  }

  const plan = planMinimizeStops(selected, runMode);
  renderStopsPlan(plan, selected, runMode);
}

// ----------------------------
// Init + events
// ----------------------------
async function init() {
  try {
    await loadData();
    populateResources(true);
    setOutputMessage("Dataset loaded. Select resources, pick goal and run style, then calculate.");
  } catch (e) {
    setOutputMessage(String(e));
  }
}

document.getElementById("resourceFilter").addEventListener("input", populateResources);
populateResources();


document.getElementById("planBtn").addEventListener("click", planRoute);

document.getElementById("selectAllBtn").addEventListener("click", () => selectAllResources(true));
document.getElementById("clearBtn").addEventListener("click", () => selectAllResources(false));

document.getElementById("copyBtn").addEventListener("click", copyOutput);

init();
