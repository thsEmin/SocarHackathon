# Sample files for the PetroNova upload page

These are cut from the **raw** competition data, so they still contain duplicates, `-999.25` values and spikes. The app's cleaning report has real numbers to show.

| File | Contents | What you get in the app |
|---|---|---|
| `demo_GL01_GL10_Apr-May2025.csv` (12 MB) | GL-01 and GL-10, 1 Apr to 31 May 2025 | VFM for 2 wells and **2 shut-ins** with PTA. GL-01 is damaged (skin +5.7); GL-10 hits a boundary. **Best for the live demo.** |
| `field_all_wells_Aug2025.csv` (31 MB) | All 10 wells, August 2025 | Full field overview for one month, plus 1 shut-in (GL-08) |
| `GL06_Jul2025.xlsx` (1 MB) | GL-06, 15 to 29 July 2025, **Excel** | Shows that Excel files work. 1 shut-in (GL-06, k about 297 mD) |
| `choke_events.csv` | Choke log | Optional second file. Without it, the app uses the competition choke log. |

How to use them: open the **Data** page, put a sensor file in the first box (and optionally `choke_events.csv` in the second), click **Upload and process**, then **Open this dataset**.
