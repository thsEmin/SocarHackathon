(function () {
  const $ = id => document.getElementById(id);
  let events = [], cur = null, idx = 0;
  const qs = new URLSearchParams(location.search);

  function renderEvents() {
    $("events").innerHTML = events.map(e => `<div class="ev ${e.idx === idx ? "on" : ""}" data-i="${e.idx}">
      <div style="display:flex;gap:8px;align-items:center"><span class="w">${e.well_name}</span><span class="badge ${e.quality === "A" ? "ok" : "warning"}" style="padding:1px 7px">${e.quality}</span></div>
      <div class="d">${PN.date(e.shut_in_start, true)} · ${PN.fmt(e.duration_hr, 1)} h</div></div>`).join("");
    document.querySelectorAll(".ev").forEach(el => el.onclick = () => { idx = +el.dataset.i; PN.setWell(events[idx].well_name); loadEvent(); });
  }

  async function loadEvent(w0, w1) {
    try {
      cur = await PN.api(`/api/pta/${idx}`, { w0, w1 });
      renderEvents(); render();
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }

  function kpi(id, v, auto, d, unit = "") {
    PN.countUp($(id), v, d, 450);
    const diff = auto != null && Math.abs(v - auto) > 1e-6;
    $(id + "-a").innerHTML = `<span class="dim">${PN.t("auto_val")}: ${PN.fmt(auto, d)}${unit}</span>` + (diff ? ` <span class="chip flat">${PN.signed((v / auto - 1) * 100, 1)}%</span>` : "");
  }

  function render() {
    if (!cur) return;
    const r = cur.results, a = cur.auto_results, c = PN.colors;
    kpi("r-m", r.horner_slope_psi_cycle, a.horner_slope_psi_cycle, 2);
    kpi("r-k", r.permeability_md, a.permeability_md, 1);
    kpi("r-s", r.skin, a.skin, 2);
    kpi("r-dps", r.dp_skin_psi, a.dp_skin_psi, 1);
    $("mode-badge").className = "badge " + (cur.window_auto ? "accent" : "warning");
    $("mode-badge").textContent = cur.window_auto ? PN.t("automatic") : PN.t("manual");
    $("q-badge").className = "badge " + (cur.quality === "A" ? "ok" : "warning");
    $("q-badge").textContent = `${PN.t("quality")} ${cur.quality}`;
    $("w0").value = (+r.radial_window_start_hr).toFixed(2); $("w1").value = (+r.radial_window_end_hr).toFixed(2);

    $("extra").innerHTML = [
      ["q_used", `${PN.fmt(r.q_oil_vfm_stbd, 0)} stb/d`], ["tp", `${PN.fmt(r.tp_hr, 0)} h`],
      ["pwf", `${PN.fmt(r.pwf_psia, 0)} psia`], ["P1hr / P*", `${PN.fmt(r.p1hr_psia, 0)} / ${PN.fmt(r.p_star_gauge_psia, 0)} psia`],
      ["pavg", `${PN.fmt(r.avg_reservoir_pressure_datum_psia, 0)} psia`], ["fe", PN.fmt(r.flow_efficiency, 2)],
      ["flatness", `${PN.fmt(r.derivative_flatness_cv * 100, 1)} %`], ["rinv", `${PN.fmt(r.radius_investigation_ft, 0)} ft`],
      ["storage", `≈ ${PN.fmt(r.wellbore_storage_bbl_psi, 3)} bbl/psi`],
    ].map(([k, v]) => `<div class="k">${PN.t(k)}</div><div class="v">${v}</div>`).join("");

    $("interp").innerHTML = cur.interpretation.map(x => `<div>${PN.t(x.key, {
      skin: x.skin != null ? PN.signed(x.skin, 1) : "", fe: x.fe != null ? PN.fmt(x.fe * 100, 0) + "%" : "",
      k: x.k != null ? PN.fmt(x.k, 0) : "", radius: x.radius != null ? PN.fmt(x.radius, 0) : "?", p: x.p != null ? PN.fmt(x.p, 0) : "" })}</div>`).join("");

    // 1 history: pressure + rate as used by the analysis
    const H = cur.history, shut = [{ start: cur.shut_in_start, end: cur.shut_in_end }];
    PN.plot($("c-hist"), [
      { x: H.t, y: H.p, name: `${PN.t("dhp")} (psia)`, type: "scatter", mode: "lines", line: { color: c.dhp, width: 1.6 } },
      { x: H.rate_t, y: H.rate_q, name: `${PN.t("oil")} VFM (stb/d)`, type: "scatter", mode: "lines", line: { color: c.oil, width: 2, shape: "hv" }, yaxis: "y2" },
    ], { yaxis: { title: { text: "psia" } }, yaxis2: { overlaying: "y", side: "right", showgrid: false, rangemode: "tozero", title: { text: "stb/d" } },
         shapes: PN.shade(shut, "rgba(224,138,0,0.12)"), margin: { r: 60 } });

    // 2 log-log with draggable window
    const L = cur.loglog, w0 = r.radial_window_start_hr, w1 = r.radial_window_end_hr;
    PN.plot($("c-loglog"), [
      { x: L.dt, y: L.dp, name: PN.t("dp"), type: "scatter", mode: "markers", marker: { color: c.water, size: 5 } },
      { x: L.dt, y: L.der, name: PN.t("deriv"), type: "scatter", mode: "markers", marker: { color: c.red, size: 5 } },
    ], { xaxis: { type: "log", title: { text: "Δt, h" } }, yaxis: { type: "log", title: { text: "psi" } }, hovermode: "closest",
         dragmode: "select", selectdirection: "h",
         shapes: [{ type: "rect", xref: "x", yref: "paper", x0: w0, x1: w1, y0: 0, y1: 1, fillcolor: "rgba(21,128,61,.09)", line: { color: "rgba(21,128,61,.5)", width: 1 } },
                  { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: r.horner_slope_psi_cycle / Math.LN10, y1: r.horner_slope_psi_cycle / Math.LN10, line: { color: c.ok, dash: "dash", width: 1 } }] },
      { modeBarButtonsToAdd: ["select2d"] });
    $("c-loglog").removeAllListeners && $("c-loglog").removeAllListeners("plotly_selected");
    $("c-loglog").on("plotly_selected", ev => {
      if (!ev || !ev.range || !ev.range.x) return;
      // Plotly reports the selected range in data units (hours); clamp to the measured data
      const lo = L.dt[0], hi = L.dt[L.dt.length - 1];
      const [a, b] = ev.range.x.map(v => Math.min(hi, Math.max(lo, v))).sort((x, y) => x - y);
      if (!(b > a * 1.2)) { PN.toast(PN.t("loglog_hint")); return; }
      loadEvent(+a.toFixed(3), +b.toFixed(3));
    });

    // 3 Horner
    const Hn = cur.horner, inW = L.dt.map(t => t >= w0 && t <= w1);
    PN.plot($("c-horner"), [
      { x: Hn.x, y: Hn.p, name: PN.t("data_pts"), type: "scatter", mode: "markers", marker: { color: c.muted, size: 5 } },
      { x: Hn.x.filter((_, i) => inW[i]), y: Hn.p.filter((_, i) => inW[i]), name: PN.t("radial_pts"), type: "scatter", mode: "markers", marker: { color: c.ok, size: 6 } },
      { x: Hn.fit_x, y: Hn.fit_p, name: `${PN.t("fit")} · m = ${PN.fmt(r.horner_slope_psi_cycle, 1)}`, type: "scatter", mode: "lines", line: { color: c.accent, dash: "dash", width: 2 } },
      { x: [Hn.p1hr_x], y: [r.p1hr_psia], name: `P1hr = ${PN.fmt(r.p1hr_psia, 0)}`, type: "scatter", mode: "markers", marker: { symbol: "square", size: 11, color: c.warn } },
      { x: [0], y: [r.p_star_gauge_psia], name: `P* = ${PN.fmt(r.p_star_gauge_psia, 0)}`, type: "scatter", mode: "markers", marker: { symbol: "star", size: 15, color: c.ink } },
    ], { xaxis: { autorange: "reversed", title: { text: "log10[(tp + Δt) / Δt]" } }, yaxis: { title: { text: "psia" } }, hovermode: "closest" });
  }

  PN.start({
    async load() {
      $("apply").onclick = () => {
        const lo = cur ? cur.loglog.dt[0] : 0.01, hi = cur ? cur.loglog.dt[cur.loglog.dt.length - 1] : 1e4;
        const a = Math.max(lo, +$("w0").value), b = Math.min(hi, +$("w1").value);
        if (!(b > a * 1.2)) { PN.toast(PN.t("loglog_hint")); return; }
        loadEvent(a, b);
      };
      $("auto").onclick = () => loadEvent();
      try {
        events = await PN.api("/api/pta/events");
        if (!events.length) { $("events").innerHTML = `<span class="muted">—</span>`; return; }
        const want = qs.get("event");
        idx = want != null ? +want : Math.max(0, events.findIndex(e => e.well_name === PN.state.well));
        renderEvents(); await loadEvent();
      } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
    },
    render,
    onWell(w) { const i = events.findIndex(e => e.well_name === w); if (i >= 0) { idx = i; loadEvent(); } else PN.toast(`${w}: ${PN.t("no_pta")}`); },
  });
})();
