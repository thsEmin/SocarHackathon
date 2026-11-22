"""Add water and gas accuracy rows under the oil bars on slide 4 of final_prezentation.pptx.

    python presentation/build/add_phase_rows.py <in.pptx> <out.pptx>

Numbers (work/vfm_validation.csv, split "B: forward (last 2 tests)", n = 20, MAPE %):
    oil   7.14 -> 2.84   water 6.38 -> 4.00   gas 10.22 -> 5.43
All three rows share one 0-11 % axis so bar lengths are comparable.
"""
import copy
import sys

from lxml import etree
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.util import Inches, Pt

sys.path.insert(0, __import__("os").path.dirname(__file__))
import add_motion as M  # noqa: E402  (effect builders)

SRC, DST = sys.argv[1], sys.argv[2]
AXIS_MAX = 11.0
ROWS = [("Water", 6.38, 4.00, 4.58), ("Gas", 10.22, 5.43, 5.13)]
NSC = "http://schemas.openxmlformats.org/drawingml/2006/chart"
NSA = "http://schemas.openxmlformats.org/drawingml/2006/main"
EMU = 914400

prs = Presentation(SRC)
s = prs.slides[3]
shp = {sh.name: sh for sh in s.shapes}
assert "bar_base" in shp and "bar_pn" in shp, "slide 4 is not the accuracy slide"


def inch(v):
    return int(round(v * EMU))


# 1. oil bars onto the shared 0-11 % axis
for nm in ("bar_base", "bar_pn"):
    cs = shp[nm].chart._chartSpace
    for mx in cs.iter(f"{{{NSC}}}max"):
        mx.set("val", f"{AXIS_MAX:g}")

# 2. water and gas rows (PetroNova first so the baseline bar sits on top, as in the oil rows)
plot_w = shp["bar_pn"].chart._chartSpace.find(f".//{{{NSC}}}plotArea/{{{NSC}}}layout")
for phase, base, pn, y in ROWS:
    cd = CategoryChartData()
    cd.categories = [phase]
    cd.add_series("PetroNova", (pn,))
    cd.add_series("Past measurements only", (base,))
    gf = s.shapes.add_chart(XL_CHART_TYPE.BAR_CLUSTERED, inch(4.3), inch(y), inch(8.3), inch(0.52), cd)
    gf.name = f"bar_{phase.lower()}"
    ch = gf.chart
    ch.has_legend = False
    ch.font.name = "Segoe UI"
    ch.font.size = Pt(12)
    plot = ch.plots[0]
    plot.gap_width = 25
    plot.overlap = -8
    plot.has_data_labels = True
    dl = plot.data_labels
    dl.number_format, dl.number_format_is_linked = '0.0"%"', False
    dl.position = XL_LABEL_POSITION.OUTSIDE_END
    dl.font.size, dl.font.bold = Pt(12), True
    dl.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    pn_ser, base_ser = plot.series
    pn_ser.format.fill.solid(); pn_ser.format.fill.fore_color.theme_color = MSO_THEME_COLOR.ACCENT_1
    base_ser.format.fill.solid(); base_ser.format.fill.fore_color.rgb = RGBColor(0x8C, 0x99, 0xA6)
    va, ca = ch.value_axis, ch.category_axis
    va.minimum_scale, va.maximum_scale = 0, AXIS_MAX
    va.has_major_gridlines = ca.has_major_gridlines = False
    va.visible = ca.visible = False
    # same inner plot rectangle as the oil bars
    pa = ch._chartSpace.find(f".//{{{NSC}}}plotArea")
    old = pa.find(f"{{{NSC}}}layout")
    if old is not None:
        pa.remove(old)
    pa.insert(0, copy.deepcopy(plot_w))

    tb = s.shapes.add_textbox(inch(0.7), inch(y + 0.06), inch(3.4), inch(0.4))
    tb.name = f"lbl_{phase.lower()}"
    tf = tb.text_frame
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    r = tf.paragraphs[0].add_run()
    r.text = phase
    r.font.size, r.font.bold, r.font.name = Pt(16), True, "Segoe UI"
    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

# small legend under the rows
lg = s.shapes.add_textbox(inch(0.7), inch(5.68), inch(3.5), inch(0.26))
lg.name = "phase_legend"
tf = lg.text_frame
tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
for txt, col in (("■ ", RGBColor(0x8C, 0x99, 0xA6)), ("past measurements only    ", None), ("■ ", "accent"), ("PetroNova", None)):
    r = tf.paragraphs[0].add_run()
    r.text = txt
    r.font.size, r.font.name = Pt(10.5), "Segoe UI"
    if col == "accent":
        r.font.color.theme_color = MSO_THEME_COLOR.ACCENT_1
    elif col is not None:
        r.font.color.rgb = col
    else:
        r.font.color.rgb = RGBColor(0xC9, 0xD3, 0xDD)

# 3. move the existing pieces to make room
zl = shp["zero_line"]; zl.top, zl.height = inch(2.1), inch(3.55)
shp["zero_lbl"].top = inch(5.66)
shp["zero_lbl"].left = inch(4.1)
shp["lower_better"].top = inch(5.98); shp["lower_better"].height = inch(0.38)
mt = shp["method"]; mt.top, mt.height, mt.width = inch(5.96), inch(0.45), inch(7.2)
for p in mt.text_frame.paragraphs:
    for r in p.runs:
        r.text = r.text.replace("of daily oil estimates.", "of daily oil, water and gas estimates.")
        r.font.size = Pt(10.5)
tk = shp["takeaway"]; tk.left, tk.top = inch(10.35), inch(3.2)
for p in tk.text_frame.paragraphs:
    for r in p.runs:
        r.text = r.text.replace("smaller error than the baseline", "smaller oil error than the baseline")
for p in shp["sub"].text_frame.paragraphs:
    for r in p.runs:
        r.text = r.text.replace("Average error of our oil production estimates on 20 later well tests",
                                "Average error of our oil, water and gas estimates on 20 later well tests")

# 4. speaker notes
nt = s.notes_slide.notes_text_frame
nt.text = nt.text.replace(
    "Handoff:",
    '[Rows appear] "And it is not only oil: water 6.4 percent down to 4.0, gas 10.2 percent down to 5.4."\nHandoff:', 1)
nt.text += ("\nWater and gas (same split, n = 20): water baseline 6.38 % → PetroNova 4.00 %; gas baseline 10.22 % → PetroNova 5.43 %."
            "\nAll three rows share one 0–11 % axis so the bars can be compared directly.")

# 5. animation: water and gas rows wipe in after the existing sequence
root = s._element
ns = M.NS
timing = root.find("p:timing", ns)
ids_used = [int(e.get("id")) for e in timing.iter(f"{{{ns['p']}}}cTn")]
ids = M.Ids(); ids.n = max(ids_used)
click_par = timing.find(".//p:cTn[@nodeType='mainSeq']/p:childTnLst/p:par/p:cTn/p:childTnLst", ns)
groups = click_par.findall("p:par", ns)
last_start = int(groups[-1].find("p:cTn/p:stCondLst/p:cond", ns).get("delay"))
t0 = last_start + 900
spid = {sh.name: str(sh.shape_id) for sh in s.shapes}
for k, (phase, *_r) in enumerate(ROWS):
    pars = []
    pars += M.effect_pars(ids, {"effect": "fade", "delay": 0, "dur": 400}, spid[f"lbl_{phase.lower()}"], "afterEffect")[0]
    pars += M.effect_pars(ids, {"effect": "wipeRight", "delay": 150, "dur": 900}, spid[f"bar_{phase.lower()}"], "withEffect")[0]
    if k == 1:
        pars += M.effect_pars(ids, {"effect": "fade", "delay": 900, "dur": 400}, spid["phase_legend"], "withEffect")[0]
    g = (f'<p:par xmlns:p="{ns["p"]}"><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="{t0 + k * 1100}"/>'
         f'</p:stCondLst><p:childTnLst>{"".join(pars)}</p:childTnLst></p:cTn></p:par>')
    click_par.append(etree.fromstring(g))
bld = timing.find("p:bldLst", ns)
for nm in ("lbl_water", "lbl_gas", "phase_legend"):
    bld.append(etree.fromstring(f'<p:bldP xmlns:p="{ns["p"]}" spid="{spid[nm]}" grpId="0"/>'))
for nm in ("bar_water", "bar_gas"):
    bld.append(etree.fromstring(f'<p:bldGraphic xmlns:p="{ns["p"]}" spid="{spid[nm]}" grpId="0"><p:bldAsOne/></p:bldGraphic>'))

prs.save(DST)
print("saved", DST)
