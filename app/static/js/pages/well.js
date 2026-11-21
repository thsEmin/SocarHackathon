(function () {
  const $ = id => document.getElementById(id);
  let d = null;

  /* Wellbore schematic from the completion data. Like industry completion diagrams it is drawn
     zone by zone (not strictly to scale) so that gauge, valve and reservoir never overlap;
     every depth is labelled and the depth ruler follows the same mapping. */
  function wellbore(d) {
    const c = d.completion, v = d.pvt, s = d.sensors_7d, p = d.pta;
    const W = 620, H = 640, top = 70, bottom = H - 40;
    const datum = v.datum_tvd_ft, pay = v.net_pay_thickness_ft;
    const maxD = datum + pay / 2 + 150;
    // piecewise-linear depth -> pixel: surface, GL valve, gauge, top of pay, base of pay, bottom
    const kd = [0, c.gl_valve_tvd_ft, c.gauge_tvd_ft, datum - pay / 2, datum + pay / 2, maxD];
    const kf = [0, 0.34, 0.60, 0.74, 0.90, 1.0];
    const y = ft => {
      let i = 1; while (i < kd.length - 1 && ft > kd[i]) i++;
      const f = kf[i - 1] + (kf[i] - kf[i - 1]) * (ft - kd[i - 1]) / Math.max(kd[i] - kd[i - 1], 1);
      return top + f * (bottom - top);
    };
    const cx = 200, tub = 9, csg = 22;
    const resTop = y(datum - pay / 2), resBot = y(datum + pay / 2);
    // blueprint palette (light)
    const K = { ink: "#0B2341", t2: "#44546A", t3: "#5F6F84", line: "#C9D2DE", orange: "#00B5E2", oil: "#3F8A24", lift: "#0FA3B1", gauge: "#7B61FF" };
    const label = (yy, txt, val, col = K.t2) => `
      <line x1="${cx + csg + 4}" y1="${yy}" x2="${cx + 120}" y2="${yy}" stroke="${col}" stroke-dasharray="3 3" stroke-width="1"/>
      <rect x="${cx + 120}" y="${yy - 2}" width="4" height="4" fill="${col}"/>
      <text x="${cx + 130}" y="${yy - 3}" fill="${K.ink}" font-size="13" font-weight="600" letter-spacing=".3">${txt}</text>
      <text x="${cx + 130}" y="${yy + 13}" fill="${col}" font-size="12" font-family="JetBrains Mono">${val}</text>`;
    const ticks = []; for (let f = 0; f <= maxD; f += 2000) ticks.push(`<line x1="58" x2="66" y1="${y(f)}" y2="${y(f)}" stroke="${K.line}"/><text x="52" y="${y(f) + 4}" text-anchor="end" fill="${K.t3}" font-size="11" font-family="JetBrains Mono">${PN.fmt(f)}</text>`);
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="earth" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#F7F8F9"/><circle cx="8" cy="8" r="0.9" fill="#D3D5D9"/></pattern>
        <pattern id="rock" width="14" height="10" patternUnits="userSpaceOnUse"><path d="M0 10 L7 0 L14 10" stroke="#9FB8A9" stroke-width="1" fill="none"/></pattern>
        <linearGradient id="flow" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${K.oil}" stop-opacity=".9"/><stop offset="1" stop-color="${K.orange}" stop-opacity=".9"/></linearGradient>
      </defs>
      <text x="62" y="${top - 30}" fill="${K.t3}" font-size="11" letter-spacing="1">TVD, FT</text>
      ${ticks.join("")}
      <rect x="70" y="${top}" width="${W - 90}" height="${bottom - top}" fill="url(#earth)" stroke="#E2E3E6"/>
      <line x1="70" x2="${W - 20}" y1="${top}" y2="${top}" stroke="${K.ink}"/>
      <text x="${W - 26}" y="${top - 8}" text-anchor="end" fill="${K.t2}" font-size="11" letter-spacing=".6">SEA LEVEL / PLATFORM</text>
      <rect x="70" y="${resTop}" width="${W - 90}" height="${resBot - resTop}" fill="url(#rock)" opacity=".9"/>
      <rect x="70" y="${resTop}" width="${W - 90}" height="${resBot - resTop}" fill="${K.oil}" opacity=".07"/>
      <!-- wellhead + choke -->
      <rect x="${cx - 26}" y="${top - 34}" width="52" height="26" fill="${K.ink}"/>
      <text x="${cx}" y="${top - 17}" fill="${K.orange}" font-size="11" text-anchor="middle" font-weight="700" letter-spacing="1">WH</text>
      <line x1="${cx + 26}" y1="${top - 21}" x2="${cx + 90}" y2="${top - 21}" stroke="${K.t3}" stroke-width="3"/>
      <text x="${cx + 96}" y="${top - 25}" fill="${K.ink}" font-size="12" font-weight="600">${PN.t("choke")} ${PN.fmt(s.choke_opening_pct, 1)}%</text>
      <text x="${cx + 96}" y="${top - 10}" fill="${K.t2}" font-size="11" font-family="JetBrains Mono">WHP ${PN.fmt(s.whp_psia, 0)} psia</text>
      <!-- casing + annulus + tubing -->
      <rect x="${cx - csg}" y="${top - 8}" width="${csg * 2}" height="${resBot - top + 18}" fill="#FFFFFF" stroke="${K.ink}" stroke-width="1.5"/>
      <rect x="${cx - csg + 3}" y="${top}" width="${csg * 2 - 6}" height="${y(c.gl_valve_tvd_ft) - top}" fill="${K.lift}" opacity=".12"/>
      <rect x="${cx - tub}" y="${top - 8}" width="${tub * 2}" height="${y(c.gauge_tvd_ft) - top + 14}" fill="url(#flow)" opacity=".9"/>
      <!-- gas-lift valve -->
      <rect x="${cx + tub}" y="${y(c.gl_valve_tvd_ft) - 7}" width="10" height="14" fill="${K.lift}"/>
      ${label(y(c.gl_valve_tvd_ft), `${PN.t("gl_valve")} · ${c.gl_valve_port_64ths}/64"`, `${PN.fmt(c.gl_valve_tvd_ft)} ft · ${PN.fmt(s.gas_lift_rate_mscfd, 0)} Mscf/d`, K.lift)}
      <!-- gauge -->
      <circle cx="${cx}" cy="${y(c.gauge_tvd_ft)}" r="8" fill="#FFFFFF" stroke="${K.gauge}" stroke-width="2.5"/>
      ${label(y(c.gauge_tvd_ft), PN.t("gauge"), `${PN.fmt(c.gauge_tvd_ft)} ft · ${PN.fmt(s.dh_pressure_psia, 0)} psia · ${PN.fmt(s.dh_temperature_degf, 1)} °F`, K.gauge)}
      <!-- perforations -->
      ${Array.from({ length: 7 }, (_, i) => { const yy = resTop + (i + 0.5) * (resBot - resTop) / 7; return `<line x1="${cx - csg - 18}" x2="${cx - csg}" y1="${yy}" y2="${yy}" stroke="${K.oil}" stroke-width="2"/><line x1="${cx + csg}" x2="${cx + csg + 18}" y1="${yy}" y2="${yy}" stroke="${K.oil}" stroke-width="2"/>`; }).join("")}
      ${label((resTop + resBot) / 2, `${PN.t("pay")} ${PN.fmt(pay)} ft · φ ${PN.fmt(v.porosity_frac * 100, 1)}%`,
        p ? `k ${PN.fmt(p.permeability_md, 0)} mD · S ${PN.signed(p.skin, 2)}` : PN.t("no_pta"), K.oil)}
      <text x="80" y="${resBot + 18}" fill="${K.t3}" font-size="11" font-family="JetBrains Mono">${PN.t("datum")} ${PN.fmt(datum)} ft · Pb ${PN.fmt(v.bubble_point_pressure_psia)} psia</text>
      <text x="${W - 26}" y="${top + 18}" text-anchor="end" fill="${K.t3}" font-size="11" font-family="JetBrains Mono">${PN.t("tubing")} ${c.tubing_od_in}" OD / ${c.tubing_id_in}" ID</text>
    </svg>`;
  }

  function render() {
    if (!d) return;
    $("wb").innerHTML = wellbore(d);
    PN.countUp($("w-oil"), d.today.oil_rate_stbd); PN.countUp($("w-water"), d.today.water_rate_stbd); PN.countUp($("w-gas"), d.today.gas_rate_mscfd);
    const c = d.completion, v = d.pvt, p = d.pta;
    $("w-comp").innerHTML = [["gauge", `${PN.fmt(c.gauge_tvd_ft)} ft`], ["gl_valve", `${PN.fmt(c.gl_valve_tvd_ft)} ft · ${c.gl_valve_port_64ths}/64"`],
      ["tubing", `${c.tubing_od_in}" / ${c.tubing_id_in}"`], [PN.t("manifold"), c.production_manifold], ["Lift gas SG", c.lift_gas_sg],
      ["First production", c.first_production_date], ["Cum. oil 1-Jan-2025", `${PN.fmt(c.cum_oil_at_2025_01_01_stb / 1e6, 2)} MMstb`]]
      .map(([k, x]) => `<div class="k">${PN.t(k)}</div><div class="v">${x}</div>`).join("");
    $("w-pvt").innerHTML = [["pay", `${v.net_pay_thickness_ft} ft`], ["φ", `${PN.fmt(v.porosity_frac * 100, 1)} %`], ["Sw", `${PN.fmt(v.water_saturation_frac * 100, 1)} %`],
      ["ct", `${v.total_compressibility_1_psi.toExponential(2)} 1/psi`], ["Bo", `${v.oil_fvf_rb_stb} rb/stb`], ["μo", `${v.oil_viscosity_cp} cp`],
      ["Pb", `${PN.fmt(v.bubble_point_pressure_psia)} psia`], ["T res", `${v.reservoir_temperature_degf} °F`], [PN.t("drawdown"), `${PN.fmt(d.drawdown, 0)} psi`]]
      .map(([k, x]) => `<div class="k">${PN.t(k)}</div><div class="v">${x}</div>`).join("");
    $("w-pta").innerHTML = p ? `<div class="res-grid">
        <div class="res"><div class="label">${PN.t("m")}</div><div class="value">${PN.fmt(p.horner_slope_psi_cycle, 1)}<span class="unit">psi/cyc</span></div></div>
        <div class="res"><div class="label">${PN.t("k")}</div><div class="value">${PN.fmt(p.permeability_md, 1)}<span class="unit">mD</span></div></div>
        <div class="res"><div class="label">${PN.t("s")}</div><div class="value">${PN.signed(p.skin, 2)}</div></div>
        <div class="res"><div class="label">${PN.t("fe")}</div><div class="value">${PN.fmt(p.flow_efficiency, 2)}</div></div></div>
        <div class="dim mono" style="font-size:12px;margin-top:10px">${PN.date(p.shut_in_start, true)} · ${PN.fmt(p.duration_hr, 1)} h · ${PN.t("quality")} ${p.quality}</div>`
      : `<div class="muted">${PN.t("no_pta")}</div>`;
  }

  async function load() {
    try { d = await PN.api("/api/well", { well: PN.state.well }); render(); }
    catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  PN.start({ load, render, onWell: load });
})();
