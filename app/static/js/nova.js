/* Nova: chat assistant bubble, shown on every page. Talks to /api/nova/chat. */
(function () {
  if (!window.PN) return;
  const KEY = "pn_nova_chat";
  const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) { return []; } };
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(chat.slice(-40))); } catch (e) { /* private mode */ } };
  let chat = load(), busy = false, ready = null;   // ready: null = unknown, true/false after /api/nova/status

  const STARTERS = { well: "nova_qp_well", pta: "nova_qp_pta", whatif: "nova_qp_whatif", vfm: "nova_qp_vfm", sensors: "nova_qp_sensors" };
  const page = document.body.dataset.page || "home";

  // ---------- markup
  const fab = document.createElement("button");
  fab.className = "nova-fab"; fab.type = "button"; fab.setAttribute("aria-haspopup", "dialog"); fab.setAttribute("aria-label", "Nova");
  // avatar (picture without eyes) + two live eyes drawn on top
  fab.innerHTML = `<span class="nova-ava"><img src="/static/nova_avatar.png?v=2" alt="" draggable="false">
      <span class="nova-eyes" aria-hidden="true"><span class="nova-gaze"><i class="nova-eye"></i><i class="nova-eye"></i></span></span></span>`;
  fab.querySelector("img").onerror = e => { e.target.remove(); };   // no picture yet: eyes on the navy disc
  const panel = document.createElement("section");
  panel.className = "nova-panel hidden"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-labelledby", "nova-title");
  panel.innerHTML = `
    <header class="nova-head">
      <div><div class="nova-title" id="nova-title" data-i18n="nova_title"></div><div class="nova-sub" data-i18n="nova_sub"></div></div>
      <div class="nova-head-btns">
        <button type="button" class="nova-new" data-i18n="nova_new"></button>
        <button type="button" class="nova-x" aria-label="Close">×</button>
      </div>
    </header>
    <div class="nova-log" aria-live="polite"></div>
    <form class="nova-form">
      <textarea rows="1" maxlength="4000"></textarea>
      <button type="submit" class="nova-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg></button>
    </form>`;
  document.body.append(fab, panel);
  const log = panel.querySelector(".nova-log"), form = panel.querySelector(".nova-form"),
        input = form.querySelector("textarea"), send = form.querySelector(".nova-send");
  PN.applyI18n(fab); PN.applyI18n(panel);

  // ---------- tiny markdown: escape first, then **bold**, `code`, bullet / numbered lists, paragraphs
  function md(text) {
    const inline = s => PN.esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
    const out = []; let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    String(text).split(/\n/).forEach(line => {
      const ul = line.match(/^\s*[-*•]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (ul || ol) {
        const tag = ul ? "ul" : "ol";
        if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; }
        out.push(`<li>${inline((ul || ol)[1])}</li>`);
      } else if (!line.trim()) { close(); }
      else { close(); out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`); }
    });
    close();
    return out.join("");
  }

  function bubble(m) {
    const el = document.createElement("div");
    el.className = "nova-msg " + (m.role === "user" ? "me" : m.error ? "bot err" : "bot");
    el.innerHTML = m.role === "user" ? `<p>${PN.esc(m.content)}</p>` : md(m.content);
    if (m.tools && m.tools.length)
      el.insertAdjacentHTML("beforeend", `<div class="nova-used">${PN.esc(PN.t("nova_used"))} <span class="mono">${m.tools.map(PN.esc).join(", ")}</span></div>`);
    return el;
  }

  function render() {
    PN.applyI18n(panel);
    input.placeholder = PN.t("nova_ph");
    log.innerHTML = "";
    log.append(bubble({ role: "assistant", content: PN.t("nova_hello") }));   // greeting always comes first
    if (ready === false) {
      log.append(bubble({ role: "assistant", content: PN.t("nova_off"), error: true }));
    } else {
      chat.forEach(m => log.append(bubble(m)));
      if (!chat.length) {
        const qs = [STARTERS[page], "nova_q1", "nova_q2", "nova_q3"].filter(Boolean);
        const box = document.createElement("div");
        box.className = "nova-starters";
        qs.forEach(k => {
          const b = document.createElement("button");
          b.type = "button"; b.textContent = PN.t(k);
          b.onclick = () => ask(PN.t(k));
          box.append(b);
        });
        log.append(box);
      }
    }
    if (busy) log.insertAdjacentHTML("beforeend", `<div class="nova-msg bot typing"><span></span><span></span><span></span> ${PN.esc(PN.t("nova_thinking"))}</div>`);
    input.disabled = send.disabled = busy || ready === false;
    log.scrollTop = log.scrollHeight;
  }

  // the well picked on this page (only where the page shows a well selector)
  function pageWell() {
    const sel = document.getElementById("well-select");
    return sel && sel.offsetParent !== null ? PN.state.well : "";
  }

  async function ask(q) {
    q = (q || "").trim();
    if (!q || busy || ready === false) return;
    chat.push({ role: "user", content: q }); save();
    busy = true; render();
    try {
      const r = await fetch("/api/nova/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chat.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })),
                               page, ds: PN.state.ds, well: pageWell(), lang: PN.state.lang }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.code === "refused") {
        if (j.code === "not_configured") ready = false;
        const key = "nova_e_" + (j.code || "api");
        const msg = PN.t(key) !== key ? PN.t(key) : `${PN.t("nova_e_api")} ${j.error || r.status}`;
        chat.push({ role: "assistant", content: msg, error: true });
      } else {
        chat.push({ role: "assistant", content: j.answer, tools: j.tools || [] });
      }
    } catch (e) {
      chat.push({ role: "assistant", content: PN.t("nova_e_offline"), error: true });
    }
    busy = false; save(); render();
    input.focus();
  }

  // ---------- open / close
  async function open() {
    panel.classList.remove("hidden"); fab.classList.add("open"); fab.setAttribute("aria-expanded", "true");
    if (ready === null) {
      try { ready = !!(await (await fetch("/api/nova/status")).json()).available; } catch (e) { ready = true; }
    }
    render();
    if (ready !== false) input.focus();
  }
  function close() { panel.classList.add("hidden"); fab.classList.remove("open"); fab.setAttribute("aria-expanded", "false"); fab.focus(); }
  fab.onclick = () => (panel.classList.contains("hidden") ? open() : close());
  panel.querySelector(".nova-x").onclick = close;
  panel.querySelector(".nova-new").onclick = () => { chat = []; save(); render(); input.focus(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !panel.classList.contains("hidden")) close(); });

  form.onsubmit = e => { e.preventDefault(); const q = input.value; input.value = ""; grow(); ask(q); };
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  const grow = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; };
  input.addEventListener("input", grow);

  // ---------- eyes: follow the mouse (spring easing) and blink now and then
  (function eyes() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ava = fab.querySelector(".nova-ava"), gaze = fab.querySelector(".nova-gaze"),
          pair = fab.querySelectorAll(".nova-eye");
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const step = () => {
      x += (tx - x) * 0.15; y += (ty - y) * 0.15;
      if (Math.abs(tx - x) < 0.01 && Math.abs(ty - y) < 0.01) { x = tx; y = ty; raf = 0; }
      gaze.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      if (raf) raf = requestAnimationFrame(step);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
    const aim = (nx, ny) => { tx = nx; ty = ny; kick(); };
    window.addEventListener("mousemove", e => {
      const r = ava.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const max = r.width * 0.07;                                  // stays inside the dark core
      const reach = Math.min(1, Math.hypot(dx, dy) / (r.width * 2));  // nearby cursor = smaller look
      const ang = Math.atan2(dy, dx);
      aim(Math.cos(ang) * max * reach, Math.sin(ang) * max * reach);
    }, { passive: true });
    const home = () => aim(0, 0);
    document.addEventListener("mouseleave", home);
    window.addEventListener("mouseout", e => { if (!e.relatedTarget) home(); }, { passive: true });
    window.addEventListener("blur", home);

    const blink = () => {
      pair.forEach(el => el.classList.add("blink"));
      setTimeout(() => pair.forEach(el => el.classList.remove("blink")), 120);
      setTimeout(blink, 3000 + Math.random() * 2000);
    };
    setTimeout(blink, 3000 + Math.random() * 2000);
  })();

  // re-translate when the language buttons are used
  document.getElementById("lang")?.addEventListener("click", () => setTimeout(() => {
    PN.applyI18n(fab); if (!panel.classList.contains("hidden")) render();
  }));
})();
