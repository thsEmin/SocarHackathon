# Intelligent Well Performance Analysis: SOCAR Hackathon 2026

Virtual flow metering (VFM) + automatic pressure-transient analysis (PTA) for 10 gas-lifted wells.

## Get the code and data

The 269 MB sensor file and the cleaned parquet file are stored with **Git LFS**:

```
git clone https://github.com/thsEmin/SocarHackathon.git
cd SocarHackathon
git lfs pull
```

## Run everything (about 2 minutes)

```
pip install -r requirements.txt
python run_all.py
```

`run_all.py` runs the four steps in order and stops at the first failure:

| Step | Script | What it does |
|---|---|---|
| 1 | `src/prep.py` | Cleans the raw data and builds the daily, test and shut-in tables |
| 2 | `src/vfm.py` | Trains and validates the VFM, then writes the daily oil, water and gas predictions |
| 3 | `src/pta.py` | Runs a build-up analysis on every shut-in, with plots and results |
| 4 | `src/check_data.py` | Runs 57 automatic checks on data, VFM and PTA |

The raw files in `Dataset/` are never modified.

## Deliverables (`outputs/`)

| File | Contents |
|---|---|
| `VFM_daily_predictions.xlsx` | Sheet `predictions` with `date, well_name, oil_rate_stbd, water_rate_stbd, gas_rate_mscfd` (10 wells × 273 days). Also: day flags, validation table, physics checks, drawdowns used. |
| `PTA_results.xlsx` | Sheet `results` with Horner slope, permeability, skin and ΔP skin for each shut-in. Also: details and interpretation, sensitivity, method. |
| `pta_plots/*.png` | One 4-panel figure per shut-in: rate and pressure history, log-log diagnostic, Horner plot, results |

## Folders

- `Dataset/`: raw data (read only)
- `src/`: pipeline code
- `work/`: intermediate tables, the trained model (`vfm_model.joblib`) and diagnostics
- `outputs/`: deliverables

The full method is in `METHODOLOGY.md`.
