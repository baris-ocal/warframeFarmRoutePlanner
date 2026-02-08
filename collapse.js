(function () {
  const mq = window.matchMedia("(max-width: 68rem)");

  // Update these if your IDs differ
  const panelIds = {
    resources: "panelResources",
    types: "panelTypes",
    output: "panelOutput",
  };

  // If your Plan button has a different id, update this selector
  const planBtnSelector = "#planBtn, button.primary, button[data-action='plan']";

  function getPanelTitle(panelEl){
    const h2 = panelEl.querySelector(".panelHead h2") || panelEl.querySelector("h2");
    return (h2 && h2.textContent.trim()) ? h2.textContent.trim() : "Section";
  }

  function getDetails(panelEl){
    return panelEl ? panelEl.querySelector(":scope > details.mCollapse") : null;
  }

  function setOpen(id, isOpen){
    const panel = document.getElementById(id);
    const details = getDetails(panel);
    if (!details) return;
    details.open = !!isOpen;
  }

  function openDefaults(){
    // Default: Resources expanded; other two collapsed
    setOpen(panelIds.resources, true);
    setOpen(panelIds.types, false);
    setOpen(panelIds.output, false);
  }

  function openRouteOnly(){
    setOpen(panelIds.resources, false);
    setOpen(panelIds.types, false);
    setOpen(panelIds.output, true);

    const outPanel = document.getElementById(panelIds.output);
    if (outPanel){
      outPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function wrapPanels(){
    Object.values(panelIds).forEach((id) => {
      const panel = document.getElementById(id);
      if (!panel) return;

      if (panel.dataset.collapsible === "1") return;

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
    });

    openDefaults();
  }

  function unwrapPanels(){
    Object.values(panelIds).forEach((id) => {
      const panel = document.getElementById(id);
      if (!panel) return;

      if (panel.dataset.collapsible !== "1") return;

      const details = getDetails(panel);
      if (!details) return;

      const body = details.querySelector(".mCollapseBody");
      if (!body) return;

      while (body.firstChild) panel.appendChild(body.firstChild);

      details.remove();
      delete panel.dataset.collapsible;
    });
  }

  function attachPlanHandler(){
    // Try to find a reliable plan button.
    const btn = document.querySelector(planBtnSelector);
    if (!btn) return;

    // Avoid multiple bindings
    if (btn.dataset.routeCollapseHook === "1") return;
    btn.dataset.routeCollapseHook = "1";

    btn.addEventListener("click", () => {
      if (!mq.matches) return;               // only on mobile
      // Small delay so your planner can update output first (optional but helps UX)
      setTimeout(openRouteOnly, 0);
    });
  }

  function sync(){
    if (mq.matches){
      wrapPanels();
      attachPlanHandler();
    } else {
      unwrapPanels();
    }
  }

  mq.addEventListener?.("change", sync);
  window.addEventListener("load", sync);
  sync();
})();
