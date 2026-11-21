"""Automatic pressure-transient (build-up) analysis on every shut-in.

Single-phase oil, field units, rate = VFM-predicted oil rate (README Phase 2).
For each shut-in:
  1. Pwf   = last flowing gauge pressure before the choke closed
  2. q     = VFM oil rate over the last 24 h of production before shut-in
  3. tp    = Horner producing time = 24 * Np / q  (Np = cumulative oil, incl. VFM 2025 volumes)
  4. Bourdet derivative vs Agarwal equivalent time -> radial-flow window = flattest stretch
  5. Horner straight-line fit in that window -> m, P*, P1hr
  6. k, skin, dP_skin (+ flow efficiency, radius of investigation, flow-regime labels)
"""
import sys
import json
import numpy as np
import pandas as pd
import joblib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D, W, OUT = ROOT / "Dataset", ROOT / "work", ROOT / "outputs"
LN10 = np.log(10)

BIN_WIDTH = 0.02          # log10(dt) bin width used to thin minute data (50 points per log cycle)
DERIV_L = 0.1             # Bourdet smoothing window, log cycles
WIN_WIDTHS = [1.5, 1.0, 0.75, 0.5]   # candidate radial-flow window widths, log cycles (widest first)
FLAT_OK = 0.02            # a window counts as "flat" if derivative CV <= 2 % (keeps clear of storage tail)
MIN_POINTS = 12


# ------------------------------------------------------------------ maths
def bourdet(x, p, L=DERIV_L):
    """Bourdet derivative dp/dx with x = ln(time function), smoothing window L log cycles."""
    x = np.asarray(x, float); p = np.asarray(p, float)
    j = np.searchsorted(x, x - L * LN10, side="left")
    k = np.searchsorted(x, x + L * LN10, side="right") - 1
    i = np.arange(len(x))
    ok = (j < i) & (k > i)
    j, k = np.where(ok, j, 0), np.where(ok, k, 0)
    dxl, dxr = x - x[j], x[k] - x
    with np.errstate(divide="ignore", invalid="ignore"):
        d = ((p - p[j]) / dxl * dxr + (p[k] - p) / dxr * dxl) / (dxl + dxr)
    return np.where(ok, d, np.nan)


def log_bin(dt, p):
    """Average minute data into equal log-time bins (equal weight per log cycle)."""
    b = np.floor(np.log10(dt) / BIN_WIDTH)
    g = pd.DataFrame({"b": b, "dt": dt, "p": p}).groupby("b").mean()
    return g.dt.values, g.p.values


def find_radial_window(dt, der, min_dt):
    """Widest window whose derivative is flat (CV <= FLAT_OK); else the flattest 0.5-cycle window."""
    ldt = np.log10(dt)
    ok = np.isfinite(der) & (der > 0) & (dt >= min_dt)
    best_any = None
    for width in WIN_WIDTHS:
        best = None
        for a in np.arange(ldt[ok].min(), ldt[ok].max() - width + 1e-9, 0.025):
            m = ok & (ldt >= a) & (ldt <= a + width)
            if m.sum() < MIN_POINTS:
                continue
            cv = der[m].std() / der[m].mean()
            if best is None or cv < best[0]:
                best = (cv, a, width)
        if best is None:
            continue
        if best[0] <= FLAT_OK:
            return best
        if best_any is None or best[0] < best_any[0]:
            best_any = best
    return best_any


# ------------------------------------------------------------------ data helpers
def load_inputs():
    sys.path.insert(0, str(ROOT / "src"))
    import vfm  # noqa: F401  (needed to unpickle the model)
    return {
        "hf": pd.read_parquet(W / "hf_clean.parquet"),
        "shut": pd.read_csv(W / "shut_ins.csv", parse_dates=["shut_start", "shut_end"]),
        "daily": pd.read_csv(W / "daily_predictions.csv", parse_dates=["date"]),
        "tests": pd.read_csv(W / "train.csv"),
        "pvt": pd.read_csv(D / "reservoir_pvt.csv").set_index("well_name"),
        "comp": pd.read_csv(D / "well_completion.csv").set_index("well_name"),
        "choke": pd.read_csv(D / "choke_events(in).csv").assign(
            timestamp=lambda c: pd.to_datetime(c.timestamp, format="mixed")),
        "model": joblib.load(W / "vfm_model.joblib"),
    }


def vfm_rate_before(inp, well, t0):
    """Oil rate for the analysis = the VFM *daily* prediction (the deliverable Excel) of the last
    full producing day before shut-in, so judges can trace VFM output -> PTA input."""
    d = inp["daily"]
    x = d[(d.well_name == well) & (d.date < t0.normalize()) & (d.shut_frac == 0) & ~d.no_data]
    if x.empty:
        raise NotEligible("no_producing_day",
                          "PTA is unavailable for this event. Include at least one full producing day before the shut-in.")
    row = x.iloc[-1]
    return float(row.oil_rate_stbd), row.date


class NotEligible(ValueError):
    """A shut-in that cannot be analysed; `code` is language-neutral (the app translates it)."""
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


MIN_BUILDUP_POINTS = 20


def check_eligible(inp, ev):
    """Raise NotEligible if this shut-in lacks the input PTA needs (checked before the analysis)."""
    hw = inp["hf"][inp["hf"].well_name == ev.well_name]
    vfm_rate_before(inp, ev.well_name, ev.shut_start)
    if not hw[hw.timestamp <= ev.shut_start].dh_pressure_psia.notna().any():
        raise NotEligible("no_flowing_pressure",
                          "PTA is unavailable for this event. No downhole pressure was recorded before the shut-in.")
    n = int(hw[(hw.timestamp > ev.shut_start) & (hw.timestamp < ev.shut_end)].dh_pressure_psia.notna().sum())
    if n < MIN_BUILDUP_POINTS:
        raise NotEligible("short_buildup",
                          f"PTA is unavailable for this event. Only {n} build-up pressure points were recorded "
                          f"(at least {MIN_BUILDUP_POINTS} are needed).")


def analyse_safe(inp, ev, **kw):
    """analyse() that never raises: returns (res, curves, None) or (None, None, {code, reason})."""
    try:
        check_eligible(inp, ev)
        res, cur = analyse(inp, ev, **kw)
        return res, cur, None
    except NotEligible as e:
        return None, None, {"code": e.code, "reason": str(e)}
    except Exception as e:  # any other failure stays confined to this one event
        return None, None, {"code": "failed", "reason": f"PTA is unavailable for this event: {e}"}


# ------------------------------------------------------------------ pressure-only build-up analysis
def buildup_pressure(hw, t0, t1, tp, window=None):
    """Everything that needs only pressure + producing time: Pwf, derivative, radial window,
    Horner line (m, P*), late-time behaviour. Used by the PTA and by the VFM (drawdown)."""
    flowing = hw[(hw.timestamp <= t0)].dropna(subset=["dh_pressure_psia"])
    pwf = float(flowing.dh_pressure_psia.iloc[-1])
    bu = hw[(hw.timestamp > t0) & (hw.timestamp < t1)].dropna(subset=["dh_pressure_psia"])
    dt_raw = (bu.timestamp - t0).dt.total_seconds().values / 3600
    p_raw = bu.dh_pressure_psia.values
    dt, p = log_bin(dt_raw, p_raw)
    dte = tp * dt / (tp + dt)                       # Agarwal equivalent time
    der = bourdet(np.log(dte), p)
    # end of wellbore storage hump: radial window must start after the derivative peak
    early = np.isfinite(der) & (dt < dt.max() / 3)
    peak_dt = dt[early][np.nanargmax(der[early])] if early.any() else dt.min()
    if window is None:
        _, a, width = find_radial_window(dt, der, min_dt=max(peak_dt, 0.05))
        w0, w1, auto = 10 ** a, 10 ** (a + width), True
    else:
        (w0, w1), auto = window, False
    m_ = (dt >= w0) & (dt <= w1)
    cv = float(np.nanstd(der[m_]) / np.nanmean(der[m_]))
    X = np.log10((tp + dt) / dt)
    slope, icpt = np.polyfit(X[m_], p[m_], 1)
    plateau = np.nanmedian(der[m_])
    late = np.isfinite(der) & (dt > w1)
    late_ratio = float(np.nanmedian(der[late][-10:]) / plateau) if late.sum() >= 5 else 1.0
    regime_late = ("boundary / pressure support" if late_ratio < 0.8 else
                   "boundary / lower mobility" if late_ratio > 1.2 else "still radial flow")
    # time the derivative first leaves the plateau by >20% after the window (boundary signal)
    dev = late & (np.abs(der / plateau - 1) > 0.2)
    t_boundary = float(dt[dev][0]) if regime_late != "still radial flow" and dev.any() else np.nan
    p_star = icpt
    # average reservoir pressure: stabilised final pressure if a boundary was felt, else P*
    p_res = float(p_raw[-1]) if regime_late == "boundary / pressure support" else p_star
    return {"pwf": pwf, "dt_raw": dt_raw, "p_raw": p_raw, "dt": dt, "p": p, "der": der, "X": X,
            "slope": slope, "icpt": icpt, "m": -slope, "p_star": p_star, "p_res": p_res,
            "w0": w0, "w1": w1, "auto": auto, "cv": cv, "plateau": plateau,
            "regime_late": regime_late, "t_boundary": t_boundary}


def reservoir_drawdown(hf, shut, comp):
    """Drawdown (reservoir pressure - flowing pressure) per well from its shut-in(s), pressure only.
    tp = time since first production (P* depends on tp only through a log, so this is enough)."""
    rows = []
    for _, ev in shut.iterrows():
        tp = (ev.shut_start - pd.Timestamp(comp.loc[ev.well_name, "first_production_date"])).total_seconds() / 3600
        b = buildup_pressure(hf[hf.well_name == ev.well_name], ev.shut_start, ev.shut_end, tp)
        rows.append({"well_name": ev.well_name, "p_res_psia": b["p_res"], "pwf_psia": b["pwf"],
                     "drawdown_psi": b["p_res"] - b["pwf"], "late_time": b["regime_late"]})
    return pd.DataFrame(rows).groupby("well_name").mean(numeric_only=True)


def cumulative_oil(inp, well, t0, q):
    """Np at shut-in = cum at 1 Jan 2025 + VFM daily volumes in 2025 up to t0."""
    d = inp["daily"]
    before = d[(d.well_name == well) & (d.date < t0.normalize())].oil_rate_stbd.sum()
    partial = q * (t0 - t0.normalize()).total_seconds() / 86400
    return inp["comp"].loc[well, "cum_oil_at_2025_01_01_stb"] + before + partial


# ------------------------------------------------------------------ core analysis
def interpret(k_md, skin, regime_late, fe, p_last=None, l_bnd=np.nan):
    msgs = []
    if skin > 3:
        msgs.append(f"Damaged well (skin {skin:+.1f}): only {fe:.0%} of the drawdown drives flow; stimulation candidate.")
    elif skin > 0.5:
        msgs.append(f"Mild damage (skin {skin:+.1f}).")
    elif skin < -1:
        msgs.append(f"Stimulated / fractured near the well (skin {skin:+.1f}): flows better than an undamaged well.")
    else:
        msgs.append(f"Near-wellbore condition close to undamaged (skin {skin:+.1f}).")
    msgs.append("High permeability." if k_md > 150 else "Moderate permeability." if k_md > 50 else "Low-moderate permeability.")
    if regime_late == "boundary / pressure support":
        msgs.append("Late-time derivative drops: boundary or pressure support reached"
                    + (f" once the test had investigated about {l_bnd:.0f} ft" if np.isfinite(l_bnd) else "")
                    + " (limited drainage area)"
                    + (f"; average reservoir pressure at gauge is about {p_last:.0f} psia." if p_last else "."))
    elif regime_late == "boundary / lower mobility":
        msgs.append("Late-time derivative rises: sealing boundary or poorer rock away from the well.")
    return " ".join(msgs)


def analyse(inp, ev, window=None, tp_mode="Np/q"):
    """Analyse one shut-in. `window` = (dt_start_h, dt_end_h) overrides the automatic choice."""
    w, t0, t1 = ev.well_name, ev.shut_start, ev.shut_end
    v = inp["pvt"].loc[w]
    hw = inp["hf"][inp["hf"].well_name == w]

    q, q_date = vfm_rate_before(inp, w, t0)
    Np = cumulative_oil(inp, w, t0, q)
    ch = inp["choke"]
    last_change = ch[(ch.well_name == w) & (ch.timestamp < t0)].timestamp.max()
    tp_choke = (t0 - last_change).total_seconds() / 3600
    tp = 24 * Np / q if tp_mode == "Np/q" else tp_choke

    b = buildup_pressure(hw, t0, t1, tp, window)
    pwf, m, p_star, dt = b["pwf"], b["m"], b["p_star"], b["dt"]
    p1hr = b["icpt"] + b["slope"] * np.log10(tp + 1)
    B, mu, hh, phi, ct, rw = (v.oil_fvf_rb_stb, v.oil_viscosity_cp, v.net_pay_thickness_ft,
                              v.porosity_frac, v.total_compressibility_1_psi, v.wellbore_radius_ft)
    k = 162.6 * q * B * mu / (m * hh)
    skin = 1.1513 * ((p1hr - pwf) / m - np.log10(k / (phi * mu * ct * rw ** 2)) + 3.2275)
    dps = 0.869 * m * skin
    fe = (p_star - pwf - dps) / (p_star - pwf)
    r_inv = np.sqrt(k * dt.max() / (948 * phi * mu * ct))
    r_e = np.sqrt(v.estimated_drainage_area_acres * 43560 / np.pi)

    # extra reservoir description
    dp0 = b["p"][0] - pwf
    c_ws = q * B * dt[0] / (24 * dp0) if dp0 > 0 else np.nan          # wellbore storage, bbl/psi (first point)
    # radius of investigation at the moment the boundary is first felt (derivative leaves plateau)
    l_bnd = (np.sqrt(k * b["t_boundary"] / (948 * phi * mu * ct))
             if np.isfinite(b["t_boundary"]) else np.nan)
    api = inp["tests"].loc[inp["tests"].well_name == w, "oil_gravity_api"].mean()
    grad = 0.433 * 141.5 / (131.5 + api)                                 # oil gradient, psi/ft
    to_datum = grad * (v.datum_tvd_ft - inp["comp"].loc[w, "gauge_tvd_ft"])

    res = {
        "well_name": w, "shut_in_start": t0, "shut_in_end": t1,
        "duration_hr": round((t1 - t0).total_seconds() / 3600, 2),
        "horner_slope_psi_cycle": m, "permeability_md": k, "skin": skin, "dp_skin_psi": dps,
        "q_oil_vfm_stbd": q, "q_source_date": q_date.date(), "tp_hr": tp, "tp_mode": tp_mode,
        "pwf_psia": pwf, "p1hr_psia": p1hr, "p_star_gauge_psia": p_star,
        "p_star_datum_psia": p_star + to_datum,
        "avg_reservoir_pressure_datum_psia": b["p_res"] + to_datum,
        "p_last_psia": float(b["p_raw"][-1]), "bubble_point_psia": v.bubble_point_pressure_psia,
        "radial_window_start_hr": b["w0"], "radial_window_end_hr": b["w1"], "window_auto": b["auto"],
        "derivative_flatness_cv": b["cv"], "m_from_derivative": b["plateau"] * LN10,
        "storage_end_hr_approx": b["w0"], "wellbore_storage_bbl_psi": c_ws,
        "late_time_behaviour": b["regime_late"], "boundary_felt_at_radius_ft": l_bnd,
        "flow_efficiency": fe, "radius_investigation_ft": r_inv, "drainage_radius_ft": r_e,
        "quality": "A" if b["cv"] <= 0.03 else "B" if b["cv"] <= 0.06 else "C",
        "tp_since_last_choke_change_hr": tp_choke,
    }
    res["interpretation"] = interpret(k, skin, b["regime_late"], fe, p_last=float(b["p_raw"][-1]), l_bnd=l_bnd)
    curves = {k_: b[k_] for k_ in ("dt_raw", "p_raw", "dt", "p", "der", "X", "slope", "icpt")}
    return res, curves


# ------------------------------------------------------------------ plots
def plot(inp, res, cur, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    w, t0, t1 = res["well_name"], res["shut_in_start"], res["shut_in_end"]
    w0, w1 = res["radial_window_start_hr"], res["radial_window_end_hr"]
    fig, ax = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle(f"{w}  build-up {t0:%Y-%m-%d %H:%M}  ({res['duration_hr']:.1f} h)   quality {res['quality']}", fontsize=13)

    # 1 history
    a = ax[0, 0]
    h = inp["hf"]
    x = h[(h.well_name == w) & h.timestamp.between(t0 - pd.Timedelta(days=5), t1 + pd.Timedelta(days=1))]
    a.plot(x.timestamp, x.dh_pressure_psia, lw=0.8, c="C3", label="downhole pressure")
    a.set_ylabel("pressure, psia", color="C3"); a.axvspan(t0, t1, color="orange", alpha=0.15, label="shut-in")
    b = a.twinx()
    # rate history exactly as the analysis assumes it: VFM daily rates, then constant q, then 0
    d = inp["daily"]
    dd = d[(d.well_name == w) & d.date.between(t0.normalize() - pd.Timedelta(days=5), t0.normalize() - pd.Timedelta(days=1))]
    q = res["q_oil_vfm_stbd"]
    tt = list(dd.date) + [t0.normalize(), t0, t1]
    qq = list(dd.oil_rate_stbd) + [q, 0.0, 0.0]
    b.step(tt, qq, where="post", c="C0", label="VFM oil rate (as used)")
    b.set_ylim(0, max(qq) * 1.25)
    b.set_ylabel("oil rate (VFM), stb/d", color="C0")
    a.set_title("1. Rate and pressure history"); a.tick_params(axis="x", labelsize=8, rotation=20)
    a.legend(loc="lower left", fontsize=8); b.legend(loc="lower right", fontsize=8)

    # 2 log-log
    a = ax[0, 1]
    dp = cur["p"] - res["pwf_psia"]
    a.loglog(cur["dt"], dp, "o", ms=3, c="C0", label="ΔP")
    der = np.where(cur["der"] > 0, cur["der"], np.nan)
    a.loglog(cur["dt"], der, "o", ms=3, c="C3", label="Bourdet derivative")
    a.axvspan(w0, w1, color="green", alpha=0.12, label="radial flow (fit window)")
    a.axhline(res["horner_slope_psi_cycle"] / LN10, c="green", ls="--", lw=1)
    a.set_xlabel("Δt, hours"); a.set_ylabel("ΔP, derivative, psi"); a.grid(True, which="both", alpha=0.3)
    a.set_title(f"2. Log-log diagnostic  (late time: {res['late_time_behaviour']})")
    a.legend(fontsize=8, loc="best", framealpha=0.6)

    # 3 Horner
    a = ax[1, 0]
    X = cur["X"]
    m_ = (cur["dt"] >= w0) & (cur["dt"] <= w1)
    a.plot(X, cur["p"], "o", ms=3, c="grey", label="build-up data")
    a.plot(X[m_], cur["p"][m_], "o", ms=3, c="green", label="radial-flow points")
    xx = np.linspace(0, X.max(), 50)
    a.plot(xx, cur["icpt"] + cur["slope"] * xx, "g--", lw=1.2, label=f"fit: m = {res['horner_slope_psi_cycle']:.1f} psi/cycle")
    x1 = np.log10(res["tp_hr"] + 1)
    a.plot([x1], [res["p1hr_psia"]], "s", c="C1", ms=8, label=f"P1hr = {res['p1hr_psia']:.0f} psia")
    a.plot([0], [res["p_star_gauge_psia"]], "*", c="C3", ms=12, label=f"P* = {res['p_star_gauge_psia']:.0f} psia")
    a.invert_xaxis(); a.set_xlabel("log10[(tp + Δt) / Δt]"); a.set_ylabel("pressure, psia")
    a.grid(True, alpha=0.3); a.set_title("3. Horner plot"); a.legend(fontsize=8)

    # 4 results
    a = ax[1, 1]; a.axis("off")
    lines = [
        ("Horner slope m", f"{res['horner_slope_psi_cycle']:.2f} psi/cycle"),
        ("Permeability k", f"{res['permeability_md']:.1f} mD"),
        ("Skin S", f"{res['skin']:+.2f}"),
        ("ΔP skin", f"{res['dp_skin_psi']:+.1f} psi"),
        ("", ""),
        ("Oil rate q (VFM)", f"{res['q_oil_vfm_stbd']:.0f} stb/d"),
        ("Producing time tp", f"{res['tp_hr']:.0f} h  (Np/q)"),
        ("Pwf at shut-in", f"{res['pwf_psia']:.0f} psia  (Pb {res['bubble_point_psia']:.0f})"),
        ("Radial-flow window", f"{w0:.1f} – {w1:.1f} h  (flatness {res['derivative_flatness_cv']:.1%})"),
        ("Flow efficiency", f"{res['flow_efficiency']:.2f}"),
        ("Radius investigated", f"{res['radius_investigation_ft']:.0f} ft  (drainage ≈ {res['drainage_radius_ft']:.0f} ft)"),
        ("Avg. reservoir pressure", f"{res['avg_reservoir_pressure_datum_psia']:.0f} psia at datum"),
        ("Wellbore storage C", f"≈ {res['wellbore_storage_bbl_psi']:.3f} bbl/psi"),
    ]
    for i, (k_, v_) in enumerate(lines):
        a.text(0.02, 0.95 - i * 0.06, k_, fontsize=11, weight="bold")
        a.text(0.45, 0.95 - i * 0.06, v_, fontsize=11)
    a.text(0.02, 0.95 - len(lines) * 0.06 - 0.03, _wrap(res["interpretation"], 70), fontsize=10, va="top", style="italic")
    a.set_title("4. Results")
    plt.tight_layout()
    fig.savefig(path, dpi=100)
    plt.close(fig)


def _wrap(s, n):
    import textwrap
    return "\n".join(textwrap.wrap(s, n))


# ------------------------------------------------------------------ main
def run_all(inp):
    rows, curves, skipped = [], {}, []
    for _, ev in inp["shut"].iterrows():
        res, cur, err = analyse_safe(inp, ev)
        if err:
            skipped.append({"well_name": ev.well_name, "shut_in_start": ev.shut_start, **err})
            continue
        # sensitivity: other producing-time definition, and window shifted by +-0.1 log cycle
        alt, _ = analyse(inp, ev, tp_mode="since last choke change")
        w0, w1 = res["radial_window_start_hr"], res["radial_window_end_hr"]
        ks = [analyse(inp, ev, window=(w0 * f, w1 * f))[0]["permeability_md"] for f in (10 ** -0.1, 10 ** 0.1)]
        res["k_md_if_tp_since_choke_change"] = alt["permeability_md"]
        res["skin_if_tp_since_choke_change"] = alt["skin"]
        res["k_md_window_shift_min"], res["k_md_window_shift_max"] = min(ks), max(ks)
        rows.append(res)
        curves[(ev.well_name, ev.shut_start)] = cur
    out = pd.DataFrame(rows)
    out.attrs["skipped"] = skipped
    return out, curves


def main():
    inp = load_inputs()
    r, curves = run_all(inp)
    (OUT / "pta_plots").mkdir(parents=True, exist_ok=True)
    for _, res in r.iterrows():
        cur = curves[(res.well_name, res.shut_in_start)]
        plot(inp, res, cur, OUT / "pta_plots" / f"{res.well_name}_{res.shut_in_start:%Y%m%d_%H%M}.png")

    r.to_csv(W / "pta_estimates.csv", index=False)
    write_excel(r, OUT / "PTA_results.xlsx")
    pd.set_option("display.width", 220)
    print(r[["well_name", "shut_in_start", "duration_hr", "horner_slope_psi_cycle", "permeability_md", "skin",
             "dp_skin_psi", "q_oil_vfm_stbd", "radial_window_start_hr", "radial_window_end_hr",
             "derivative_flatness_cv", "m_from_derivative", "quality", "late_time_behaviour"]].round(2).to_string(index=False))
    print("\nsensitivity (k, mD):")
    print(r[["well_name", "permeability_md", "k_md_if_tp_since_choke_change", "k_md_window_shift_min",
             "k_md_window_shift_max"]].round(1).to_string(index=False))


def write_excel(r, path):
    """PTA deliverable. `path` may be a file path or a file-like object (the app writes to memory)."""
    req = r[["well_name", "shut_in_start", "duration_hr", "horner_slope_psi_cycle",
             "permeability_md", "skin", "dp_skin_psi"]].round(3)
    detail = r.drop(columns=["window_auto"]).round(4)
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        req.to_excel(xw, sheet_name="results", index=False)
        detail.to_excel(xw, sheet_name="details", index=False)
        r[["well_name", "shut_in_start", "permeability_md", "k_md_if_tp_since_choke_change",
           "k_md_window_shift_min", "k_md_window_shift_max", "skin", "skin_if_tp_since_choke_change"]
          ].round(3).to_excel(xw, sheet_name="sensitivity", index=False)
        pd.DataFrame({"item": ["rate", "tp", "window", "Pwf", "P1hr", "k", "skin", "dP_skin", "phase"],
                      "method": ["VFM daily oil rate (VFM_daily_predictions.xlsx) of the last full producing day before shut-in",
                                 "Horner producing time 24*Np/q, Np = cum oil 1-Jan-2025 + VFM volumes",
                                 "flattest Bourdet derivative (Agarwal equivalent time), widest window with CV<=2%",
                                 "last flowing downhole gauge pressure before the choke closed",
                                 "read from the Horner straight line at dt = 1 h",
                                 "k = 162.6 q B mu / (m h)",
                                 "S = 1.1513[(P1hr-Pwf)/m - log10(k/(phi mu ct rw^2)) + 3.2275]",
                                 "dP_skin = 0.869 m S",
                                 "single-phase oil valid: Pwf above bubble point in every test"]}
                     ).to_excel(xw, sheet_name="method", index=False)
        pd.DataFrame({"note": ["All results in this workbook use the AUTOMATIC radial-flow window. "
                               "A manual window chosen on screen is not exported.",
                               "Oil rate q = column q_oil_vfm_stbd, taken from the VFM daily prediction "
                               "of the date in column q_source_date."]}
                     ).to_excel(xw, sheet_name="fit", index=False)
        skipped = r.attrs.get("skipped") or []
        if skipped:
            pd.DataFrame(skipped)[["well_name", "shut_in_start", "reason"]].to_excel(
                xw, sheet_name="not_analysed", index=False)


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import pta
    pta.main()
