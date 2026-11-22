/* PetroNova home: "how it works" story card inside the scroll hero, live numbers, reveals. */
(function () {
  const $ = id => document.getElementById(id);
  const RM = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = k => (k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const hash = (i, s = 0) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  // story card colours, taken from the hero photo: sunset amber / gold / coral on warm dark earth
  // ("orange" is the highlight role; oil stays green and water blue so the meaning is unchanged)
  const C = { ink: "#1A120D", ink2: "#2B1D15", line: "#4D3A2C", text: "#FBEFE3", text2: "#DCC6B2", text3: "#B0957F",
              orange: "#FFA43A", red: "#FF5E4D", oil: "#9BD86B", water: "#7DB4EA", gas: "#FF7A66", dhp: "#FFD37A", temp: "#FF8A5B",
              lift: "#EBD7B4", ok: "#9BD86B", warn: "#F5B841", alarm: "#FF5E4D", radial: "rgba(155,216,107," };
  const STEP_COL = ["#FFA43A", "#9BD86B", "#FF5E4D", "#FFD37A", "#9BD86B"];

  // ------------------------------------------------------------------ data (live, with fallbacks)
  const D = {
    wells: Array.from({ length: 10 }, (_, i) => ({ well: `GL-${String(i + 1).padStart(2, "0")}`, manifold: i < 5 ? "A" : "B", status: "ok", oil: 0 })),
    alerts: [], pta: null,
  };
  const synthLog = (() => {
    const dt = [], dp = [], der = [];
    for (let i = 0; i < 90; i++) {
      const lt = -2 + i * 4.2 / 89, t = Math.pow(10, lt);
      dt.push(t); dp.push(25 * Math.log(1 + t / 0.02));
      der.push(25 * t / (0.02 + t) + 18 * Math.exp(-((lt + 0.9) ** 2) / 0.12));
    }
    return { dt, dp, der, w0: 2, w1: 10, k: null, s: null, well: "" };
  })();

  // ------------------------------------------------------------------ canvas helpers
  function canvas(cv) {
    const ctx = cv.getContext("2d"), s = { cv, ctx, w: 0, h: 0 };
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
      s.w = r.width; s.h = r.height; cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    fit(); new ResizeObserver(fit).observe(cv);
    return s;
  }
  function text(ctx, str, x, y, o = {}) {
    ctx.font = `${o.weight || 500} ${o.size || 11}px ${o.mono ? "JetBrains Mono, monospace" : "Inter, Segoe UI, sans-serif"}`;
    ctx.fillStyle = o.color || C.text2; ctx.textAlign = o.align || "left"; ctx.textBaseline = o.base || "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = (o.ls || 0) + "px";
    ctx.fillText(o.upper === false ? str : String(str).toUpperCase(), x, y);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }
  const box = (ctx, x, y, w, h, fill, stroke) => { if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); } };
  function bez(p0, p1, p2, p3, u) {
    const m = 1 - u;
    return [m * m * m * p0[0] + 3 * m * m * u * p1[0] + 3 * m * u * u * p2[0] + u * u * u * p3[0],
            m * m * m * p0[1] + 3 * m * m * u * p1[1] + 3 * m * u * u * p2[1] + u * u * u * p3[1]];
  }

  // ------------------------------------------------------------------ 2 · story stage
  const stage = canvas($("story-canvas"));
  const area = () => { const { w, h } = stage; return { x0: 16, y0: 44, x1: w - 16, y1: h - 30, w, h }; };

  // scene A (steps 1-2): raw sensor lanes, cleaned by a sweep
  const LANES = [
    { name: "WHP · psia", c: C.orange, f: j => Math.sin(j * 0.03) * 0.35 + Math.sin(j * 0.011 + 1) * 0.25 },
    { name: "DHP · psia", c: C.dhp, f: j => Math.sin(j * 0.017 + 2) * 0.45 + Math.sin(j * 0.05) * 0.1 },
    { name: "TEMP · °F", c: C.temp, f: j => Math.sin(j * 0.009 + 4) * 0.4 + Math.sin(j * 0.04 + 1) * 0.08 },
    { name: "LIFT GAS · Mscf/d", c: C.lift, f: j => (Math.floor(j / 70) % 5 === 3 ? -0.45 : 0.3) + Math.sin(j * 0.06) * 0.06 },
  ];
  function sceneSignals(t, P) {
    const { ctx } = stage, A = area(), laneH = (A.y1 - A.y0) / LANES.length;
    const sweep = lerp(A.x0 - 60, A.x1 + 60, ease(clamp((P - 0.55) / 0.95)));
    const step = 4, shift = t * 36;
    LANES.forEach((L, li) => {
      const yc = A.y0 + laneH * (li + 0.55), amp = laneH * 0.32;
      ctx.strokeStyle = C.line; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(A.x0, A.y0 + laneH * (li + 1)); ctx.lineTo(A.x1, A.y0 + laneH * (li + 1)); ctx.stroke(); ctx.setLineDash([]);
      text(ctx, L.name, A.x0, A.y0 + laneH * li + 16, { size: 10, ls: 1, color: C.text3 });
      ctx.beginPath(); let pen = false;
      for (let x = A.x0; x <= A.x1; x += step) {
        const j = Math.floor((x + shift) / step), cf = clamp((sweep - x) / 40 + 0.5);
        const gap = hash(Math.floor(j / 14), li + 30) > 0.93;
        const spike = hash(j, li + 10) > 0.972 ? (hash(j, li + 20) > 0.5 ? 1.5 : -1.5) : 0;
        const noise = (hash(j, li) - 0.5) * 0.55;
        if (gap && cf < 0.5) { pen = false; continue; }
        const y = yc - (L.f(j) + (noise + spike) * (1 - cf)) * amp;
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
      }
      ctx.strokeStyle = L.c; ctx.lineWidth = 1.4; ctx.stroke();
      // markers: raw -999.25 gaps (red ticks) and spikes being removed at the sweep (orange rings)
      for (let x = A.x0; x <= A.x1; x += step) {
        const j = Math.floor((x + shift) / step), cf = clamp((sweep - x) / 40 + 0.5);
        if (cf < 0.5 && hash(Math.floor(j / 14), li + 30) > 0.93 && j % 14 === 0) {
          ctx.fillStyle = C.alarm; ctx.fillRect(x, yc + amp * 1.05, 26, 2);
          text(ctx, "−999.25", x, yc + amp * 1.05 - 4, { mono: true, size: 9, color: C.alarm, upper: false });
        }
        const d = sweep - x;
        if (hash(j, li + 10) > 0.972 && d > 0 && d < 140) {
          ctx.strokeStyle = `rgba(123,211,90,${1 - d / 140})`; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(x, yc - L.f(j) * amp, 5 + d / 14, 0, Math.PI * 2); ctx.stroke();
        }
      }
    });
    // sweep line
    if (sweep > A.x0 && sweep < A.x1) {
      const g = ctx.createLinearGradient(sweep - 80, 0, sweep, 0); g.addColorStop(0, "rgba(123,211,90,0)"); g.addColorStop(1, "rgba(123,211,90,.2)");
      ctx.fillStyle = g; ctx.fillRect(sweep - 80, A.y0, 80, A.y1 - A.y0);
      ctx.fillStyle = C.ok; ctx.fillRect(sweep, A.y0 - 6, 2, A.y1 - A.y0 + 12);
      text(ctx, PN.t("h_lg_clean"), sweep + 8, A.y0 + 4, { size: 10, ls: 1, color: C.ok, weight: 600 });
    }
    // legend
    const lx = A.x1;
    text(ctx, `■ ${PN.t("h_lg_spike")}   ■ ${PN.t("h_lg_gap")}`, lx, 28, { size: 9.5, ls: .8, color: C.text3, align: "right" });
  }

  // scene B (step 3): sensors -> VFM node -> oil / water / gas
  function sceneVFM(t, l) {
    const { ctx } = stage, A = area(), W = A.x1 - A.x0, H = A.y1 - A.y0;
    const nx = A.x0 + W * 0.40, ny = A.y0 + H * 0.5, ns = Math.max(44, Math.min(64, W * 0.08));
    const inX1 = A.x0 + W * 0.2, ins = [C.orange, C.dhp, C.lift], inLbl = ["WHP", "DHP", "LIFT"];
    ins.forEach((c, k) => {
      const yy = A.y0 + H * (0.22 + k * 0.28);
      ctx.beginPath();
      for (let x = A.x0; x <= inX1; x += 3) { const j = (x + t * 36) / 4; const y = yy - LANES[[0, 1, 3][k]].f(j) * 14; x === A.x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.strokeStyle = c; ctx.lineWidth = 1.4; ctx.stroke();
      text(ctx, inLbl[k], A.x0, yy - 22, { size: 10, ls: 1, color: C.text3 });
      const p0 = [inX1, yy], p1 = [inX1 + W * 0.1, yy], p2 = [nx - W * 0.1, ny], p3 = [nx - ns / 2, ny];
      ctx.beginPath(); ctx.moveTo(...p0); ctx.bezierCurveTo(...p1, ...p2, ...p3); ctx.strokeStyle = "rgba(239,240,241,.18)"; ctx.lineWidth = 1; ctx.stroke();
      for (let q = 0; q < 4; q++) { const [x, y] = bez(p0, p1, p2, p3, ((t * 0.45 + q / 4 + k * 0.13) % 1)); ctx.fillStyle = c; ctx.fillRect(x - 2, y - 2, 4, 4); }
    });
    // node
    const pulse = (t * 0.8) % 1;
    ctx.strokeStyle = `rgba(255,90,102,${0.7 * (1 - pulse)})`; ctx.lineWidth = 1;
    const r = ns / 2 + pulse * 26; ctx.strokeRect(nx - r, ny - r, r * 2, r * 2);
    box(ctx, nx - ns / 2, ny - ns / 2, ns, ns, C.ink2, C.red);
    text(ctx, "VFM", nx, ny + 4, { size: 13, weight: 600, ls: 1.5, color: C.text, align: "center" });
    text(ctx, PN.t("h_lg_physics"), nx, ny + ns / 2 + 18, { size: 9.5, ls: 1, color: C.text3, align: "center" });
    // outputs
    const bx0 = A.x0 + W * 0.56, outs = [[C.oil, PN.t("oil")], [C.water, PN.t("water")], [C.gas, PN.t("gas")]];
    outs.forEach(([c, name], k) => {
      const yy = A.y0 + H * (0.2 + k * 0.3);
      const p0 = [nx + ns / 2, ny], p1 = [nx + W * 0.08, ny], p2 = [bx0 - W * 0.08, yy], p3 = [bx0 - 6, yy];
      ctx.beginPath(); ctx.moveTo(...p0); ctx.bezierCurveTo(...p1, ...p2, ...p3); ctx.strokeStyle = c; ctx.globalAlpha *= .45; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha /= .45;
      for (let q = 0; q < 5; q++) { const [x, y] = bez(p0, p1, p2, p3, ((t * 0.6 + q / 5) % 1)); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill(); }
      // daily bars per phase
      const n = 16, bw = (A.x1 - bx0) / n, shown = Math.ceil(lerp(2, n, ease(clamp(l / 0.8)))), bh = H * 0.22;
      text(ctx, name, bx0, yy - bh * 0.5 - 8, { size: 10, ls: 1, color: c, weight: 600 });
      for (let d = 0; d < shown; d++) {
        const v = 0.55 + 0.25 * Math.sin(d * 0.5 + k * 2 + 0.3) + 0.12 * Math.sin(d * 1.7 + k);
        const grow = d === shown - 1 ? clamp((l * n / 0.8) % 1 + 0.3) : 1;
        const hh = v * bh * grow;
        ctx.fillStyle = c; ctx.globalAlpha *= 0.85; ctx.fillRect(bx0 + d * bw + 1, yy + bh * 0.5 - hh, bw - 3, hh); ctx.globalAlpha /= 0.85;
        if (d % 6 === 2 && k === 0) { // a well test calibrates the model
          const tx = bx0 + d * bw + bw / 2 - 1, ty = yy + bh * 0.5 - hh - 9;
          ctx.save(); ctx.translate(tx, ty); ctx.rotate(Math.PI / 4); box(ctx, -4, -4, 8, 8, C.ink, C.text); ctx.restore();
        }
      }
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(bx0, yy + bh * 0.5 + .5); ctx.lineTo(A.x1, yy + bh * 0.5 + .5); ctx.stroke();
    });
    text(ctx, `◇ ${PN.t("h_lg_test")}`, A.x1, 28, { size: 9.5, ls: .8, color: C.text3, align: "right" });
  }

  // scene C (step 4): build-up after a shut-in, then the log-log diagnostic
  function scenePTA(t, l) {
    const { ctx } = stage, A = area(), W = A.x1 - A.x0, H = A.y1 - A.y0;
    const a = clamp(1 - (l - 0.32) / 0.22), b = clamp((l - 0.32) / 0.22), base = ctx.globalAlpha;
    if (a > 0) { // history
      ctx.globalAlpha = base * a;
      const ts = 0.46, prog = clamp(l / 0.3), px = x => A.x0 + x * W, pres = x => x < ts ? 0.25 + 0.02 * Math.sin(x * 60) + (hash(Math.floor(x * 200)) - .5) * 0.015 : 0.25 + 0.6 * (1 - Math.exp(-(x - ts) / 0.05)) + 0.1 * Math.log(1 + (x - ts) * 8) / 3;
      ctx.fillStyle = "rgba(0,181,226,.08)"; ctx.fillRect(px(ts), A.y0, W * (1 - ts), H);
      text(ctx, PN.t("h_lg_shutin"), px(ts) + 10, A.y0 + 16, { size: 10, ls: 1, color: C.orange, weight: 600 });
      // rate (step down to zero)
      ctx.beginPath(); ctx.moveTo(px(0), A.y1 - H * 0.22); ctx.lineTo(px(ts), A.y1 - H * 0.22); ctx.lineTo(px(ts), A.y1 - 2); ctx.lineTo(px(1), A.y1 - 2);
      ctx.strokeStyle = C.oil; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, `${PN.t("oil")} · stb/d`, A.x0, A.y1 - H * 0.22 - 8, { size: 10, ls: 1, color: C.oil });
      // pressure, drawn as the user scrolls
      ctx.beginPath(); const xe = Math.max(ts * 0.98, prog);
      for (let x = 0; x <= xe; x += 0.003) { const y = A.y1 - H * 0.3 - pres(x) * H * 0.62; x ? ctx.lineTo(px(x), y) : ctx.moveTo(px(x), y); }
      ctx.strokeStyle = C.dhp; ctx.lineWidth = 2; ctx.stroke();
      const hy = A.y1 - H * 0.3 - pres(xe) * H * 0.62;
      ctx.fillStyle = C.dhp; ctx.beginPath(); ctx.arc(px(xe), hy, 4 + Math.sin(t * 6) * 1.2, 0, 7); ctx.fill();
      text(ctx, `${PN.t("dhp")} · psia`, A.x0, A.y1 - H * 0.3 - pres(0) * H * 0.62 - 10, { size: 10, ls: 1, color: C.dhp });
    }
    if (b > 0) { // log-log
      ctx.globalAlpha = base * b;
      const L = D.pta || synthLog, reveal = clamp((l - 0.42) / 0.4);
      const xs = L.dt.map(Math.log10), all = L.dp.concat(L.der).filter(v => v > 0).map(Math.log10);
      const xmin = Math.floor(Math.min(...xs)), xmax = Math.ceil(Math.max(...xs)), ymin = Math.floor(Math.min(...all)), ymax = Math.ceil(Math.max(...all));
      const gx = v => A.x0 + 34 + (v - xmin) / (xmax - xmin) * (W - 40), gy = v => A.y1 - 18 - (v - ymin) / (ymax - ymin) * (H - 40);
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      for (let d = xmin; d <= xmax; d++) { ctx.beginPath(); ctx.moveTo(gx(d), A.y0 + 10); ctx.lineTo(gx(d), A.y1 - 18); ctx.stroke(); text(ctx, d < 0 ? `${Math.pow(10, d)}` : `${Math.pow(10, d)}`, gx(d), A.y1 - 2, { mono: true, size: 9.5, color: C.text3, align: "center", upper: false }); }
      for (let d = ymin; d <= ymax; d++) { ctx.beginPath(); ctx.moveTo(A.x0 + 34, gy(d)); ctx.lineTo(A.x1, gy(d)); ctx.stroke(); text(ctx, `${Math.pow(10, d)}`, A.x0 + 28, gy(d) + 3, { mono: true, size: 9.5, color: C.text3, align: "right", upper: false }); }
      text(ctx, "Δt, h", A.x1, A.y1 - 24, { mono: true, size: 10, color: C.text2, align: "right", upper: false });
      // radial-flow window
      const wa = clamp((l - 0.78) / 0.15);
      if (wa > 0 && L.w0 && L.w1) {
        const x0 = gx(Math.log10(L.w0)), x1 = gx(Math.log10(L.w1));
        ctx.fillStyle = C.radial + (0.14 * wa) + ")"; ctx.fillRect(x0, A.y0 + 10, x1 - x0, H - 28);
        ctx.strokeStyle = C.radial + (0.7 * wa) + ")"; ctx.strokeRect(x0 + .5, A.y0 + 10.5, x1 - x0, H - 28);
        text(ctx, PN.t("h_lg_radial"), (x0 + x1) / 2, A.y0 + 26, { size: 9.5, ls: 1, color: C.ok, align: "center", weight: 600 });
      }
      const n = L.dt.length, upto = Math.floor(n * reveal), stepN = Math.max(1, Math.floor(n / 140));
      for (let i = 0; i < upto; i += stepN) {
        const x = gx(xs[i]);
        if (L.dp[i] > 0) { ctx.fillStyle = C.water; ctx.fillRect(x - 2, gy(Math.log10(L.dp[i])) - 2, 4, 4); }
        if (L.der[i] > 0) { ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(x, gy(Math.log10(L.der[i])), 2.3, 0, 7); ctx.fill(); }
      }
      text(ctx, `■ ΔP   ● ${PN.t("deriv")}`, A.x0 + 40, A.y0 + 26, { size: 10, ls: .6, color: C.text2, upper: false });
      if (wa > 0) {
        ctx.globalAlpha = base * b * wa;
        const res = L.k != null ? `k ${PN.fmt(L.k, 0)} mD   ·   skin ${PN.signed(L.s, 1)}` : "k · skin";
        const tw = Math.min(260, W * 0.5);
        box(ctx, A.x1 - tw, A.y1 - 70, tw, 36, C.ink2, C.ok);
        text(ctx, res, A.x1 - tw / 2, A.y1 - 47, { mono: true, size: 12, color: C.text, align: "center", upper: false, weight: 600 });
        if (L.well) text(ctx, L.well, A.x1 - tw + 8, A.y1 - 76, { size: 9.5, ls: 1, color: C.text3 });
      }
    }
    ctx.globalAlpha = base;
  }

  // scene D (step 5): the field on one screen, with alerts
  function sceneField(t, l) {
    const { ctx } = stage, A = area(), W = A.x1 - A.x0, H = A.y1 - A.y0, base = ctx.globalAlpha;
    // box size follows the card: two manifold rows must fit, so the boxes shrink with a small card
    const cols = 5, gap = W < 360 ? 6 : 10, tw = (W - gap * (cols - 1)) / cols, ROW = 32, th = clamp((H - 8 - ROW - 14 - 16) / 2, 26, 76);   // 16 = room for the label under the last pipe
    const fs = clamp(tw / 7.5, 8.5, 11);                       // well-name size
    const fo = clamp(Math.min(tw / 4.6, th - fs - 12), 9, 20);  // oil-number size (always below the name, never on top of it)
    const rows = [D.wells.filter(w => w.manifold === "A"), D.wells.filter(w => w.manifold !== "A")];
    rows.forEach((row, ri) => {
      const y = A.y0 + 8 + ri * (th + ROW);
      // manifold pipe with flow
      const py = y + th + 14;
      ctx.strokeStyle = C.line; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x0, py); ctx.lineTo(A.x1, py); ctx.stroke();
      ctx.strokeStyle = C.ok; ctx.lineWidth = 3; ctx.setLineDash([10, 14]); ctx.lineDashOffset = -t * 30;
      ctx.globalAlpha = base * clamp(l / 0.4); ctx.beginPath(); ctx.moveTo(A.x0, py); ctx.lineTo(A.x1, py); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = base;
      text(ctx, `${PN.t("manifold")} ${ri ? "B" : "A"}`, A.x1, py + 13, { size: 8.5, ls: 1, color: C.text3, align: "right" });   // under the pipe, clear of the boxes
      row.slice(0, cols).forEach((w, ci) => {
        const k = clamp((l * 1.6) - (ri * cols + ci) * 0.07); if (k <= 0) return;
        const x = A.x0 + ci * (tw + gap), yy = y + (1 - ease(k)) * 16;
        ctx.globalAlpha = base * ease(k);
        const sc = w.status === "alarm" ? C.alarm : w.status === "warning" ? C.warn : C.ok;
        box(ctx, x, yy, tw, th, C.ink2, w.status === "ok" ? C.line : sc);
        if (w.status !== "ok") {
          const pr = (t * 0.9 + ci * 0.2) % 1;
          ctx.strokeStyle = (w.status === "alarm" ? "rgba(255,77,77," : "rgba(245,165,36,") + (0.7 * (1 - pr)) + ")";
          ctx.strokeRect(x - pr * 8, yy - pr * 8, tw + pr * 16, th + pr * 16);
        }
        // line 1: status dot + well name · line 2: oil rate (+ "stb/d" only when the box is wide enough)
        const nameY = yy + 5 + fs, oilY = yy + th - 6;
        ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(x + 9, nameY - fs * 0.36, Math.max(2.5, fs * 0.3), 0, 7); ctx.fill();
        text(ctx, w.well, x + 16, nameY, { size: fs, weight: 600, color: C.text, ls: .3 });
        text(ctx, w.oil ? PN.fmt(w.oil) : "—", x + 7, oilY, { size: fo, weight: 500, color: C.oil, upper: false });
        if (tw >= 120) text(ctx, "stb/d", x + tw - 7, oilY, { size: 9, color: C.text3, align: "right", ls: .5 });
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + tw / 2, yy + th); ctx.lineTo(x + tw / 2, py); ctx.stroke();
      });
      ctx.globalAlpha = base;
    });
    // alerts feed
    const ay = A.y0 + 8 + 2 * (th + ROW) + 12, ka = clamp((l - 0.35) / 0.4);
    if (ka > 0 && ay < A.y1 - 20) {
      ctx.globalAlpha = base * ka;
      text(ctx, `■ ${PN.t("alerts")}`, A.x0, ay, { size: 10, ls: 1.2, color: C.red, weight: 600 });
      const lines = alertLines().slice(0, Math.max(1, Math.floor((A.y1 - ay - 10) / 24)));
      lines.forEach((a, i) => {
        const kk = clamp(ka * 3 - i * 0.6); if (kk <= 0) return;
        const yy = ay + 24 + i * 24, col = a.level === "alarm" ? C.alarm : a.level === "warning" ? C.warn : C.text3;
        ctx.fillStyle = col; ctx.fillRect(A.x0, yy - 10, 3, 14);
        const s = a.text.slice(0, Math.ceil(a.text.length * kk));
        text(ctx, s.length > 90 ? s.slice(0, 88) + "…" : s, A.x0 + 12, yy + 1, { size: 12, color: C.text, upper: false, weight: 400 });
      });
    }
    ctx.globalAlpha = base;
  }
  function alertLines() {
    if (!D.alerts.length) return [{ level: "info", text: PN.t("h_loading") }];
    return D.alerts.map(a => {
      const p = Object.assign({}, a, { skin: a.skin != null ? PN.signed(a.skin, 1) : "", pct: a.min_change_pct != null ? PN.fmt(a.min_change_pct, 0) : "" });
      return { level: a.level, text: (a.well ? a.well + " · " : "") + PN.t(a.key, p) };
    });
  }

  const SCENES = [[sceneSignals, -9, 2], [sceneVFM, 2, 3], [scenePTA, 3, 4], [sceneField, 4, 9]];
  function drawStage(t, P) {
    const { ctx, w, h } = stage;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(239,240,241,.06)";
    for (let x = 9; x < w; x += 18) for (let y = 9; y < h; y += 18) ctx.fillRect(x, y, 1, 1);
    SCENES.forEach(([fn, s0, s1], i) => {
      const wgt = clamp(Math.min(P - (s0 - 0.15), (s1 + 0.15) - P) / 0.3);
      if (wgt <= 0) return;
      ctx.save(); ctx.globalAlpha = ease(wgt); ctx.translate(0, (1 - ease(wgt)) * 18);
      i === 0 ? fn(t, P) : fn(t, clamp(P - s0));
      ctx.restore();
    });
  }

  // ------------------------------------------------------------------ scroll state
  const steps = [...document.querySelectorAll(".step")], ticks = [...document.querySelectorAll("#stage-ticks i")];
  const hero = $("hero"), pin = document.querySelector(".h-pin"), story = $("hero-story");
  const STORY0 = 0.12, STORY1 = 0.93;   // share of the hero runway the five steps use (matches hero-scrub.js fades)
  let P = 0, Ps = 0, active = -1, sy = 0;
  function onScroll() {
    sy = window.scrollY;
    const doc = document.documentElement, max = doc.scrollHeight - innerHeight;
    $("scroll-bar").style.transform = `scaleX(${max > 0 ? sy / max : 0})`;
    // the five steps play inside the pinned hero: step progress comes from how far the hero has scrolled
    const hr = hero.getBoundingClientRect(), run = hr.height - pin.getBoundingClientRect().height;
    const hp = run > 0 ? clamp(-hr.top / run) : 0;
    P = 5 * clamp((hp - STORY0) / (STORY1 - STORY0)) * 0.999;
    const show = clamp((hp - STORY0 + 0.04) / 0.04) * (1 - clamp((hp - 0.95) / 0.025));
    story.style.opacity = show.toFixed(3);
    story.style.transform = `translateY(${((1 - show) * 24).toFixed(1)}px)`;
    vis.on = show > 0.01;
    if (RM) Ps = P;
    const a = Math.min(4, Math.floor(P));
    if (a !== active) {
      active = a;
      steps.forEach((el, i) => el.classList.toggle("on", i === a));
      $("stage-cap").textContent = `0${a + 1} / ${PN.t(`h_s${a + 1}_tag`)}`;
      document.querySelector(".stage-cap .sq").style.background = STEP_COL[a];
    }
    ticks.forEach((el, i) => el.style.setProperty("--f", clamp(P - i).toFixed(3)));
  }
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);

  // render only what is on screen
  const vis = { stage: false, on: false };
  new IntersectionObserver(es => es.forEach(e => { vis.stage = e.isIntersecting; })).observe($("story-canvas"));

  let t = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!RM) t += dt;
    Ps += (P - Ps) * (RM ? 1 : Math.min(1, dt * 7));
    if (vis.stage && vis.on) drawStage(t, Ps);
    requestAnimationFrame(frame);
  }

  // reveal-on-scroll + count-up
  let numbersShown = false, numbersReady = false;
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in"); io.unobserve(e.target);
    if (e.target.classList.contains("num")) { numbersShown = true; countNumbers(); }
  }), { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(el => io.observe(el));

  const NUM = {};
  function countNumbers() {
    if (!numbersShown || !numbersReady || NUM.done) return;
    NUM.done = true;
    PN.countUp($("n-oil"), NUM.oil, 0, 1400); PN.countUp($("n-cum"), NUM.cum, 0, 1400);
    PN.countUp($("n-flag"), NUM.flag, 0, 900); PN.countUp($("n-perm"), NUM.perm, 0, 1400);
  }

  // ---- model results: validation table (one exam) + physics checks, styled for the dark page
  let M = null;
  const mkey = m => m.includes("well average") ? "avg" : m.includes("line between") ? "line" : m.includes("trend only") ? "trend" : m.startsWith("v1") ? "v1" : "v2";
  function renderModel() {
    if (!M) return;
    const rows = M.validation.slice(), mean = r => (r.oil_rate_stbd + r.water_rate_stbd + r.gas_rate_mscfd) / 3;
    rows.sort((a, b) => mean(a) - mean(b));
    const fin = rows.find(r => r.model.includes("FINAL"));
    if (fin) { $("acc-oil").textContent = PN.fmt(fin.oil_rate_stbd, 2); $("acc-water").textContent = PN.fmt(fin.water_rate_stbd, 2); $("acc-gas").textContent = PN.fmt(fin.gas_rate_mscfd, 2); }
    const pc = v => `${PN.fmt(v, 2)} %`;
    $("val-table").innerHTML = `<tr><th>${PN.t("model")}</th><th class="n">${PN.t("oil")}</th><th class="n">${PN.t("water")}</th><th class="n">${PN.t("gas")}</th></tr>`
      + rows.map(r => { const k = mkey(r.model), f = r.model.includes("FINAL");
        return `<tr class="${f ? "hl" : ""}" title="${PN.t("vd_" + k)}"><td>${PN.t("vm_" + k)}${f ? " ★" : ""}</td>`
          + `<td class="n">${pc(r.oil_rate_stbd)}</td><td class="n">${pc(r.water_rate_stbd)}</td><td class="n">${pc(r.gas_rate_mscfd)}</td></tr>`; }).join("");
    $("val-how").innerHTML = `<details><summary>${PN.t("val_how_t")}</summary><ul>`
      + [1, 2, 3, 4, 5, 6].map(i => `<li>${PN.t("val_how" + i)}</li>`).join("") + `</ul></details>`;

    const g = M.diag, wells = Object.keys(g.liftcut_v2).sort(), txt = "rgba(251,239,227,.72)", grid = "rgba(255,190,140,.10)";
    PN.plot($("liftcut-chart"), [
      { x: wells, y: wells.map(w => g.liftcut_v1[w]), name: PN.t("v1"), type: "bar", marker: { color: "rgba(235,215,180,.45)" } },
      { x: wells, y: wells.map(w => g.liftcut_v2[w]), name: PN.t("v2"), type: "bar", marker: { color: "#FFA43A" } },
    ], { barmode: "group", font: { color: txt }, legend: { font: { color: txt } }, hovermode: "x", margin: { t: 34, b: 34, l: 46, r: 10 },
         xaxis: { gridcolor: grid, linecolor: grid, tickcolor: grid, fixedrange: true },
         yaxis: { title: { text: "%" }, gridcolor: grid, linecolor: grid, tickcolor: grid, zeroline: true, zerolinecolor: "rgba(255,236,220,.35)", fixedrange: true } },
       { displayModeBar: false });
    $("normal-kv").innerHTML = `<div>${PN.t("liftcut_note")}</div><div class="v"></div>
      <div>${PN.t("normal_vs_test")} · ${PN.t("v1")}</div><div class="v">${PN.signed(g.normal_v1, 2)} %</div>
      <div>${PN.t("normal_vs_test")} · ${PN.t("v2")}</div><div class="v good">${PN.signed(g.normal_v2, 2)} %</div>
      <div class="note">${PN.t("normal_note")}</div><div class="v"></div>`;
  }

  async function load() {
    PN.api("/api/model").then(m => { M = m; renderModel(); }).catch(() => { /* section stays with dashes */ });
    const ds = PN.state.datasets.find(d => d.id === PN.state.ds);
    if (ds) {
      $("f-wells").textContent = ds.wells.length;
      const days = Math.round((new Date(ds.end) - new Date(ds.start)) / 864e5) + 1;
      if (isFinite(days)) $("f-days").textContent = days;
    }
    try {
      const ov = await PN.api("/api/overview");
      D.wells = ov.wells.slice().sort((a, b) => (a.manifold + a.well).localeCompare(b.manifold + b.well));
      D.alerts = ov.alerts.filter(a => a.level !== "info").concat(ov.alerts.filter(a => a.level === "info"));
      NUM.oil = PN.cv("oil", ov.totals.oil_rate_stbd); NUM.cum = PN.cv("oil", ov.period_cum_oil) / 1000;
      $("n-cum-u").textContent = `10³ ${PN.vl("oil")}`;
      NUM.flag = ov.wells.filter(w => w.status !== "ok").length;
      $("n-date").textContent = PN.date(ov.date);   // the day these numbers describe
    } catch (e) { /* the story still runs on synthetic data */ }
    try {
      const ev = await PN.api("/api/pta/events");
      $("f-shut").textContent = ev.length;
      const ks = ev.map(e => e.permeability_md).filter(v => v != null).sort((a, b) => a - b);
      NUM.perm = ks.length ? ks[Math.floor(ks.length / 2)] : null;
      numbersReady = true; countNumbers();
      // the longest good-quality build-up is the clearest example for the story
      const pick = ev.filter(e => e.permeability_md != null)
        .sort((a, b) => String(a.quality).localeCompare(String(b.quality)) || b.duration_hr - a.duration_hr)[0];
      if (pick) {
        const d = await PN.api(`/api/pta/${pick.idx}`), L = d.loglog, keep = L.dt.map((v, i) => i).filter(i => L.dt[i] > 0);
        D.pta = { dt: keep.map(i => L.dt[i]), dp: keep.map(i => L.dp[i]), der: keep.map(i => (L.der[i] == null ? 0 : L.der[i])),
                  w0: d.results.radial_window_start_hr, w1: d.results.radial_window_end_hr,
                  k: d.results.permeability_md, s: d.results.skin, well: `${d.well_name} · ${PN.date(d.shut_in_start)}` };
      }
    } catch (e) { numbersReady = true; countNumbers(); }
  }

  PN.start({
    load,
    render() { active = -1; onScroll(); renderModel(); },
  });
  onScroll();
  requestAnimationFrame(frame);
})();
