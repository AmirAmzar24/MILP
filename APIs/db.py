"""
MongoDB Database Connection Module

Handles connection to the advancti MongoDB database and provides
helper functions for fetching data.
"""

import logging
import os
from pymongo import MongoClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# MongoDB connection string from environment variable
MONGO_URI = os.getenv('MONGO_URI', '')

# Lazy connection - only connect when needed
_client = None
_db = None


def get_db():
    """Get MongoDB database connection (lazy initialization)"""
    global _client, _db

    if _db is None:
        if not MONGO_URI:
            raise ValueError("MONGO_URI environment variable not set")

        _client = MongoClient(MONGO_URI)
        _db = _client['advancti_demo']

    return _db


def close_connection():
    """Close MongoDB connection"""
    global _client, _db
    if _client:
        _client.close()
        _client = None
        _db = None


# ============ Client/User Functions ============

def get_available_roles():
    """
    Get all unique roles from the users collection
    Returns: List of role strings
    """
    db = get_db()
    roles = db['users'].distinct('role')
    # Filter out None/empty and sort
    return sorted([r for r in roles if r])


def get_users_by_role(role: str = 'client'):
    """
    Get all users with a specific role that have at least one project

    Args:
        role: The role to filter by (e.g., 'client', 'contractor')

    Returns: List of users with _id, name, nick, projectCount
    """
    db = get_db()
    # Only return users that have at least one project
    users = db['users'].find(
        {
            'role': role,
            'projects': {'$exists': True, '$not': {'$size': 0}}
        },
        {'_id': 1, 'name': 1, 'nick': 1, 'projects': 1}
    ).sort('name', 1)

    return [
        {
            'id': str(u['_id']),
            'name': u.get('name', 'Unknown'),
            'nick': u.get('nick', ''),
            'projectCount': len(u.get('projects', []))
        }
        for u in users
    ]


def get_all_clients():
    """
    Get all clients (users with role='client')
    Returns: List of clients with _id, name, nick

    Note: This is kept for backward compatibility.
    Use get_users_by_role() for more flexibility.
    """
    return get_users_by_role('client')


# ============ Project Functions ============

def get_projects_by_client(client_id: str):
    """
    Get all projects for a specific client
    """
    db = get_db()

    try:
        client_oid = ObjectId(client_id)
    except Exception as e:
        logger.debug("Invalid client_id '%s': %s", client_id, e)
        return []

    projects = db['projects'].find(
        {'client': client_oid},
        {'_id': 1, 'name': 1, 'location': 1, 'junctions': 1, 'description': 1}
    ).sort('name', 1)

    return [
        {
            'id': str(p['_id']),
            'name': p.get('name', 'Unknown'),
            'location': p.get('location', ''),
            'description': p.get('description', ''),
            'junctionCount': len(p.get('junctions', []))
        }
        for p in projects
    ]


def get_project_with_junctions(project_id: str):
    """
    Get a project with full junction details
    """
    db = get_db()

    try:
        project_oid = ObjectId(project_id)
    except Exception as e:
        logger.debug("Invalid project_id '%s': %s", project_id, e)
        return None

    # Get project
    project = db['projects'].find_one({'_id': project_oid})
    if not project:
        return None

    # Get junction IDs from project
    junction_oids = project.get('junctions', [])

    # Fetch junction details
    junctions = list(db['junctions'].find(
        {'_id': {'$in': junction_oids}},
        {
            '_id': 1,
            'identifier': 1,
            'name': 1,
            'location': 1,
            'distance': 1,
            'position': 1,
            'pathType': 1
        }
    ))

    # Create a map to preserve order from project.junctions array
    junction_map = {str(j['_id']): j for j in junctions}

    # Order junctions as they appear in project
    ordered_junctions = []
    for joid in junction_oids:
        j = junction_map.get(str(joid))
        if j:
            ordered_junctions.append({
                'id': str(j['_id']),
                'identifier': j.get('identifier', ''),
                'name': j.get('name', 'Unknown'),
                'location': j.get('location', ''),
                'distance': j.get('distance', 0),
                'position': j.get('position', {}),
                'pathType': j.get('pathType', 'phase-single')
            })

    return {
        'id': str(project['_id']),
        'name': project.get('name', 'Unknown'),
        'location': project.get('location', ''),
        'description': project.get('description', ''),
        'junctions': ordered_junctions
    }


# ============ Subsystem Functions ============

def get_subsystems_by_project(project_id: str):
    """
    Get all distinct subsystems for a project from sascoos collection

    Args:
        project_id: The project ObjectId as string

    Returns:
        List of subsystem names/IDs found in sascoos for this project
    """
    db = get_db()

    try:
        project_oid = ObjectId(project_id)
    except Exception as e:
        logger.debug("Invalid project_id '%s': %s", project_id, e)
        return []

    # Get distinct subsystem values for this project
    subsystems = db['sascoos'].distinct('subsystem', {'project': project_oid})

    # Filter out None/empty and sort
    return sorted([s for s in subsystems if s])


# ============ Timing/Schedule Functions ============

def get_latest_timings(project_id: str, subsystem: str = None, reason: str = None):
    """
    Get the latest timings from sascoos collection for a project

    Args:
        project_id: The project ObjectId as string
        subsystem: Filter by subsystem name
        reason: Filter by reason ('schedule', 'adaptive', or None for latest)

    Returns:
        Latest timing data with junction_plan containing splits and offsets
    """
    db = get_db()

    try:
        project_oid = ObjectId(project_id)
    except Exception as e:
        logger.debug("Invalid project_id '%s': %s", project_id, e)
        return None

    # Build query
    query = {'project': project_oid}
    if subsystem:
        query['subsystem'] = subsystem
    if reason:
        query['data.reason'] = reason

    timing = db['sascoos'].find_one(
        query,
        sort=[('date', -1)]  # Most recent first
    )

    if not timing:
        return None

    data = timing.get('data', {})
    junction_plan = data.get('junction_plan', {})

    return {
        'id': str(timing['_id']),
        'date': timing.get('date'),
        'reason': data.get('reason', 'unknown'),
        'cycle': data.get('cur_cycle_len', data.get('cycle', 0)),
        'junctionPlan': {
            jid: {
                'split': jp.get('split', {}),
                'offset': jp.get('offset', 0),
                'plan': jp.get('plan', 0)
            }
            for jid, jp in junction_plan.items()
        }
    }


def get_timing_history(project_id: str, limit: int = 10):
    """
    Get timing history for a project
    """
    db = get_db()

    try:
        project_oid = ObjectId(project_id)
    except Exception as e:
        logger.debug("Invalid project_id '%s': %s", project_id, e)
        return []

    timings = db['sascoos'].find(
        {'project': project_oid},
        {'_id': 1, 'date': 1, 'data.reason': 1, 'data.cur_cycle_len': 1}
    ).sort('date', -1).limit(limit)

    return [
        {
            'id': str(t['_id']),
            'date': t.get('date'),
            'reason': t.get('data', {}).get('reason', 'unknown'),
            'cycle': t.get('data', {}).get('cur_cycle_len', 0)
        }
        for t in timings
    ]


def get_timings_in_range(project_id: str, subsystem: str = None, start_date: str = None, end_date: str = None, limit: int = 50):
    """
    Get timing plans within a date range for a project

    Args:
        project_id: The project ObjectId as string
        subsystem: Filter by subsystem name
        start_date: ISO format date string (e.g., '2024-01-01T00:00:00')
        end_date: ISO format date string
        limit: Maximum number of results to return

    Returns:
        List of timing entries with id, date, reason, cycle
    """
    from datetime import datetime

    db = get_db()

    try:
        project_oid = ObjectId(project_id)
    except Exception as e:
        logger.debug("Invalid project_id '%s': %s", project_id, e)
        return []

    # Build query with date range
    query = {'project': project_oid}
    if subsystem:
        query['subsystem'] = subsystem

    if start_date or end_date:
        date_query = {}
        if start_date:
            try:
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                date_query['$gte'] = start_dt
            except Exception as e:
                logger.debug("Invalid start_date '%s': %s", start_date, e)
        if end_date:
            try:
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                date_query['$lte'] = end_dt
            except Exception as e:
                logger.debug("Invalid end_date '%s': %s", end_date, e)
        if date_query:
            query['date'] = date_query

    timings = db['sascoos'].find(
        query,
        {'_id': 1, 'date': 1, 'data.reason': 1, 'data.cur_cycle_len': 1, 'data.cur_plan': 1}
    ).sort('date', -1).limit(limit)

    results = []
    for t in timings:
        date_val = t.get('date')
        # Convert datetime to ISO string for JSON serialization
        if date_val:
            if hasattr(date_val, 'isoformat'):
                date_str = date_val.isoformat()
            else:
                date_str = str(date_val)
        else:
            date_str = None

        results.append({
            'id': str(t['_id']),
            'date': date_str,
            'reason': t.get('data', {}).get('reason', 'unknown'),
            'cycle': t.get('data', {}).get('cur_cycle_len', 0),
            'plan': t.get('data', {}).get('cur_plan', 0)
        })

    return results


def get_timing_by_id(timing_id: str):
    """
    Get a specific timing entry by its ID

    Args:
        timing_id: The timing document ObjectId as string

    Returns:
        Timing data with junction_plan containing splits and offsets
    """
    db = get_db()

    try:
        timing_oid = ObjectId(timing_id)
    except Exception as e:
        logger.debug("Invalid timing_id '%s': %s", timing_id, e)
        return None

    timing = db['sascoos'].find_one({'_id': timing_oid})

    if not timing:
        return None

    data = timing.get('data', {})
    junction_plan = data.get('junction_plan', {})

    date_val = timing.get('date')
    if date_val and hasattr(date_val, 'isoformat'):
        date_str = date_val.isoformat()
    else:
        date_str = str(date_val) if date_val else None

    return {
        'id': str(timing['_id']),
        'date': date_str,
        'reason': data.get('reason', 'unknown'),
        'cycle': data.get('cur_cycle_len', data.get('cycle', 0)),
        'plan': data.get('cur_plan', 0),
        'junctionPlan': {
            jid: {
                'split': jp.get('split', {}),
                'offset': jp.get('offset', 0),
                'plan': jp.get('plan', 0)
            }
            for jid, jp in junction_plan.items()
        }
    }


# ============ Data Transformation for GUI ============

def transform_to_gui_format(project_data: dict, timing_data: dict = None):
    """
    Transform MongoDB data to GUI-compatible format

    The GUI expects:
    {
        junctions: [{id, name, position_m, offset_s, lost_s, phases_s, ...}],
        travelOut_s: [],
        travelIn_s: [],
        queueOut_s: [],
        queueIn_s: [],
        optimization: {...}
    }
    """
    if not project_data:
        return None

    all_junctions = project_data.get('junctions', [])
    junction_plan = timing_data.get('junctionPlan', {}) if timing_data else {}

    # CRITICAL: Sort junctions by position (distance) to ensure correct travel time calculations
    # and proper greenband rendering in the time-space diagram
    all_junctions = sorted(all_junctions, key=lambda j: j.get('distance', 0))

    # Filter to only include junctions that exist in sascoos timing data
    # This ensures we only show junctions with actual timing data, not all project junctions
    junctions = [j for j in all_junctions if j.get('identifier', '') in junction_plan]

    gui_junctions = []

    for i, j in enumerate(junctions):
        identifier = j.get('identifier', '')
        jp = junction_plan.get(identifier, {})

        # Get phase splits from timing data
        splits = jp.get('split', {})
        # Convert split dict {1: 57, 2: 45, 3: 36} to phases array
        # Note: splits are individual phase durations (not cumulative)
        phase_times = []
        if splits:
            sorted_keys = sorted(splits.keys(), key=lambda x: int(x))
            for key in sorted_keys:
                phase_times.append(splits[key])

        # Skip junctions without timing data (should not happen after filtering)
        if not phase_times:
            continue

        # Distance field is absolute distance from first junction
        position_m = j.get('distance', 0)

        gui_junction = {
            'id': j.get('id', identifier),
            'dbId': j.get('id'),  # Keep MongoDB ID reference
            'identifier': identifier,
            'name': j.get('name', f'Junction {i+1}'),
            'position_m': position_m,
            'offset_s': jp.get('offset', 0),
            'lost_s': 7,  # Default lost time
            'phases_s': phase_times,
            'outboundIdx': [0],  # Default: first phase is outbound
            'inboundIdx': [len(phase_times) // 2] if len(phase_times) > 1 else [0],
            'phaseNames': [f'P{k+1}' for k in range(len(phase_times))],
            'enabled': True
        }

        gui_junctions.append(gui_junction)

    # Calculate travel times from distance differences between consecutive junctions
    # Distance field is absolute from first junction, so we need the difference
    travel_times = []
    for i in range(1, len(junctions)):
        prev_position = junctions[i-1].get('distance', 0)
        curr_position = junctions[i].get('distance', 0)
        link_distance = abs(curr_position - prev_position)

        # Convert distance (meters) to travel time at ~50 km/h average
        # time = distance / speed = distance_m / (50000/3600) = distance * 3600 / 50000
        travel_time = round(link_distance * 3600 / 50000) if link_distance else 30
        travel_times.append(max(travel_time, 10))  # Minimum 10 seconds

    # Get cycle time from timing data
    cycle = timing_data.get('cycle', 150) if timing_data else 150

    return {
        'junctions': gui_junctions,
        'travelOut_s': travel_times,
        'travelIn_s': travel_times.copy(),
        'queueOut_s': [5] * len(travel_times),
        'queueIn_s': [5] * len(travel_times),
        'optimization': {
            'cycleRange': [max(60, cycle - 30), min(200, cycle + 30)],
            'speedRange_kmh': [40, 70],
            'speedChangeRange_kmh': [-15, 15],
            'defaultRed_s': 3,
            'defaultAmber_s': 3,
            'k': 1,
            'flag': 1,
            'masterJunctionId': gui_junctions[0]['id'] if gui_junctions else None
        },
        'metadata': {
            'source': 'mongodb',
            'projectId': project_data.get('id'),
            'projectName': project_data.get('name'),
            'timingDate': str(timing_data.get('date')) if timing_data else None,
            'timingReason': timing_data.get('reason') if timing_data else None
        }
    }
