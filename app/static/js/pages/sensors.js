(function () {
  let d = null;
  const el = document.getElementById("sensor-chart");

  function render() {
    if (!d) return;
    document.getElementById("s-title").textContent = `${d.well} · ${PN.t("p_sensors")}`;
    // SVG traces (not WebGL): work on every laptop / projector setup
    const c = PN.colors, gl = (y, name, color, axis, extra) => Object.assign({ x: d.t, y, name, type: "scatter", mode: "lines",
      line: { color, width: 1.4 }, xaxis: "x", yaxis: axis, hovertemplate: "%{y:.1f}" }, extra || {});
    const traces = [
      gl(PN.cva("p", d.whp_psia), `${PN.t("whp")} (${PN.ul("p")})`, c.whp, "y"),
      gl(PN.cva("p", d.whp_downstream_psia), `${PN.t("whp_down")} (${PN.ul("p")})`, c.down, "y"),
      gl(PN.cva("p", d.dh_pressure_psia), `${PN.t("dhp")} (${PN.ul("p")})`, c.dhp, "y2"),
      gl(PN.cva("t", d.dh_temperature_degf), `${PN.t("temperature")} (${PN.ul("t")})`, c.temp, "y3"),
      gl(PN.cva("p", d.annulus_pressure_psia), `${PN.t("annulus")} (${PN.ul("p")})`, c.ann, "y4"),
      gl(PN.cva("gas", d.gas_lift_rate_mscfd), `${PN.t("lift")} (${PN.ul("gas")})`, c.lift, "y5"),
      gl(d.choke_opening_pct, `${PN.t("choke")} (%)`, c.choke, "y6", { line: { color: c.choke, width: 1.6, shape: "hv" } }),
    ];
    const dom = [[0.78, 1], [0.78, 1], [0.56, 0.74], [0.30, 0.52], [0.30, 0.52], [0, 0.26]];
    const ax = (i, title, extra) => Object.assign({ domain: dom[i], title: { text: title, font: { size: 11 } }, gridcolor: c.grid, zeroline: false }, extra || {});
    const shapes = [...PN.shade(d.shut_ins, "rgba(224,138,0,0.12)"), ...PN.shade(d.tests, "rgba(37,99,235,0.08)")];
    PN.plot(el, traces, {
      xaxis: { anchor: "y6", gridcolor: c.grid, rangeslider: { visible: false }, ...(range ? { range } : {}),
               rangeselector: { x: 0, y: 1.1, bgcolor: "#FFFFFF", activecolor: "#D6EBF8", bordercolor: c.line, borderwidth: 1,
                                font: { color: c.ink, size: 11 },
                                buttons: [{ count: 7, label: "1W", step: "day", stepmode: "backward" }, { count: 1, label: "1M", step: "month", stepmode: "backward" },
                                          { count: 3, label: "3M", step: "month", stepmode: "backward" }, { step: "all", label: "All" }] } },
      yaxis: ax(0, `WHP, ${PN.ul("p")}`), yaxis2: ax(1, `DHP, ${PN.ul("p")}`, { overlaying: "y", side: "right", showgrid: false }),
      yaxis3: ax(2, PN.ul("t")), yaxis4: ax(3, `${PN.t("annulus")}, ${PN.ul("p")}`), yaxis5: ax(4, PN.ul("gas"), { overlaying: "y4", side: "right", showgrid: false }),
      yaxis6: ax(5, "%"), shapes, margin: { l: 64, r: 64, t: 70, b: 30 }, legend: { y: 1.045, x: 0.25 }, hovermode: "x unified",
    });
  }

  // From / To dates: set the chart window; zooming the chart updates the dates
  let range = null;
  const day = s => String(s).slice(0, 10);
  const addDay = iso => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
  function applyDates() {
    const a = document.getElementById("r-from").value, b = document.getElementById("r-to").value;
    if (!a || !b) return;
    range = a <= b ? [a, addDay(b)] : [b, addDay(a)];
    Plotly.relayout(el, { "xaxis.range": range });
  }
  document.getElementById("r-from").onchange = applyDates;
  document.getElementById("r-to").onchange = applyDates;
  function syncDates() {
    const r = el.layout && el.layout.xaxis && el.layout.xaxis.range;
    if (!r) return;
    document.getElementById("r-from").value = day(r[0]); document.getElementById("r-to").value = day(r[1]);
  }

  async function load() {
    try {
      d = await PN.api("/api/sensors", { well: PN.state.well });
      ["r-from", "r-to"].forEach(id => { const x = document.getElementById(id); x.min = day(d.t[0]); x.max = day(d.t[d.t.length - 1]); });
      render(); syncDates();
      if (!el._pnZoom) { el._pnZoom = true; el.on("plotly_relayout", ev => { if (ev["xaxis.range[0]"] || ev["xaxis.range"] || ev["xaxis.autorange"]) { const r = el.layout.xaxis.range; range = ev["xaxis.autorange"] ? null : r; syncDates(); } }); }
    }
    catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  PN.start({ load, render, onWell: load });
})();
