"""Start PetroNova at http://127.0.0.1:5000  (stop with Ctrl+C).
   python run_app.py            -> local only
   python run_app.py --public   -> listen on all network interfaces (for hosting / Docker)
"""
import os
import sys
import webbrowser
from threading import Timer

from waitress import serve

from app.server import create_app

if __name__ == "__main__":
    public = "--public" in sys.argv
    host = "0.0.0.0" if public else "127.0.0.1"
    port = int(os.environ.get("PORT", 5000))
    print("Loading data and model ...", flush=True)
    app = create_app()
    url = f"http://127.0.0.1:{port}"
    print(f"PetroNova is running at {url}", flush=True)
    if not public and "--no-browser" not in sys.argv:
        Timer(1.0, lambda: webbrowser.open(url)).start()
    # "localhost" may resolve to IPv6 (::1) or IPv4 (127.0.0.1) on Windows: listen on both locally
    listen = f"0.0.0.0:{port}" if public else f"127.0.0.1:{port} [::1]:{port}"
    try:
        serve(app, listen=listen, threads=8, max_request_body_size=800 * 1024 * 1024)
    except OSError:  # IPv6 not available on this machine
        serve(app, host=host, port=port, threads=8, max_request_body_size=800 * 1024 * 1024)
