/* Home hero, a two-stage scroll journey (the picture stays pinned while the 620vh runway scrolls):
     0%-45%   the pumpjack walking beam pitches down (video frames)
     45%-95%  the camera dives down the wellbore through the rock layers to the reservoir
     95%-100% the reservoir fades to dark and the page continues below
   Scrolling up plays everything backwards. Frames + manifest.json come from build_scroll_frames.py. */
(function () {
  const $ = id => document.getElementById(id);
  const hero = $("hero"), cv = $("hero-canvas");
  if (!hero || !cv) return;
  const ctx = cv.getContext("2d");
  const base = hero.dataset.frames;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const ramp = (p, a, b) => clamp((p - a) / (b - a));             // 0 before a, 1 after b
  const STAGE1 = 0.45, STAGE2 = 0.95;                               // scroll split points
  const FX = 0.38, FY = 0.5;   // cover-fit focus: on narrow screens keep the pumpjack and the wellbore in view

  // defaults until manifest.json arrives (it only adds the depth / layer data)
  let M = { count: 95, video: 40, centers: null, wellhead: 0.21, td_m: 2950, well_x: 0.405, layers: [] };
  let N = M.count;
  const imgs = [], ready = [];
  let target = 0, shown = 0, drawn = -1, raf = 0, W = 0, H = 0, P = 0;
  const src = i => `${base}frame_${String(i + 1).padStart(4, "0")}.webp`;

  function load(i) {
    if (imgs[i]) return;
    const im = new Image();
    im.decoding = "async";
    im.onload = () => { ready[i] = true; if (drawn < 0 || i === Math.round(shown)) request(); };
    im.src = src(i);
    imgs[i] = im;
  }
  const loadAll = () => { for (let i = 1; i < N; i++) load(i); };

  // ------------------------------------------------------------------ drawing
  function fit() {
    const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    cv.width = Math.max(1, Math.round(W * d)); cv.height = Math.max(1, Math.round(H * d));
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.imageSmoothingQuality = "high";
    drawn = -1; request();
  }
  function nearestReady(i) {          // never show a blank canvas while frames are still arriving
    for (let k = 0; k < N; k++) {
      if (i - k >= 0 && ready[i - k]) return i - k;
      if (i + k < N && ready[i + k]) return i + k;
    }
    return -1;
  }
  function cover(iw, ih) {            // fill the box, never stretch
    const s = Math.max(W / iw, H / ih), dw = iw * s, dh = ih * s;
    return { x: (W - dw) * FX, y: (H - dh) * FY, w: dw, h: dh };
  }
  function draw(i) {
    const j = nearestReady(i);
    if (j < 0 || j === drawn) return;
    const im = imgs[j], c = cover(im.naturalWidth, im.naturalHeight);
    ctx.drawImage(im, c.x, c.y, c.w, c.h);
    drawn = j;
  }

  // ------------------------------------------------------------------ scroll -> frame + HUD
  function progress() {
    const r = hero.getBoundingClientRect(), run = r.height - cv.getBoundingClientRect().height;
    return run > 0 ? clamp(-r.top / run) : 0;
  }
  function frameAt(p) {
    const V = M.video;
    if (p <= STAGE1) return (p / STAGE1) * (V - 1);
    return (V - 1) + ramp(p, STAGE1, STAGE2) * (N - V);
  }

  const surface = $("hero-surface"), shade = $("hero-shade"), gauge = $("hero-gauge"), fade = $("hero-fade");
  const gfill = $("hero-gfill"), gdot = $("hero-gdot"), depthEl = $("hero-depth"), prog = $("hero-prog");
  const layerBox = $("hero-layers"), layerEls = [...document.querySelectorAll(".h-layer")];
  let activeLayer = null;

  function hud(p, f) {
    // surface titles, KPIs and buttons: visible at the top, gone before step 1 of "how it works" (12%)
    const s = 1 - ramp(p, 0.06, 0.115);
    surface.style.opacity = s.toFixed(3);
    surface.style.transform = `translateY(${(-40 * (1 - s)).toFixed(1)}px)`;
    surface.style.pointerEvents = s < 0.5 ? "none" : "";
    shade.style.opacity = (0.35 + 0.65 * s).toFixed(3);

    // underground: depth from where the camera is looking (centre of the view)
    const under = ramp(p, STAGE1, STAGE1 + 0.05) * (1 - ramp(p, STAGE2, STAGE2 + 0.03));
    gauge.style.opacity = under.toFixed(3);
    layerBox.style.opacity = under.toFixed(3);
    let frac = 0, cy = 0;
    if (M.centers) {
      const C = M.centers, k = clamp(f - (M.video - 1) - 1, 0, C.length - 1), k0 = Math.floor(k), t = k - k0;
      cy = C[k0] + ((C[Math.min(k0 + 1, C.length - 1)] - C[k0]) * t);
      frac = clamp((cy - M.wellhead) / (C[C.length - 1] - M.wellhead));
    } else {
      frac = ramp(p, STAGE1, STAGE2);
    }
    const depth = Math.round(frac * M.td_m / 10) * 10;
    depthEl.textContent = depth.toLocaleString("en-US");
    gfill.style.transform = `scaleY(${frac.toFixed(4)})`;
    gdot.style.top = `${(frac * 100).toFixed(2)}%`;

    const L = M.layers.find(l => cy >= l.top && cy < l.bottom);
    const key = under > 0.05 && L ? L.key : null;
    if (key !== activeLayer) {
      activeLayer = key;
      layerEls.forEach(el => el.classList.toggle("on", el.dataset.layer === key));
    }
    // keep the label just left of the wellbore wherever cover-fit puts it (the steps panel is on the right)
    if (W) {
      const c = cover(16, 9);
      layerBox.style.setProperty("--well-x", `${(c.x + M.well_x * c.w).toFixed(1)}px`);
    }

    fade.style.opacity = ramp(p, STAGE2, 1).toFixed(3);
    if (prog) prog.style.transform = `scaleX(${p.toFixed(4)})`;
  }

  function tick() {
    raf = 0;
    shown += (target - shown) * 0.35;                  // light easing: smooth, but glued to the scroll
    if (Math.abs(target - shown) < 0.02) shown = target;
    draw(Math.round(shown));
    hud(P, shown);
    if (shown !== target) request();
  }
  function request() { if (!raf) raf = requestAnimationFrame(tick); }
  function onScroll() { P = progress(); target = frameAt(P); request(); }

  // frame 1 first (it is also the CSS background, so nothing is ever blank); the rest in the background
  load(0);
  fetch(`${base}manifest.json`).then(r => r.ok ? r.json() : null).then(m => {
    if (m) { M = Object.assign(M, m); N = M.count; }
  }).catch(() => {}).finally(() => {
    const go = () => loadAll();
    if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 600 }); else setTimeout(go, 120);
    onScroll();
  });

  new ResizeObserver(fit).observe(cv);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  onScroll();

  // the hero button glides down to the VFM & PTA section
  const btn = $("hero-go");
  if (btn) btn.addEventListener("click", e => {
    const el = document.querySelector(btn.getAttribute("href"));
    if (!el) return;
    e.preventDefault();
    const head = 0;   // the top bar is hidden while scrolling, so nothing to leave room for
    scrollTo({ top: el.getBoundingClientRect().top + scrollY - head, behavior: "smooth" });
  });
})();
