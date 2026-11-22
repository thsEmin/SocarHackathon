"""Data preparation: raw CSVs in Dataset/  ->  clean tables in work/.

Raw files are never modified. Steps:
  1. high-frequency data: drop duplicate rows, sort, -999.25 -> NaN, remove spikes (Hampel filter)
  2. attach choke opening to every minute (step function from choke events) and mark shut-in minutes
  3. daily table: sensor means over *producing* minutes, shut-in fraction, data-coverage flag
  4. test table: sensor means over each well-test window + label-quality flags + static well data
"""
import numpy as np
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "Dataset"
OUT = ROOT / "work"

SENTINEL = -999.25
SENS = ["whp_psia", "whp_downstream_psia", "dh_pressure_psia",
        "dh_temperature_degf", "annulus_pressure_psia", "gas_lift_rate_mscfd"]

# Hampel filter: a reading is a spike if it is further than this from the centred
# 11-minute rolling median. Normal noise (99.99th pct) is 1.5 psi for downhole pressure,
# 6.5 psi wellhead, 0.08 degF, 48 mscfd gas lift, so these limits are >=6x normal noise.
# A centred median follows real steps and smooth build-ups, so shut-ins are kept.
SPIKE_WINDOW = 11
SPIKE_LIMIT = {"whp_psia": 50, "whp_downstream_psia": 30, "dh_pressure_psia": 30,
               "dh_temperature_degf": 2, "annulus_pressure_psia": 40, "gas_lift_rate_mscfd": 300}

MIN_COVERAGE_MIN = 720          # a day needs >= 12 h of valid readings to be trusted
TEST_LABELS = ["oil_rate_stbd", "water_rate_stbd", "gas_rate_mscfd"]


# ---------------------------------------------------------------- loading
def raw_hf_path():
    """The raw sensor file: Dataset/high_freq_data.csv if it was unzipped, otherwise the zipped
    copy kept in git (Dataset/high_freq_data.zip, 60 MB instead of 269 MB; pandas reads it directly)."""
    p = D / "high_freq_data.csv"
    return p if p.exists() else D / "high_freq_data.zip"


def load_choke(path=D / "choke_events(in).csv"):
    c = pd.read_csv(path)
    c["timestamp"] = pd.to_datetime(c.timestamp, format="mixed")
    return c.drop_duplicates().sort_values(["well_name", "timestamp"]).reset_index(drop=True)


def load_static():
    comp = pd.read_csv(D / "well_completion.csv")
    pvt = pd.read_csv(D / "reservoir_pvt.csv")
    return comp.merge(pvt, on="well_name", validate="one_to_one")


# ---------------------------------------------------------------- cleaning
def despike(h):
    """Replace isolated spikes with NaN; returns cleaned frame and spike counts."""
    counts = {}
    for c in SENS:
        med = h.groupby("well_name")[c].transform(
            lambda s: s.rolling(SPIKE_WINDOW, center=True, min_periods=3).median())
        bad = (h[c] - med).abs() > SPIKE_LIMIT[c]
        counts[c] = int(bad.sum())
        h.loc[bad, c] = np.nan
    return h, counts


def clean_hf(h):
    """Full minute-level cleaning. Works on any upload with the same columns."""
    log = {"rows_raw": len(h)}
    h = h.copy()
    h["timestamp"] = pd.to_datetime(h.timestamp, format="mixed")
    h = h.drop_duplicates()
    log["exact_duplicates_dropped"] = log["rows_raw"] - len(h)
    # same well+minute with different values: keep the mean of the readings
    n = len(h)
    h = h.groupby(["well_name", "timestamp"], as_index=False)[SENS].mean()
    log["conflicting_duplicates_merged"] = n - len(h)
    h = h.sort_values(["well_name", "timestamp"]).reset_index(drop=True)
    log["sentinels_to_nan"] = int((h[SENS] == SENTINEL).sum().sum())
    h[SENS] = h[SENS].mask(h[SENS] <= -900)
    h, log["spikes_removed"] = despike(h)
    return h, log


def attach_choke(h, c):
    """Choke opening in force at each minute + shut-in flag."""
    h = pd.merge_asof(h.sort_values("timestamp"),
                      c.rename(columns={"timestamp": "choke_ts"}).sort_values("choke_ts"),
                      left_on="timestamp", right_on="choke_ts", by="well_name",
                      direction="backward").drop(columns="choke_ts")
    h["shut_in"] = h.choke_opening_pct == 0
    return h.sort_values(["well_name", "timestamp"]).reset_index(drop=True)


# ---------------------------------------------------------------- tables
def _agg(x):
    """Sensor means over producing minutes of a block of minutes."""
    prod = x[~x.shut_in]
    out = prod[SENS].mean()
    out["choke_opening_pct"] = prod.choke_opening_pct.mean()
    out["n_minutes"] = len(x)
    out["n_valid_minutes"] = int(x.dh_pressure_psia.notna().sum())
    out["shut_frac"] = x.shut_in.mean()
    return out


def add_derived(df):
    df["whp_dp"] = df.whp_psia - df.whp_downstream_psia          # pressure drop across choke
    df["lift_dp"] = df.dh_pressure_psia - df.whp_psia            # gauge-to-surface drawdown
    df["annulus_minus_whp"] = df.annulus_pressure_psia - df.whp_psia
    return df


def daily_table(h):
    h = h.assign(date=h.timestamp.dt.floor("D"))
    g = h.groupby(["well_name", "date"])
    # sensor + choke means over producing minutes only (shut-in minutes masked out)
    cols = SENS + ["choke_opening_pct"]
    d = h[cols].mask(h.shut_in, axis=0).groupby([h.well_name, h.date]).mean()
    d["n_minutes"] = g.size()
    d["n_valid_minutes"] = g.dh_pressure_psia.count()
    d["shut_frac"] = g.shut_in.mean()
    # keep every calendar day per well, even days with no readings at all (outages)
    days = pd.date_range(h.date.min(), h.date.max(), freq="D")
    full = pd.MultiIndex.from_product([sorted(h.well_name.unique()), days], names=["well_name", "date"])
    d = d.reindex(full)
    d["no_data"] = d.n_minutes.isna()
    d[["n_minutes", "n_valid_minutes"]] = d[["n_minutes", "n_valid_minutes"]].fillna(0).astype(int)
    d = d.reset_index()
    # fully shut days -> choke 0; days with no data keep NaN (unknown, not "shut")
    d["choke_opening_pct"] = d.choke_opening_pct.where(~(d.shut_frac == 1), 0)
    d["low_coverage"] = d.n_valid_minutes < MIN_COVERAGE_MIN
    return add_derived(d)


TEST_REQUIRED = ["well_name", "test_start", "test_end"] + TEST_LABELS
# columns repair_labels needs; an uploaded test sheet without them is used as it is (no repair)
REPAIR_COLS = ["liquid_rate_stbd", "water_cut_pct", "gor_scf_stb", "glr_scf_stb", "gas_lift_rate_mscfd"]


def test_table(h, static, t=None):
    """t: a well-test table (e.g. uploaded); default reads Dataset/well_tests.csv."""
    if t is None:
        t = pd.read_csv(D / "well_tests.csv")
    t = t.copy()
    for c in ("test_start", "test_end"):
        t[c] = pd.to_datetime(t[c], format="mixed")
    t = t.drop_duplicates().sort_values(["well_name", "test_start"]).reset_index(drop=True)
    can_repair = set(REPAIR_COLS) <= set(t.columns)
    # keep the test-sheet sensor values for reference, but features come from cleaned HF data
    t = t.rename(columns={c: f"sheet_{c}" for c in SENS})
    feats = []
    for _, r in t.iterrows():
        x = h[(h.well_name == r.well_name) & (h.timestamp >= r.test_start) & (h.timestamp < r.test_end)]
        feats.append(_agg(x))
    t = pd.concat([t, pd.DataFrame(feats, index=t.index)], axis=1)
    t["date"] = t.test_start.dt.floor("D")
    t = add_derived(t)

    if can_repair:
        t = repair_labels(t)
    else:
        for c in TEST_LABELS:
            t[f"bad_{c.split('_')[0]}"] = ~(t[c] > 0) if c == "oil_rate_stbd" else ~(t[c] >= 0)
    t["test_during_shut_in"] = t.shut_frac > 0
    return t.merge(static, on="well_name", how="left", validate="many_to_one")


def repair_labels(t):
    """Each test row stores the same facts several times (rates, ratios, totals).
    Where the rate column disagrees with the ratio columns, rebuild it from the ratios,
    but only if an independent column (GLR) confirms the rebuilt value.
    Anything that cannot be confirmed is flagged bad (True = do not train on it)."""
    t = t.copy()
    for c in TEST_LABELS:
        t[f"raw_{c}"] = t[c]
    water_from_wc = t.liquid_rate_stbd * t.water_cut_pct / 100
    gas_from_gor = t.gor_scf_stb * t.oil_rate_stbd / 1000
    lift = t.sheet_gas_lift_rate_mscfd.abs()
    # GLR = (formation gas + lift gas) / liquid -> independent check of the rebuilt gas
    glr_ok = ((gas_from_gor + lift) * 1000 / t.liquid_rate_stbd - t.glr_scf_stb).abs() <= 0.02 * t.glr_scf_stb
    liq_ok = (t.oil_rate_stbd + water_from_wc - t.liquid_rate_stbd).abs() <= 1

    w_off = (t.water_rate_stbd - water_from_wc).abs() > 1
    g_off = (t.gas_rate_mscfd - gas_from_gor).abs() > 1
    t.loc[w_off & liq_ok, "water_rate_stbd"] = water_from_wc
    t.loc[g_off & glr_ok, "gas_rate_mscfd"] = gas_from_gor
    t["repaired_water"] = w_off & liq_ok
    t["repaired_gas"] = g_off & glr_ok
    t["repaired_lift_sign"] = t.sheet_gas_lift_rate_mscfd < 0
    t["sheet_gas_lift_rate_mscfd"] = lift

    t["bad_oil"] = t.oil_rate_stbd <= 0
    t["bad_water"] = (t.water_rate_stbd < 0) | (w_off & ~liq_ok)
    t["bad_gas"] = (t.gas_rate_mscfd < 0) | (g_off & ~glr_ok)
    return t


def shut_in_events(h, c):
    """One row per shut-in: start = choke set to 0, end = next choke event (re-open) or data end."""
    rows = []
    for w, cw in c.groupby("well_name"):
        cw = cw.sort_values("timestamp").reset_index(drop=True)
        data_end = h.loc[h.well_name == w, "timestamp"].max()
        for i, r in cw[cw.choke_opening_pct == 0].iterrows():
            end = cw.timestamp[i + 1] if i + 1 < len(cw) else data_end
            rows.append({"well_name": w, "shut_start": r.timestamp, "shut_end": end,
                         "duration_hr": (end - r.timestamp).total_seconds() / 3600,
                         "inside_hf_window": r.timestamp <= data_end})
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- main
def main():
    OUT.mkdir(exist_ok=True)
    raw = pd.read_csv(raw_hf_path())
    h, log = clean_hf(raw)
    c = load_choke()
    h = attach_choke(h, c)
    h.to_parquet(OUT / "hf_clean.parquet", index=False, compression="zstd", compression_level=9) if _has_parquet() else None

    d = daily_table(h)
    t = test_table(h, load_static())
    s = shut_in_events(h, c)
    d.to_csv(OUT / "daily.csv", index=False)
    t.to_csv(OUT / "train.csv", index=False)
    s.to_csv(OUT / "shut_ins.csv", index=False)
    pd.Series(log | {"rows_clean": len(h)}).to_json(OUT / "cleaning_log.json", indent=2)

    print("cleaning log:", log | {"rows_clean": len(h)})
    print(f"daily {d.shape}  low-coverage days {int(d.low_coverage.sum())}  fully shut days {int((d.shut_frac == 1).sum())}")
    print(f"tests {t.shape}  repaired water/gas/lift-sign: {int(t.repaired_water.sum())}/{int(t.repaired_gas.sum())}/"
          f"{int(t.repaired_lift_sign.sum())}  still bad oil/water/gas: {int(t.bad_oil.sum())}/{int(t.bad_water.sum())}/{int(t.bad_gas.sum())}"
          f"  tests overlapping a shut-in: {int(t.test_during_shut_in.sum())}")
    print("shut-ins:\n", s.to_string(index=False))


def _has_parquet():
    try:
        import pyarrow  # noqa: F401
        return True
    except ImportError:
        return False


if __name__ == "__main__":
    main()
