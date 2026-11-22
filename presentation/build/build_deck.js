// PetroNova pitch deck (daylight edition): static build with pptxgenjs.
// Animations + Morph are added afterwards by add_motion.py, which reads anim_spec.json written here.
//
//   python presentation/build/gen_assets.py && python presentation/build/gen_scenery.py
//   node presentation/build/build_deck.js        (NODE_PATH must contain pptxgenjs)
//   python presentation/build/add_motion.py
//
// Every number on the slides was checked against the project data (see ../PITCH_PLAN.md).
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..");
const A = (f) => path.join(ROOT, "deck_assets", f);
const OUT = process.env.DECK_OUT || path.join(HERE, "PetroNova_Pitch_static.pptx");
const SKIP = (process.env.SKIP || "").split(",").filter(Boolean).map(Number);

const W = 13.333, H = 7.5;
const STRIP_TOP = 5.0, PIPE_CY = 6.15, PIPE_D = 0.30, GROUND = 6.6;

const THEME = {
  name: "PetroNova Daylight",
  headFontFace: "Segoe UI Semibold",
  bodyFontFace: "Segoe UI",
  colors: {
    dk1: "1E293B", lt1: "FFFFFF", dk2: "475569", lt2: "F1F5F9",
    accent1: "D9822B", accent2: "E5484D", accent3: "1F9D6B",
    accent4: "2F6FB0", accent5: "64748B", accent6: "CBD5E1",
    hlink: "2F6FB0", folHlink: "64748B",
  },
};
const HEX = { slate: "1E293B", body: "334155", muted: "64748B", line: "E2E8F0", grid: "E2E8F0",
              amber: "D9822B", amberHi: "F2A33A", red: "E5484D", green: "1F9D6B", steel: "94A3B8",
              white: "FFFFFF", ink: "0E141B", mist: "E6ECF2" };

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.title = "PetroNova: What Does a Three-Day Shutdown Cost?";
pres.subject = "SOCAR Hackathon 2026 pitch";
pres.author = "PetroNova team";
pres.company = "PetroNova";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;

// ---------------------------------------------------------------- layouts (title placeholder only)
const layout = (title, color, size, y, w, h) => pres.defineSlideMaster({
  title, background: { color: "F1F5F9" },
  objects: [{ placeholder: { options: { name: "title", type: "title", x: 0.7, y, w, h, fontFace: THEME.headFontFace,
    fontSize: size, color, align: "left", valign: "top", margin: 0 }, text: "Slide title" } }],
});
layout("PN Day", C.text1, 32, 0.45, 12.0, 0.65);
layout("PN Day Open", C.text1, 40, 1.0, 8.0, 1.5);
layout("PN Photo", C.background1, 32, 0.45, 12.0, 0.65);
layout("PN Photo Open", C.background1, 40, 0.95, 6.6, 1.55);

// ---------------------------------------------------------------- helpers
const spec = { slides: [] };
let cur = null;
const SCENES = { 1: "scene1_oilfield.jpg", 2: "scene2_day.jpg", 3: "scene3_day.jpg", 4: "scene4_day.jpg",
                 5: "scene5_day.jpg", 6: "scene6_terminal.jpg", 7: "scene7_day.jpg" };
const CAMERA = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 7 };   // slide -> scene/pipeline position
let section = "";

function newSlide(n, master, sec, title) {
  if (sec) { pres.addSection({ title: sec }); section = sec; }
  const s = pres.addSlide({ masterName: master, sectionTitle: section });
  const k = CAMERA[n];
  const near = n === 8 ? [7] : [k - 1, k, k + 1];
  for (const j of near) {
    if (!SCENES[j]) continue;
    s.addImage({ path: A(SCENES[j]), x: (j - k) * W, y: 0, w: W, h: H, objectName: `!!scene${j}`,
                 altText: `Background scene ${j}` });
  }
  // custody-transfer metering hub lives at slide-6 x = 7.45 (pans in from slide 5, out on slide 7)
  if (k >= 5 && k <= 7) s.addImage({ path: A("metering_station.png"), x: 7.45 + (6 - k) * W, y: GROUND - 4.2, w: 5.9, h: 4.2,
    objectName: "!!metering", altText: "Custody-transfer metering skid, storage tanks and distillation towers" });
  s.addImage({ path: A("pipeline_strip.png"), x: -(k - 1) * W, y: STRIP_TOP, w: Math.round(8 * W * 914400), h: H - STRIP_TOP,  // >100 in = EMU in pptxgenjs
               objectName: "!!pipeline", altText: "Crude oil pipeline running through every slide" });
  s.addText(title, { placeholder: "title" });
  cur = { n, anims: [], transition: n === 1 ? "fade" : "morph" };
  spec.slides.push(cur);
  return s;
}
function anim(name, effect, o = {}) { cur.anims.push(Object.assign({ name, effect, trig: "after", delay: 0, dur: 500 }, o)); }

function txt(s, text, o) {
  s.addText(text, Object.assign({ isTextBox: true, margin: 0, fontFace: THEME.bodyFontFace, color: C.text1,
                                  fontSize: 16, valign: "top" }, o));
}
const shadow = () => ({ type: "outer", color: "0F172A", opacity: 0.16, blur: 8, offset: 2, angle: 90 });
function card(s, name, x, y, w, h, o = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: HEX.white, transparency: o.t || 0 },
    line: { color: HEX.line, width: 0.75 }, shadow: shadow(), objectName: name });
}
function chipBox(s, name, x, y, w, h, text, o = {}) {
  s.addText(text, Object.assign({ shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x, y, w, h,
    fill: { color: o.fillHex || HEX.white, transparency: o.fillT ?? 0 }, line: { color: o.lineHex || HEX.line, width: 0.75 },
    shadow: o.noShadow ? undefined : shadow(), fontFace: THEME.bodyFontFace, fontSize: o.fontSize || 13,
    color: o.color || C.text1, align: o.align || "left", valign: o.valign || "middle", margin: [0.06, 0.14, 0.06, 0.14],
    objectName: name }, o.extra || {}));
}
// metaphor drops (slides 1-2)
function droplet(s, name, x, y, sz) {
  s.addImage({ path: A("ripple.png"), x: x - sz * 1.6, y: y + sz * 1.25, w: sz * 4.4, h: sz * 1.15, objectName: `${name}_ripple`,
               altText: "Ripple where an oil drop lands" });
  s.addImage({ path: A("droplet.png"), x, y, w: sz, h: sz * 1.42, objectName: name, altText: "Falling oil drop (visual metaphor)" });
}
function dropAnim(name, o = {}) {
  anim(name, "drop", Object.assign({ dur: 900, fall: o.fall || 0.38 }, o));
  anim(`${name}_ripple`, "ripple", { trig: "with", delay: (o.delay || 0) + 860, dur: 1400 });
}
// pipeline life: crude pulse in this slide's sight glass, slow drips onto drip pans
const GLASS = { 1: [9.0, 1.0], 2: [2.2, 1.0], 3: [4.0, 1.0], 4: [6.25, 0.6], 5: [1.0, 1.0], 6: [1.4, 1.0], 7: [1.2, 1.0], 8: [1.2, 1.0] };
const DRIPS = { 1: [11.3], 2: [5.37], 5: [5.4] };
function pipelineLife(s, n) {
  const [gx, gw] = GLASS[n];
  s.addImage({ path: A("crude_pulse.png"), x: gx, y: PIPE_CY - PIPE_D / 2 + 0.035, w: gw, h: PIPE_D - 0.07,
               objectName: "crude_pulse", altText: "Crude oil moving through the sight glass" });
  anim("crude_pulse", "glint", { trig: "with", delay: 0, dur: 1500, repeat: "indefinite" });
  (DRIPS[n] || []).forEach((x, i) => {
    s.addImage({ path: A("drip.png"), x: x - 0.035, y: PIPE_CY + 0.18, w: 0.07, h: 0.1, objectName: `drip${i}`,
                 altText: "Crude drip falling into a drip pan" });
    anim(`drip${i}`, "drip", { trig: "with", delay: 400 + i * 700, dur: 2200, fall: 0.032, repeat: "indefinite" });
  });
}
// animated counter: intermediate values wait off-slide (so the edit view stays clean),
// each jumps onto the card for ~90 ms; the final value then stays.
function counter(s, name, steps, finalText, o) {
  const step = 90;
  steps.forEach((v, i) => txt(s, v, Object.assign({}, o, { x: W + 0.4, y: o.y, objectName: `${name}_c${i}` })));
  txt(s, finalText, Object.assign({}, o, { objectName: name }));
  return (baseDelay) => {
    steps.forEach((v, i) => anim(`${name}_c${i}`, "counterStep", { trig: "with", delay: baseDelay + i * step, dur: step,
      dx: (o.x - (W + 0.4)) / W }));
    anim(name, "fade", { trig: "with", delay: baseDelay + steps.length * step, dur: 1 });
  };
}

// ---------------------------------------------------------------- data
const csv = (f) => fs.readFileSync(path.join(HERE, f), "utf8").trim().split(/\r?\n/);
const hourly = csv("gl01_hourly.csv").slice(1)
  .map((l) => { const [h, q] = l.split(","); return { h: new Date(h.replace(" ", "T")), q: +q }; })
  .filter((r) => r.h >= new Date("2025-04-12T00:00:00") && r.h < new Date("2025-04-22T00:00:00"));
const SHUT0 = new Date("2025-04-15T08:00:00"), SHUT1 = new Date("2025-04-18T08:00:00");
const EXPECTED = 998.556996;   // Problems page: median oil rate of the 7 producing days before the stop
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labels = hourly.map((r) => `${r.h.getDate()} ${MON[r.h.getMonth()]}`);
const inShut = (r) => r.h >= SHUT0 && r.h < SHUT1;
const actual = hourly.map((r) => (inShut(r) ? 0 : Math.round(r.q * 10) / 10));
const expected = hourly.map((r) => (inShut(r) || +r.h === +SHUT1 ? EXPECTED : null));
const gap = hourly.map((r) => (inShut(r) ? EXPECTED : 0));
const gapSum = gap.reduce((a, b) => a + b, 0) / 24;
if (Math.abs(gapSum - 2995.7) > 0.1) throw new Error(`gap area ${gapSum} != 2995.7`);

const buRows = csv("buildups_6.csv");
const buWells = buRows[0].split(",").slice(1);
const buData = buRows.slice(1).map((l) => l.split(",").map((v) => (v === "" ? null : +v)));
const buHours = buData.map((r) => r[0]);

// ================================================================ SLIDE 1 (photo)
if (!SKIP.includes(1)) {
  const s = newSlide(1, "PN Photo Open", "The problem", "What Does a Three-Day Shutdown Cost?");
  txt(s, "PETRONOVA  ·  SOCAR HACKATHON 2026", { x: 0.7, y: 0.55, w: 6.5, h: 0.3, fontSize: 12, bold: true,
      color: C.accent1, charSpacing: 3, objectName: "kicker" });
  txt(s, "If one oil well stops for three days, how much could that cost?", { x: 0.7, y: 2.55, w: 6.0, h: 0.75,
      fontSize: 18, italic: true, color: C.background1, objectName: "question" });
  txt(s, "3 days", { x: 0.7, y: 3.35, w: 2.6, h: 0.95, fontSize: 54, fontFace: THEME.headFontFace, color: C.background1,
      objectName: "stat1_num" });
  txt(s, "offline", { x: 0.7, y: 4.32, w: 2.6, h: 0.35, fontSize: 16, color: C.accent6, objectName: "stat1_lbl" });
  txt(s, "≈3,000", { x: 3.45, y: 3.35, w: 3.4, h: 0.95, fontSize: 54, fontFace: THEME.headFontFace, color: "F2A33A",
      objectName: "stat2_num" });
  txt(s, "barrels of estimated oil loss", { x: 3.45, y: 4.32, w: 3.4, h: 0.35, fontSize: 16, color: C.accent6, objectName: "stat2_lbl" });
  chipBox(s, "case_chip", 0.7, 4.95, 2.75, 0.4, "GL‑01  ·  15–18 April 2025", { fontSize: 12 });
  txt(s, "Photo: Michael Duniway, USGS (public domain)", { x: 0.3, y: 7.22, w: 4.0, h: 0.2, fontSize: 9, color: C.background1,
      objectName: "credit" });
  droplet(s, "drop1", 4.55, 4.85, 0.3);
  droplet(s, "drop2", 5.35, 5.05, 0.36);
  droplet(s, "drop3", 3.85, 5.2, 0.26);

  anim("kicker", "fade", { delay: 200 });
  anim("@title", "riseIn", { trig: "with", delay: 350, dur: 700 });
  pipelineLife(s, 1);
  anim("question", "riseIn", { delay: 250, dur: 600 });
  anim("stat1_num", "riseIn", { delay: 500, dur: 600 });
  anim("stat1_lbl", "fade", { trig: "with", delay: 200 });
  anim("stat2_num", "riseIn", { delay: 450, dur: 600 });
  anim("stat2_lbl", "fade", { trig: "with", delay: 200 });
  dropAnim("drop1", { trig: "with", delay: 350, fall: 0.40 });
  dropAnim("drop2", { trig: "with", delay: 750, fall: 0.45 });
  dropAnim("drop3", { trig: "with", delay: 1100, fall: 0.48 });
  anim("case_chip", "fade", { delay: 200 });

  s.addNotes(
`SPEAKER 1 · 0:00–0:30 (≈30 s)

[Let the oilfield shot settle. The oil rises out of the ground through the well into the wellhead and runs into the pipeline.]
"If one oil well stops for three days, how much could that cost?"
[Numbers appear.] "Here is a real case from the competition data. Well GL‑01 was offline for three days, from the 15th to the 18th of April 2025. We estimate it did not produce about three thousand barrels of oil."
"Let's follow the oil and see where that number comes from."

Facts (verified): GL‑01 choke at 0% from 15 Apr 08:00 to 18 Apr 08:00 = 72 h (Dataset/choke_events, work/shut_ins.csv). Estimated loss 2,995.7 bbl (PetroNova Problems page, downtime method).
The falling drops and the dripping pipe are visual metaphors only. There was no spill in this case.
Photo: "A pumpjack on an active oil or gas drilling site in New Mexico", Michael Duniway, USGS, 22 May 2019. Public domain. The pipeline, wellhead and rock cross-section are illustrations.`);
}

// ================================================================ SLIDE 2
if (!SKIP.includes(2)) {
  const s = newSlide(2, "PN Day", null, "How Much Oil Would the Well Have Produced?");
  const cx = 0.6, cy = 1.3, cw = 8.75, ch = 3.95;
  const LAY = { x: 0.1, y: 0.04, w: 0.87, h: 0.8 };
  const base = () => ({ x: cx, y: cy, w: cw, h: ch, layout: Object.assign({}, LAY),
    valAxisMinVal: 0, valAxisMaxVal: 1200, valAxisMajorUnit: 300, catAxisLabelFrequency: 24,
    showLegend: false, lineDataSymbol: "none", displayBlanksAs: "gap",
    catAxisLabelColor: HEX.muted, valAxisLabelColor: HEX.muted, catAxisLabelFontSize: 12, valAxisLabelFontSize: 12,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valAxisLabelFormatCode: "#,##0",
    catAxisLineShow: false, valAxisLineShow: false, catAxisMajorTickMark: "none", valAxisMajorTickMark: "none" });
  const hidden = { catAxisHidden: true, valAxisHidden: true, valGridLine: { style: "none" }, catGridLine: { style: "none" } };
  card(s, "chart_card", 0.45, 1.2, 9.05, 4.2, { t: 8 });
  s.addChart(pres.charts.LINE, [{ name: "Expected production if the well had kept running", labels, values: expected }],
    Object.assign(base(), { chartColors: [HEX.slate], lineSize: 2.5, lineDash: "dash",
      valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: "none" },
      showValAxisTitle: true, valAxisTitle: "Oil production (barrels per day)", valAxisTitleColor: HEX.muted,
      valAxisTitleFontSize: 11, valAxisTitleFontFace: "+mn-lt", objectName: "chart_expected" }));
  s.addChart(pres.charts.LINE, [{ name: "Production during shutdown", labels, values: actual }],
    Object.assign(base(), hidden, { chartColors: [HEX.amber], lineSize: 3, objectName: "chart_actual" }));
  s.addChart(pres.charts.AREA, [{ name: "Estimated oil loss", labels, values: gap }],
    Object.assign(base(), hidden, { chartColors: [HEX.red], chartColorsOpacity: 40, objectName: "chart_gap" }));

  const px0 = cx + LAY.x * cw, pw = LAY.w * cw, py0 = cy + LAY.y * ch, ph = LAY.h * ch;
  const X = (i) => px0 + ((i + 0.5) / labels.length) * pw;
  const Y = (v) => py0 + ph * (1 - v / 1200);
  const i0 = hourly.findIndex(inShut), i1 = hourly.length - 1 - [...hourly].reverse().findIndex(inShut);
  const mid = (X(i0) + X(i1)) / 2;
  txt(s, "Expected if the well had kept running", { x: mid - 1.6, y: Y(EXPECTED) - 0.36, w: 3.2, h: 0.28, fontSize: 12,
      align: "center", color: C.text1, objectName: "lbl_expected" });
  txt(s, "Estimated oil loss", { x: mid - 1.3, y: Y(600), w: 2.6, h: 0.35, fontSize: 18, bold: true, align: "center",
      color: "9F1D22", objectName: "lbl_loss" });
  txt(s, "≈3,000 barrels", { x: mid - 1.3, y: Y(600) + 0.36, w: 2.6, h: 0.3, fontSize: 14, align: "center",
      color: "9F1D22", objectName: "lbl_loss2" });
  txt(s, "Production during shutdown: 0", { x: mid - 1.15, y: Y(0) - 0.3, w: 2.3, h: 0.26, fontSize: 11, align: "center",
      color: C.accent1, bold: true, objectName: "lbl_actual" });
  txt(s, "Before the stop", { x: px0 + 0.1, y: Y(1020) - 0.33, w: 1.9, h: 0.26, fontSize: 12, color: C.text2, objectName: "lbl_before" });
  droplet(s, "drop_s2", mid - 0.13, Y(920), 0.26);

  txt(s, "THE IDEA IN ONE SENTENCE", { x: 9.8, y: 1.3, w: 3.0, h: 0.3, fontSize: 12, bold: true, color: C.accent1,
      charSpacing: 2, objectName: "rp_kicker" });
  txt(s, "Before it stopped, GL‑01 made about 1,000 barrels a day. It stopped for 3 days, so about 3,000 barrels were not produced.",
      { x: 9.8, y: 1.68, w: 3.0, h: 1.75, fontSize: 16, color: C.text1, objectName: "rp_sentence" });
  chipBox(s, "rp_formula", 9.8, 3.5, 3.0, 0.72, [
      { text: "998.6 bbl/day × 3 days", options: { breakLine: true, fontSize: 13, color: C.text2 } },
      { text: "= 2,995.7 barrels", options: { fontSize: 16, bold: true, color: C.text1 } }]);
  txt(s, "Hourly oil from PetroNova’s virtual flow meter. Expected rate = median of the 7 producing days before the stop.",
      { x: 9.8, y: 4.35, w: 3.0, h: 0.62, fontSize: 10.5, color: C.text2, objectName: "rp_source" });

  anim("@title", "fade", { delay: 100, dur: 500 });
  pipelineLife(s, 2);
  anim("chart_card", "fade", { trig: "with", delay: 100 });
  anim("chart_expected", "wipeRight", { delay: 150, dur: 1300 });
  anim("lbl_expected", "fade", { trig: "with", delay: 900 });
  anim("chart_actual", "wipeRight", { delay: 150, dur: 1600 });
  anim("lbl_before", "fade", { trig: "with", delay: 300 });
  anim("lbl_actual", "fade", { trig: "with", delay: 900 });
  anim("chart_gap", "fade", { delay: 200, dur: 900 });
  dropAnim("drop_s2", { trig: "with", delay: 300, fall: 0.26 });
  anim("lbl_loss", "riseIn", { trig: "with", delay: 900, dur: 500 });
  anim("lbl_loss2", "fade", { trig: "with", delay: 1100 });
  anim("rp_kicker", "fade", { delay: 200 });
  anim("rp_sentence", "flyInRight", { trig: "with", delay: 100, dur: 600 });
  anim("rp_formula", "riseIn", { delay: 300 });
  anim("rp_source", "fade", { trig: "with", delay: 300 });

  s.addNotes(
`SPEAKER 1 · 0:30–1:05 (≈35 s)

"Time goes left to right, oil production goes up."
[Dashed line draws] "This dashed line is what GL‑01 would have produced if it had kept running."
[Amber line draws] "This line is what it really produced. On the 15th it drops to zero and stays there for three days."
[Red area fills] "The red area between the two lines is the oil that was not produced."
"Before it stopped, the well made about 1,000 barrels a day. It stopped for 3 days. So about 3,000 barrels were not produced."
Handoff: "But a stopped well can tell us much more than that. [Speaker 2]"

Data (real, not illustrative): hourly oil rate of GL‑01 from the trained VFM (app/services/diagnostics.hourly_rates), 12–21 Apr 2025. Shut-in 15 Apr 08:00 – 18 Apr 08:00 (72 h, rate 0).
Expected rate 998.6 bbl/day = median of the 7 producing days before the stop, exactly as the Problems page computes downtime losses. 998.6 × 3 days = 2,995.7 bbl.
Scenery: an ageing gathering manifold with a DANGER sign; the drip is a visual metaphor.`);
}

// ================================================================ SLIDE 3
if (!SKIP.includes(3)) {
  const s = newSlide(3, "PN Day", "How PetroNova works", "What Can a Stopped Well Tell Us?");
  txt(s, "PetroNova turns sensor data into oil, water and gas estimates, possible problems, and a place to start investigating.",
      { x: 0.7, y: 1.12, w: 7.2, h: 0.55, fontSize: 14, color: C.text2, objectName: "sub" });
  card(s, "chart_card", 0.5, 1.7, 7.4, 2.45, { t: 8 });
  txt(s, "Pressure rise after each of the 6 shut-ins (psi, first 12 hours)", { x: 0.7, y: 1.78, w: 6.5, h: 0.26, fontSize: 12,
      color: C.text2, objectName: "bu_axis" });
  const PAL = { "GL-01": HEX.amber, "GL-02": "7C93B0", "GL-04": "475569", "GL-06": "A3B4C8", "GL-08": "5E7A99", "GL-10": "8FA3A8" };
  const blabels = buHours.map((h) => (h % 2 === 0 ? `${h} h` : ""));
  const bx = 0.55, by = 2.0, bw = 6.5, bh = 2.12, BL = { x: 0.1, y: 0.04, w: 0.86, h: 0.78 };
  s.addChart(pres.charts.LINE, buWells.map((wname, j) => ({ name: wname, labels: blabels, values: buData.map((r) => r[j + 1]) })), {
    x: bx, y: by, w: bw, h: bh, layout: BL, chartColors: buWells.map((wn) => PAL[wn]), lineSize: 2, lineDataSymbol: "none",
    showLegend: false, displayBlanksAs: "gap", valAxisMinVal: 0, valAxisMaxVal: 800, valAxisMajorUnit: 200,
    catAxisLabelFrequency: 8, valAxisLabelFormatCode: "#,##0", catAxisLabelColor: HEX.muted, valAxisLabelColor: HEX.muted,
    catAxisLabelFontSize: 11, valAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    valGridLine: { color: HEX.grid, size: 0.75 }, catGridLine: { style: "none" }, catAxisLineShow: false,
    valAxisLineShow: false, catAxisMajorTickMark: "none", valAxisMajorTickMark: "none", objectName: "chart_buildup" });
  // direct labels at each curve's last point
  const BX = (i) => bx + BL.x * bw + ((i + 0.5) / buHours.length) * BL.w * bw;
  const BY = (v) => by + BL.y * bh + BL.h * bh * (1 - v / 800);
  const placed = [];
  buWells.forEach((wn, j) => {
    let i = buData.length - 1; while (buData[i][j + 1] == null) i--;
    let y = BY(buData[i][j + 1]) - 0.11;
    while (placed.some((p) => Math.abs(p.y - y) < 0.17 && Math.abs(p.x - BX(i)) < 0.7)) y -= 0.17;
    placed.push({ x: BX(i), y });
    txt(s, wn.replace("-", "‑"), { x: BX(i) + 0.05, y, w: 0.65, h: 0.22, fontSize: wn === "GL-01" ? 11 : 9.5, bold: wn === "GL-01",
        color: wn === "GL-01" ? C.accent1 : C.text2, objectName: `bu_lbl_${wn}` });
  });
  chipBox(s, "out1", 0.5, 4.3, 3.55, 0.95, [
      { text: "How much production may have been lost", options: { breakLine: true, fontSize: 12, color: C.text2 } },
      { text: "≈3,000 barrels", options: { fontSize: 22, bold: true, color: C.accent1 } }], { valign: "top" });
  chipBox(s, "out2", 4.25, 4.3, 3.65, 0.95, [
      { text: "What the engineer should check first (GL‑01)", options: { breakLine: true, fontSize: 12, color: C.text2 } },
      { text: "Damage near the well", options: { breakLine: true, fontSize: 20, bold: true, color: C.accent3 } },
      { text: "PTA: skin +5.7 · flow efficiency 68%", options: { fontSize: 9.5, color: C.text2 } }], { valign: "top" });
  // cutaway card + pressure rings at the perforations
  const KX = 8.35, KY = 1.2;
  s.addImage({ path: A("well_cutaway.png"), x: KX, y: KY, w: 4.6, h: 4.25, objectName: "cutaway",
               altText: "Cutaway of the well: casing, tubing and perforations in the oil-bearing rock", shadow: shadow() });
  const WX = KX + 2.3, RY = KY + (3.011 + 3.717) / 2;
  for (let i = 0; i < 3; i++) {
    s.addShape(pres.shapes.OVAL, { x: WX - 0.9, y: RY - 0.3, w: 1.8, h: 0.6, fill: { type: "none" },
      line: { color: HEX.amberHi, width: 2.25 }, objectName: `ring${i}` });
  }
  chipBox(s, "gauge_lbl", KX + 0.15, KY + 2.2, 1.85, 0.52, [
      { text: "Downhole gauge, GL‑01", options: { breakLine: true, fontSize: 10, color: C.text2 } },
      { text: "3,241 → 3,512 psi", options: { fontSize: 12, bold: true } }]);
  chipBox(s, "res_lbl", KX + 2.75, KY + 3.72, 1.7, 0.36, "Oil-bearing rock", { fontSize: 11 });

  anim("@title", "fade", { delay: 100 });
  pipelineLife(s, 3);
  anim("sub", "fade", { trig: "with", delay: 250 });
  anim("cutaway", "fade", { trig: "with", delay: 200, dur: 700 });
  anim("chart_card", "fade", { delay: 100 });
  anim("bu_axis", "fade", { trig: "with", delay: 100 });
  anim("chart_buildup", "wipeRight", { trig: "with", delay: 200, dur: 2200 });
  buWells.forEach((wn) => anim(`bu_lbl_${wn}`, "fade", { trig: "with", delay: 2200 }));
  ["ring0", "ring1", "ring2"].forEach((r, i) => anim(r, "pulse", { trig: "with", delay: 200 + i * 600, dur: 1800, repeat: "indefinite" }));
  anim("gauge_lbl", "fade", { trig: "with", delay: 700 });
  anim("res_lbl", "fade", { trig: "with", delay: 1000 });
  anim("out1", "riseIn", { trig: "with", delay: 2800, dur: 600 });
  anim("out2", "flyInRight", { trig: "with", delay: 3500, dur: 700 });

  s.addNotes(
`SPEAKER 2 · 1:05–1:45 (≈40 s)

"Let's look inside the well."
"When a well stops, oil keeps flowing into it from the rock, so the pressure at the bottom rises. PetroNova reads every one of these stops automatically — here are all six shut-ins in the data."
"Each curve rises fast and then flattens. The shape is a clue: it tells the engineer how easily oil can flow from the rock into the well."
"So from one stopped well PetroNova gives two answers: how much production may have been lost — about 3,000 barrels for GL‑01 — and what to check first. For GL‑01, the curve points to damage in the rock right around the well."
Handoff: "But can you trust our estimates?"

Technical backup:
- Curves: pressure rise since the stop from the downhole gauge (work/hf_clean.parquet), 15-min means, first 12 h. Rises: GL‑01 +271 psi (72 h), GL‑02 +282 (5.7 h), GL‑04 +838 (48 h), GL‑06 +119 (8 h), GL‑08 +522 (72 h), GL‑10 +228 (9 h). Shorter shut-ins end before 12 h.
- GL‑01 PTA (Horner + Bourdet derivative): k ≈ 108 mD, skin +5.7, ΔP skin ≈ 116 psi, flow efficiency 0.68 → stimulation candidate.
- Scenery: gas-lift compressor and a telemetry (RTU) station.`);
}

// ================================================================ SLIDE 4
if (!SKIP.includes(4)) {
  const s = newSlide(4, "PN Day", null, "How Close Were Our Estimates?");
  txt(s, "Average error of our oil production estimates on 20 later well tests", { x: 0.7, y: 1.15, w: 9.5, h: 0.4,
      fontSize: 16, color: C.text2, objectName: "sub" });
  const X0 = 4.3;
  const bar = (name, val, color, y, nm) => s.addChart(pres.charts.BAR, [{ name, labels: [name], values: [val] }], {
    x: X0, y, w: 8.3, h: 0.9, barDir: "bar", layout: { x: 0, y: 0.08, w: 7.0 / 8.3, h: 0.84 },
    valAxisMinVal: 0, valAxisMaxVal: 8, catAxisHidden: true, valAxisHidden: true,
    valGridLine: { style: "none" }, catGridLine: { style: "none" }, barGapWidthPct: 12, showLegend: false,
    chartColors: [color], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: '0.0"%"',
    dataLabelColor: HEX.slate, dataLabelFontSize: 22, dataLabelFontBold: true, dataLabelFontFace: "+mn-lt", objectName: nm });
  card(s, "bars_card", 0.45, 1.7, 12.4, 2.65, { t: 10 });
  bar("Past measurements only", 7.14, HEX.steel, 1.9, "bar_base");
  bar("PetroNova selected model", 2.84, HEX.green, 3.0, "bar_pn");
  txt(s, "Past measurements only", { x: 0.7, y: 2.0, w: 3.5, h: 0.38, fontSize: 17, bold: true, objectName: "lbl_base" });
  txt(s, "Trend from each well’s earlier tests, no sensor data", { x: 0.7, y: 2.38, w: 3.4, h: 0.42, fontSize: 11,
      color: C.text2, objectName: "lbl_base2" });
  txt(s, "PetroNova’s selected model", { x: 0.7, y: 3.1, w: 3.5, h: 0.38, fontSize: 17, bold: true, color: C.accent3, objectName: "lbl_pn" });
  txt(s, "Physics-hybrid virtual flow meter using sensor data", { x: 0.7, y: 3.48, w: 3.4, h: 0.42, fontSize: 11,
      color: C.text2, objectName: "lbl_pn2" });
  s.addShape(pres.shapes.LINE, { x: X0, y: 1.85, w: 0, h: 2.15, line: { color: HEX.muted, width: 1.25 }, objectName: "zero_line" });
  txt(s, "0%", { x: X0 - 0.2, y: 4.02, w: 0.4, h: 0.24, fontSize: 11, align: "center", color: C.text2, objectName: "zero_lbl" });
  chipBox(s, "lower_better", 0.5, 4.55, 2.1, 0.42, "↓  Lower is better", { fontSize: 13, fillHex: "E7F6EF", lineHex: "1F9D6B", noShadow: true });
  txt(s, "Mean absolute percentage error (MAPE) of daily oil estimates. Each well’s last 2 tests (20 in total) were hidden from the model and used only for checking.",
      { x: 2.85, y: 4.53, w: 6.6, h: 0.6, fontSize: 11, color: C.text2, objectName: "method" });
  card(s, "take_card", 9.85, 4.5, 3.0, 0.78);
  txt(s, [{ text: "2.5×  ", options: { fontSize: 30, fontFace: THEME.headFontFace, color: C.accent3 } },
          { text: "smaller error", options: { fontSize: 14, color: C.text1 } }],
      { x: 10.0, y: 4.55, w: 2.8, h: 0.68, valign: "middle", objectName: "takeaway" });

  anim("@title", "fade", { delay: 100 });
  pipelineLife(s, 4);
  anim("sub", "fade", { trig: "with", delay: 250 });
  anim("bars_card", "fade", { delay: 50 });
  anim("zero_line", "fade", { trig: "with", delay: 100 });
  anim("zero_lbl", "fade", { trig: "with", delay: 100 });
  anim("lbl_base", "fade", { delay: 100 });
  anim("lbl_base2", "fade", { trig: "with", delay: 150 });
  anim("bar_base", "wipeRight", { trig: "with", delay: 200, dur: 1200 });
  anim("lbl_pn", "fade", { delay: 300 });
  anim("lbl_pn2", "fade", { trig: "with", delay: 150 });
  anim("bar_pn", "wipeRight", { trig: "with", delay: 200, dur: 800 });
  anim("lower_better", "riseIn", { delay: 300 });
  anim("method", "fade", { trig: "with", delay: 200 });
  anim("take_card", "fade", { delay: 200 });
  anim("takeaway", "zoomIn", { trig: "with", delay: 100, dur: 500 });

  s.addNotes(
`SPEAKER 2 · 1:45–2:10 (≈25 s)

"Can you trust these estimates? We tested them."
"We hid each well's last two tests — 20 measurements in total — and asked the model to estimate them."
"Using past measurements only, the average error was 7.1 percent. PetroNova's model: 2.8 percent. Lower is better: about two and a half times smaller."
Handoff: "So now we trust the barrels. What are they worth? [Speaker 3]"

Verified in work/vfm_validation.csv: split "B: forward (last 2 tests)", target oil_rate_stbd, n = 20.
"trend only (no sensors)" = 7.14 % (baseline shown); "v2: physics-hybrid (FINAL)" = 2.84 %.
Context: leave-one-test-out (85 tests) v2 oil MAPE 2.5 %. Plain ML (v1) scores 2.6 % but was rejected: in the 14 Jun lift-gas outage it predicted MORE oil on all 10 wells.
Scenery: the 10-well pad, GL‑01 to GL‑10 (GL‑01 highlighted).`);
}

// ================================================================ SLIDE 5
if (!SKIP.includes(5)) {
  const s = newSlide(5, "PN Day", "The decision", "Which Well Should We Check First?");
  const eq = [
    ["eq_bbl", "≈3,000", "barrels", 0.7, 2.45, C.text1],
    ["eq_x", "×", "", 3.2, 0.6, C.accent5],
    ["eq_price", "$70", "per barrel", 3.85, 1.75, C.text1],
    ["eq_eq", "≈", "", 5.65, 0.6, C.accent5],
    ["eq_val", "$210,000", "estimated value of oil that could have been produced", 6.3, 4.6, C.accent1],
  ];
  for (const [nm, big, small, x, w, col] of eq) {
    txt(s, big, { x, y: 1.15, w, h: 0.95, fontSize: 50, fontFace: THEME.headFontFace, color: col,
        align: small ? "left" : "center", objectName: nm });
    if (small) txt(s, small, { x, y: 2.08, w: Math.max(w, 1.8), h: 0.3, fontSize: 13, color: C.text2, objectName: `${nm}_lbl` });
  }
  chipBox(s, "price_note", 0.7, 2.5, 5.0, 0.36, "Illustrative price: $70/barrel  ·  Oil production value only",
          { fontSize: 12, fillHex: "FFF4E5", lineHex: "E8B46A", noShadow: true });
  const ev = [["GL‑08 · 19–22 Aug", 4394.2], ["GL‑01 · 15–18 Apr", 2995.7], ["GL‑04 · 3–5 Jun", 1618.8],
              ["GL‑10 · 27–28 May", 692.0], ["GL‑02 · 8 Mar", 311.9], ["GL‑06 · 22 Jul", 228.6]];
  const usd = ev.map(([, b]) => Math.round(b * 70 / 1000));
  card(s, "rank_card", 0.5, 3.0, 8.1, 2.35, { t: 6 });
  txt(s, "All six shutdowns in the data, measured the same way", { x: 0.7, y: 3.08, w: 7.6, h: 0.3, fontSize: 13, bold: true,
      objectName: "rank_title" });
  s.addChart(pres.charts.BAR, [{ name: "Estimated value of oil not produced ($ thousand)", labels: ev.map((e) => e[0]).reverse(),
      values: usd.slice().reverse() }], {
    x: 0.55, y: 3.36, w: 7.9, h: 1.95, barDir: "bar", layout: { x: 0.24, y: 0.02, w: 0.66, h: 0.96 },
    chartColors: [HEX.steel, HEX.steel, HEX.steel, HEX.steel, HEX.amber, HEX.steel], barGapWidthPct: 40,
    valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 340, valGridLine: { style: "none" }, catGridLine: { style: "none" },
    catAxisLabelColor: HEX.body, catAxisLabelFontSize: 11, catAxisLabelFontFace: "+mn-lt", catAxisLineShow: false,
    catAxisMajorTickMark: "none", showLegend: false, showValue: true, dataLabelPosition: "outEnd",
    dataLabelFormatCode: '"$"0"k"', dataLabelColor: HEX.slate, dataLabelFontSize: 11, dataLabelFontFace: "+mn-lt",
    objectName: "chart_rank" });
  txt(s, "WHY IT MATTERS", { x: 9.1, y: 3.05, w: 3.6, h: 0.3, fontSize: 12, bold: true, color: C.accent1, charSpacing: 2,
      objectName: "why_k" });
  txt(s, "One number for every incident lets an engineer compare very different problems and start with the one that matters most.",
      { x: 9.1, y: 3.38, w: 3.7, h: 1.3, fontSize: 15, color: C.text1, objectName: "why" });
  txt(s, "Estimated barrels × $70. Not an audited loss and not guaranteed to be recovered.",
      { x: 9.1, y: 4.72, w: 3.7, h: 0.45, fontSize: 10.5, color: C.text2, objectName: "why_note" });

  anim("@title", "fade", { delay: 100 });
  pipelineLife(s, 5);
  anim("eq_bbl", "riseIn", { delay: 250, dur: 500 });
  anim("eq_bbl_lbl", "fade", { trig: "with", delay: 150 });
  anim("eq_x", "fade", { delay: 350 });
  anim("eq_price", "riseIn", { trig: "with", delay: 150, dur: 500 });
  anim("eq_price_lbl", "fade", { trig: "with", delay: 300 });
  anim("price_note", "fade", { trig: "with", delay: 400 });
  anim("eq_eq", "fade", { delay: 500 });
  anim("eq_val", "zoomIn", { trig: "with", delay: 150, dur: 600 });
  anim("eq_val_lbl", "fade", { trig: "with", delay: 500 });
  anim("rank_card", "fade", { delay: 600 });
  anim("rank_title", "fade", { trig: "with", delay: 100 });
  anim("chart_rank", "wipeRight", { trig: "with", delay: 200, dur: 1400 });
  anim("why_k", "fade", { delay: 200 });
  anim("why", "flyInRight", { trig: "with", delay: 100, dur: 600 });
  anim("why_note", "fade", { trig: "with", delay: 400 });

  s.addNotes(
`SPEAKER 3 · 2:10–2:45 (≈35 s)

"So what are those barrels worth?"
[Beat 1] "About 3,000 barrels..." [Beat 2] "...times an illustrative price of 70 dollars a barrel..." [Beat 3] "...is about 210 thousand dollars: the estimated value of oil GL‑01 could have produced in those three days."
"Now every shutdown in the data sits on the same scale. GL‑08's three-day stop in August is worth even more, about 300 thousand dollars."
"One number per incident tells an engineer where to look first."
Handoff: "Let's follow the oil to the end of the line."

Verified (Problems page, downtime method = 7-day pre-stop median rate × hours offline):
GL‑08 4,394.2 bbl → $307.6k · GL‑01 2,995.7 → $209.7k · GL‑04 1,618.8 → $113.3k · GL‑10 692.0 → $48.4k · GL‑02 311.9 → $21.8k · GL‑06 228.6 → $16.0k.
$70/bbl is the app's default oil price, illustrative only; oil value only. Not an audited loss, not realised savings, not a guaranteed recovery.
Scenery: high-pressure choke skid with shut-in valve and pressure monitoring.`);
}

// ================================================================ SLIDE 6 (photo): impact + metering hub
if (!SKIP.includes(6)) {
  const s = newSlide(6, "PN Photo", null, "Let’s Follow the Data for One Well");
  txt(s, "10 wells  ·  273 days of data", { x: 0.7, y: 1.15, w: 6.5, h: 0.45, fontSize: 22, fontFace: THEME.headFontFace,
      color: C.background1, objectName: "stats" });
  txt(s, [{ text: "Find the event  ", options: {} }, { text: "→", options: { color: "F2A33A" } },
          { text: "  Estimate the loss  ", options: {} }, { text: "→", options: { color: "F2A33A" } },
          { text: "  Decide what to check", options: {} }],
      { x: 0.7, y: 1.62, w: 6.6, h: 0.35, fontSize: 15, color: C.background1, objectName: "steps" });

  const big = (o) => Object.assign({ fontSize: 28, fontFace: THEME.headFontFace, color: C.text1, h: 0.55, valign: "middle" }, o);
  const small = (o) => Object.assign({ fontSize: 11, color: C.text2, h: 0.62 }, o);
  // row 1: three cards
  const r1 = [[0.6, "m_rows", ["0.4 M", "1.1 M", "1.9 M", "2.6 M", "3.3 M"], "3.9 M", "minute-by-minute sensor rows cleaned and used", C.text1],
              [2.9, "m_checks", ["0 / 57", "11 / 57", "24 / 57", "37 / 57", "49 / 57"], "57 / 57", "automated checks passed before any result is shown", C.accent3],
              [5.2, "m_gain", ["+5%", "+14%", "+25%", "+34%", "+42%"], "+47%", "possible oil on GL‑01 once damage is removed (≈ +475 bbl/day)", C.accent1]];
  const counters = [];
  r1.forEach(([x, nm, steps, fin, lbl, col]) => {
    card(s, `${nm}_card`, x, 2.15, 2.12, 1.48);
    counters.push(counter(s, nm, steps, fin, big({ x: x + 0.15, y: 2.25, w: 1.85, color: col })));
    txt(s, lbl, small({ x: x + 0.15, y: 2.85, w: 1.85, objectName: `${nm}_lbl` }));
  });
  // row 2: donut card + outage card
  card(s, "m_data_card", 0.6, 3.78, 3.3, 1.55);
  s.addChart(pres.charts.DOUGHNUT, [{ name: "Production data", labels: ["Daily rates", "Well tests"], values: [2730, 85] }], {
    x: 0.62, y: 3.83, w: 1.45, h: 1.45, holeSize: 62, chartColors: [HEX.amberHi, "CBD5E1"], showLegend: false,
    showValue: false, showPercent: false, showLabel: false, dataBorder: { pt: 1, color: "FFFFFF" }, firstSliceAng: 0,
    objectName: "donut" });
  counters.push(counter(s, "m_data", ["4×", "11×", "18×", "25×", "29×"], "32×", big({ x: 2.05, y: 3.88, w: 1.75, color: C.accent1 })));
  txt(s, "more production data: 2,730 daily rates vs 85 tests", small({ x: 2.05, y: 4.45, w: 1.75, h: 0.8, objectName: "m_data_lbl" }));
  card(s, "m_outage_card", 4.05, 3.78, 3.27, 1.55);
  counters.push(counter(s, "m_outage", ["0 / 10", "2 / 10", "4 / 10", "6 / 10", "8 / 10"], "10 / 10", big({ x: 4.2, y: 3.88, w: 3.0, color: C.accent3 })));
  txt(s, "wells moved the right way during the lift-gas outage (plain ML: 0 / 10)", small({ x: 4.2, y: 4.45, w: 3.0, h: 0.8, objectName: "m_outage_lbl" }));

  chipBox(s, "handoff", 0.6, 5.45, 4.7, 0.42, "Next: live demo — GL‑01 in PetroNova  →", { fontSize: 14, bold: true,
          fillHex: "0E141B", fillT: 10, lineHex: "F2A33A", color: C.background1 });
  txt(s, "Photo: M. Duniway, USGS (public domain). Pipeline, metering skid, tanks and towers: illustration.",
      { x: 0.3, y: 7.22, w: 7.0, h: 0.2, fontSize: 9, color: C.background1, objectName: "credit" });

  anim("@title", "fade", { delay: 150 });
  pipelineLife(s, 6);
  anim("stats", "riseIn", { trig: "with", delay: 300, dur: 600 });
  anim("steps", "fade", { trig: "with", delay: 700 });
  ["m_rows", "m_checks", "m_gain"].forEach((nm, i) => {
    anim(`${nm}_card`, "riseIn", { delay: i ? 150 : 400, dur: 450 });
    counters[i](100);
    anim(`${nm}_lbl`, "fade", { trig: "with", delay: 300 });
  });
  anim("m_data_card", "riseIn", { delay: 250, dur: 450 });
  anim("donut", "wheel", { trig: "with", delay: 150, dur: 1200 });
  counters[3](200);
  anim("m_data_lbl", "flyInRight", { trig: "with", delay: 500, dur: 600 });
  anim("m_outage_card", "riseIn", { delay: 150, dur: 450 });
  counters[4](100);
  anim("m_outage_lbl", "fade", { trig: "with", delay: 300 });
  anim("handoff", "riseIn", { delay: 400, dur: 600 });

  s.addNotes(
`SPEAKER 3 · 2:45–3:30 (≈45 s)

"At the end of the line, every barrel is measured before it leaves the field. PetroNova does the same for data."
"We ran it on all 10 wells and 273 days: find the event, estimate the loss, decide what to check."
[Cards count up] "3.9 million sensor rows cleaned. 57 out of 57 automatic checks passed. 32 times more production data than the tests alone. When lift gas dropped in June, all 10 wells moved the right way — a plain machine-learning model got 0 out of 10. And GL‑01 could produce about 47 percent more oil once its damage is fixed."
[Hold] "Let's open GL‑01 in PetroNova."
→ switch to the live demo.

Verified:
- 3,914,560 cleaned 1-minute rows (work/hf_clean.parquet; raw 3,917,073).
- 57/57: python src/check_data.py → "57/57 checks passed".
- 2,730 = 10 wells × 273 days (work/daily.csv); 85 well tests; 2,730 / 85 = 32.1×.
- Outage 14 Jun 2025 (work/vfm_diagnostics.json): PetroNova oil change −3% to −19% on all 10 wells; plain ML +1% to +68% on all 10 (wrong direction).
- +47% / ≈ +475 bbl/day = (1/0.68 − 1) × 1,009 bbl/day (GL‑01 rate before the shut-in, flow efficiency rounded to 0.68). Unrounded flow efficiency 0.6835 gives +46% ≈ +467 bbl/day.
Visual: custody-transfer metering skid, export manifold, storage tanks, distillation towers and windsock are illustrations; the photo is real.`);
}

// ================================================================ SLIDE 7: references
if (!SKIP.includes(7)) {
  const s = newSlide(7, "PN Day", "Close", "References & Engineering Foundations");
  const refs = [
    ["Petroleum Engineering & Well Testing", "ref_pe", 0.6, [
      ["Horner, D.R. (1951).", "Pressure Build-up in Wells. Proceedings of the Third World Petroleum Congress, The Hague, Section II, 503–523.", "Horner straight line: permeability and skin from each build-up."],
      ["Bourdet, D., Ayoub, J.A. & Pirard, Y.M. (1989).", "Use of Pressure Derivative in Well-Test Interpretation. SPE Formation Evaluation 4(2), 293–302.", "Derivative plot: finding the radial-flow window automatically."],
      ["Lee, J., Rollins, J.B. & Spivey, J.P. (2003).", "Pressure Transient Testing. SPE Textbook Series, Vol. 9. Society of Petroleum Engineers.", "Build-up workflow, skin and flow-efficiency checks."]]],
    ["Multiphase Flow & Physics-Informed Modeling", "ref_ml", 6.8, [
      ["Brill, J.P. & Mukherjee, H. (1999).", "Multiphase Flow in Wells. SPE Monograph Series, Vol. 17. Society of Petroleum Engineers.", "Background for estimating oil, water and gas flow in a well."],
      ["Karniadakis, G.E., Kevrekidis, I.G., Lu, L., Perdikaris, P., Wang, S. & Yang, L. (2021).", "Physics-informed machine learning. Nature Reviews Physics 3, 422–440.", "Physics rules built into the flow-meter model."],
      ["Hampel, F.R. (1974).", "The Influence Curve and Its Role in Robust Estimation. Journal of the American Statistical Association 69(346), 383–393.", "Hampel filter: removing spikes from 3.9 M sensor rows."]]],
  ];
  refs.forEach(([head, nm, x, items]) => {
    card(s, `${nm}_card`, x, 1.3, 5.95, 3.75);
    txt(s, head.toUpperCase(), { x: x + 0.25, y: 1.45, w: 5.5, h: 0.3, fontSize: 12, bold: true, color: C.accent1, charSpacing: 1.5,
        objectName: `${nm}_head` });
    const runs = [];
    items.forEach(([who, what, role], i) => {
      runs.push({ text: who + " ", options: { bold: true, color: C.text1 } });
      runs.push({ text: what, options: { color: C.text1, breakLine: true } });
      runs.push({ text: role, options: { italic: true, color: C.accent1, fontSize: 10.5, breakLine: i < items.length - 1,
                                          paraSpaceAfter: 9 } });
    });
    txt(s, runs, { x: x + 0.25, y: 1.85, w: 5.45, h: 3.1, fontSize: 11.5, paraSpaceAfter: 2, objectName: `${nm}_body` });
  });
  txt(s, "Project methods and validation: METHODOLOGY.md in the PetroNova repository.", { x: 0.7, y: 5.18, w: 7.5, h: 0.26,
      fontSize: 10.5, color: C.text2, objectName: "foot" });

  anim("@title", "fade", { delay: 100 });
  pipelineLife(s, 7);
  anim("ref_pe_card", "riseIn", { delay: 200, dur: 500 });
  anim("ref_pe_head", "fade", { trig: "with", delay: 150 });
  anim("ref_pe_body", "fade", { trig: "with", delay: 250, dur: 600 });
  anim("ref_ml_card", "flyInRight", { delay: 150, dur: 600 });
  anim("ref_ml_head", "fade", { trig: "with", delay: 200 });
  anim("ref_ml_body", "fade", { trig: "with", delay: 300, dur: 600 });
  anim("foot", "fade", { delay: 200 });

  s.addNotes(
`AFTER THE LIVE DEMO (not part of the 3:30 pitch)

Show briefly, or leave up while judges ask about methods.
"Our methods stand on classic, peer-reviewed engineering: Horner and Bourdet for reading pressure build-ups, Lee and colleagues for the well-test workflow, Brill and Mukherjee for flow in wells, physics-informed machine learning for the model, and Hampel's filter for cleaning the sensor data."
All six references are real publications; no web links are given on purpose.
Scenery: clean export terminal valve station at the end of the pipeline.`);
}

// ================================================================ SLIDE 8: thank you
if (!SKIP.includes(8)) {
  const s = newSlide(8, "PN Day Open", null, "Thank You for Your Attention");
  txt(s, "PETRONOVA  ·  SOCAR HACKATHON 2026", { x: 0.7, y: 0.6, w: 6.5, h: 0.3, fontSize: 12, bold: true,
      color: C.accent1, charSpacing: 3, objectName: "kicker" });
  txt(s, "Questions are welcome.", { x: 0.7, y: 2.75, w: 6.0, h: 0.5, fontSize: 24, color: C.text2, objectName: "questions" });
  chipBox(s, "recap", 0.7, 3.55, 5.6, 0.5, "Find the event  →  Estimate the loss  →  Decide what to check", { fontSize: 14 });

  anim("kicker", "fade", { delay: 200 });
  anim("@title", "riseIn", { trig: "with", delay: 300, dur: 700 });
  pipelineLife(s, 8);
  anim("questions", "fade", { delay: 300, dur: 600 });
  anim("recap", "riseIn", { delay: 200, dur: 600 });

  s.addNotes(
`ALL SPEAKERS · end of the session

Click once: the camera stays at the export terminal while the closing text fades in.
"Thank you for your attention. We are happy to take your questions."
Keep this slide up during Q&A. Backup answers are in the notes of slides 2–6.`);
}

// ---------------------------------------------------------------- write
fs.writeFileSync(path.join(HERE, "anim_spec.json"), JSON.stringify(spec, null, 2));
pres.writeFile({ fileName: OUT }).then(async (f) => {
  const SK = process.env.PPTX_SKILL;
  if (SK) { const { applyTheme } = require(path.join(SK, "scripts", "apply_theme.js")); await applyTheme(OUT, THEME); }
  console.log("wrote", f);
});
