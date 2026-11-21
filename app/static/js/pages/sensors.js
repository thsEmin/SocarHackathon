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
      gl(d.whp_psia, `${PN.t("whp")} (psia)`, c.whp, "y"),
      gl(d.whp_downstream_psia, `${PN.t("whp_down")} (psia)`, c.down, "y"),
      gl(d.dh_pressure_psia, `${PN.t("dhp")} (psia)`, c.dhp, "y2"),
      gl(d.dh_temperature_degf, `${PN.t("temperature")} (°F)`, c.temp, "y3"),
      gl(d.annulus_pressure_psia, `${PN.t("annulus")} (psia)`, c.ann, "y4"),
      gl(d.gas_lift_rate_mscfd, `${PN.t("lift")} (Mscf/d)`, c.lift, "y5"),
      gl(d.choke_opening_pct, `${PN.t("choke")} (%)`, c.choke, "y6", { line: { color: c.choke, width: 1.6, shape: "hv" } }),
    ];
    const dom = [[0.78, 1], [0.78, 1], [0.56, 0.74], [0.30, 0.52], [0.30, 0.52], [0, 0.26]];
    const ax = (i, title, extra) => Object.assign({ domain: dom[i], title: { text: title, font: { size: 11 } }, gridcolor: c.grid, zeroline: false }, extra || {});
    const shapes = [...PN.shade(d.shut_ins, "rgba(224,138,0,0.12)"), ...PN.shade(d.tests, "rgba(37,99,235,0.08)")];
    PN.plot(el, traces, {
      xaxis: { anchor: "y6", gridcolor: c.grid, rangeslider: { visible: false },
               rangeselector: { x: 0, y: 1.1, bgcolor: "#FFFFFF", activecolor: "#D6EBF8", bordercolor: c.line, borderwidth: 1,
                                font: { color: c.ink, size: 11 },
                                buttons: [{ count: 7, label: "1W", step: "day", stepmode: "backward" }, { count: 1, label: "1M", step: "month", stepmode: "backward" },
                                          { count: 3, label: "3M", step: "month", stepmode: "backward" }, { step: "all", label: "All" }] } },
      yaxis: ax(0, "WHP"), yaxis2: ax(1, "DHP", { overlaying: "y", side: "right", showgrid: false }),
      yaxis3: ax(2, "°F"), yaxis4: ax(3, PN.t("annulus")), yaxis5: ax(4, "Mscf/d", { overlaying: "y4", side: "right", showgrid: false }),
      yaxis6: ax(5, "%"), shapes, margin: { l: 64, r: 64, t: 70, b: 30 }, legend: { y: 1.045, x: 0.25 }, hovermode: "x unified",
    });
  }

  async function load() {
    try { d = await PN.api("/api/sensors", { well: PN.state.well }); render(); }
    catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  PN.start({ load, render, onWell: load });
})();
