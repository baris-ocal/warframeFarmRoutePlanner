// app.js
// Warframe Farm Route Planner (web, GitHub Pages friendly)
// UI: checkbox resources, draggable mission priorities, card-based output (no debug spam)

let DATA = null;

const defaultMissionOrder = [
  "Survival",
  "Disruption",
  "Defense",
  "Exterminate",
  "Capture",
  "Other",
];

// ----------------------------
// Core helpers
// ----------------------------
function buildMissionRank(order){
  const n = order.length;
  const rank = {};
  order.forEach((m, i) => { rank[m] = n - i; });
  return rank;
}

function normalizeMissionType(mtype, knownTypes){
  return knownTypes.has(mtype) ? mtype : "Other";
}

function nodeLevel(node){
  const lv = (node.level_max ?? node.level_min ?? 0);
  return Number.isFinite(lv) ? lv : 0;
}

function nodeCoversResources(node, remaining, resourcePlanets, resourceNodes){
  const covered = [];
  for (const r of remaining){
    const nodeList = resourceNodes?.[r];

    // If node-specific data exists, it overrides planet-wide logic
    if (Array.isArray(nodeList) && nodeList.length > 0){
      if (nodeList.includes(node.key)) covered.push(r);
      continue;
    }

    // Fallback: planet-wide
    const planets = resourcePlanets[r] || [];
    if (planets.includes(node.planet)) covered.push(r);
  }
  return covered;
}

// Score tuple: [typeRank, overlap, darkSector, level, key]
function scoreNode(node, remaining, resourcePlanets, missionRank, knownTypes){
  const mtype = normalizeMissionType(node.mission_type, knownTypes);
  const typeRank = missionRank[mtype] || missionRank["Other"] || 0;
  const overlap = nodeCoversResources(node, remaining, resourcePlanets, DATA.resource_nodes).length;
  const ds = node.is_dark_sector ? 1 : 0;
  const lvl = nodeLevel(node);
  return [typeRank, overlap, ds, lvl, node.key];
}

// Compare tuples descending
function cmpScore(a, b){
  for (let i = 0; i < a.length; i++){
    if (a[i] > b[i]) return -1;
    if (a[i] < b[i]) return 1;
  }
  return 0;
}

function topKCandidates(nodes, remaining, resourcePlanets, order, minLevel, maxLevel, k){
  if (k <= 0) return [];
  const knownTypes = new Set(order);
  const missionRank = buildMissionRank(order);

  const scored = [];
  for (const n of nodes){
    const lvl = nodeLevel(n);
    if (lvl < minLevel || lvl > maxLevel) continue;

    const cover = nodeCoversResources(n, remaining, resourcePlanets, DATA.resource_nodes);
    if (cover.length === 0) continue;

    const s = scoreNode(n, remaining, resourcePlanets, missionRank, knownTypes);
    scored.push({ node: n, score: s, cover });
  }

  scored.sort((x, y) => cmpScore(x.score, y.score));
  return scored.slice(0, k);
}

// ----------------------------
// Resource checklist UI
// ----------------------------
function getSelectedResources(){
  const checks = document.querySelectorAll("#resourceList input[type='checkbox']");
  const selected = [];
  for (const c of checks){
    if (c.checked) selected.push(c.value);
  }
  return selected;
}

function populateResources(preserveSelection = true){
  const wrap = document.getElementById("resourceList");
  const filter = document.getElementById("resourceFilter").value.trim().toLowerCase();

  // Preserve selection across filtering rebuilds
  const previouslySelected = new Set();
  if (preserveSelection){
    for (const r of getSelectedResources()) previouslySelected.add(r);
  }

  wrap.innerHTML = "";

  const resources = Object.keys(DATA.resource_planets).sort((a, b) => a.localeCompare(b));

  for (const r of resources){
    if (filter && !r.toLowerCase().includes(filter)) continue;

    const row = document.createElement("label");
    row.className = "check";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = r;
    cb.checked = previouslySelected.has(r);

    const text = document.createElement("span");
    text.textContent = r;

    row.appendChild(cb);
    row.appendChild(text);
    wrap.appendChild(row);
  }
}

function selectAllResources(value){
  const checks = document.querySelectorAll("#resourceList input[type='checkbox']");
  for (const c of checks) c.checked = value;
}

// ----------------------------
// Mission priority draggable list
// ----------------------------
function readMissionOrder(){
  return [...document.querySelectorAll("#typeList li")].map(li => li.dataset.type);
}

function makeTypeItem(type){
  const li = document.createElement("li");
  li.dataset.type = type;
  li.draggable = true;

  const name = document.createElement("span");
  name.textContent = type;

  const handle = document.createElement("span");
  handle.className = "handle";
  handle.textContent = "⋮⋮";

  li.appendChild(name);
  li.appendChild(handle);
  return li;
}

function resetMissionOrder(){
  const ul = document.getElementById("typeList");
  ul.innerHTML = "";
  for (const t of defaultMissionOrder){
    ul.appendChild(makeTypeItem(t));
  }
}

function setupDragList(){
  const ul = document.getElementById("typeList");
  resetMissionOrder();

  let dragEl = null;

  ul.addEventListener("dragstart", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    dragEl = li;
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  ul.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("dragging");
    dragEl = null;
  });

  ul.addEventListener("dragover", (e) => {
    e.preventDefault();
    const after = getDragAfterElement(ul, e.clientY);
    const dragging = ul.querySelector(".dragging");
    if (!dragging) return;
    if (after == null) ul.appendChild(dragging);
    else ul.insertBefore(dragging, after);
  });

  function getDragAfterElement(container, y){
    const els = [...container.querySelectorAll("li:not(.dragging)")];
    let closest = { offset: Number.NEGATIVE_INFINITY, element: null };

    for (const child of els){
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset){
        closest = { offset, element: child };
      }
    }
    return closest.element;
  }
}

// ----------------------------
// Output rendering
// ----------------------------
function setOutputMessage(msg){
  const out = document.getElementById("output");
  out.innerHTML = `<div class="empty">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function copyOutput(){
  const out = document.getElementById("output");
  const text = out.innerText || "";
  navigator.clipboard.writeText(text).catch(() => {});
}

// ----------------------------
// Planner
// ----------------------------
function planRoute(){
  if (!DATA){
    setOutputMessage("Dataset not loaded yet.");
    return;
  }

  const selected = getSelectedResources();
  if (selected.length === 0){
    setOutputMessage("Select at least one resource.");
    return;
  }

  const minLevel = Math.max(1, Number(document.getElementById("minLevel").value || 1));
  const maxLevel = Math.max(minLevel, Number(document.getElementById("maxLevel").value || 999));
  const runnerUps = Math.max(0, Math.min(10, Number(document.getElementById("runnerUps").value || 0)));

  const order = readMissionOrder();
  const remaining = new Set(selected);

  const route = [];
  const altPicks = [];

  while (remaining.size > 0){
    const candidates = topKCandidates(
      DATA._nodes,
      remaining,
      DATA.resource_planets,
      order,
      minLevel,
      maxLevel,
      Math.max(1, 1 + runnerUps)
    );

    if (candidates.length === 0){
      break;
    }

    const best = candidates[0];
    route.push(best);

    // remove covered resources
    for (const r of best.cover) remaining.delete(r);

    // store alternatives for this step
    if (runnerUps > 0){
      altPicks.push(candidates.slice(1));
    } else {
      altPicks.push([]);
    }
  }

  renderRoute(route, altPicks, selected, minLevel, maxLevel, order);
}

function renderRoute(route, altPicks, selected, minLevel, maxLevel, order){
  const out = document.getElementById("output");

  if (route.length === 0){
    out.innerHTML = `
      <div class="warn">
        Could not find nodes that match your filters for the selected resources.
      </div>
      <div class="monoSmall">Try widening the level range or selecting fewer resources.</div>
    `;
    return;
  }

  // What is covered
  const covered = new Set();
  for (const step of route){
    for (const r of step.cover) covered.add(r);
  }
  const missing = selected.filter(r => !covered.has(r));

  const header = `
    <div class="card">
      <div class="cardTop">
        <div class="cardTitle">Planned route</div>
        <div class="badge type">Lv ${minLevel} to ${maxLevel}</div>
      </div>

      <div class="subtle small" style="margin-top:0.35rem;">
        Priority: ${escapeHtml(order.join(" • "))}
      </div>

      <hr class="hrSoft">

      <div class="kv">
        <div class="k">Selected</div>
        <div class="v">${escapeHtml(String(selected.length))} resources</div>

        <div class="k">Covered</div>
        <div class="v">${escapeHtml(String(covered.size))} resources</div>

        <div class="k">Stops</div>
        <div class="v">${escapeHtml(String(route.length))}</div>
      </div>

      ${missing.length ? `
        <div class="warn">
          Missing: ${escapeHtml(missing.join(", "))}
        </div>
      ` : ``}
    </div>
  `;

  const steps = route.map((s, i) => {
    const title = `${s.node.planet} · ${s.node.key}`;
    const type = s.node.mission_type || "Other";
    const ds = s.node.is_dark_sector ? `<span class="badge ds">Dark Sector</span>` : "";
    const cover = s.cover.length ? s.cover.map(r => `<span class="chip">${escapeHtml(r)}</span>`).join("") : "";

    const alts = altPicks[i] || [];
    const altBlock = alts.length ? `
      <details class="details">
        <summary>Alternatives</summary>
        <div class="altList">
          ${alts.map(a => {
            const at = `${a.node.planet} · ${a.node.key}`;
            const am = a.node.mission_type || "Other";
            const ads = a.node.is_dark_sector ? ` <span class="badge ds">DS</span>` : "";
            return `
              <div class="altItem">
                <div class="altTop">
                  <span>${escapeHtml(at)}</span>
                  <span class="badge type">${escapeHtml(am)}</span>
                  ${ads}
                </div>
                <div class="altSub">${escapeHtml(a.cover.join(", "))}</div>
              </div>
            `;
          }).join("")}
        </div>
      </details>
    ` : "";

    return `
      <div class="card">
        <div class="cardTop">
          <div class="cardTitle">#${i + 1} · ${escapeHtml(title)}</div>
          <div class="rightBadges">
            <span class="badge type">${escapeHtml(type)}</span>
            ${ds}
          </div>
        </div>

        <div class="chips">${cover || `<span class="subtle small">No resources listed.</span>`}</div>
        ${altBlock}
      </div>
    `;
  }).join("");

  out.innerHTML = header + steps;
}

// ----------------------------
// Init
// ----------------------------
async function init(){
  try{
    const res = await fetch("wf_dataset.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load wf_dataset.json (put it next to index.html).");
    DATA = await res.json();

    // Normalize node_info into a list for speed
    const nodes = [];
    for (const [key, v] of Object.entries(DATA.node_info || {})){
      nodes.push({
        key,
        planet: String(v.planet || "").trim(),
        mission_type: String(v.mission_type || "Other").trim() || "Other",
        level_min: Number(v.level_min || 0),
        level_max: Number(v.level_max || v.level_min || 0),
        is_dark_sector: Boolean(v.is_dark_sector),
      });
    }
    DATA._nodes = nodes;

    setupDragList();
    populateResources(true);

    setOutputMessage("Dataset loaded. Pick resources, adjust levels, drag mission priorities, then plan a route.");
  } catch (e){
    setOutputMessage(String(e));
  }
}

// ----------------------------
// Wire events
// ----------------------------
document.getElementById("planBtn").addEventListener("click", planRoute);

document.getElementById("resourceFilter").addEventListener("input", () => {
  populateResources(true);
});

document.getElementById("selectAllBtn").addEventListener("click", () => selectAllResources(true));
document.getElementById("clearBtn").addEventListener("click", () => selectAllResources(false));

document.getElementById("resetTypesBtn").addEventListener("click", resetMissionOrder);

document.getElementById("copyBtn").addEventListener("click", copyOutput);

init();
