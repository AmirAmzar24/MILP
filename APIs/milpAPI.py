from flask import Flask, request, jsonify
import logging
import traceback
import sys
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add parent directory to path to import MILP modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'milp-code'))

import milp1FINAL
import milp2FINAL

app = Flask(__name__)

# Prevents Flask from propagating exceptions
app.config['PROPAGATE_EXCEPTIONS'] = False

# Cap request size (10MB) to prevent DoS via large payloads
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

# SECURITY WARNING: this legacy endpoint is UNAUTHENTICATED. Do not expose it
# publicly - run it on localhost only. The authenticated frontendAPI.py is the
# supported entry point.

# Filter out all warnings
import warnings
warnings.filterwarnings("ignore")

@app.route('/')
def hello_world():
    return "Hello World!"

@app.route('/milp1', methods=['POST'])
def milp1Func():
    try:
        data = request.get_json()
        output = milp1FINAL.callback(data['phase'], data['phaseID'], data['phaseRed'], data['outbound'], 
                                    data['inbound'], data['travel_time'], data['queue_time'])
        return jsonify(output), 200
    except KeyError as e:
            logger.error("KeyError in /milp1: %s", traceback.format_exc())
            return jsonify({
                'error': f"Missing key: {str(e)}"
            }), 400
    except Exception:
            logger.error("Error in /milp1: %s", traceback.format_exc())
            return jsonify({
                'error': 'An error occurred. Check for syntax errors (like , or []) or incomplete/incorrect input data'
            }), 400

@app.route('/milp2', methods=['POST'])
def milp2Func():
    try:
        data = request.get_json()
        output = milp2FINAL.callback(data['phase'], data['phaseID'], data['phaseRed'], data['phaseAmber'], data['outbound'],
                                data['inbound'], data['queue_time'], data['k'], data['speedRange'],
                                data['speedChangeRange'], data['distance'], data['cycleRange'], data['flag'])
        return jsonify(output), 200
    except KeyError as e:
            logger.error("KeyError in /milp2: %s", traceback.format_exc())
            return jsonify({
                'error': f"Missing key: {str(e)}"
            }), 400
    except Exception:
            logger.error("Error in /milp2: %s", traceback.format_exc())
            return jsonify({
                'error': 'An error occurred. Check for syntax errors (like , or []) or incomplete/incorrect input data'
            }), 400


@app.errorhandler(404)
def page_not_found(e):
    return 'Page not found. Check your URL (endpoint)', 404

if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 4000))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    app.run(port=port, debug=debug)