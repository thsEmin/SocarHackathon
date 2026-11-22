"""Predict a NEW period with the already-trained model (no retraining) - backup for the web upload.

    python predict_new.py --hf high_freq_data.csv --choke choke_events.csv --tests well_tests.csv --out results

--choke and --tests are optional. Writes into --out:
  VFM_daily_predictions.xlsx   daily oil / water / gas per well (same format as outputs/)
  PTA_results.xlsx             build-up analysis of every usable shut-in in the new period
  well_test_check.csv          (with --tests) predicted vs measured on each new well test

Do NOT copy new files into Dataset/ and run run_all.py: that retrains the model on the new period
only and overwrites work/ (the trained model and the app's preloaded data).
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app.services import store, views  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hf", required=True, help="high-frequency sensor file (CSV or Excel)")
    ap.add_argument("--choke", help="choke events file (default: competition choke log)")
    ap.add_argument("--tests", help="well tests of the new period (used only to check accuracy)")
    ap.add_argument("--out", default="predictions_new", help="output folder")
    a = ap.parse_args()

    t0 = time.time()
    files = {role: (Path(p).name, Path(p).read_bytes())
             for role, p in (("hf", a.hf), ("choke", a.choke), ("tests", a.tests)) if p}
    warn = []
    ds = store.build_dataset(files, warn, lambda s, p: print(f"[{p:3d}%] {s}", flush=True), "new")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    (out / "VFM_daily_predictions.xlsx").write_bytes(views.export_vfm_xlsx(ds))
    p = ds.preds
    print(f"VFM: {p.well_name.nunique()} wells, {p.date.min():%Y-%m-%d} -> {p.date.max():%Y-%m-%d}, "
          f"{len(p)} rows, empty cells: {int(p[store.vfm.TARGETS].isna().sum().sum())}")

    print(f"PTA: {len(ds.shut)} shut-ins in the new period")
    try:
        (out / "PTA_results.xlsx").write_bytes(views.export_pta_xlsx(ds))
        print("     PTA_results.xlsx written")
    except ValueError as e:
        print(f"     no PTA file: {e}")

    if ds.test_check:
        ds.test_rows.to_csv(out / "well_test_check.csv", index=False)
        m = ds.test_check["mape_pct"]
        print(f"VFM vs {ds.test_check['n_tests']} new well tests (model not refit), mean error: "
              f"oil {m['oil_rate_stbd']:.2f} %, water {m['water_rate_stbd']:.2f} %, gas {m['gas_rate_mscfd']:.2f} %")
    for w in warn:
        print("warning:", w)
    print(f"done in {time.time() - t0:.0f}s -> {out.resolve()}")


if __name__ == "__main__":
    main()
