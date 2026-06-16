import sys
import os

# Make APIs/ importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
# Make milp-code/ importable (api_translator.py doesn't need it, but good to have)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "milp-code"))
