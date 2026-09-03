import os

from flask import Flask, abort, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

# <repo>/static, resolved from this file so it works from any cwd.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STATIC_DIR = os.path.join(REPO_ROOT, "static")


def create_app(test_config=None):
    """
    this function is an application factory for Flask. it is called automatically to
    create the app when you execute `flask --app app run`

    https://flask.palletsprojects.com/en/3.0.x/patterns/appfactories/
    """

    # static_folder=None: we serve <repo>/static ourselves (see below) instead of
    # Flask's default /static route.
    app = Flask(__name__, instance_relative_config=True, static_folder=None)
    app.config.from_mapping(
        RSVP_DB_PATH=os.environ.get(
            "RSVP_DB_PATH", os.path.join(app.instance_path, "rsvps.db")
        ),
        RSVP_EVENTS_PATH=os.environ.get(
            "RSVP_EVENTS_PATH", os.path.join(STATIC_DIR, "events.json")
        ),
        MAX_CONTENT_LENGTH=1024,
    )
    if test_config is not None:
        app.config.from_mapping(test_config)

    # ensure the instance folder (and wherever the db lives) exists. In
    # production /var/lib/come-see already exists (systemd StateDirectory);
    # if it cannot be created here, fail loudly at startup rather than on the
    # first request.
    for directory in (app.instance_path, os.path.dirname(app.config["RSVP_DB_PATH"])):
        os.makedirs(directory, exist_ok=True)

    from . import database, rsvps

    database.init_app(app)
    app.register_blueprint(rsvps.bp)

    register_error_handlers(app)
    register_static_site(app)

    return app


def register_error_handlers(app):
    """Errors under /api/ are JSON in the contract's {"error", "message"} shape."""

    @app.errorhandler(HTTPException)
    def handle_http_exception(e):
        if not request.path.startswith("/api/"):
            return e
        code = e.name.lower().replace(" ", "_")  # e.g. not_found, method_not_allowed
        return jsonify(error=code, message=e.description), e.code


def register_static_site(app):
    """
    Serve <repo>/static at / so `flask --app app run` gives the whole site
    during development. In production nginx serves static and only /api/
    reaches gunicorn, so the static routes are only reachable locally. The
    /api/ catch-all below is what production can hit: an unknown GET under
    /api/ is a JSON 404 instead of an attempt to serve a file, and a wrong
    method on any /api/ path stays a JSON 405.
    """

    @app.get("/api/<path:_unknown>")
    def unknown_api(_unknown):
        abort(404)

    @app.get("/")
    def index():
        return send_from_directory(STATIC_DIR, "index.html")

    @app.get("/<path:filename>")
    def static_site(filename):
        return send_from_directory(STATIC_DIR, filename)
