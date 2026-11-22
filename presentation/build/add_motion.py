"""Add native PowerPoint animations and Morph transitions to the static deck.

    python presentation/build/add_motion.py

Reads  presentation/build/PetroNova_Pitch_static.pptx + presentation/build/anim_spec.json
Writes presentation/PetroNova_Pitch.pptx

* Transitions: slide 1 fades in; slides 2-6 use Morph (fallback: fade). Shapes named "!!scene<n>" and
  "!!pipeline" exist on neighbouring slides at positions one slide-width apart, so Morph pans along the
  pipeline like a tracking camera.
* Animations: one automatic sequence per slide (first effect starts with the slide, the rest are
  After/With Previous). Slides advance only on the presenter's click.
"""
import json
import shutil
import zipfile
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(__file__).parent / "PetroNova_Pitch_static.pptx"
OUT = ROOT / "PetroNova_Pitch_v3.pptx"
SPEC = json.loads((Path(__file__).parent / "anim_spec.json").read_text(encoding="utf8"))

NS = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main",
      "a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
P = "{%s}" % NS["p"]
MORPH_MS = 1600


class Ids:
    def __init__(self):
        self.n = 2

    def __call__(self):
        self.n += 1
        return self.n


# ------------------------------------------------------------------ behaviour snippets
def _set_visible(ids, spid):
    return (f'<p:set><p:cBhvr><p:cTn id="{ids()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>'
            f'</p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName>'
            f'</p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>')


def _set_hidden(ids, spid, delay):
    return (f'<p:set><p:cBhvr><p:cTn id="{ids()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst>'
            f'</p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName>'
            f'</p:attrNameLst></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>')


def _effect(ids, spid, dur, filt, transition="in", delay=0):
    return (f'<p:animEffect transition="{transition}" filter="{filt}"><p:cBhvr><p:cTn id="{ids()}" dur="{dur}">'
            f'<p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect>')


def _anim_prop(ids, spid, dur, attr, frm, to, decel=False):
    return (f'<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="{ids()}" dur="{dur}" fill="hold"'
            f'{" decel=\"100000\"" if decel else ""}/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr>'
            f'<p:tavLst><p:tav tm="0"><p:val><p:strVal val="{frm}"/></p:val></p:tav>'
            f'<p:tav tm="100000"><p:val><p:strVal val="{to}"/></p:val></p:tav></p:tavLst></p:anim>')


def _scale(ids, spid, dur, frm, to, delay=0):
    """Grow from frm to to (1000ths of a percent) by animating width and height (as the Zoom effect does)."""
    f, t = frm / 100000, to / 100000
    return (_anim_prop(ids, spid, dur, "ppt_w", f"#ppt_w*{f:g}", f"#ppt_w*{t:g}", decel=True)
            + _anim_prop(ids, spid, dur, "ppt_h", f"#ppt_h*{f:g}", f"#ppt_h*{t:g}", decel=True))


def _motion(ids, spid, dur, path, accel=False, delay=0):
    return (f'<p:animMotion origin="layout" path="{path}" pathEditMode="relative" ptsTypes="">'
            f'<p:cBhvr><p:cTn id="{ids()}" dur="{dur}" fill="hold"{" accel=\"100000\"" if accel else ""}>'
            f'<p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName>'
            f'<p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>')


def _par(ids, preset, cls, sub, node, delay, body, grp=0, repeat=None, dur=None):
    rep = f' repeatCount="{repeat}"' if repeat else ""
    d = f' dur="{dur}"' if dur else ""
    return (f'<p:par><p:cTn id="{ids()}" presetID="{preset}" presetClass="{cls}" presetSubtype="{sub}" fill="hold"'
            f'{rep}{d} grpId="{grp}" nodeType="{node}"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst>'
            f'<p:childTnLst>{body}</p:childTnLst></p:cTn></p:par>')


def effect_pars(ids, e, spid, node):
    """Return (list of effect <p:par> xml, total length in ms) for one spec entry."""
    t, dl, dur = e["effect"], e["delay"], e["dur"]
    if t == "fade":
        b = _set_visible(ids, spid) + _effect(ids, spid, dur, "fade")
        return [_par(ids, 10, "entr", 0, node, dl, b)], dl + dur
    if t == "riseIn":   # Ascend-like: fade + small rise
        b = (_set_visible(ids, spid) + _effect(ids, spid, dur, "fade")
             + _anim_prop(ids, spid, dur, "ppt_x", "#ppt_x", "#ppt_x")
             + _anim_prop(ids, spid, dur, "ppt_y", "#ppt_y+0.04", "#ppt_y", decel=True))
        return [_par(ids, 42, "entr", 0, node, dl, b)], dl + dur
    if t in ("wipeRight", "wipeUp"):
        sub, filt = (8, "wipe(left)") if t == "wipeRight" else (4, "wipe(down)")
        b = _set_visible(ids, spid) + _effect(ids, spid, dur, filt)
        return [_par(ids, 22, "entr", sub, node, dl, b)], dl + dur
    if t == "zoomIn":   # Zoom (subtle): grow from 0 + fade
        b = (_set_visible(ids, spid) + _effect(ids, spid, dur, "fade")
             + _anim_prop(ids, spid, dur, "ppt_w", "0", "#ppt_w", decel=True)
             + _anim_prop(ids, spid, dur, "ppt_h", "0", "#ppt_h", decel=True))
        return [_par(ids, 53, "entr", 16, node, dl, b)], dl + dur
    if t == "drop":     # appear high above, fall with gravity, vanish on impact
        fall = e.get("fall", 0.4)
        b = (_set_visible(ids, spid) + _effect(ids, spid, 120, "fade")
             + _motion(ids, spid, dur, f"M 0 -{fall:.3f} L 0 0 E", accel=True)
             + _set_hidden(ids, spid, dur + 40))
        return [_par(ids, 10, "entr", 0, node, dl, b)], dl + dur + 40
    if t == "ripple":   # splash ring: grow outwards and fade away
        b = (_set_visible(ids, spid) + _scale(ids, spid, dur, 25000, 100000)
             + _effect(ids, spid, int(dur * 0.65), "fade", "out", delay=int(dur * 0.35))
             + _set_hidden(ids, spid, dur))
        return [_par(ids, 10, "entr", 0, node, dl, b)], dl + dur
    if t == "pulse":    # pressure ring: grow + fade, looped
        b = (_set_visible(ids, spid) + _scale(ids, spid, dur, 30000, 100000)
             + _effect(ids, spid, dur, "fade", "out"))
        rep = e.get("repeat")
        return [_par(ids, 10, "entr", 0, node, dl, b, repeat=rep, dur=dur)], dl + dur
    if t == "glint":    # crude pulse moving through a sight glass, looped
        b = _set_visible(ids, spid) + _effect(ids, spid, dur, "wipe(left)")
        return [_par(ids, 22, "entr", 8, node, dl, b, repeat=e.get("repeat"), dur=dur)], dl + dur
    if t == "drip":     # drop forms, falls into the drip pan, disappears; looped with a pause
        fall_ms = 420
        b = (_set_visible(ids, spid) + _effect(ids, spid, 300, "fade")
             + _motion(ids, spid, fall_ms, f"M 0 0 L 0 {e.get('fall', 0.03):.3f} E", accel=True, delay=300)
             + _set_hidden(ids, spid, 300 + fall_ms + 20))
        return [_par(ids, 10, "entr", 0, node, dl, b, repeat=e.get("repeat"), dur=dur)], dl + dur
    if t == "wheel":    # donut: highlighted slice sweeps open
        b = _set_visible(ids, spid) + _effect(ids, spid, dur, "wheel(1)")
        return [_par(ids, 21, "entr", 1, node, dl, b)], dl + dur
    if t == "flyInRight":   # explanation slides in from the right
        b = (_set_visible(ids, spid) + _effect(ids, spid, dur, "fade")
             + _anim_prop(ids, spid, dur, "ppt_x", "#ppt_x+0.12", "#ppt_x", decel=True)
             + _anim_prop(ids, spid, dur, "ppt_y", "#ppt_y", "#ppt_y"))
        return [_par(ids, 10, "entr", 0, node, dl, b)], dl + dur
    if t == "counterStep":  # intermediate counter value: jump from off-slide onto the card, then vanish
        b = (_set_visible(ids, spid) + _motion(ids, spid, 1, f"M 0 0 L {e['dx']:.5f} 0 E")
             + _set_hidden(ids, spid, dur))
        return [_par(ids, 10, "entr", 0, node, dl, b)], dl + dur
    raise ValueError(t)


# ------------------------------------------------------------------ timing tree
def build_timing(anims, name_to_id, kind_of):
    ids = Ids()
    groups, cur = [], None
    for e in anims:
        if e["trig"] == "after" or cur is None:
            cur = []
            groups.append(cur)
        cur.append(e)
    t0, grp_xml, built = 0, [], []
    for g in groups:
        pars, end = [], 0
        for k, e in enumerate(g):
            spid = name_to_id[e["name"]]
            node = "afterEffect" if k == 0 else "withEffect"
            xs, length = effect_pars(ids, e, spid, node)
            pars += xs
            end = max(end, length)
            if spid not in built:
                built.append(spid)
        grp_xml.append(f'<p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="{t0}"/></p:stCondLst>'
                       f'<p:childTnLst>{"".join(pars)}</p:childTnLst></p:cTn></p:par>')
        t0 += end
    click = (f'<p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/>'
             f'<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst>'
             f'<p:childTnLst>{"".join(grp_xml)}</p:childTnLst></p:cTn></p:par>')
    blds = []
    for spid in built:
        if kind_of[spid] == "sp":
            blds.append(f'<p:bldP spid="{spid}" grpId="0" animBg="1"/>')
        elif kind_of[spid] == "graphicFrame":
            blds.append(f'<p:bldGraphic spid="{spid}" grpId="0"><p:bldAsOne/></p:bldGraphic>')
    xml = (f'<p:timing xmlns:p="{NS["p"]}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">'
           f'<p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq">'
           f'<p:childTnLst>{click}</p:childTnLst></p:cTn>'
           f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
           f'<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
           f'</p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>'
           f'{"<p:bldLst>" + "".join(blds) + "</p:bldLst>" if blds else ""}</p:timing>')
    # renumber ids so the root is 1 and the main sequence 2 (Ids started at 3 for inner nodes)
    return etree.fromstring(xml), t0


def transition_xml(kind):
    if kind == "morph":
        return etree.fromstring(
            '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
            f'xmlns:p="{NS["p"]}">'
            '<mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" '
            'xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p159">'
            f'<p:transition spd="slow" p14:dur="{MORPH_MS}"><p159:morph option="byObject"/></p:transition></mc:Choice>'
            '<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>')
    return etree.fromstring(f'<p:transition xmlns:p="{NS["p"]}" spd="slow"><p:fade/></p:transition>')


def process_slide(xml_bytes, sl):
    root = etree.fromstring(xml_bytes)
    name_to_id, kind_of = {}, {}
    for el in root.iter(P + "sp", P + "pic", P + "graphicFrame", P + "cxnSp"):
        nv = el.find(".//p:cNvPr", NS)
        sid = nv.get("id")
        kind_of[sid] = etree.QName(el).localname
        name_to_id[nv.get("name")] = sid
        if el.find(".//p:nvPr/p:ph[@type='title']", NS) is not None:
            name_to_id["@title"] = sid
    missing = [e["name"] for e in sl["anims"] if e["name"] not in name_to_id]
    if missing:
        raise KeyError(f"slide {sl['n']}: no shape named {missing}")
    for old in root.findall("p:timing", NS) + root.findall("p:transition", NS):
        root.remove(old)
    timing, total = build_timing(sl["anims"], name_to_id, kind_of)
    clr = root.find("p:clrMapOvr", NS)
    idx = list(root).index(clr) + 1 if clr is not None else len(root)
    root.insert(idx, transition_xml(sl["transition"]))
    root.insert(idx + 1, timing)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True), total


def main():
    tmp = OUT.with_suffix(".tmp.pptx")
    with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            for sl in SPEC["slides"]:
                if item.filename == f"ppt/slides/slide{sl['n']}.xml":
                    data, total = process_slide(data, sl)
                    print(f"slide {sl['n']}: {len(sl['anims'])} effects, auto sequence ~{total / 1000:.1f} s, "
                          f"transition {sl['transition']}")
            zout.writestr(item, data)
    shutil.move(tmp, OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
