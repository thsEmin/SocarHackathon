# Intelligent Well Performance Analysis: SOCAR Hackathon 2026

Virtual flow metering (VFM) + automatic pressure-transient analysis (PTA) for 10 gas-lifted wells.

## Get the code and data

```
git clone https://github.com/thsEmin/SocarHackathon.git
cd SocarHackathon
```

Everything is a normal file (no Git LFS needed), so **Download ZIP** on GitHub works too. The 269 MB raw sensor file is stored zipped as `Dataset/high_freq_data.zip` (60 MB); the code reads the zip directly, and uses `Dataset/high_freq_data.csv` instead if you unzip it there.

## Open the app (PetroNova)

```
pip install -r requirements.txt
python run_app.py
```

The app opens at **http://127.0.0.1:5000** and works offline (charts and fonts are bundled). Its pages:

- **Field overview:** field schematic, KPIs and alerts
- **Problems & financial loss:** finds current, past and future problems per well (formation damage, shut-ins, choke cut-backs, water breakthrough, gas breakout, flow restriction, lift-gas problems, gauge faults, fast decline, bubble point ahead), shows the root cause and the solution, and turns lost barrels into money at an oil and gas price you enter (charts per well, per cause and over time; Excel export)
- **Data:** upload and cleaning report
- **Sensors:** with From / To dates
- **Virtual flow meter:** From / To dates (totals follow the period) and an hourly view of any day (click a day on the chart)
- **What-if scenarios:** choke and lift-gas sliders
- **Pressure transient analysis:** the 4 plots, plus a manual window you can drag
- **Well profile:** wellbore diagram
- **Export:** VFM Excel, PTA Excel and the plots

Use the EN / AZ switch at the top right to change language, and the **Units** menu next to it to show pressure (psi, bar, kPa, MPa, Pa, atm), temperature (°F, °C, K), rates (stb/d, m³/d, Mscf/d …) and depth (ft, m). Units change only what you see; calculations and Excel files stay in field units.

To host it online, use the `Dockerfile` (`docker build -t petronova .` then `docker run -p 8000:8000 petronova`).

## Rebuild everything (about 3 minutes)

```
python run_all.py
```

`run_all.py` runs the five steps in order and stops at the first failure:

| Step | Script | What it does |
|---|---|---|
| 1 | `src/prep.py` | Cleans the raw data and builds the daily, test and shut-in tables |
| 2 | `src/vfm.py` | Trains and validates the VFM, then writes the daily oil, water and gas predictions |
| 3 | `src/pta.py` | Runs a build-up analysis on every shut-in, with plots and results |
| 4 | `src/check_data.py` | Runs 57 automatic checks on data, VFM and PTA |
| 5 | `src/check_app.py` | Runs 25 automatic checks on the web app (pages, API, numbers, problems and losses, hourly view, units, upload, exports) |

The raw files in `Dataset/` are never modified.

## Predict a new period (for example the Oct-Dec scoring data)

Use the trained model as it is, with no retraining:

```
python predict_new.py --hf high_freq_data.csv --choke choke_events.csv --tests well_tests.csv --out results
```

This writes `VFM_daily_predictions.xlsx`, `PTA_results.xlsx` and, with `--tests`, `well_test_check.csv` (predicted vs measured) into `results/`. It takes about 15 s for 3 months. In the app, the Data page does the same thing; the third box is for the optional well tests. **Do not** copy new files into `Dataset/` and run `run_all.py`: that retrains the model on the new period only and overwrites `work/`.

## Deliverables checklist

| # | Required | Where |
|---|---|---|
| 1 | Result files for Phase 1 (VFM) and Phase 2 (PTA), CSV or Excel | `outputs/VFM_daily_predictions.xlsx` (sheet `predictions`) and `outputs/PTA_results.xlsx` (sheet `results`) |
| 2 | Trained model in `.pkl` format | `outputs/vfm_model.pkl` |
| 3 | Notebook with all cells run, showing our best results | `PetroNova_pipeline.ipynb` (repo root) |
| 4 | Folder with all PTA plots | `outputs/pta_plots/` (one 4-panel figure per shut-in) |

The pitch deck is `final_presentation.pptx`.

## Deliverables (`outputs/`)

| File | Contents |
|---|---|
| `VFM_daily_predictions.xlsx` | Sheet `predictions` with `date, well_name, oil_rate_stbd, water_rate_stbd, gas_rate_mscfd` (10 wells × 273 days). Also: day flags, validation table, physics checks, drawdowns used. |
| `PTA_results.xlsx` | Sheet `results` with Horner slope, permeability, skin and ΔP skin for each shut-in. Also: details and interpretation, sensitivity, method. |
| `pta_plots/*.png` | One 4-panel figure per shut-in: rate and pressure history, log-log diagnostic, Horner plot, results |
| `vfm_model.pkl` | The trained VFM model (pickle). Load with `import sys; sys.path.insert(0, 'src'); import vfm, pickle` then `pickle.load(open('outputs/vfm_model.pkl', 'rb'))`. |

The notebook `PetroNova_pipeline.ipynb` (repo root) runs the whole pipeline with all outputs saved: cleaning, VFM training + validation, PTA results, interpretation and every PTA plot.

## Folders

- `Dataset/`: raw data (read only)
- `src/`: pipeline code
- `app/`: PetroNova web app (Flask server, services, pages, design system)
- `work/`: intermediate tables, the trained model (`vfm_model.joblib`) and diagnostics
- `outputs/`: deliverables

The full method is in `METHODOLOGY.md`.
