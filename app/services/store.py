"""Datasets for the app.

A Dataset holds everything the pages need: cleaned minute data, daily table, VFM daily
predictions, shut-ins and PTA inputs. The preloaded dataset is read from work/ (built by
run_all.py). Uploaded data go through exactly the same pipeline functions in src/.
"""
import io
import json
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
import prep  # noqa: E402
import vfm   # noqa: E402  (also needed to unpickle the model)
import pta   # noqa: E402

D, W = ROOT / "Dataset", ROOT / "work"
UPLOADS = ROOT / "uploads"
SENSORS = prep.SENS
HF_REQUIRED = ["timestamp", "well_name"] + SENSORS


class Dataset:
    def __init__(self, ds_id, label, hf, daily, preds, shut, choke, clean_log, source):
        self.id, self.label, self.source = ds_id, label, source
        self.hf, self.daily, self.preds, self.shut, self.choke = hf, daily, preds, shut, choke
        self.clean_log = clean_log
        self.created = time.time()
        self._pta_cache = {}

    # inputs dict in the format src/pta.py expects
    def pta_inputs(self):
        s = shared()
        return {"hf": self.hf, "shut": self.shut, "daily": self.preds, "tests": s["tests"],
                "pvt": s["pvt"], "comp": s["comp"], "choke": self.choke, "model": s["model"]}

    def wells(self):
        return sorted(self.preds.well_name.unique())

    def summary(self):
        return {"id": self.id, "label": self.label, "source": self.source,
                "wells": self.wells(), "start": str(self.preds.date.min().date()),
                "end": str(self.preds.date.max().date()), "n_minutes": int(len(self.hf)),
                "n_shut_ins": int(len(self.shut)), "cleaning": self.clean_log}


# ------------------------------------------------------------------ shared (training-side) data
_SHARED = {}


def shared():
    if not _SHARED:
        _SHARED["model"] = joblib.load(W / "vfm_model.joblib")
        _SHARED["tests"] = pd.read_csv(W / "train.csv", parse_dates=["test_start", "test_end"])
        _SHARED["pvt"] = pd.read_csv(D / "reservoir_pvt.csv").set_index("well_name")
        _SHARED["comp"] = pd.read_csv(D / "well_completion.csv").set_index("well_name")
        _SHARED["validation"] = pd.read_csv(W / "vfm_validation.csv")
        _SHARED["diag"] = json.loads((W / "vfm_diagnostics.json").read_text())
        _SHARED["drawdown"] = pd.read_csv(W / "drawdown.csv", index_col=0)
    return _SHARED


# ------------------------------------------------------------------ registry
_DATASETS = {}
_JOBS = {}
_LOCK = threading.Lock()


def load_preloaded():
    hf = pd.read_parquet(W / "hf_clean.parquet")
    daily = pd.read_csv(W / "daily.csv", parse_dates=["date"])
    preds = pd.read_csv(W / "daily_predictions.csv", parse_dates=["date"])
    shut = pd.read_csv(W / "shut_ins.csv", parse_dates=["shut_start", "shut_end"])
    choke = prep.load_choke()
    log = json.loads((W / "cleaning_log.json").read_text())
    ds = Dataset("preloaded", "SOCAR Hackathon 2026 dataset (preloaded)", hf, daily, preds, shut, choke,
                 log, "preloaded")
    _DATASETS[ds.id] = ds
    return ds


# ready-made demo datasets (1 / 7 / 30 / 90 days), cut from the preloaded data at startup so they
# are in the Dataset list straight away. 1 day and 30 days are the same periods as the files in samples/.
SAMPLES = [("sample-1d", "2025-08-27", "2025-08-27"),    # samples/field_all_wells_1day_27Aug2025.csv
           ("sample-7d", "2025-08-16", "2025-08-22"),    # includes the GL-08 shut-in (19-22 Aug)
           ("sample-30d", "2025-08-01", "2025-08-30"),   # August (as samples/field_all_wells_Aug2025.csv), 30 days
           ("sample-90d", "2025-07-03", "2025-09-30")]   # GL-06 and GL-08 shut-ins


def load_samples(base):
    for ds_id, a, b in SAMPLES:
        a, b = pd.Timestamp(a), pd.Timestamp(b)
        end = b + pd.Timedelta(days=1)
        in_days = lambda df: df[(df.date >= a) & (df.date <= b)].reset_index(drop=True)
        hf = base.hf[(base.hf.timestamp >= a) & (base.hf.timestamp < end)].reset_index(drop=True)
        shut = base.shut[(base.shut.shut_start >= a) & (base.shut.shut_end < end)].reset_index(drop=True)
        n = (b - a).days + 1
        label = f"Sample: {n} day{'s' if n > 1 else ''} ({a:%d %b} - {b:%d %b %Y}, 10 wells)"
        ds = Dataset(ds_id, label, hf, in_days(base.daily), in_days(base.preds), shut, base.choke,
                     base.clean_log, "sample")
        _DATASETS[ds.id] = ds


def get(ds_id, strict=False):
    """strict=True returns None for an unknown id instead of falling back to the preloaded data."""
    if strict:
        return _DATASETS.get(ds_id)
    return _DATASETS.get(ds_id) or _DATASETS["preloaded"]


def all_summaries():
    return [d.summary() for d in sorted(_DATASETS.values(), key=lambda d: d.created)]


# ------------------------------------------------------------------ upload pipeline
def _read_table(name, data):
    if name.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(io.BytesIO(data))
    return pd.read_csv(io.BytesIO(data))


def start_upload(files):
    """files: dict role -> (filename, bytes). Roles: 'hf' (required), 'choke' (optional)."""
    job_id = uuid.uuid4().hex[:10]
    _JOBS[job_id] = {"status": "queued", "stage": "queued", "progress": 0, "error": None, "dataset": None,
                     "warnings": []}
    threading.Thread(target=_run_upload, args=(job_id, files), daemon=True).start()
    return job_id


def job(job_id):
    return _JOBS.get(job_id)


def _stage(job_id, stage, progress):
    _JOBS[job_id].update(stage=stage, progress=progress, status="running")


def _run_upload(job_id, files):
    j = _JOBS[job_id]
    try:
        _stage(job_id, "reading", 5)
        name, data = files["hf"]
        raw = _read_table(name, data)
        missing = [c for c in HF_REQUIRED if c not in raw.columns]
        if missing:
            raise ValueError(f"high-frequency file is missing columns: {', '.join(missing)}")
        known = set(shared()["model"].oil.wells)
        unknown = sorted(set(raw.well_name.astype(str)) - known)
        if unknown:
            j["warnings"].append(f"wells not in the trained model were skipped: {', '.join(unknown)}")
            raw = raw[raw.well_name.isin(known)]
        if raw.empty:
            raise ValueError("no rows for wells the model was trained on (GL-01 ... GL-10)")
        raw = raw[HF_REQUIRED]

        if "choke" in files:
            cname, cdata = files["choke"]
            choke = _read_table(cname, cdata)
            if not {"timestamp", "well_name", "choke_opening_pct"} <= set(choke.columns):
                raise ValueError("choke file needs columns timestamp, well_name, choke_opening_pct")
            choke["timestamp"] = pd.to_datetime(choke.timestamp, format="mixed")
            choke = choke.drop_duplicates().sort_values(["well_name", "timestamp"]).reset_index(drop=True)
        else:
            choke = prep.load_choke()
            j["warnings"].append("no choke file uploaded: the competition choke log was used")

        _stage(job_id, "cleaning (duplicates, -999.25, spikes)", 20)
        h, log = prep.clean_hf(raw)
        h = prep.attach_choke(h, choke)
        if h.choke_opening_pct.isna().any():
            j["warnings"].append("some minutes are before the first choke record: choke assumed unknown there")

        _stage(job_id, "building daily table and finding shut-ins", 45)
        daily = prep.daily_table(h)
        shut = prep.shut_in_events(h, choke)
        if len(shut):
            shut = shut[shut.inside_hf_window & (shut.shut_start >= h.timestamp.min())].reset_index(drop=True)

        _stage(job_id, "running the VFM model", 65)
        preds = vfm.predict_daily(shared()["model"], daily)

        _stage(job_id, "saving", 90)
        ds_id = "up-" + job_id
        out = UPLOADS / ds_id
        out.mkdir(parents=True, exist_ok=True)
        preds.to_csv(out / "daily_predictions.csv", index=False)
        log = log | {"rows_clean": int(len(h))}
        n_w = preds.well_name.nunique()
        label = f"Upload: {name} ({preds.date.min():%d %b} - {preds.date.max():%d %b %Y}, {n_w} well{'s' if n_w > 1 else ''})"
        ds = Dataset(ds_id, label, h, daily, preds, shut, choke, log, "upload")

        # check every shut-in for PTA now, so the page can say how many are usable and why not
        _stage(job_id, "checking shut-ins for PTA", 95)
        inp = ds.pta_inputs()
        auto = []
        for i in range(len(shut)):
            res, _, err = pta.analyse_safe(inp, shut.iloc[i])
            auto.append((res, err))
            if err:
                j["warnings"].append(f"{shut.well_name.iloc[i]} shut-in {shut.shut_start.iloc[i]:%d %b %Y %H:%M}: "
                                     f"{err['reason']}")
        ds._pta_cache["auto"] = auto
        j["pta_ok"] = sum(e is None for _, e in auto)
        j["pta_total"] = len(auto)
        with _LOCK:
            _DATASETS[ds_id] = ds
        j.update(status="done", stage="done", progress=100, dataset=ds_id)
    except Exception as e:  # report any problem to the page instead of crashing
        j.update(status="error", error=str(e), trace=traceback.format_exc()[-1500:])
