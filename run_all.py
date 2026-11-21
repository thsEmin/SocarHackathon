"""Run the whole pipeline in order and stop at the first failure:
prep (clean data) -> vfm (train + daily predictions) -> pta (build-up analysis) -> checks."""
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEPS = [("1/5 clean data", "src/prep.py"),
         ("2/5 VFM model + daily predictions", "src/vfm.py"),
         ("3/5 PTA on every shut-in", "src/pta.py"),
         ("4/5 automatic data / VFM / PTA checks", "src/check_data.py"),
         ("5/5 automatic web-app checks", "src/check_app.py")]

for name, script in STEPS:
    t = time.time()
    print(f"=== {name} ...", flush=True)
    res = subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT, capture_output=True, text=True)
    tail = [ln for ln in res.stdout.strip().splitlines() if ln.strip()][-1:] if res.stdout.strip() else []
    if res.returncode != 0:
        print(res.stdout[-3000:], res.stderr[-3000:], sep="\n")
        sys.exit(f"FAILED at step '{name}'")
    print(f"    done in {time.time() - t:.0f}s  {tail[0] if tail else ''}")
print("\nAll steps finished. Deliverables are in outputs/.")
