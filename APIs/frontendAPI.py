"""
Frontend API - GUI-friendly endpoints for traffic signal optimization

This Flask API provides a translation layer between the GUI's user-friendly
JSON format and the MILP backend's complex NEMA format.

Run on port 5000 (separate from milpAPI.py which runs on port 4000)
"""

from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv
from functools import wraps
import traceback
import warnings
import json
import sys
import os
import logging

# Configure logging - log errors server-side only
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables from .env file FIRST
load_dotenv()

# Determine if we're in production mode (secure by default)
IS_PRODUCTION = os.getenv('FLASK_ENV', 'production').lower() == 'production'

# Add parent directory to path to import MILP modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'milp-code'))

# Import MILP optimization functions
import milp1FINAL
import milp2FINAL

# Import translation functions
from api_translator import gui_to_milp, milp_to_gui, standardize_cycle_lengths

# Import authentication layer
import auth

# Import database functions
try:
    from db import (
        get_all_clients,
        get_available_roles,
        get_users_by_role,
        get_projects_by_client,
        get_project_with_junctions,
        get_subsystems_by_project,
        get_latest_timings,
        get_timing_history,
        get_timings_in_range,
        get_timing_by_id,
        transform_to_gui_format
    )
    DB_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Database module not available: {e}")
    DB_AVAILABLE = False

# Initialize Flask app
app = Flask(__name__)
app.config['PROPAGATE_EXCEPTIONS'] = False
app.config['JSON_SORT_KEYS'] = False  # Preserve dictionary order

# Enable CORS for all routes (allows requests from frontend)
# Support both ALLOWED_ORIGINS and CORS_ORIGINS for backward compatibility.
# SECURITY: default to local dev origins (NOT '*') so a missing/misconfigured
# environment does not silently open the API to every origin. Set '*' explicitly
# only if you really want to allow all origins.
DEFAULT_DEV_ORIGINS = 'http://localhost:5173,http://localhost:5174'
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS') or os.environ.get('CORS_ORIGINS') or DEFAULT_DEV_ORIGINS

# For production: set ALLOWED_ORIGINS environment variable to specific URLs
if ALLOWED_ORIGINS == '*':
    CORS(app, resources={r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
    }})
else:
    ALLOWED_ORIGINS_LIST = ALLOWED_ORIGINS.split(',')
    CORS(app,
         resources={r"/*": {
             "origins": ALLOWED_ORIGINS_LIST,
             "methods": ["GET", "POST", "OPTIONS"],
             "allow_headers": ["Content-Type", "Authorization"],
             "supports_credentials": False,
             "max_age": 3600
         }})

# Filter out warnings
warnings.filterwarnings("ignore")


# Security headers - applied to all responses
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    # Only add HSTS in production (when HTTPS is enabled)
    if IS_PRODUCTION:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


_LOCALHOST_HOSTS = {'127.0.0.1', 'localhost', '::1'}


def should_trust_proxy() -> bool:
    """
    Whether the app runs behind a trusted reverse proxy (TRUST_PROXY=true).

    SECURITY: only enable this when a proxy actually sets X-Forwarded-For.
    Enabling it without a proxy lets clients spoof that header and defeat the
    per-IP rate limits.
    """
    return os.getenv('TRUST_PROXY', 'false').lower() == 'true'


def resolve_run_config():
    """
    Resolve (host, port, debug) for app.run() from the environment, with a
    safety guard.

    SECURITY: the Werkzeug debugger exposes an interactive console that allows
    remote code execution. It must never be reachable from another machine, so
    debug is forced off whenever the bind host is not loopback. To allow LAN
    access set FLASK_HOST=0.0.0.0 (debug will be disabled automatically).
    """
    host = os.getenv('FLASK_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    if debug and host not in _LOCALHOST_HOSTS:
        logger.warning(
            "FLASK_DEBUG disabled: host %s is not loopback and the debugger "
            "would allow remote code execution.", host
        )
        debug = False
    return host, port, debug


def log_error(endpoint: str, error: Exception) -> None:
    """Log error details server-side only"""
    logger.error(f"Error in {endpoint}: {error}")
    logger.error(f"Full traceback:\n{traceback.format_exc()}")


def error_response(message: str, status_code: int = 500):
    """Return a safe error response without exposing internals"""
    return jsonify({'error': message}), status_code


def db_endpoint(error_message: str):
    """Decorator for DB-backed GET endpoints.

    Handles the two pieces of boilerplate every DB handler shares:
    - Return 503 when the database module is unavailable.
    - Catch any exception, log it server-side, and return a safe error response.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not DB_AVAILABLE:
                return jsonify({'error': 'Database not configured'}), 503
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                log_error(request.path, e)
                return error_response(error_message, 500)
        return wrapper
    return decorator


# Maximum request size (10MB) - prevents DoS via large payloads
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH


# ============ Rate limiting ============
# Default in-memory storage is fine for a single process. For multi-process /
# production deployments set RATELIMIT_STORAGE_URI to a shared backend (e.g.
# redis://...) so limits are enforced across workers.
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["200 per hour", "30 per minute"],
    storage_uri=os.environ.get('RATELIMIT_STORAGE_URI', 'memory://'),
)

# When behind a trusted reverse proxy, honour X-Forwarded-For so rate limits
# and logging see the real client IP instead of the proxy's. Disabled by
# default (see should_trust_proxy for why).
if should_trust_proxy():
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    logger.info("ProxyFix enabled (TRUST_PROXY=true)")


@app.errorhandler(429)
def ratelimit_handler(e):
    """Safe JSON response when a client exceeds the rate limit."""
    return jsonify({'error': 'Too many requests. Please slow down and try again later.'}), 429


# ============ Authentication ============

def require_auth(fn):
    """
    Decorator that requires a valid bearer token in the Authorization header.

    Responds with 401 (without leaking why) for missing, malformed, expired,
    or tampered tokens. On success, exposes the authenticated username via
    request.environ['auth_user'].
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        token = header[7:] if header.startswith('Bearer ') else ''
        username = auth.verify_token(token)
        if not username:
            return error_response('Authentication required', 401)
        request.environ['auth_user'] = username
        return fn(*args, **kwargs)
    return wrapper


@app.route('/api/auth/login', methods=['POST'])
@limiter.limit("5 per 15 minutes")
def auth_login():
    """Authenticate a user and return a signed bearer token."""
    data = request.get_json(silent=True) or {}
    username = data.get('username', '')
    password = data.get('password', '')
    if not auth.authenticate(username, password):
        # Generic message - do not reveal whether the user exists.
        return error_response('Invalid credentials', 401)
    token = auth.create_token(username)
    return jsonify({'token': token, 'user': username}), 200


@app.route('/api/auth/me', methods=['GET'])
@require_auth
def auth_me():
    """Return the currently authenticated user (validates the token)."""
    return jsonify({'user': request.environ.get('auth_user')}), 200


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    """Stateless logout - the client discards its token."""
    return jsonify({'status': 'logged out'}), 200


def validate_optimize_input(data: dict) -> tuple[bool, str]:
    """
    Validate optimization input data structure and values.
    Returns (is_valid, error_message)
    """
    if not isinstance(data, dict):
        return False, "Input must be a JSON object"

    # Required fields
    if 'junctions' not in data:
        return False, "Missing required field: junctions"

    junctions = data['junctions']
    if not isinstance(junctions, list):
        return False, "junctions must be an array"

    if len(junctions) < 2:
        return False, "At least 2 junctions required for optimization"

    if len(junctions) > 50:
        return False, "Maximum 50 junctions allowed"

    # Validate each junction has required fields
    for i, junction in enumerate(junctions):
        if not isinstance(junction, dict):
            return False, f"Junction {i} must be an object"

        # Check for required junction fields
        if 'id' not in junction:
            return False, f"Junction {i} missing 'id' field"

        # Validate phases_s if present (array of phase durations)
        if 'phases_s' in junction:
            phases_s = junction['phases_s']
            if not isinstance(phases_s, list):
                return False, f"Junction {i} 'phases_s' must be an array"

            for j, duration in enumerate(phases_s):
                if not isinstance(duration, (int, float)):
                    return False, f"Junction {i}, Phase {j}: duration must be a number"
                if duration < 0 or duration > 300:
                    return False, f"Junction {i}, Phase {j}: duration must be 0-300 seconds"

    # Validate optional numeric fields if present
    if 'cycleRange' in data:
        cycle_range = data['cycleRange']
        if isinstance(cycle_range, list) and len(cycle_range) == 2:
            if cycle_range[0] < 10 or cycle_range[1] > 300:
                return False, "cycleRange must be between 10-300 seconds"

    return True, ""


@app.route('/')
@limiter.exempt
def hello():
    return jsonify({
        'service': 'Traffic Signal Optimization - Frontend API',
        'version': '1.0',
        'endpoints': {
            '/optimize': 'POST - Main optimization endpoint (GUI format)',
            '/health': 'GET - Health check'
        }
    })


@app.route('/health', methods=['GET'])
@limiter.exempt
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'frontend-api'
    }), 200


@app.route('/optimize', methods=['POST'])
@limiter.limit("10 per minute")
@require_auth
def optimize():
    """
    Main optimization endpoint - accepts GUI JSON format

    Expected input: GUI-friendly JSON with junctions and optimization config
    Returns: GUI-friendly JSON with optimized offsets and bandwidth
    """
    try:
        # 1. Receive GUI JSON
        gui_input = request.get_json()

        if not gui_input:
            return error_response('No JSON data provided', 400)

        # 2. Validate input structure and values
        is_valid, error_msg = validate_optimize_input(gui_input)
        if not is_valid:
            return error_response(error_msg, 400)

        # DEBUG: Log received data to diagnose inconsistency issues.
        # Logged at DEBUG level so full request payloads are not written at the
        # default INFO level in normal operation.
        logger.debug("=== RECEIVED GUI INPUT DEBUG ===")
        logger.debug(f"Number of junctions: {len(gui_input.get('junctions', []))}")
        for i, j in enumerate(gui_input.get('junctions', [])):
            phases = j.get('phases_s', [])
            logger.debug(f"Junction {i} ({j.get('name', 'Unknown')}): {len(phases)} phases, phases_s={phases}")
        logger.debug(f"queueOut_s: {gui_input.get('queueOut_s', [])} (len={len(gui_input.get('queueOut_s', []))})")
        logger.debug(f"queueIn_s: {gui_input.get('queueIn_s', [])} (len={len(gui_input.get('queueIn_s', []))})")
        logger.debug("================================")

        # 3. Translate GUI format -> MILP format
        # standardize=False can be passed in the request body to skip cycle-length averaging (for testing)
        standardize = gui_input.pop('standardize', True)
        logger.info(f"Translating GUI -> MILP (standardize={standardize})")
        milp_input = gui_to_milp(gui_input, standardize=standardize)

        logger.info(f"Number of junctions: {len(gui_input['junctions'])}")
        logger.info(f"Cycle range: {milp_input['cycleRange']}")

        # DEBUG: Log MILP input array shapes (DEBUG level - payload detail)
        import numpy as np
        logger.debug("=== MILP INPUT ARRAY SHAPES ===")
        logger.debug(f"phase shape: {np.array(milp_input['phase']).shape}")
        logger.debug(f"phaseID shape: {np.array(milp_input['phaseID']).shape}")
        logger.debug(f"queue_time shape: {np.array(milp_input['queue_time']).shape}")
        logger.debug(f"queue_time values: {milp_input['queue_time']}")
        logger.debug(f"distance shape: {np.array(milp_input['distance']).shape}")
        logger.debug(f"speedRange shape: {np.array(milp_input['speedRange']).shape}")
        logger.debug(f"speedChangeRange shape: {np.array(milp_input['speedChangeRange']).shape}")
        logger.debug(f"outbound NEMA IDs: {milp_input['outbound']}")
        logger.debug(f"inbound NEMA IDs: {milp_input['inbound']}")
        # Log each junction's phases
        for i, (phases, j) in enumerate(zip(milp_input['phase'], gui_input['junctions'])):
            logger.debug(f"Junction {i} ({j.get('name')}): phases={phases}, outIdx={j.get('outboundIdx')}, inIdx={j.get('inboundIdx')}")
        logger.debug("===============================")

        # 4. Call MILP optimization (using MILP2 by default)
        logger.info("Running MILP Optimization")
        milp_output = milp2FINAL.callback(
            milp_input['phase'],
            milp_input['phaseID'],
            milp_input['phaseRed'],
            milp_input['phaseAmber'],
            milp_input['outbound'],
            milp_input['inbound'],
            milp_input['queue_time'],
            milp_input['k'],
            milp_input['speedRange'],
            milp_input['speedChangeRange'],
            milp_input['distance'],
            milp_input['cycleRange'],
            milp_input['flag']
        )

        logger.info(f"MILP Optimization Complete - Bandwidth: {milp_output.get('b_max', 'N/A')}")

        # 5. Translate MILP output -> GUI format
        gui_output = milp_to_gui(milp_output, gui_input, milp_input)

        # 5b. Restore scaled queue times from milp_input (milp_output does not
        #     echo back queue_time, so milp_to_gui returns zeros without this).
        scaled_queue = milp_input.get('queue_time', [[], []])
        gui_output['queueOut_s'] = list(scaled_queue[0]) if len(scaled_queue) > 0 else []
        gui_output['queueIn_s']  = list(scaled_queue[1]) if len(scaled_queue) > 1 else []

        # DEBUG: Log what we're returning to diagnose re-optimization failures
        logger.debug("=== RETURNING GUI OUTPUT DEBUG ===")
        for i, j in enumerate(gui_output.get('junctions', [])):
            phases = j.get('phases_s', [])
            logger.debug(f"Junction {i} ({j.get('name', 'Unknown')}): {len(phases)} phases, phases_s={phases}")
        logger.debug(f"queueOut_s: len={len(gui_output.get('queueOut_s', []))}")
        logger.debug(f"queueIn_s: len={len(gui_output.get('queueIn_s', []))}")
        logger.debug("==================================")

        # 6. Return GUI-friendly JSON
        return jsonify(gui_output), 200

    except KeyError as e:
        log_error('/optimize', e)
        return error_response(f"Missing required field: {str(e)}", 400)

    except ValueError as e:
        log_error('/optimize', e)
        return error_response(f"Invalid data: {str(e)}", 400)

    except Exception as e:
        log_error('/optimize', e)
        return error_response('An error occurred during optimization', 500)


@app.route('/optimize/milp1', methods=['POST'])
@require_auth
def optimize_milp1():
    """
    MILP1 optimization endpoint (fixed cycle, simpler model)

    Expected input: GUI-friendly JSON
    Returns: GUI-friendly JSON with optimized offsets
    """
    try:
        gui_input = request.get_json()

        if not gui_input:
            return error_response('No JSON data provided', 400)

        # Validate structure and values before translating
        is_valid, error_msg = validate_optimize_input(gui_input)
        if not is_valid:
            return error_response(error_msg, 400)

        # Translate to MILP format
        milp_input = gui_to_milp(gui_input)

        # For MILP1, we need travel times instead of speeds/distances
        # Extract from GUI or calculate
        travel_time = gui_input.get('travelOut_s', [])
        if not travel_time:
            # Calculate from distance and default speed
            return jsonify({
                'error': 'MILP1 requires travel times (travelOut_s field)'
            }), 400

        # Call MILP1
        milp_output = milp1FINAL.callback(
            milp_input['phase'],
            milp_input['phaseID'],
            milp_input['phaseRed'],
            milp_input['outbound'],
            milp_input['inbound'],
            travel_time,
            milp_input['queue_time']
        )

        # Translate output
        gui_output = milp_to_gui(milp_output, gui_input, milp_input)

        return jsonify(gui_output), 200

    except Exception as e:
        log_error('/optimize/milp1', e)
        return error_response('Error in MILP1 optimization', 500)


@app.route('/preprocess', methods=['POST'])
@require_auth
def preprocess_input():
    """
    Returns the standardized GUI JSON after cycle-length averaging,
    showing the before/after for each junction's phases_s and queue times.
    """
    try:
        gui_input = request.get_json()

        if not gui_input:
            return error_response('No JSON data provided', 400)

        is_valid, error_msg = validate_optimize_input(gui_input)
        if not is_valid:
            return error_response(error_msg, 400)

        standardized = standardize_cycle_lengths(gui_input)

        # Build a before/after summary per junction
        original_junctions  = gui_input.get('junctions', [])
        standard_junctions  = standardized.get('junctions', [])
        original_queue_out  = gui_input.get('queueOut_s', [])
        original_queue_in   = gui_input.get('queueIn_s', [])
        standard_queue_out  = standardized.get('queueOut_s', [])
        standard_queue_in   = standardized.get('queueIn_s', [])

        summary = []
        for idx, (orig, std) in enumerate(zip(original_junctions, standard_junctions)):
            orig_cycle = sum(orig.get('phases_s', []))
            std_cycle  = sum(std.get('phases_s', []))
            summary.append({
                'junction':           orig.get('name', f'J{idx+1}'),
                'original_phases_s':  orig.get('phases_s', []),
                'original_cycle_s':   round(orig_cycle, 1),
                'standardized_phases_s': std.get('phases_s', []),
                'standardized_cycle_s':  round(std_cycle, 1),
                'scale_factor':       round(std_cycle / orig_cycle, 4) if orig_cycle else None,
                'original_queueOut_s':    original_queue_out[idx] if idx < len(original_queue_out) else None,
                'standardized_queueOut_s': standard_queue_out[idx] if idx < len(standard_queue_out) else None,
                'original_queueIn_s':     original_queue_in[idx]  if idx < len(original_queue_in)  else None,
                'standardized_queueIn_s': standard_queue_in[idx]  if idx < len(standard_queue_in)  else None,
            })

        avg_cycle = sum(s['standardized_cycle_s'] for s in summary) / len(summary) if summary else 0

        response_data = {
            'status':           'ok',
            'num_junctions':    len(standard_junctions),
            'average_cycle_s':  round(avg_cycle, 1),
            'summary':          summary,
            'standardized_input': standardized,
        }

        return Response(
            json.dumps(response_data, indent=2, sort_keys=False),
            mimetype='application/json'
        ), 200

    except Exception as e:
        log_error('/preprocess', e)
        return error_response('Failed to preprocess input', 400)


@app.route('/validate', methods=['POST'])
@require_auth
def validate_input():
    """
    Validate GUI JSON input without running optimization
    Returns the translated MILP format for inspection
    """
    try:
        gui_input = request.get_json()

        if not gui_input:
            return error_response('No JSON data provided', 400)

        is_valid, error_msg = validate_optimize_input(gui_input)
        if not is_valid:
            return jsonify({'status': 'invalid', 'error': error_msg}), 400

        # Translate and return MILP format for inspection
        milp_input = gui_to_milp(gui_input)

        # Create response with preserved order
        from collections import OrderedDict
        response_data = OrderedDict([
            ('status', 'valid'),
            ('gui_input', gui_input),
            ('milp_input', milp_input),
            ('message', 'Input is valid and translated successfully')
        ])

        # Use json.dumps with sort_keys=False to preserve order
        json_str = json.dumps(response_data, indent=2, sort_keys=False)
        return Response(json_str, mimetype='application/json'), 200

    except Exception as e:
        log_error('/validate', e)
        return jsonify({
            'status': 'invalid',
            'error': 'Input could not be translated to MILP format'
        }), 400


# ============ Database API Endpoints ============

@app.route('/api/roles', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch roles')
def api_get_roles():
    """Get all available roles from MongoDB"""
    roles = get_available_roles()
    return jsonify({'roles': roles}), 200


@app.route('/api/users', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch users')
def api_get_users_by_role():
    """Get all users with a specific role from MongoDB"""
    role = request.args.get('role', 'client')
    users = get_users_by_role(role)
    return jsonify({'users': users}), 200


@app.route('/api/clients', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch clients')
def api_get_clients():
    """Get all clients from MongoDB (backward compatible)"""
    clients = get_all_clients()
    return jsonify({'clients': clients}), 200


@app.route('/api/clients/<client_id>/projects', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch projects')
def api_get_client_projects(client_id):
    """Get all projects for a specific client"""
    projects = get_projects_by_client(client_id)
    return jsonify({'projects': projects}), 200


@app.route('/api/projects/<project_id>', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch project')
def api_get_project(project_id):
    """Get project details with junctions"""
    project = get_project_with_junctions(project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404
    return jsonify({'project': project}), 200


@app.route('/api/projects/<project_id>/subsystems', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch subsystems')
def api_get_project_subsystems(project_id):
    """Get all subsystems for a project from sascoos collection"""
    subsystems = get_subsystems_by_project(project_id)
    return jsonify({
        'subsystems': subsystems,
        'count': len(subsystems)
    }), 200


@app.route('/api/projects/<project_id>/timings', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch timings')
def api_get_project_timings(project_id):
    """Get latest timings for a project"""
    reason = request.args.get('reason')  # Optional: 'schedule' or 'adaptive'
    timings = get_latest_timings(project_id, reason)
    if not timings:
        return jsonify({'error': 'No timings found', 'timings': None}), 200
    return jsonify({'timings': timings}), 200


@app.route('/api/projects/<project_id>/timings/history', methods=['GET'])
@require_auth
@db_endpoint('Failed to fetch timing history')
def api_get_timing_history(project_id):
    """Get timing history for a project"""
    limit = request.args.get('limit', 10, type=int)
    # Limit the max to prevent abuse
    limit = min(limit, 100)
    history = get_timing_history(project_id, limit)
    return jsonify({'history': history}), 200


@app.route('/api/projects/<project_id>/timings/search', methods=['GET'])
@require_auth
@db_endpoint('Failed to search timings')
def api_search_timings(project_id):
    """
    Search timing plans within a date range

    Query params:
        subsystem: Filter by subsystem name (required)
        start_date: ISO format date string (e.g., '2024-01-01')
        end_date: ISO format date string
        limit: Max number of results (default 50)
    """
    subsystem = request.args.get('subsystem')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    limit = request.args.get('limit', 50, type=int)
    # Limit the max to prevent abuse
    limit = min(limit, 200)

    timings = get_timings_in_range(project_id, subsystem, start_date, end_date, limit)
    return jsonify({
        'timings': timings,
        'count': len(timings)
    }), 200


@app.route('/api/timings/<timing_id>/load', methods=['GET'])
@require_auth
@db_endpoint('Failed to load timing')
def api_load_timing(timing_id):
    """
    Load a specific timing plan by ID and return GUI-compatible format.
    Requires project_id as query param to get junction details.
    """
    project_id = request.args.get('project_id')
    if not project_id:
        return jsonify({'error': 'project_id query param required'}), 400

    # Get the timing data
    timing = get_timing_by_id(timing_id)
    if not timing:
        return jsonify({'error': 'Timing not found'}), 404

    # Get project with junctions
    project = get_project_with_junctions(project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Transform to GUI format
    gui_data = transform_to_gui_format(project, timing)

    return jsonify({
        'success': True,
        'data': gui_data,
        'timing': {
            'id': timing['id'],
            'date': timing['date'],
            'reason': timing['reason'],
            'cycle': timing['cycle']
        }
    }), 200


@app.route('/api/projects/<project_id>/load', methods=['GET'])
@require_auth
@db_endpoint('Failed to load project')
def api_load_project_for_gui(project_id):
    """
    Load a project with its latest timings in GUI-compatible format.
    This is the main endpoint for loading data into the GUI.
    """
    # Get project with junctions
    project = get_project_with_junctions(project_id)
    if not project:
        return jsonify({'error': 'Project not found'}), 404

    # Get latest timings (prefer 'schedule' over 'adaptive')
    timings = get_latest_timings(project_id, 'schedule')
    if not timings:
        timings = get_latest_timings(project_id)  # Get any timing

    # Transform to GUI format
    gui_data = transform_to_gui_format(project, timings)

    return jsonify({
        'success': True,
        'data': gui_data
    }), 200


@app.route('/api/db/status', methods=['GET'])
@require_auth
def api_db_status():
    """Check database connection status"""
    if not DB_AVAILABLE:
        return jsonify({
            'connected': False,
            'error': 'Database module not available'
        }), 200

    try:
        from db import get_db
        db = get_db()
        # Try a simple operation to verify connection
        db.list_collection_names()
        return jsonify({
            'connected': True,
            'database': 'advancti'
        }), 200
    except Exception as e:
        # Log the real error server-side; the raw message can expose cluster
        # hostnames and other infrastructure details.
        log_error('/api/db/status', e)
        return jsonify({
            'connected': False,
            'error': 'Could not connect to the database'
        }), 200


@app.errorhandler(404)
def page_not_found(e):
    return jsonify({
        'error': 'Endpoint not found',
        'message': 'Check your URL. Available endpoints: /, /optimize, /health, /validate, /api/*'
    }), 404


if __name__ == '__main__':
    import socket

    # Resolve run configuration (host defaults to loopback; debug is force-
    # disabled on non-loopback hosts to prevent RCE via the Werkzeug debugger).
    host, port, debug = resolve_run_config()

    # Only print startup message once (in reloader process)
    # This prevents duplicate messages when debug=True
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        # Get local IP address
        try:
            hostname = socket.gethostname()
            local_ip = socket.gethostbyname(hostname)
        except:
            local_ip = "Unable to detect"

        print("\n" + "="*60)
        print("Frontend API Server Starting...")
        print("="*60)
        print("Service: Traffic Signal Optimization - Frontend API")
        print(f"Port: {port}")
        print(f"Bind host: {host}  (debug={debug})")
        print(f"Local access: http://localhost:{port}")
        if host not in _LOCALHOST_HOSTS:
            print(f"Network access: http://{local_ip}:{port}")
        else:
            print("Network access: disabled (set FLASK_HOST=0.0.0.0 to enable)")
        print("\nEndpoints:")
        print("  - GET  /         : Service info")
        print("  - GET  /health   : Health check")
        print("  - POST /optimize : Main optimization (MILP2)")
        print("  - POST /validate : Validate input without optimizing")
        print("\nNOTE: If colleagues can't connect, check Windows Firewall!")
        print("="*60 + "\n")

    app.run(host=host, port=port, debug=debug)
