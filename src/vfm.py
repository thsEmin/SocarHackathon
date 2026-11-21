"""Virtual flow meter: well-test labels + cleaned sensors -> daily oil / water / gas rates.

Final model ("physics-hybrid", v2):
  OIL   log q = well level + well decline trend + slow effects (choke, 15-day median of downhole
              pressure & temperature)  +  IPR term  -(Pwf - Pwf_slow) / drawdown
          * the IPR term is reservoir physics: q ~ (Pres - Pwf), so a short-term rise of Pwf of
            dP lowers the rate by dP / drawdown. Drawdown comes from our own build-up analysis
            (pressure only). When the data are allowed to choose the strength (lambda) freely,
            they choose ~0.9-1.0, i.e. the well tests confirm the physics.
          * learned effects are sign-constrained (more choke -> more oil, etc.)
  WATER = oil x WOR, GAS = oil x GOR; ratios from a fixed-effects regression on the sensors.
          Water and gas therefore inherit the oil physics (IPR, lift-gas response), and the
          fluid mix stays stable during operational upsets.

Why not the first model (v1, unconstrained)? It scored 2.6 % on tests, but it learned
"higher downhole pressure -> more oil" (true over months because of depletion, wrong within a
day). In the 14-Jun-2025 field-wide lift-gas outage it predicted oil going UP by 10-68 %.
"""
import json
import pickle
import sys
import warnings
import numpy as np
import pandas as pd
import joblib
from pathlib import Path
from scipy.optimize import lsq_linear
from sklearn.linear_model import RidgeCV

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
D, W, OUT = ROOT / "Dataset", ROOT / "work", ROOT / "outputs"
T0 = pd.Timestamp("2025-01-01")

TARGETS = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]
# whp_downstream_psia is deliberately NOT used: during a well test the flow goes to the test
# separator, so downstream pressure is ~20-28 psi lower than on normal days (8.7 within-well
# std away on 99% of days). A model using it is trained on "test mode" and breaks on normal days.
SENSORS = ["whp_psia", "dh_pressure_psia", "dh_temperature_degf",
           "annulus_pressure_psia", "gas_lift_rate_mscfd", "choke_opening_pct"]
SLOW_WIN = 15                      # days, centred rolling median = "reservoir state"
SLOW = ["dh_pressure_psia", "dh_temperature_degf"]
OIL_FEATS = ["choke_opening_pct", "dh_pressure_psia_slow", "dh_temperature_degf_slow"]
OIL_SIGNS = {f: +1 for f in OIL_FEATS}
# Clipping ratio-model inputs was tested (z = 3, 5) and rejected: correlated sensors offset each
# other, and clipping some of them broke that balance (worse accuracy AND water rising +8.5 % in
# the lift-gas outage). Unclipped, WOR/GOR stay stable during the outage (water follows oil).
RATIO_ZCLIP = None
ALPHAS = np.logspace(-3, 3, 25)
LIFT_CUT = ("2025-06-14 06:00", "2025-06-14 20:00")   # field-wide lift-gas outage 10:00-15:00


def add_time(df, col):
    df = df.copy()
    df["days"] = (pd.to_datetime(df[col]) - T0).dt.total_seconds() / 86400
    return df


# ------------------------------------------------------------------ physics features
def slow_table(daily):
    """15-day centred median of producing-day sensor means, per well (reservoir state)."""
    d = daily.sort_values(["well_name", "date"])
    st = d[["well_name", "date"]].copy()
    for s in SLOW:
        x = d[s].where((d.shut_frac == 0) & ~d.no_data)
        st[f"{s}_slow"] = x.groupby(d.well_name).transform(
            lambda v: v.rolling(SLOW_WIN, center=True, min_periods=3).median())
    cols = [f"{s}_slow" for s in SLOW]
    st[cols] = st.groupby("well_name")[cols].transform(lambda v: v.interpolate(limit_direction="both"))
    return st


def drawdown_map(hf, shut, comp):
    """Drawdown per well from our own build-up analysis (pressure only); median for wells without one."""
    sys.path.insert(0, str(ROOT / "src"))
    from pta import reservoir_drawdown
    dd = reservoir_drawdown(hf, shut, comp)
    wells = sorted(hf.well_name.unique())
    out = pd.DataFrame(index=wells)
    out["drawdown_psi"] = dd.drawdown_psi.reindex(wells)
    out["source"] = np.where(out.drawdown_psi.notna(), "own shut-in", "median of shut-in wells")
    out["drawdown_psi"] = out.drawdown_psi.fillna(dd.drawdown_psi.median())
    return out


def build_features(df, datecol, slow, dd):
    df = df.copy()
    df["_date"] = pd.to_datetime(df[datecol]).dt.floor("D")
    df = df.merge(slow.rename(columns={"date": "_date"}), on=["well_name", "_date"], how="left")
    df["dh_pressure_psia_fast"] = df.dh_pressure_psia - df.dh_pressure_psia_slow
    df["ipr"] = -df.dh_pressure_psia_fast / df.well_name.map(dd.drawdown_psi)   # = d ln(q) by IPR
    return df.drop(columns="_date")


# ------------------------------------------------------------------ models
class FixedEffectsVFM:
    """log(y) = a_w + b_w * (days - mean_w) + sum_k c_k * z_k  (z = per-well standardised sensors).
    zclip: clip z to +-zclip at prediction time (protects against wild extrapolation)."""

    def __init__(self, sensors=SENSORS, per_well_trend=True, use_sensors=True, zclip=None):
        self.sensors = sensors if use_sensors else []
        self.per_well_trend = per_well_trend
        self.zclip = zclip

    def _design(self, df, clip=False):
        X = []
        for s in self.sensors:
            z = (df[s].values - df.well_name.map(self.mu_[s]).values) / self.sd_[s]
            X.append(np.clip(z, -self.zclip, self.zclip) if (clip and self.zclip) else z)
        dc = (df.days.values - df.well_name.map(self.mu_["days"]).values) / self.sd_["days"]
        if self.per_well_trend:
            for w in self.wells_:
                X.append(np.where(df.well_name.values == w, dc, 0.0))
        else:
            X.append(dc)
        return np.column_stack(X)

    def fit(self, df, y):
        self.wells_ = sorted(df.well_name.unique())
        cols = self.sensors + ["days"]
        self.mu_ = {c: df.groupby("well_name")[c].mean() for c in cols}
        self.sd_ = {c: (df[c] - df.well_name.map(self.mu_[c])).std() + 1e-9 for c in cols}
        ly = np.log(y.values)
        self.a_ = pd.Series(ly).groupby(df.well_name.values).mean()
        r = ly - df.well_name.map(self.a_).values
        self.m_ = RidgeCV(alphas=ALPHAS, fit_intercept=False).fit(self._design(df), r)
        return self

    def predict(self, df):
        unknown = set(df.well_name) - set(self.wells_)
        if unknown:
            raise ValueError(f"model was not trained on wells {sorted(unknown)}")
        return np.exp(df.well_name.map(self.a_).values + self.m_.predict(self._design(df, clip=True)))


class HybridOilVFM:
    """log q = a_w + per-well trend + sign-constrained learned effects + lam * IPR term.
    lam=None -> lam is learned from the data (diagnostic); lam=1 -> pure IPR physics."""

    # alpha 0.3 -> 0.03: validated on leave-one-test-out and on hiding each well's last 2-4 tests
    # (oil forward error 3.35 -> 2.84 %); the 14-Jun lift-gas outage response did not change.
    def __init__(self, feats=OIL_FEATS, signs=OIL_SIGNS, lam=1.0, alpha=0.03):
        self.feats, self.signs, self.lam, self.alpha = feats, signs, lam, alpha

    def _X(self, df):
        X = [(df[f].values - df.well_name.map(self.mu[f]).values) / self.sd[f] for f in self.feats]
        dc = (df.days.values - df.well_name.map(self.mu["days"]).values) / self.sd["days"]
        X += [np.where(df.well_name.values == w, dc, 0.0) for w in self.wells]
        if self.lam is None:
            X.append(df.ipr.values - df.well_name.map(self.mu["ipr"]).values)
        return np.column_stack(X)

    def fit(self, df, y):
        self.wells = sorted(df.well_name.unique())
        cols = self.feats + ["days", "ipr"]
        self.mu = {c: df.groupby("well_name")[c].mean() for c in cols}
        self.sd = {c: (df[c] - df.well_name.map(self.mu[c])).std() + 1e-9 for c in cols}
        ly = np.log(y.values)
        if self.lam is not None:                       # known physics moved to the left-hand side
            ly = ly - self.lam * (df.ipr.values - df.well_name.map(self.mu["ipr"]).values)
        self.a = pd.Series(ly).groupby(df.well_name.values).mean()
        r = ly - df.well_name.map(self.a).values
        X = self._X(df)
        n = X.shape[1]
        lb, ub = np.full(n, -np.inf), np.full(n, np.inf)
        for i, f in enumerate(self.feats):
            if self.signs.get(f, 0) > 0: lb[i] = 0
            if self.signs.get(f, 0) < 0: ub[i] = 0
        pen = np.sqrt(self.alpha) * np.eye(n)
        if self.lam is None:
            lb[-1], pen[-1, -1] = 0, 0                 # physics strength: >= 0, not shrunk
        self.coef = lsq_linear(np.vstack([X, pen]), np.concatenate([r, np.zeros(n)]), bounds=(lb, ub)).x
        return self

    def predict(self, df):
        unknown = set(df.well_name) - set(self.wells)
        if unknown:
            raise ValueError(f"model was not trained on wells {sorted(unknown)}")
        out = df.well_name.map(self.a).values + self._X(df) @ self.coef
        if self.lam is not None:
            out = out + self.lam * (df.ipr.values - df.well_name.map(self.mu["ipr"]).values)
        return np.exp(out)

    @property
    def lam_hat(self):
        return self.lam if self.lam is not None else float(self.coef[-1])


class RatioVFM:
    """Final model. oil: HybridOilVFM; water = oil x WOR; gas = oil x GOR (clipped FixedEffectsVFM).
    Carries the drawdown table and slow-window settings so it can prepare any new data."""

    def fit(self, t, dd):
        self.dd = dd
        self.oil = HybridOilVFM().fit(t, t.oil_rate_stbd)
        self.wor = FixedEffectsVFM(zclip=RATIO_ZCLIP).fit(t, t.water_rate_stbd / t.oil_rate_stbd)
        self.gor = FixedEffectsVFM(zclip=RATIO_ZCLIP).fit(t, t.gas_rate_mscfd / t.oil_rate_stbd)
        return self

    def prepare(self, df, datecol, daily):
        """Add time + physics features to any table of well/time rows (needs the daily table)."""
        return build_features(add_time(df, datecol), datecol, slow_table(daily), self.dd)

    def predict(self, df):
        oil = self.oil.predict(df)
        return {"oil_rate_stbd": oil,
                "water_rate_stbd": oil * self.wor.predict(df),
                "gas_rate_mscfd": oil * self.gor.predict(df)}


# ------------------------------------------------------------------ baselines and candidates
def well_mean(tr, te, y):
    return te.well_name.map(tr.groupby("well_name")[y].mean()).values


def time_interp(tr, te, y):
    """Straight line between the neighbouring tests of the same well (flat beyond the ends)."""
    out = []
    for _, r in te.iterrows():
        g = tr[tr.well_name == r.well_name].sort_values("days")
        out.append(np.interp(r.days, g.days, g[y]))
    return np.array(out)


def v1_model(tr, te, y):
    """First model (kept for comparison): unconstrained fixed effects, oil x WOR / GOR."""
    oil = FixedEffectsVFM().fit(tr, tr.oil_rate_stbd).predict(te)
    if y == "oil_rate_stbd":
        return oil
    return oil * FixedEffectsVFM().fit(tr, tr[y] / tr.oil_rate_stbd).predict(te)


def v2_model(tr, te, y, lam=1.0):
    oil = HybridOilVFM(lam=lam).fit(tr, tr.oil_rate_stbd).predict(te)
    if y == "oil_rate_stbd":
        return oil
    return oil * FixedEffectsVFM(zclip=RATIO_ZCLIP).fit(tr, tr[y] / tr.oil_rate_stbd).predict(te)


def candidates():
    return {
        "dummy: well average": well_mean,
        "dummy: line between tests": time_interp,
        "trend only (no sensors)": lambda tr, te, y: FixedEffectsVFM(use_sensors=False).fit(tr, tr[y]).predict(te),
        "v1: unconstrained ML (first model)": v1_model,
        "v2: physics-hybrid (FINAL)": v2_model,
    }


# ------------------------------------------------------------------ validation
def splits(t):
    """A) leave-one-test-out: the daily job is filling days *between* tests.
       B) forward: hide each well's last 2 tests, train on the earlier ones (harder, extrapolation)."""
    loto = [(t.index != i, t.index == i) for i in t.index]
    rk = t.groupby("well_name").days.rank(ascending=False)
    return {"A: leave-one-test-out": loto, "B: forward (last 2 tests)": [(rk > 2, rk <= 2)]}


def evaluate(t):
    rows = []
    for sname, folds in splits(t).items():
        for mname, fn in candidates().items():
            for y in TARGETS:
                yt, yp = [], []
                for tr_m, te_m in folds:
                    yp.append(fn(t[tr_m], t[te_m], y))
                    yt.append(t[te_m][y].values)
                yt, yp = np.concatenate(yt), np.concatenate(yp)
                rows.append({"split": sname, "model": mname, "target": y, "n": len(yt),
                             "MAPE_%": np.mean(np.abs(yp - yt) / yt) * 100,
                             "MAE": np.mean(np.abs(yp - yt)),
                             "R2": 1 - np.sum((yt - yp) ** 2) / np.sum((yt - yt.mean()) ** 2)})
    return pd.DataFrame(rows)


def physics_diagnostics(t, hf, daily, dd, final):
    """1) lambda learned freely  2) response to the 14-Jun lift-gas outage  3) normal days vs tests."""
    out = {"lambda_learned_from_tests": HybridOilVFM(lam=None).fit(t, t.oil_rate_stbd).lam_hat}
    ev = hf[hf.timestamp.between(*LIFT_CUT)]
    blk = ev.set_index("timestamp").groupby("well_name").resample("2h")[SENSORS].mean().reset_index()
    blk = build_features(add_time(blk, "timestamp"), "timestamp", slow_table(daily), dd)
    v1 = FixedEffectsVFM().fit(t, t.oil_rate_stbd)
    for name, m in [("v1", v1), ("v2", final.oil)]:
        b = blk.assign(p=m.predict(blk))
        base = b[b.timestamp.dt.hour < 10].groupby("well_name").p.mean()
        dip = b[b.timestamp.dt.hour.isin([10, 12])].groupby("well_name").p.mean()
        chg = (dip / base - 1) * 100
        out[f"liftcut_oil_change_pct_{name}"] = chg.round(1).to_dict()
    dd_ = build_features(add_time(daily, "date"), "date", slow_table(daily), dd)
    dd_["days"] += 0.5
    dd_ = dd_[(dd_.shut_frac == 0) & ~dd_.no_data]
    for name, m in [("v1", v1), ("v2", final.oil)]:
        offs = []
        for _, r in t.iterrows():
            nb = dd_[(dd_.well_name == r.well_name) & ((dd_.days - r.days).abs() <= 3) & ((dd_.days - r.days).abs() >= 1)]
            if len(nb):
                offs.append(np.median(m.predict(nb)) / r.oil_rate_stbd - 1)
        out[f"normal_days_vs_test_pct_{name}"] = float(np.median(offs) * 100)
    return out


# ------------------------------------------------------------------ daily prediction
FULL_COVERAGE_MIN = 720


def predict_daily(model, d):
    """Daily rates. Shut-in hours produce nothing; days with no data are interpolated; days with
    little data (< 12 h) are blended with neighbouring days in proportion to their data coverage."""
    x = model.prepare(d, "date", d)
    x["days"] += 0.5  # middle of the day
    prod = (x.shut_frac < 1) & ~x.no_data
    out = x[["date", "well_name", "shut_frac", "no_data", "low_coverage", "n_valid_minutes"]].copy()
    preds = model.predict(x[prod])
    for y in TARGETS:
        p = np.full(len(x), np.nan)
        p[prod.values] = preds[y]
        out[y] = p
        # neighbour estimate from well-covered producing days of the same well
        good = out[y].where(~out.low_coverage & (out.shut_frac == 0))
        nb = good.groupby(out.well_name).transform(lambda s: s.interpolate(limit_direction="both"))
        wgt = (out.n_valid_minutes / FULL_COVERAGE_MIN).clip(0, 1)
        blend = out.low_coverage & ~out.no_data & (out.shut_frac == 0)
        out.loc[blend, y] = wgt[blend] * out.loc[blend, y] + (1 - wgt[blend]) * nb[blend]
        out[y] = out[y] * (1 - out.shut_frac.fillna(0))  # partly shut days produce for part of the day
        out.loc[out.shut_frac == 1, y] = 0.0
        out[y] = out.groupby("well_name")[y].transform(lambda s: s.interpolate(limit_direction="both"))
    out["filled_no_data"] = out.no_data
    return out


def neighbour_offset(model, t, d, window=3):
    """Predicted rate on normal days next to each test vs the measured test rate (median, %)."""
    x = model.prepare(d, "date", d)
    x["days"] += 0.5
    x = x[(x.shut_frac == 0) & ~x.no_data]
    rows = []
    for _, r in t.iterrows():
        nb = x[(x.well_name == r.well_name) & ((x.days - r.days).abs() <= window) & ((x.days - r.days).abs() >= 1)]
        if len(nb):
            p = model.predict(nb)
            rows.append({y: np.median(p[y]) / r[y] - 1 for y in TARGETS})
    return pd.DataFrame(rows)


# ------------------------------------------------------------------ main
def load_training(daily, dd):
    t = pd.read_csv(W / "train.csv")
    t["test_mid"] = pd.to_datetime(t.test_start) + (pd.to_datetime(t.test_end) - pd.to_datetime(t.test_start)) / 2
    return build_features(add_time(t, "test_mid"), "test_mid", slow_table(daily), dd).reset_index(drop=True)


def main():
    hf = pd.read_parquet(W / "hf_clean.parquet")
    shut = pd.read_csv(W / "shut_ins.csv", parse_dates=["shut_start", "shut_end"])
    comp = pd.read_csv(D / "well_completion.csv").set_index("well_name")
    d = pd.read_csv(W / "daily.csv", parse_dates=["date"])

    dd = drawdown_map(hf, shut, comp)
    dd.to_csv(W / "drawdown.csv")
    print("drawdown per well (psi):", dd.drawdown_psi.round(0).to_dict())
    t = load_training(d, dd)

    r = evaluate(t)
    r.to_csv(W / "vfm_validation.csv", index=False)
    piv = r.pivot_table(index=["split", "model"], columns="target", values="MAPE_%", sort=False).round(2)
    piv["mean"] = piv.mean(axis=1).round(2)
    pd.set_option("display.width", 200)
    print("MAPE % (lower is better)\n", piv.to_string())

    model = RatioVFM().fit(t, dd)
    joblib.dump(model, W / "vfm_model.joblib")
    OUT.mkdir(exist_ok=True)
    with open(OUT / "vfm_model.pkl", "wb") as f:   # deliverable: model in .pkl format
        pickle.dump(model, f)
    diag = physics_diagnostics(t, hf, d, dd, model)
    diag["oil_coefficients_per_std"] = dict(zip(model.oil.feats, np.round(model.oil.coef[:len(model.oil.feats)], 4)))
    (W / "vfm_diagnostics.json").write_text(json.dumps(diag, indent=2, default=float))
    print("\nphysics diagnostics:", json.dumps(diag, indent=1, default=float))

    off = neighbour_offset(model, t, d)
    print("\nnormal days next to a test vs measured test rate (median offset, %):",
          (off.median() * 100).round(1).to_dict())
    p = predict_daily(model, d)
    p.to_csv(W / "daily_predictions.csv", index=False)
    print("\ndaily predictions:", p.shape, "NaN cells:", int(p[TARGETS].isna().sum().sum()))
    export_excel(p, piv, diag, dd)


def export_excel(p, piv, diag, dd, path=None):
    """Deliverable: sheet 1 has exactly the columns the README asks for.
    `path` may be a file path or a file-like object (the app writes to memory)."""
    OUT.mkdir(exist_ok=True)
    path = OUT / "VFM_daily_predictions.xlsx" if path is None else path
    main_sheet = p[["date", "well_name"] + TARGETS].copy()
    main_sheet["date"] = main_sheet.date.dt.date
    main_sheet[TARGETS] = main_sheet[TARGETS].round(1)
    flags = p[["date", "well_name", "shut_frac", "no_data", "low_coverage", "n_valid_minutes"]].copy()
    flags["date"] = flags.date.dt.date
    flags = flags[(flags.shut_frac > 0) | flags.no_data | flags.low_coverage]
    flags["note"] = np.select(
        [flags.shut_frac == 1, flags.shut_frac > 0, flags.no_data],
        ["well shut in all day: rate 0", "shut in part of the day: rate scaled by hours open",
         "no sensor data: filled from neighbouring days"],
        "less than 12 h of sensor data: blended with neighbouring days by data coverage")
    diag_rows = [("lambda learned from tests (physics says 1.0)", round(diag["lambda_learned_from_tests"], 3)),
                 ("normal days vs tests, v1 (%)", round(diag["normal_days_vs_test_pct_v1"], 2)),
                 ("normal days vs tests, v2 FINAL (%)", round(diag["normal_days_vs_test_pct_v2"], 2))]
    for w in sorted(diag["liftcut_oil_change_pct_v2"]):
        diag_rows.append((f"14-Jun lift-gas outage, oil change {w}: v1 / v2 FINAL (%)",
                          f"{diag['liftcut_oil_change_pct_v1'][w]:+.1f} / {diag['liftcut_oil_change_pct_v2'][w]:+.1f}"))
    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        main_sheet.to_excel(xw, sheet_name="predictions", index=False)
        flags.round(3).to_excel(xw, sheet_name="day_flags", index=False)
        piv.reset_index().to_excel(xw, sheet_name="validation_MAPE_pct", index=False)
        pd.DataFrame(diag_rows, columns=["physics check", "value"]).to_excel(xw, sheet_name="physics_checks", index=False)
        dd.round(1).to_excel(xw, sheet_name="drawdown_used")
    if not hasattr(path, "write"):
        print("wrote", path)


if __name__ == "__main__":
    # Run through the importable module (not __main__), so the saved model refers to
    # vfm.RatioVFM and can be loaded by other programs such as the app.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import vfm
    vfm.main()
