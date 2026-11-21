"""Independent checks on the cleaned tables in work/. Run after prep.py.
Prints PASS/FAIL per check; exits with code 1 if anything fails."""
import sys
import numpy as np
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D, W = ROOT / "Dataset", ROOT / "work"
SENS = ["whp_psia", "whp_downstream_psia", "dh_pressure_psia",
        "dh_temperature_degf", "annulus_pressure_psia", "gas_lift_rate_mscfd"]
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))


# ------------------------------------------------------------ raw files untouched
raw = pd.read_csv(D / "high_freq_data.csv")
check("raw HF file still raw (has sentinels + duplicates)",
      (raw[SENS] == -999.25).sum().sum() == 7418 and raw.duplicated().sum() == 2513)

# ------------------------------------------------------------ minute-level clean data
h = pd.read_parquet(W / "hf_clean.parquet")
check("no duplicate (well, minute)", not h.duplicated(["well_name", "timestamp"]).any())
check("sorted by well then time",
      h.groupby("well_name").timestamp.apply(lambda s: s.is_monotonic_increasing).all())
check("no sentinel or negative values", not (h[SENS] < 0).any().any(),
      f"min={h[SENS].min().min():.1f}")
check("row count = raw - duplicates", len(h) == len(raw) - 2513, f"{len(h)}")
check("every minute has a choke value", h.choke_opening_pct.notna().all())
# tolerance 5 psi = wellhead sensor noise (99.99th pct of minute-to-minute deviation is ~6.5 psi)
check("downstream pressure never above wellhead (beyond sensor noise)",
      not (h.whp_downstream_psia > h.whp_psia + 5).any(),
      f"{int((h.whp_downstream_psia > h.whp_psia).sum())} minute(s) above by <5 psi")

# independent spike re-check with a different (wider) window
left = {}
for c, lim in {"dh_pressure_psia": 30, "whp_psia": 50, "dh_temperature_degf": 2,
               "annulus_pressure_psia": 40, "gas_lift_rate_mscfd": 300,
               "whp_downstream_psia": 30}.items():
    med = h.groupby("well_name")[c].transform(lambda s: s.rolling(31, center=True, min_periods=5).median())
    left[c] = int(((h[c] - med).abs() > lim).sum())
check("no spikes left (31-min window re-check)", sum(left.values()) <= 20, str(left))

ranges = {"dh_pressure_psia": (1500, 4500), "whp_psia": (100, 1000), "dh_temperature_degf": (150, 220),
          "annulus_pressure_psia": (800, 1800), "gas_lift_rate_mscfd": (0, 2000),
          "whp_downstream_psia": (100, 260)}
out = {c: int((~h[c].between(*r) & h[c].notna()).sum()) for c, r in ranges.items()}
check("values inside physical ranges", sum(out.values()) == 0,
      f"outside: {out}; observed min/max: " +
      ", ".join(f"{c}={h[c].min():.0f}..{h[c].max():.0f}" for c in ranges))

nan_share = h[SENS].isna().mean().max()
check("missing share per sensor < 1%", nan_share < 0.01, f"max {nan_share:.4%}")

# ------------------------------------------------------------ shut-ins (critical for PTA)
s = pd.read_csv(W / "shut_ins.csv", parse_dates=["shut_start", "shut_end"])
check("6 shut-ins found, all inside data window", len(s) == 6 and s.inside_hf_window.all())
for _, r in s.iterrows():
    x = h[(h.well_name == r.well_name) & h.timestamp.between(r.shut_start, r.shut_end)]
    pre = h[(h.well_name == r.well_name) & h.timestamp.between(r.shut_start - pd.Timedelta("1h"), r.shut_start)]
    rise = x.dh_pressure_psia.iloc[-30:].mean() - pre.dh_pressure_psia.mean()
    nan_pts = int(x.dh_pressure_psia.isna().sum())
    gl_off = (x.gas_lift_rate_mscfd.iloc[5:] < 50).mean()
    check(f"shut-in {r.well_name} {r.shut_start:%Y-%m-%d}: pressure builds up, curve intact",
          rise > 20 and nan_pts / max(len(x), 1) < 0.01,
          f"{r.duration_hr:.1f} h, build-up +{rise:.0f} psi, missing pts {nan_pts}/{len(x)}, gas-lift off {gl_off:.0%}")

# ------------------------------------------------------------ daily table
d = pd.read_csv(W / "daily.csv", parse_dates=["date"])
wells = sorted(h.well_name.unique())
check("daily: 10 wells x 273 days, unique keys",
      len(d) == 10 * 273 and not d.duplicated(["well_name", "date"]).any(), f"{len(d)} rows")
check("daily: no-data days flagged", d.no_data.sum() == 1 and d.loc[d.no_data, "low_coverage"].all(),
      "; ".join(f"{r.well_name} {r.date:%Y-%m-%d}" for _, r in d[d.no_data].iterrows()))
prod = d[(d.shut_frac < 1) & ~d.no_data]
check("daily: producing days have all features",
      not prod[SENS + ["choke_opening_pct"]].isna().any().any(),
      f"NaN cells {int(prod[SENS].isna().sum().sum())}")
check("daily: fully shut days = 5", int((d.shut_frac == 1).sum()) == 5)
check("daily: shut-in days carry choke 0", (d.loc[d.shut_frac == 1, "choke_opening_pct"] == 0).all())
check("daily: no-data days are not marked as shut", d.loc[d.no_data, "choke_opening_pct"].isna().all())

# ------------------------------------------------------------ VFM outputs (if built)
if (W / "daily_predictions.csv").exists():
    p = pd.read_csv(W / "daily_predictions.csv")
    T = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]
    check("VFM: 2,730 daily rows, no NaN, no negatives",
          len(p) == 2730 and not p[T].isna().any().any() and not (p[T] < 0).any().any())
    check("VFM: fully shut days predict 0", (p.loc[p.shut_frac == 1, T] == 0).all().all())
    x = pd.read_excel(ROOT / "outputs" / "VFM_daily_predictions.xlsx", sheet_name="predictions")
    check("VFM Excel: required columns in required order",
          list(x.columns) == ["date", "well_name", "oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"])
    import joblib
    sys.path.insert(0, str(ROOT / "src"))
    m = joblib.load(W / "vfm_model.joblib")
    check("VFM: saved model loads outside the training script", type(m).__module__ == "vfm")
    import json
    dg = json.loads((W / "vfm_diagnostics.json").read_text())
    check("VFM physics: data-learned IPR strength close to physics (0.7-1.3, physics = 1.0)",
          0.7 <= dg["lambda_learned_from_tests"] <= 1.3, f"lambda = {dg['lambda_learned_from_tests']:.2f}")
    lc = dg["liftcut_oil_change_pct_v2"]
    check("VFM physics: 14-Jun lift-gas outage lowers oil on every well (and by < 30%)",
          all(-30 < v < 0 for v in lc.values()), f"range {min(lc.values()):+.1f} .. {max(lc.values()):+.1f} %")
    check("VFM physics: normal days slightly below test level (back-pressure, 0 to -5%)",
          -5 < dg["normal_days_vs_test_pct_v2"] < 0, f"{dg['normal_days_vs_test_pct_v2']:+.2f} %")
    lowc = p[p.low_coverage & ~p.no_data & (p.shut_frac == 0)]
    ok = True
    for _, rr in lowc.iterrows():
        g = p[(p.well_name == rr.well_name) & ~p.low_coverage & (p.shut_frac == 0)].copy()
        g["dd"] = (pd.to_datetime(g.date) - pd.to_datetime(rr.date)).dt.days.abs()
        near = g.nsmallest(4, "dd").oil_rate_stbd
        ok &= near.min() * 0.85 <= rr.oil_rate_stbd <= near.max() * 1.15
    check("VFM: low-data days blended, within 15% of neighbouring days", ok, f"{len(lowc)} days")
lc = d[d.low_coverage]
check("daily: low-coverage days listed (warning, not error)", True,
      "; ".join(f"{r.well_name} {r.date:%m-%d} ({r.n_valid_minutes} min)" for _, r in lc.iterrows()))

# ------------------------------------------------------------ training table
t = pd.read_csv(W / "train.csv", parse_dates=["test_start"])
check("train: 85 tests, 10 wells", len(t) == 85 and t.well_name.nunique() == 10)
check("train: every test has HF features", not t[SENS + ["choke_opening_pct"]].isna().any().any())
diff = {c: float((t[c] - t[f"sheet_{c}"]).abs().median()) for c in SENS if c != "gas_lift_rate_mscfd"}
check("train: HF features match test-sheet values (median abs diff < 2)",
      max(diff.values()) < 2, ", ".join(f"{k}={v:.2f}" for k, v in diff.items()))
check("train: no test overlaps a shut-in", not t.test_during_shut_in.any())
check("train: repairs as expected (water 1, gas 10, lift sign 2), nothing left bad",
      (t.repaired_water.sum(), t.repaired_gas.sum(), t.repaired_lift_sign.sum()) == (1, 10, 2)
      and (t.bad_oil.sum(), t.bad_water.sum(), t.bad_gas.sum()) == (0, 0, 0))
check("train: after repair, rate columns agree with ratio columns",
      (t.water_rate_stbd - t.liquid_rate_stbd * t.water_cut_pct / 100).abs().max() < 1.5
      and (t.gas_rate_mscfd - t.gor_scf_stb * t.oil_rate_stbd / 1000).abs().max() < 1.5
      and (t.oil_rate_stbd + t.water_rate_stbd - t.liquid_rate_stbd).abs().max() < 1.5)
rep = t[t.repaired_gas]
check("train: repaired gas matches lab solution GOR (within 50%)",
      ((rep.gas_rate_mscfd * 1000 / rep.oil_rate_stbd) / rep.solution_gor_at_pb_scf_stb).between(0.5, 1.5).all())
for y, f in [("oil_rate_stbd", "bad_oil"), ("water_rate_stbd", "bad_water"), ("gas_rate_mscfd", "bad_gas")]:
    good = t.loc[~t[f], y]
    check(f"train: usable {y} labels all > 0", (good > 0).all(), f"{len(good)} usable")
check("train: static well data attached", not t[["net_pay_thickness_ft", "oil_fvf_rb_stb"]].isna().any().any())

# ------------------------------------------------------------ PTA outputs (if built)
if (W / "pta_estimates.csv").exists():
    r = pd.read_csv(W / "pta_estimates.csv", parse_dates=["shut_in_start"])
    pvt = pd.read_csv(D / "reservoir_pvt.csv").set_index("well_name")
    check("PTA: one result per shut-in, all values finite",
          len(r) == len(s) and np.isfinite(r[["horner_slope_psi_cycle", "permeability_md", "skin", "dp_skin_psi"]]).all().all())
    check("PTA: slope and permeability positive", (r.horner_slope_psi_cycle > 0).all() and (r.permeability_md > 0).all())
    # recompute k, skin, dP_skin from the reported inputs with the textbook formulas
    v = pvt.loc[r.well_name].reset_index(drop=True)
    k = 162.6 * r.q_oil_vfm_stbd * v.oil_fvf_rb_stb * v.oil_viscosity_cp / (r.horner_slope_psi_cycle * v.net_pay_thickness_ft)
    sk = 1.1513 * ((r.p1hr_psia - r.pwf_psia) / r.horner_slope_psi_cycle
                   - np.log10(k / (v.porosity_frac * v.oil_viscosity_cp * v.total_compressibility_1_psi * v.wellbore_radius_ft ** 2)) + 3.2275)
    check("PTA: k recomputed from formula matches", np.allclose(k, r.permeability_md, rtol=1e-6))
    check("PTA: skin recomputed from formula matches", np.allclose(sk, r.skin, atol=1e-6))
    check("PTA: dP_skin = 0.869 m S", np.allclose(0.869 * r.horner_slope_psi_cycle * r.skin, r.dp_skin_psi, atol=1e-6))
    dev = (r.m_from_derivative / r.horner_slope_psi_cycle - 1).abs()
    check("PTA: Horner slope agrees with derivative plateau (within 3%)", (dev < 0.03).all(), f"max {dev.max():.2%}")
    check("PTA: radial window inside the build-up", ((r.radial_window_start_hr > 0) & (r.radial_window_end_hr <= r.duration_hr)).all())
    check("PTA: derivative flat in window (CV < 6%)", (r.derivative_flatness_cv < 0.06).all(),
          ", ".join(f"{a} {b:.1%}" for a, b in zip(r.well_name, r.derivative_flatness_cv)))
    check("PTA: single-phase valid (Pwf above bubble point)", (r.pwf_psia > r.bubble_point_psia).all())
    check("PTA: rate used = VFM daily Excel value of the day before shut-in (exact)",
          all(abs(q - p.loc[(p.well_name == w) & (pd.to_datetime(p.date) == pd.Timestamp(qd)), "oil_rate_stbd"].iloc[0]) < 1e-6
              and pd.Timestamp(qd) < t.normalize()
              for w, t, q, qd in zip(r.well_name, r.shut_in_start, r.q_oil_vfm_stbd, r.q_source_date)))
    ks = np.maximum((r.k_md_window_shift_max / r.permeability_md - 1).abs(),
                    (r.k_md_window_shift_min / r.permeability_md - 1).abs())
    kt = (r.k_md_if_tp_since_choke_change / r.permeability_md - 1).abs()
    check("PTA: robust to window shift (k within 5%) and tp choice (k within 3%)",
          (ks < 0.05).all() and (kt < 0.03).all(), f"window max {ks.max():.1%}, tp max {kt.max():.1%}")
    check("PTA: P1hr between Pwf and final pressure", ((r.p1hr_psia > r.pwf_psia) & (r.p1hr_psia < r.p_last_psia + 5)).all())
    xr = pd.read_excel(ROOT / "outputs" / "PTA_results.xlsx", sheet_name="results")
    check("PTA Excel: required columns present",
          {"horner_slope_psi_cycle", "permeability_md", "skin", "dp_skin_psi"} <= set(xr.columns) and len(xr) == len(r))
    plots = list((ROOT / "outputs" / "pta_plots").glob("*.png"))
    check("PTA: one plot per shut-in", len(plots) == len(r))

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
