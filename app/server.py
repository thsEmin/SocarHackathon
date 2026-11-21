"""PetroNova: Flask server. Pages are rendered once; data comes from the JSON API."""
import io
import math
import sys
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, abort
from flask.json.provider import DefaultJSONProvider

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services import store, insights, pta_service, views, diagnostics  # noqa: E402

PAGES = ["home", "overview", "problems", "data", "sensors", "vfm", "whatif", "pta", "well", "export"]


class SafeJSON(DefaultJSONProvider):
    """NaN / inf -> null so the browser can always parse the response."""
    def dumps(self, obj, **kw):
        return super().dumps(_clean(obj), **kw)


def _clean(o):
    if isinstance(o, float):
        return None if (math.isnan(o) or math.isinf(o)) else o
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if hasattr(o, "item"):  # numpy scalar
        return _clean(o.item())
    return o


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")
    app.json = SafeJSON(app)
    app.config["MAX_CONTENT_LENGTH"] = 700 * 1024 * 1024   # the full sensor file is 269 MB
    store.load_preloaded()
    store.shared()

    def ds():
        ds_id = request.args.get("ds", "preloaded")
        d = store.get(ds_id, strict=True)
        if d is None:
            abort(404, f"unknown dataset {ds_id}")
        return d

    def well_arg(d):
        w = request.args.get("well") or d.wells()[0]
        if w not in d.wells():
            abort(404, f"unknown well {w}")
        return w

    # ---------------------------------------------------------- pages
    @app.route("/")
    def index():
        return render_template("home.html", page="home")

    @app.route("/favicon.ico")
    def favicon():
        return app.send_static_file("img/favicon.ico")

    @app.route("/<page>")
    def page(page):
        if page not in PAGES:
            abort(404)
        return render_template(f"{page}.html", page=page)

    # ---------------------------------------------------------- API
    @app.get("/api/datasets")
    def api_datasets():
        return jsonify(store.all_summaries())

    @app.get("/api/overview")
    def api_overview():
        return jsonify(insights.overview(ds()))

    @app.get("/api/sensors")
    def api_sensors():
        d = ds()
        return jsonify(views.sensors(d, well_arg(d)))

    @app.get("/api/vfm")
    def api_vfm():
        d = ds()
        return jsonify(views.vfm(d, well_arg(d)))

    @app.get("/api/vfm/hourly")
    def api_vfm_hourly():
        d = ds()
        try:
            return jsonify(views.vfm_hourly(d, well_arg(d), request.args.get("date", "")))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    @app.get("/api/problems")
    def api_problems():
        return jsonify(diagnostics.problems(ds()))

    @app.get("/api/well")
    def api_well():
        d = ds()
        return jsonify(views.well_info(d, well_arg(d)))

    @app.get("/api/pta/events")
    def api_pta_events():
        return jsonify(pta_service.events(ds()))

    @app.get("/api/pta/<int:idx>")
    def api_pta_detail(idx):
        d = ds()
        if not 0 <= idx < len(d.shut):
            abort(404, "unknown shut-in")
        w0, w1 = request.args.get("w0", type=float), request.args.get("w1", type=float)
        window = None
        if w0 is not None and w1 is not None:
            if not 0 < w0 < w1:
                return jsonify({"error": "window start must be > 0 and smaller than the end"}), 400
            window = (w0, w1)
        try:
            return jsonify(pta_service.detail(d, idx, window))
        except Exception as e:  # e.g. a window with too few points
            return jsonify({"error": f"could not fit this window: {e}"}), 400

    @app.get("/api/whatif")
    def api_whatif():
        d = ds()
        return jsonify(insights.whatif(d, well_arg(d), request.args.get("choke", 0, type=float),
                                       request.args.get("lift", 0, type=float)))

    @app.post("/api/upload")
    def api_upload():
        files = {}
        for role in ("hf", "choke"):
            f = request.files.get(role)
            if f and f.filename:
                files[role] = (f.filename, f.read())
        if "hf" not in files:
            return jsonify({"error": "please choose the high-frequency sensor file"}), 400
        return jsonify({"job": store.start_upload(files)})

    @app.get("/api/upload/<job_id>")
    def api_upload_status(job_id):
        j = store.job(job_id)
        if not j:
            abort(404)
        return jsonify({k: v for k, v in j.items() if k != "trace"})

    @app.get("/api/export/<kind>")
    def api_export(kind):
        d = ds()
        makers = {"vfm": (views.export_vfm_xlsx, "VFM_daily_predictions.xlsx",
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                  "pta": (views.export_pta_xlsx, "PTA_results.xlsx",
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                  "plots": (views.export_plots_zip, "PTA_plots.zip", "application/zip")}
        if kind == "problems":
            oil = request.args.get("oil_price", 70, type=float)
            gas = request.args.get("gas_price", 3, type=float)
            makers[kind] = (lambda d_: views.export_problems_xlsx(d_, oil, gas), "Problems_and_losses.xlsx",
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        if kind not in makers:
            abort(404)
        fn, name, mime = makers[kind]
        try:
            data = fn(d)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        prefix = "" if d.id == "preloaded" else d.id + "_"
        return send_file(io.BytesIO(data), mimetype=mime, as_attachment=True, download_name=prefix + name)

    @app.errorhandler(404)
    def not_found(e):
        if request.path.startswith("/api/"):
            return jsonify({"error": str(e.description)}), 404
        return render_template("404.html", page="notfound"), 404

    return app
