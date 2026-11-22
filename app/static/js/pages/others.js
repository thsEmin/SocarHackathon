/* "Others" page: equations explained, reference plots, mini calculators, glossary.
   Content (texts, formulas) comes from js/others_content.js; everything is computed in the browser (offline). */
(function () {
  const C = window.OTHERS;
  if (!C) return;
  const $ = id => document.getElementById(id);
  const L = () => PN.state.lang || "en";
  const tr = o => (o && (o[L()] || o.en)) || "";
  const T = (en, az, ru) => ({ en, az, ru });
  const esc = PN.esc;

  // page-only texts
  const W = {
    where: T("Where in PetroNova →", "PetroNova-da harada →", "Где в PetroNova →"),
    calc: T("Open calculator →", "Kalkulyatoru aç →", "Открыть калькулятор →"),
    eqlink: T("Equation →", "Tənlik →", "Формула →"),
    sym: T("Symbol", "İşarə", "Символ"), mean: T("Meaning", "Mənası", "Значение"), unit: T("Unit", "Vahid", "Единица"),
    use: T("Use {well} values", "{well} dəyərlərini istifadə et", "Подставить значения {well}"),
    used: T("Filled with {well}: PVT from the reservoir table, build-up results from the shut-in of {date}.",
            "{well} ilə dolduruldu: PVT lay cədvəlindən, bərpa nəticələri {date} bağlanmasından.",
            "Заполнено по {well}: PVT из таблицы пласта, результаты КВД остановки {date}."),
    usedNoPta: T("Filled with {well} PVT. This well has no analysed build-up, so the test values were left as they are.",
                 "{well} PVT ilə dolduruldu. Bu quyuda təhlil edilmiş bərpa testi yoxdur, test dəyərləri dəyişdirilmədi.",
                 "Заполнено PVT {well}. Для этой скважины нет обработанной КВД, значения исследования не изменены."),
    defaults: T("Example values are GL-01's April 2025 build-up. Inputs are in field units.",
                "Nümunə dəyərlər GL-01-in 2025 aprel bərpa testindəndir. Girişlər mədən vahidlərindədir.",
                "Примеры — КВД GL-01 за апрель 2025. Ввод в промысловых единицах."),
    app: T("PetroNova result", "PetroNova nəticəsi", "Результат PetroNova"),
    inYour: T("in your units", "sizin vahidlərdə", "в ваших единицах"),
    kind: T("Quantity", "Kəmiyyət", "Величина"), from: T("From", "Vahiddən", "Из"), value: T("Value", "Dəyər", "Значение"),
    model: { radial: T("Storage + radial", "Tutum + radial", "Ствол + радиальный"), fault: T("Sealing fault", "Keçirməz qırılma", "Непроницаемый разлом"),
             closed: T("Closed boundary", "Qapalı sərhəd", "Замкнутая граница"), support: T("Pressure support", "Təzyiq dəstəyi", "Поддержка давления") },
    dp: T("Δp", "Δp", "Δp"), der: T("Derivative", "Törəmə", "Производная"), ref: T("Radial (reference)", "Radial (müqayisə)", "Радиальный (эталон)"),
    dt: T("Δt, h", "Δt, saat", "Δt, ч"),
    data: T("Build-up data", "Bərpa məlumatı", "Данные КВД"), line: T("Horner line", "Horner xətti", "Прямая Хорнера"),
    straight: T("Straight-line PI", "Düz xətt (PI)", "Прямая (PI)"), vogel: T("Vogel below Pb", "Pb-dən aşağı Vogel", "Вогель ниже Pb"),
    rate: T("Oil rate", "Neft debiti", "Дебит нефти"), years: T("Years", "İllər", "Годы"),
    ideal: T("No skin", "Skinsiz", "Без скина"), damaged: T("Damaged zone (S ≈ 6.6)", "Zədələnmiş zona (S ≈ 6.6)", "Загрязнённая зона (S ≈ 6.6)"),
    radius: T("Distance from well, ft", "Quyudan məsafə, ft", "Расстояние от скважины, ft"),
    lift: T("Injected lift gas", "Vurulan qazlift qazı", "Закачка газлифтного газа"),
    peak: T("Technical maximum", "Texniki maksimum", "Технический максимум"), econ: T("Economic optimum", "İqtisadi optimum", "Экономический оптимум"),
  };
  const w = k => tr(W[k]);

  // ---------------------------------------------------------------- build the page once (cards keep their identity,
  // so the download buttons that exports.js adds stay in place when the language changes)
  const eqBox = $("tab-eq"), plBox = $("tab-pl"), calcBox = $("tab-calc"), glBox = $("tab-gl");
  Object.keys(C.G).forEach(g => {
    eqBox.insertAdjacentHTML("beforeend", `<h2 class="oth-group" data-g="${g}"></h2><div class="oth-grid" data-g="${g}"></div>`);
  });
  C.EQ.forEach(e => {
    eqBox.querySelector(`.oth-grid[data-g="${e.g}"]`).insertAdjacentHTML("beforeend",
      `<article class="card oth-eq" id="eq-${e.id}" data-xp="skip"><div class="card-h"><h3></h3></div>
        <div class="oth-f">${e.f}</div><table class="oth-sym"></table><p class="oth-d"></p><div class="oth-links"></div></article>`);
  });
  C.PLOTS.forEach(pt => {
    plBox.insertAdjacentHTML("beforeend",
      `<article class="card oth-plot" id="${pt.id}"><div class="card-h"><h3></h3>${pt.id === "pl-loglog"
        ? `<div class="right"><div class="seg" id="ll-model">${Object.keys(W.model).map(k => `<button type="button" data-m="${k}"></button>`).join("")}</div></div>` : ""}</div>
        <p class="oth-d"></p><div class="chart" id="c-${pt.id}" style="height:380px"></div></article>`);
  });
  calcBox.insertAdjacentHTML("beforeend",
    `<div class="oth-usebar"><button type="button" class="btn primary" id="use-well"></button><span class="dim" id="use-note"></span></div><div class="oth-grid" id="calc-grid"></div>`);
  C.CALC.forEach(c => {
    $("calc-grid").insertAdjacentHTML("beforeend",
      `<article class="card oth-calc" id="${c.id}" data-xp="skip"><div class="card-h"><h3></h3></div><div class="oth-form"></div><div class="oth-out"></div><div class="oth-links"></div></article>`);
  });
  glBox.insertAdjacentHTML("beforeend", `<article class="card" id="oth-gloss" data-xp="skip"><dl class="oth-gl"></dl></article>`);

  // ---------------------------------------------------------------- calculators
  // inputs share keys: "Use well values" fills every input with the same key. Defaults = GL-01, 15 Apr 2025 build-up.
  const F = {
    q: [C.SYM.q, 1009.43], B: [C.SYM.B, 1.16], mu: [C.SYM.mu, 1.054], m: [C.SYM.m, 23.2706], h: [C.SYM.h, 80],
    p1: [C.SYM.p1, 3480.99], pwf: [C.SYM.pwf, 3240.72], k: [C.SYM.k, 107.795], phi: [C.SYM.phi, 0.194],
    ct: [C.SYM.ct, 1.275e-5], rw: [C.SYM.rw, 0.328], ps: [C.SYM.ps, 3606.16], dt: [C.SYM.dt, 72],
    fe: [C.SYM.FE, 0.68], qn: [["q", T("current oil rate", "cari neft debiti", "текущий дебит нефти"), "stb/d"], 1009.43],
    price: [["P oil", T("oil price", "neftin qiyməti", "цена нефти"), "$/bbl"], 70],
  };
  const CALC_IN = { "calc-k": ["q", "B", "mu", "m", "h"], "calc-skin": ["p1", "pwf", "m", "k", "phi", "mu", "ct", "rw", "ps"],
                    "calc-rinv": ["k", "dt", "phi", "mu", "ct"], "calc-gain": ["qn", "fe", "price"] };
  const val = {};
  Object.entries(F).forEach(([k, [, d]]) => { val[k] = d; });
  let appRes = null, appWell = "GL-01";

  function buildForms() {
    Object.entries(CALC_IN).forEach(([id, keys]) => {
      $(id).querySelector(".oth-form").innerHTML = keys.map(k => {
        const [s] = F[k];
        return `<label class="oth-in"><span class="oth-in-l"><b>${esc(s[0])}</b> ${esc(tr(s[1]))}</span>
          <span class="oth-in-v"><input type="number" step="any" data-k="${k}" value="${val[k]}"><span class="oth-in-u">${esc(s[2])}</span></span></label>`;
      }).join("");
    });
    // unit converter
    const kinds = Object.keys(UNITS);
    $("calc-units").querySelector(".oth-form").innerHTML = `
      <label class="oth-in"><span class="oth-in-l">${esc(w("kind"))}</span><span class="oth-in-v"><select id="u-kind">${kinds.map(k => `<option value="${k}">${esc(tr(UNITS[k].name))}</option>`).join("")}</select></span></label>
      <label class="oth-in"><span class="oth-in-l">${esc(w("value"))}</span><span class="oth-in-v"><input type="number" step="any" id="u-val" value="${uState.v}"></span></label>
      <label class="oth-in"><span class="oth-in-l">${esc(w("from"))}</span><span class="oth-in-v"><select id="u-from"></select></span></label>`;
    $("u-kind").value = uState.kind;
    fillFrom();
    $("u-kind").onchange = () => { uState.kind = $("u-kind").value; uState.from = null; fillFrom(); compute(); };
    $("u-from").onchange = () => { uState.from = $("u-from").value; compute(); };
    $("u-val").oninput = () => { uState.v = +$("u-val").value; compute(); };
    document.querySelectorAll(".oth-form input[data-k]").forEach(inp => inp.oninput = () => {
      val[inp.dataset.k] = +inp.value;
      document.querySelectorAll(`.oth-form input[data-k="${inp.dataset.k}"]`).forEach(o => { if (o !== inp) o.value = inp.value; });
      compute();
    });
  }

  // converter: [label, factor, offset] relative to field units (same scheme as PN.UNITS)
  const UNITS = {
    p: { name: T("Pressure", "Təzyiq", "Давление"), u: PN.UNITS.p },
    dp: { name: T("Pressure difference", "Təzyiq fərqi", "Перепад давления"), u: PN.UNITS.dp },
    t: { name: T("Temperature", "Temperatur", "Температура"), u: PN.UNITS.t },
    oil: { name: T("Oil rate", "Neft debiti", "Дебит нефти"), u: PN.UNITS.oil },
    liq: { name: T("Liquid rate", "Maye debiti", "Дебит жидкости"), u: PN.UNITS.liq },
    gas: { name: T("Gas rate", "Qaz debiti", "Дебит газа"), u: PN.UNITS.gas },
    len: { name: T("Length / depth", "Uzunluq / dərinlik", "Длина / глубина"), u: PN.UNITS.len },
    perm: { name: T("Permeability", "Keçiricilik", "Проницаемость"), u: { md: ["md", 1], d: ["darcy", 0.001], um2: ["μm²", 9.869233e-4], m2: ["m²", 9.869233e-16] } },
    visc: { name: T("Viscosity", "Özlülük", "Вязкость"), u: { cp: ["cp", 1], mpas: ["mPa·s", 1], pas: ["Pa·s", 0.001] } },
    comp: { name: T("Compressibility", "Sıxılma əmsalı", "Сжимаемость"), u: { psi: ["1/psi", 1], bar: ["1/bar", 14.5038], kpa: ["1/kPa", 0.145038], mpa: ["1/MPa", 145.038] } },
    fvf: { name: T("Gas-oil ratio", "Qaz-neft nisbəti", "Газовый фактор"), u: { scfstb: ["scf/stb", 1], m3m3: ["m³/m³", 0.178108] } },
  };
  const uState = { kind: "p", from: null, v: 3500 };
  function fillFrom() {
    const u = UNITS[uState.kind].u;
    $("u-from").innerHTML = Object.entries(u).map(([k, d]) => `<option value="${k}">${esc(d[0])}</option>`).join("");
    if (!uState.from || !u[uState.from]) uState.from = Object.keys(u)[0];
    $("u-from").value = uState.from;
  }

  const fx = (v, d = 2) => (v == null || !isFinite(v) ? "—" : PN.fmt(v, d));
  const sig = v => (v == null || !isFinite(v) ? "—" : Math.abs(v) >= 1000 ? PN.fmt(v, 0) : Math.abs(v) >= 1 ? PN.fmt(v, 3).replace(/\.?0+$/, "") : Number(v.toPrecision(4)).toString());
  function outRow(label, main, unit, extra, app) {
    return `<div class="oth-res"><span class="oth-res-l">${esc(label)}</span><span class="oth-res-v"><b>${main}</b> ${esc(unit)}</span>
      ${extra ? `<span class="dim oth-res-x">${extra}</span>` : ""}${app != null ? `<span class="oth-app">${esc(w("app"))} (${esc(appWell)}): ${app}</span>` : ""}</div>`;
  }
  function compute() {
    const v = val;
    const k = 162.6 * v.q * v.B * v.mu / (v.m * v.h);
    $("calc-k").querySelector(".oth-out").innerHTML = outRow("k", fx(k, 1), "md", "", appRes && appRes.k != null ? fx(appRes.k, 1) + " md" : null);
    const S = 1.1513 * ((v.p1 - v.pwf) / v.m - Math.log10(v.k / (v.phi * v.mu * v.ct * v.rw ** 2)) + 3.2275);
    const dps = 0.869 * v.m * S, fe = (v.ps - v.pwf - dps) / (v.ps - v.pwf);
    $("calc-skin").querySelector(".oth-out").innerHTML =
      outRow("S", fx(S, 2), "", "", appRes && appRes.S != null ? fx(appRes.S, 2) : null) +
      outRow("ΔP skin", fx(dps, 1), "psi", `${fx(PN.cv("dp", dps), 1)} ${PN.ul("dp")} ${w("inYour")}`, appRes && appRes.dps != null ? fx(appRes.dps, 1) + " psi" : null) +
      outRow("FE", fx(fe, 2), "", "", appRes && appRes.fe != null ? fx(appRes.fe, 2) : null);
    const ri = Math.sqrt(v.k * v.dt / (948 * v.phi * v.mu * v.ct));
    $("calc-rinv").querySelector(".oth-out").innerHTML = outRow("r inv", fx(ri, 0), "ft", `${fx(PN.cv("len", ri), 0)} ${PN.ul("len")} ${w("inYour")}`, appRes && appRes.ri != null ? fx(appRes.ri, 0) + " ft" : null);
    const gain = v.qn * (1 / v.fe - 1);
    $("calc-gain").querySelector(".oth-out").innerHTML =
      outRow("q gain", fx(gain, 0), "stb/d", `${fx(PN.cv("oil", gain), 1)} ${PN.ul("oil")} ${w("inYour")}`) +
      outRow("$", fx(gain * v.price, 0), "$/d", `≈ $${fx(gain * v.price * 365 / 1e6, 2)}M / yr`);
    // converter
    const u = UNITS[uState.kind].u, f = u[uState.from] || Object.values(u)[0];
    const base = (uState.v - (f[2] || 0)) / f[1];
    $("calc-units").querySelector(".oth-out").innerHTML = `<div class="oth-conv">${Object.values(u).map(d =>
      `<div><span class="mono">${sig(base * d[1] + (d[2] || 0))}</span> <span class="dim">${esc(d[0])}</span></div>`).join("")}</div>`;
  }

  async function useWell() {
    const well = PN.state.well;
    try {
      const info = await PN.api("/api/well", { well });
      const pv = info.pvt || {}, pt = info.pta;
      const set = (k, x) => { if (x != null && isFinite(x)) val[k] = +(+x).toPrecision(6); };
      set("B", pv.oil_fvf_rb_stb); set("mu", pv.oil_viscosity_cp); set("h", pv.net_pay_thickness_ft); set("phi", pv.porosity_frac);
      set("ct", pv.total_compressibility_1_psi); set("rw", pv.wellbore_radius_ft);
      if (info.today) set("qn", info.today.oil_rate_stbd);
      appWell = well;
      if (pt) {
        set("q", pt.q_oil_vfm_stbd); set("m", pt.horner_slope_psi_cycle); set("p1", pt.p1hr_psia); set("pwf", pt.pwf_psia);
        set("k", pt.permeability_md); set("ps", pt.p_star_gauge_psia); set("fe", pt.flow_efficiency);
        // Δt = time of the last recorded build-up point (what PetroNova uses), recovered from its radius of investigation
        const dtLast = pt.radius_investigation_ft && pt.permeability_md
          ? pt.radius_investigation_ft ** 2 * 948 * val.phi * val.mu * val.ct / pt.permeability_md : pt.duration_hr;
        set("dt", dtLast);
        appRes = { k: pt.permeability_md, S: pt.skin, dps: pt.dp_skin_psi, fe: pt.flow_efficiency, ri: pt.radius_investigation_ft };
        $("use-note").textContent = tr(W.used).replace(/\{well\}/g, well).replace("{date}", String(pt.shut_in_start).slice(0, 10));
      } else {
        appRes = null;
        $("use-note").textContent = tr(W.usedNoPta).replace(/\{well\}/g, well);
      }
      document.querySelectorAll(".oth-form input[data-k]").forEach(inp => { inp.value = val[inp.dataset.k]; });
      compute();
    } catch (e) { PN.toast(`${PN.t("error")}: ${e.message}`); }
  }
  $("use-well").onclick = useWell;

  // ---------------------------------------------------------------- reference plots (textbook shapes)
  const drawn = {};
  let llModel = "radial";
  const logspace = (a, b, nPts) => Array.from({ length: nPts }, (_, j) => Math.pow(10, a + (b - a) * j / (nPts - 1)));
  const linspace = (a, b, nPts) => Array.from({ length: nPts }, (_, j) => a + (b - a) * j / (nPts - 1));
  function loglogCurves(model) {
    const t = logspace(-3, 3, 220), P = 8.7, tw = 0.03, tb = 30;
    const d = t.map(tt => {
      const xx = tt / tw, u = tt / tb;
      let v = P * (xx / (1 + xx)) * (1 + 0.9 * Math.exp(-Math.pow(Math.log(xx / 2.5), 2) / 1.4));
      if (model === "fault") v *= 1 + 1 / (1 + Math.pow(u, -2));
      if (model === "closed") v += P * u;
      if (model === "support") v /= 1 + Math.pow(u, 2);
      return v;
    });
    const dp = [d[0]];
    for (let j = 1; j < t.length; j++) dp.push(dp[j - 1] + 0.5 * (d[j] + d[j - 1]) * Math.log(t[j] / t[j - 1]));
    const sk = t.map(tt => 6 * P * ((tt / tw) / (1 + tt / tw)));
    return { t, d, dp: dp.map((v, j) => v + sk[j]) };
  }
  const PLOT_DRAW = {
    "pl-loglog": el => {
      const c = PN.colors, a = loglogCurves(llModel), ref = loglogCurves("radial");
      PN.plot(el, [
        { x: a.t, y: PN.cva("dp", a.dp), name: w("dp"), mode: "lines", line: { color: c.accent, width: 2.5 } },
        { x: a.t, y: PN.cva("dp", a.d), name: w("der"), mode: "lines", line: { color: c.red, width: 2.5 } },
        ...(llModel !== "radial" ? [{ x: ref.t, y: PN.cva("dp", ref.d), name: w("ref"), mode: "lines", line: { color: c.muted, width: 1.5, dash: "dot" } }] : []),
      ], { xaxis: { type: "log", title: { text: w("dt") } }, yaxis: { type: "log", title: { text: `Δp, ${PN.ul("dp")}` } }, legend: { orientation: "h", y: 1.12 } });
    },
    "pl-horner": el => {
      const c = PN.colors, tp = 1000, Ps = 3606, m = 23.27, pwf = 3240;
      const dt = logspace(-2, Math.log10(72), 90);
      const X = dt.map(t => Math.log10((tp + t) / t));
      const pr = X.map(x => Ps - m * x);
      const p = pr.map((v, j) => pwf + (v - pwf) * (1 - Math.exp(-dt[j] / 0.12)));
      const xl = [0, 5], p1x = Math.log10(tp + 1);
      PN.plot(el, [
        { x: X, y: PN.cva("p", p), name: w("data"), mode: "markers", marker: { color: c.accent, size: 6 } },
        { x: xl, y: PN.cva("p", xl.map(x => Ps - m * x)), name: w("line"), mode: "lines", line: { color: c.red, dash: "dash", width: 2 } },
      ], { xaxis: { title: { text: "log10[(tp + Δt) / Δt]" }, autorange: "reversed" }, yaxis: { title: { text: `p, ${PN.ul("p")}` } },
           legend: { orientation: "h", y: 1.12 },
           annotations: [{ x: 0, y: PN.cv("p", Ps), text: "P*", showarrow: true, ax: -30, ay: -25 },
                         { x: p1x, y: PN.cv("p", Ps - m * p1x), text: "p1hr", showarrow: true, ax: 30, ay: -30 },
                         { x: 1.6, y: PN.cv("p", Ps - m * 1.6), text: "slope = −m", showarrow: false, yshift: 18 }] });
    },
    "pl-ipr": el => {
      const c = PN.colors, Pr = 3000, Pb = 2000, J = 1.5, qb = J * (Pr - Pb), qv = J * Pb / 1.8;
      const pw = linspace(0, Pr, 120);
      const st = pw.map(pp => J * (Pr - pp));
      const vg = pw.map(pp => pp >= Pb ? J * (Pr - pp) : qb + qv * (1 - 0.2 * pp / Pb - 0.8 * Math.pow(pp / Pb, 2)));
      PN.plot(el, [
        { x: PN.cva("oil", st), y: PN.cva("p", pw), name: w("straight"), mode: "lines", line: { color: c.muted, dash: "dash", width: 2 } },
        { x: PN.cva("oil", vg), y: PN.cva("p", pw), name: w("vogel"), mode: "lines", line: { color: c.oil, width: 2.5 } },
      ], { xaxis: { title: { text: `${w("rate")}, ${PN.ul("oil")}` } }, yaxis: { title: { text: `pwf, ${PN.ul("p")}` } }, legend: { orientation: "h", y: 1.12 },
           shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: PN.cv("p", Pb), y1: PN.cv("p", Pb), line: { color: c.warn, dash: "dot", width: 1.5 } }],
           annotations: [{ xref: "paper", x: 0.98, y: PN.cv("p", Pb), text: "Pb", showarrow: false, yshift: 10 }] });
    },
    "pl-decline": el => {
      const c = PN.colors, t = linspace(0, 10, 101), qi = 1000, Di = 0.3;
      const curve = b => t.map(x => b === 0 ? qi * Math.exp(-Di * x) : qi / Math.pow(1 + b * Di * x, 1 / b));
      PN.plot(el, [0, 0.5, 1].map((b, j) => ({ x: t, y: PN.cva("oil", curve(b)), name: b === 0 ? "b = 0 (exponential)" : b === 1 ? "b = 1 (harmonic)" : "b = 0.5 (hyperbolic)",
        mode: "lines", line: { color: [c.red, c.accent, c.oil][j], width: 2.5 } })),
        { xaxis: { title: { text: w("years") } }, yaxis: { title: { text: `${w("rate")}, ${PN.ul("oil")}` } }, legend: { orientation: "h", y: 1.12 } });
    },
    "pl-skin": el => {
      const c = PN.colors, rw = 0.328, re = 1000, rs = 3, ratio = 4, Pe = 3600;
      const Cc = 141.2 * 1000 * 1.16 * 1.054 / (100 * 80);
      const r = logspace(Math.log10(rw), Math.log10(re), 160);
      const ideal = r.map(x => Pe - Cc * Math.log(re / x));
      const dmg = r.map(x => x >= rs ? Pe - Cc * Math.log(re / x) : Pe - Cc * (Math.log(re / rs) + ratio * Math.log(rs / x)));
      const dps = dmg[0] - ideal[0];
      PN.plot(el, [
        { x: r, y: PN.cva("p", ideal), name: w("ideal"), mode: "lines", line: { color: c.muted, dash: "dash", width: 2 } },
        { x: r, y: PN.cva("p", dmg), name: w("damaged"), mode: "lines", line: { color: c.red, width: 2.5 } },
      ], { xaxis: { type: "log", title: { text: w("radius") } }, yaxis: { title: { text: `p, ${PN.ul("p")}` } }, legend: { orientation: "h", y: 1.12 },
           shapes: [{ type: "rect", x0: rw, x1: rs, yref: "paper", y0: 0, y1: 1, fillcolor: "rgba(239,51,64,.07)", line: { width: 0 } }],
           annotations: [{ x: Math.log10(0.6), y: PN.cv("p", (dmg[0] + ideal[0]) / 2), xref: "x", text: `ΔP skin ≈ ${fx(PN.cv("dp", -dps), 0)} ${PN.ul("dp")}`, showarrow: false, xanchor: "left" }] });
    },
    "pl-gaslift": el => {
      const c = PN.colors, G = linspace(0, 3000, 151), q = G.map(g => 300 + 1200 * g / (400 + g) - 0.12 * g);
      const gp = 1600, ge = 865, qq = g => 300 + 1200 * g / (400 + g) - 0.12 * g;
      PN.plot(el, [
        { x: PN.cva("gas", G), y: PN.cva("oil", q), name: w("rate"), mode: "lines", line: { color: c.oil, width: 2.5 } },
        { x: PN.cva("gas", [ge, gp]), y: PN.cva("oil", [qq(ge), qq(gp)]), mode: "markers+text", text: [w("econ"), w("peak")], textposition: "top center",
          marker: { color: [c.accent, c.red], size: 10 }, showlegend: false },
      ], { xaxis: { title: { text: `${w("lift")}, ${PN.ul("gas")}` } }, yaxis: { title: { text: `${w("rate")}, ${PN.ul("oil")}` } }, showlegend: false });
    },
  };
  function drawPlots(force) {
    if ($("tab-pl").classList.contains("hidden")) return;
    C.PLOTS.forEach(pt => {
      const el = $("c-" + pt.id), card = $(pt.id);
      if (card.classList.contains("hidden")) return;
      if (force || !drawn[pt.id]) { PLOT_DRAW[pt.id](el); drawn[pt.id] = true; }
    });
  }
  $("ll-model").addEventListener("click", e => {
    const b = e.target.closest("[data-m]");
    if (!b) return;
    llModel = b.dataset.m;
    $("ll-model").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    PLOT_DRAW["pl-loglog"]($("c-pl-loglog"));
  });

  // ---------------------------------------------------------------- texts (run again when the language or units change)
  function render() {
    PN.applyI18n($("oth-bar"));
    $("oth-filter").placeholder = PN.t("oth_filter_ph");
    $("oth-filter").setAttribute("aria-label", PN.t("oth_filter_ph"));
    eqBox.querySelectorAll(".oth-group").forEach(h => { h.textContent = tr(C.G[h.dataset.g]); });
    C.EQ.forEach(e => {
      const card = $("eq-" + e.id);
      card.querySelector("h3").textContent = tr(e.t);
      card.querySelector(".oth-sym").innerHTML = `<tr><th>${esc(w("sym"))}</th><th>${esc(w("mean"))}</th><th>${esc(w("unit"))}</th></tr>` +
        e.s.map(s => `<tr><td class="mono">${esc(s[0])}</td><td>${esc(tr(s[1]))}</td><td class="mono dim">${esc(s[2])}</td></tr>`).join("");
      card.querySelector(".oth-d").textContent = tr(e.d);
      const pageUrl = e.w.page === "home" ? "/" : `/${e.w.page}?focus=${e.w.focus}`;
      card.querySelector(".oth-links").innerHTML =
        `<a href="${pageUrl}">${esc(w("where"))} ${esc(PN.t("n_" + e.w.page))}</a>` +
        (e.calc ? `<a href="#" data-go="calc-${e.calc}">${esc(w("calc"))}</a>` : "");
    });
    C.PLOTS.forEach(pt => { const card = $(pt.id); card.querySelector("h3").textContent = tr(pt.t); card.querySelector(".oth-d").textContent = tr(pt.d); });
    $("ll-model").querySelectorAll("button").forEach(b => { b.textContent = tr(W.model[b.dataset.m]); b.classList.toggle("on", b.dataset.m === llModel); });
    C.CALC.forEach(c => {
      const card = $(c.id);
      card.querySelector("h3").textContent = tr(c.t);
      card.querySelector(".oth-links").innerHTML = c.eq ? `<a href="#" data-go="eq-${c.eq}">${esc(w("eqlink"))} ${esc(tr(C.EQ.find(e => e.id === c.eq).t))}</a>` : "";
    });
    $("use-well").textContent = tr(W.use).replace("{well}", PN.state.well);
    if (!appRes) $("use-note").textContent = w("defaults");
    buildForms(); compute();
    glBox.querySelector(".oth-gl").innerHTML = C.GL.slice().sort((a, b) => a.term.localeCompare(b.term)).map(g =>
      `<div class="oth-gl-i" data-term="${esc(g.term)}"><dt>${esc(g.term)}</dt><dd>${esc(tr(g.def))}${g.eq ? ` <a href="#" data-go="eq-${g.eq}">${esc(w("eqlink"))}</a>` : ""}</dd></div>`).join("");
    drawPlots(true);
    filter();
  }

  // ---------------------------------------------------------------- tabs, filter, jumps
  let tab = "eq";
  function show(name) {
    tab = name;
    ["eq", "pl", "calc", "gl"].forEach(k => $("tab-" + k).classList.toggle("hidden", k !== name));
    $("oth-tabs").querySelectorAll("button").forEach(b => { const on = b.dataset.tab === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    filter();
    if (name === "pl") requestAnimationFrame(() => drawPlots(false));
  }
  $("oth-tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });

  const norm = s => String(s || "").toLowerCase().replace(/ə/g, "e").replace(/ı/g, "i").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const allText = o => (o ? [o.en, o.az, o.ru].join(" ") : "");
  function filter() {
    const q = norm($("oth-filter").value.trim());
    let shown = 0;
    const test = txt => !q || norm(txt).includes(q);
    if (tab === "eq") {
      C.EQ.forEach(e => { const ok = test(allText(e.t) + " " + allText(e.d) + " " + e.kw + " " + e.s.map(s => s[0] + " " + allText(s[1])).join(" ")); $("eq-" + e.id).classList.toggle("hidden", !ok); shown += ok; });
      eqBox.querySelectorAll(".oth-grid").forEach(gr => { const any = gr.querySelector(".oth-eq:not(.hidden)"); gr.classList.toggle("hidden", !any); gr.previousElementSibling.classList.toggle("hidden", !any); });
    } else if (tab === "pl") {
      C.PLOTS.forEach(pt => { const ok = test(allText(pt.t) + " " + allText(pt.d) + " " + pt.kw); $(pt.id).classList.toggle("hidden", !ok); shown += ok; });
      requestAnimationFrame(() => drawPlots(false));
    } else if (tab === "calc") {
      C.CALC.forEach(c => { const ok = test(allText(c.t) + " " + c.kw); $(c.id).classList.toggle("hidden", !ok); shown += ok; });
    } else {
      C.GL.forEach(g => { const el = glBox.querySelector(`[data-term="${CSS.escape(g.term)}"]`); const ok = test(g.term + " " + allText(g.def)); el && el.classList.toggle("hidden", !ok); shown += ok; });
    }
    $("oth-none").classList.toggle("hidden", shown > 0);
  }
  $("oth-filter").addEventListener("input", filter);

  // open the tab that holds an element (links inside the page, and top-bar search results)
  function tabOf(id) {
    const el = $(id);
    const sec = el && el.closest(".oth-tab");
    return sec ? sec.id.replace("tab-", "") : null;
  }
  function goTo(id) {
    const t = tabOf(id);
    if (!t) return;
    if ($("oth-filter").value) { $("oth-filter").value = ""; }
    show(t);
    const el = $(id);
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("srch-flash"); void el.offsetWidth; el.classList.add("srch-flash");
    });
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-go]");
    if (a) { e.preventDefault(); goTo(a.dataset.go); }
  });
  document.addEventListener("pn:reveal", e => { const t = tabOf(e.detail); if (t && t !== tab) { $("oth-filter").value = ""; show(t); } });

  // ---------------------------------------------------------------- start
  render();
  show("eq");
  // render runs again on language and unit changes (core.js calls PN.page.render)
  PN.start({ render, onWell: () => { $("use-well").textContent = tr(W.use).replace("{well}", PN.state.well); } });
})();
