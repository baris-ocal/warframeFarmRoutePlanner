(function () {
  // Keep this in sync with your layout.css mobile breakpoint
  const mq = window.matchMedia("(max-width: 68rem)");

  // Tries to match: Calculate, Plan, primary action button, etc.
  const actionBtnSelector = [
    "#planBtn",
    "#calcBtn",
    "#calculateBtn",
    "button.primary",
    "button[data-action='plan']",
    "button[data-action='calculate']",
  ].join(",");

  // We will auto-detect panels instead of hardcoding IDs
  function getPanels() {
    const main = document.querySelector("main.shell.grid");
    if (!main) return [];
    return Array.from(main.querySelectorAll(":scope > section.panel"));
  }

  function getPanelTitle(panelEl) {
    const h2 = panelEl.querySelector(".panelHead h2") || panelEl.querySelector("h2");
    return h2 && h2.textContent.trim() ? h2.textContent.trim() : "Section";
  }

  function getDetails(panelEl) {
    return panelEl ? panelEl.querySelector(":scope > details.mCollapse") : null;
  }

  function wrapPanel(panel) {
    if (!panel || panel.dataset.collapsible === "1") return;

    const title = getPanelTitle(panel);

    const details = document.createElement("details");
    details.className = "mCollapse";
    details.open = false;

    const summary = document.createElement("summary");
    summary.textContent = title;

    const body = document.createElement("div");
    body.className = "mCollapseBody";

    while (panel.firstChild) body.appendChild(panel.firstChild);

    details.appendChild(summary);
    details.appendChild(body);
    panel.appendChild(details);

    panel.dataset.collapsible = "1";
  }

  function unwrapPanel(panel) {
    if (!panel || panel.dataset.collapsible !== "1") return;

    const details = getDetails(panel);
    if (!details) return;

    const body = details.querySelector(".mCollapseBody");
    if (!body) return;

    while (body.firstChild) panel.appendChild(body.firstChild);

    details.remove();
    delete panel.dataset.collapsible;
  }

  function openDefaults() {
    const panels = getPanels();
    panels.forEach((p, i) => {
      const d = getDetails(p);
      if (!d) return;
      d.open = i === 0; // first panel open, rest collapsed
    });
  }

  function openOutputPanel() {
    const panels = getPanels();
    // Prefer a panel whose id includes "output", otherwise last panel
    const outputPanel =
      panels.find((p) => (p.id || "").toLowerCase().includes("output")) || panels[panels.length - 1];

    if (!outputPanel) return;

    const d = getDetails(outputPanel);
    if (d) d.open = true;

    outputPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function attachActionHandler() {
    const btn = document.querySelector(actionBtnSelector);
    if (!btn) return;

    if (btn.dataset.routeCollapseHook === "1") return;
    btn.dataset.routeCollapseHook = "1";

    btn.addEventListener("click", () => {
      if (!mq.matches) return; // only on mobile
      // let app.js render first, then open results
      setTimeout(openOutputPanel, 0);
    });
  }

  function wrapAll() {
    const panels = getPanels();
    panels.forEach(wrapPanel);
    openDefaults();
    attachActionHandler();
  }

  function unwrapAll() {
    const panels = getPanels();
    panels.forEach(unwrapPanel);
  }

  function sync() {
    if (mq.matches) wrapAll();
    else unwrapAll();
  }

  mq.addEventListener?.("change", sync);
  window.addEventListener("load", sync);
  sync();
})();
