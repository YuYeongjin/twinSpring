"""
Node: BIM Builder node (Ollama - gemma3:12b)

Supports multi-step conversation:
1. Parse BIM action with LLM (leveraging gemma3:12b's strong understanding)
2. Ask user for missing information (store in pending_action)
3. Call Spring BIM API once all information is gathered

pending_action internal structure:
{
  "action": "createElement",
  "elementType": "IfcColumn",
  "material": "Concrete",
  "positionX": null,    <- not yet known
  "positionY": null,
  "positionZ": null,
  "sizeX": 0.5,
  "sizeY": 3.0,
  "sizeZ": 0.5,
  "projectId": "proj-001",
  "_missing": ["positionX", "positionY", "positionZ"]
}
"""
from __future__ import annotations

import json
import math
import re
import uuid
import httpx
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from state import AgentState
from llm_config import llm_precise
from config import SPRING_BASE_URL
from lang_util import detect_lang, translate_reply

# Default element sizes by type: (sizeX, sizeY, sizeZ) unit: m
_DEFAULT_SIZES = {
    "IfcColumn": (0.5, 3.0, 0.5),
    "IfcBeam":   (5.0, 0.4, 0.4),
    "IfcWall":   (5.0, 3.0, 0.2),
    "IfcSlab":   (5.0, 0.2, 5.0),
    "IfcPier":   (1.0, 5.0, 1.0),
}

_TYPE_EN = {
    "IfcColumn": "Column",
    "IfcBeam":   "Beam",
    "IfcWall":   "Wall",
    "IfcSlab":   "Slab",
    "IfcPier":   "Pier",
}

def _gen_leaning_tower() -> list[tuple]:
    """Leaning Tower of Pisa: 5-floor octagonal columns + slabs (lean 0.35m/floor)"""
    els = []
    floors, floor_h, radius, lean = 5, 5.5, 6.5, 0.35
    for f in range(floors):
        x_off = round(f * lean, 2)
        for c in range(8):
            a = (c / 8) * math.pi * 2
            els.append((
                "IfcColumn", "Concrete C40",
                round(x_off + radius * math.cos(a), 2), f * floor_h,
                round(radius * math.sin(a), 2),
                1.0, floor_h, 1.0,
            ))
        els.append(("IfcSlab", "Concrete C35", x_off, (f + 1) * floor_h, 0.0, 15.0, 0.4, 15.0))
    # Bell tower
    els.append(("IfcSlab", "Concrete C50", round(floors * lean, 2), floors * floor_h, 0.0, 7.0, 3.5, 7.0))
    return els


def _gen_pyramid() -> list[tuple]:
    """Egyptian Pyramid: 9-tier stepped slabs"""
    data = [(60,0),(50,3),(40,6),(30,9),(22,12),(15,15),(10,18),(6,21),(2,24)]
    return [("IfcSlab", "Concrete C25", 0.0, y, 0.0, float(s), 3.0, float(s)) for s, y in data]


def _gen_incheon_bridge() -> list[tuple]:
    """Incheon Bridge (cable-stayed): 2 A-type pylons + cables + approach spans (simplified)"""
    els = []
    tX, tH, tFH = 42, 25, 1.5
    deckY, deckH = 9, 0.8
    deckCY = deckY + deckH / 2
    tTopY = tFH + tH   # 26.5
    cAttY = tTopY - 1.5  # 25

    # Pylon foundations
    for tx in [-tX, tX]:
        els.append(("IfcSlab", "Concrete C60", tx, 0, 0, 10, tFH, 18))

    # Pylon columns (A-type: 2 per pylon, front and back)
    for tx in [-tX, tX]:
        for tz in [-4.5, 4.5]:
            els.append(("IfcColumn", "Concrete C60", tx, tFH, tz, 2, tH, 2))

    # Pylon crossbeams (top + middle)
    for tx in [-tX, tX]:
        els.append(("IfcBeam", "Concrete C60", tx, tTopY - 1, 0, 1.2, 1.5, 12))
        els.append(("IfcBeam", "Concrete C60", tx, 12, 0, 1.2, 1.2, 12))

    # Main span deck
    els.append(("IfcSlab", "Prestressed Concrete", 0, deckY, 0, tX * 2 + 4, deckH, 16))

    # Stay cable approximation — thin vertical elements (simplified)
    for d in [10, 20, 30, 38]:
        for side in [-1, 1]:
            h = cAttY - deckCY
            ancX_L = -tX + d
            ancX_R =  tX - d
            els.append(("IfcBeam", "Steel Grade A", ancX_L, deckCY + h * 0.5 - 0.125, side * 6.5, 0.3, h, 0.3))
            els.append(("IfcBeam", "Steel Grade A", ancX_R, deckCY + h * 0.5 - 0.125, side * 6.5, 0.3, h, 0.3))

    # Approach piers
    for px in [-73, -58, 58, 73]:
        els.append(("IfcPier", "Concrete C50", px, 0, 0, 5, 9, 14))

    # Approach decks
    els.append(("IfcSlab", "Prestressed Concrete", -57.5, deckY, 0, 34, deckH, 16))
    els.append(("IfcSlab", "Prestressed Concrete",  57.5, deckY, 0, 34, deckH, 16))

    return els


def _gen_eiffel_tower() -> list[tuple]:
    """Eiffel Tower: 3-floor steel tower + spire"""
    return [
        ("IfcPier",   "Steel Grade A",  -18, 0,    -18, 3.0, 20, 3.0),
        ("IfcPier",   "Steel Grade A",   18, 0,    -18, 3.0, 20, 3.0),
        ("IfcPier",   "Steel Grade A",  -18, 0,     18, 3.0, 20, 3.0),
        ("IfcPier",   "Steel Grade A",   18, 0,     18, 3.0, 20, 3.0),
        ("IfcBeam",   "Steel Grade A",    0, 10,   -18, 39,  0.8, 0.8),
        ("IfcBeam",   "Steel Grade A",    0, 10,    18, 39,  0.8, 0.8),
        ("IfcBeam",   "Steel Grade A",  -18, 10,     0, 0.8, 0.8, 39),
        ("IfcBeam",   "Steel Grade A",   18, 10,     0, 0.8, 0.8, 39),
        ("IfcSlab",   "Steel Grade A",    0, 20,     0, 40,  0.5, 40),
        ("IfcColumn", "Steel Grade A",  -11, 20.5, -11, 2.0, 18, 2.0),
        ("IfcColumn", "Steel Grade A",   11, 20.5, -11, 2.0, 18, 2.0),
        ("IfcColumn", "Steel Grade A",  -11, 20.5,  11, 2.0, 18, 2.0),
        ("IfcColumn", "Steel Grade A",   11, 20.5,  11, 2.0, 18, 2.0),
        ("IfcSlab",   "Steel Grade A",    0, 38.5,   0, 26,  0.5, 26),
        ("IfcColumn", "Steel Grade A",   -5, 39,    -5, 1.5, 20, 1.5),
        ("IfcColumn", "Steel Grade A",    5, 39,    -5, 1.5, 20, 1.5),
        ("IfcColumn", "Steel Grade A",   -5, 39,     5, 1.5, 20, 1.5),
        ("IfcColumn", "Steel Grade A",    5, 39,     5, 1.5, 20, 1.5),
        ("IfcSlab",   "Steel Grade A",    0, 59,     0, 14,  0.5, 14),
        ("IfcColumn", "Steel Grade A",    0, 59.5,   0, 1.0, 30, 1.0),
    ]


COMPOSITE_TEMPLATES: dict[str, dict] = {
    "pier": {
        "name": "Bridge Pier",
        "desc": "Foundation slab + 2 columns + cap beam",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0,  0.0, 0.0, 6.0, 0.5, 3.0),
            ("IfcColumn", "Concrete", -2.0,  0.5, 0.0, 0.6, 4.0, 0.6),
            ("IfcColumn", "Concrete",  2.0,  0.5, 0.0, 0.6, 4.0, 0.6),
            ("IfcBeam",   "Concrete",  0.0,  4.5, 0.0, 5.0, 0.8, 1.2),
        ],
    },
    "building_frame": {
        "name": "Building Frame",
        "desc": "Floor slab + 4 columns + 4 perimeter beams",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0,  0.0,  0.0, 8.0, 0.3, 8.0),
            ("IfcColumn", "Concrete", -3.5,  0.3, -3.5, 0.5, 3.0, 0.5),
            ("IfcColumn", "Concrete",  3.5,  0.3, -3.5, 0.5, 3.0, 0.5),
            ("IfcColumn", "Concrete", -3.5,  0.3,  3.5, 0.5, 3.0, 0.5),
            ("IfcColumn", "Concrete",  3.5,  0.3,  3.5, 0.5, 3.0, 0.5),
            ("IfcBeam",   "Steel",     0.0,  3.3, -3.5, 7.5, 0.5, 0.4),
            ("IfcBeam",   "Steel",     0.0,  3.3,  3.5, 7.5, 0.5, 0.4),
            ("IfcBeam",   "Steel",    -3.5,  3.3,  0.0, 0.4, 0.5, 7.5),
            ("IfcBeam",   "Steel",     3.5,  3.3,  0.0, 0.4, 0.5, 7.5),
        ],
    },
    "bridge_span": {
        "name": "Bridge Span",
        "desc": "2 piers + main girder + deck slab",
        "elements": [
            ("IfcSlab",   "Concrete",  0.0, 0.0, 0.0,  3.0, 0.4, 2.0),
            ("IfcColumn", "Concrete",  0.0, 0.4, 0.0,  0.8, 4.0, 0.8),
            ("IfcBeam",   "Concrete",  0.0, 4.4, 0.0,  3.0, 0.6, 1.0),
            ("IfcSlab",   "Concrete", 10.0, 0.0, 0.0,  3.0, 0.4, 2.0),
            ("IfcColumn", "Concrete", 10.0, 0.4, 0.0,  0.8, 4.0, 0.8),
            ("IfcBeam",   "Concrete", 10.0, 4.4, 0.0,  3.0, 0.6, 1.0),
            ("IfcBeam",   "Steel",     5.0, 5.0, 0.0, 11.0, 0.8, 0.6),
            ("IfcSlab",   "Concrete",  5.0, 5.8, 0.0, 11.5, 0.3, 3.0),
        ],
    },
    "leaning_tower": {
        "name": "Leaning Tower of Pisa",
        "desc": "5-floor octagonal tower · ~3.9° lean · 46 elements",
        "elements": _gen_leaning_tower(),
    },
    "eiffel_tower": {
        "name": "Eiffel Tower",
        "desc": "3-floor steel tower · includes spire · 20 elements",
        "elements": _gen_eiffel_tower(),
    },
    "pyramid": {
        "name": "Egyptian Pyramid",
        "desc": "9-tier stepped pyramid · decreasing size per tier · 9 elements",
        "elements": _gen_pyramid(),
    },
    "incheon_bridge": {
        "name": "Incheon Bridge",
        "desc": "Cable-stayed · 2 A-type pylons + cables + approach spans · 33 elements",
        "elements": _gen_incheon_bridge(),
    },
}

# Composite structure keyword pattern
_COMPOSITE_PAT = re.compile(
    r"피사의?\s*사탑|피사탑|에펠\s*탑?|에펠타워|피라미드|부르즈|이집트|골조|교각구조|교량경간"
    r"|인천대교|인천\s*교|사장교|케이블\s*교"
    r"|leaning.?tower|eiffel|pyramid|bridge.?span|building.?frame|incheon"
    r"|복합\s*구조|구조물\s*(생성|추가|만들)|랜드마크",
    re.IGNORECASE,
)

# Explicit project creation pattern
_EXPLICIT_PROJECT_PAT = re.compile(
    r"(새|신규|새로운)?\s*프로젝트\s*(생성|만들|추가|새로|시작|열기)"
    r"|프로젝트\s*(이름|명칭).{0,20}(만들|생성|추가)"
    r"|create\s*project|new\s*project",
    re.IGNORECASE,
)

# Direct composite type detection
_COMPOSITE_TYPE_PAT: list[tuple[re.Pattern, str]] = [
    (re.compile(r"피사의?\s*사탑|피사탑|leaningtower|leaning.?tower", re.I), "leaning_tower"),
    (re.compile(r"에펠\s*탑?|에펠\s*타워|eiffel", re.I),                    "eiffel_tower"),
    (re.compile(r"피라미드|이집트|pyramid", re.I),                           "pyramid"),
    (re.compile(r"인천대교|인천\s*교|사장교|케이블\s*교|incheon", re.I),      "incheon_bridge"),
    (re.compile(r"교각구조?|pier", re.I),                                   "pier"),
    (re.compile(r"건물\s*골조|골조|building.?frame", re.I),                  "building_frame"),
    (re.compile(r"교량\s*경간?|교량|bridge", re.I),                          "bridge_span"),
]

def _detect_composite_type(text: str) -> str | None:
    for pat, ct in _COMPOSITE_TYPE_PAT:
        if pat.search(text):
            return ct
    return None


# Korean / English alias → standard compositeType key
_COMPOSITE_ALIAS: dict[str, str] = {
    "교각": "pier", "pier": "pier", "교각구조": "pier",
    "건물골조": "building_frame", "골조": "building_frame",
    "건물기본골조": "building_frame", "building_frame": "building_frame",
    "교량경간": "bridge_span", "교량": "bridge_span",
    "bridge_span": "bridge_span", "bridge": "bridge_span",
    # Landmarks
    "피사의사탑": "leaning_tower", "피사탑": "leaning_tower",
    "사탑": "leaning_tower",      "leaningtower": "leaning_tower",
    "leaning_tower": "leaning_tower",
    "에펠탑": "eiffel_tower",     "에펠": "eiffel_tower",
    "eiffeltower": "eiffel_tower", "eiffel_tower": "eiffel_tower",
    "피라미드": "pyramid",        "이집트피라미드": "pyramid",
    "pyramid": "pyramid",
    # Incheon Bridge
    "인천대교": "incheon_bridge", "인천교": "incheon_bridge",
    "사장교": "incheon_bridge",   "cable.?stayed": "incheon_bridge",
    "incheon_bridge": "incheon_bridge", "incheonbridge": "incheon_bridge",
}

# System prompts

_PARSE_SYSTEM = """You are a BIM (Building Information Modeling) assistant.
Parse the user message to identify the BIM action and respond with JSON only. No explanation — JSON only.

━━ Action selection rules ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
createElement  : Add a single element (column/beam/wall/slab/pier)
createComposite: Create a composite structure with multiple elements (pier, frame, bridge, leaning tower, Eiffel Tower, pyramid, etc.)
updateElement  : Modify an existing element's properties (elementId required)
deleteElement  : Delete an existing element (elementId required)
createProject  : Create a new BIM project workspace — use ONLY when user explicitly requests "create/make a project"

⚠️ Important: If structure names like "leaning tower", "Eiffel Tower", "pyramid", "frame", or "pier" appear,
   use createComposite — NOT createProject.

Element types: IfcColumn(Column), IfcBeam(Beam), IfcWall(Wall), IfcSlab(Slab), IfcPier(Pier)
Materials: Concrete, Steel, Timber, Composite
Composite types (compositeType):
  pier=Bridge Pier, building_frame=Building Frame, bridge_span=Bridge Span,
  incheon_bridge=Incheon Bridge, leaning_tower=Leaning Tower of Pisa, eiffel_tower=Eiffel Tower, pyramid=Egyptian Pyramid

createElement format:
{{"action":"createElement","elementType":"IfcColumn","material":"Concrete","positionX":1.0,"positionY":0.0,"positionZ":2.0,"sizeX":0.5,"sizeY":3.0,"sizeZ":0.5}}

createComposite format:
{{"action":"createComposite","compositeType":"leaning_tower","baseX":0.0,"baseY":0.0,"baseZ":0.0}}

deleteElement format:
{{"action":"deleteElement","elementId":"<id>"}}

updateElement format:
{{"action":"updateElement","elementId":"<id>","positionX":1.0,...}}

createProject format:
{{"action":"createProject","projectName":"<name>","structureType":"Steel","spanCount":3}}

Use null for unknown position/size/ID values.
Output JSON only."""

_EXTRACT_SYSTEM = """Extract numeric values from the user message and respond with JSON only.
Use exactly these field names: {fields}

Rules:
- "1, 2, 0" or "1 2 0" → map to fields in order ({fields})
- "x=1, y=2, z=0" or "positionX=1" → map to the matching field
- Use null for unknown values

Example output (fields: positionX,positionY,positionZ, input: "1, 2, 0"):
{{"positionX":1.0,"positionY":2.0,"positionZ":0.0}}

Output JSON only."""


def _extract_json(text: str) -> dict | None:
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def _parse_coords_regex(text: str, missing: list[str]) -> dict:
    """
    Extract coordinate values with regex. Used as LLM fallback.
    - "1, 2, 0" / "1 2 0" → mapped in order of missing fields
    - "x=1 y=2 z=0" / "positionX=1" / "baseX=1" also handled
    """
    result = {}
    _kv_map = {
        "x": "positionX", "y": "positionY", "z": "positionZ",
        "basex": "baseX", "basey": "baseY", "basez": "baseZ",
    }

    kv_pattern = re.findall(
        r'(positionX|positionY|positionZ|baseX|baseY|baseZ|x|y|z)\s*[=:]\s*(-?\d+(?:\.\d+)?)',
        text, re.IGNORECASE,
    )
    for k, v in kv_pattern:
        key = _kv_map.get(k.lower(), k)
        if key in missing:
            result[key] = float(v)

    if all(f in result for f in missing):
        return result

    # Number-only list pattern: "1, 2, 0" or "1 2 0"
    coord_missing = [f for f in missing if f not in result and f != "compositeType"]
    numbers = re.findall(r'-?\d+(?:\.\d+)?', text)
    if len(numbers) >= len(coord_missing):
        for i, field in enumerate(coord_missing):
            result[field] = float(numbers[i])

    return result


def _apply_defaults(action: dict) -> dict:
    act = action.get("action")

    if act == "createElement":
        et = action.get("elementType") or "IfcColumn"
        action["elementType"] = et
        action["material"] = action.get("material") or "Concrete"
        defaults = _DEFAULT_SIZES.get(et, (0.5, 3.0, 0.5))
        if action.get("sizeX") is None:
            action["sizeX"] = defaults[0]
        if action.get("sizeY") is None:
            action["sizeY"] = defaults[1]
        if action.get("sizeZ") is None:
            action["sizeZ"] = defaults[2]

    elif act == "createComposite":
        raw = (action.get("compositeType") or "").lower().replace(" ", "")
        action["compositeType"] = _COMPOSITE_ALIAS.get(raw) or action.get("compositeType")

    return action


def _find_missing_fields(action: dict) -> list[str]:
    act = action.get("action")
    if act == "createElement":
        return [f for f in ("positionX", "positionY", "positionZ") if action.get(f) is None]
    if act == "createComposite":
        missing = []
        if not action.get("compositeType") or action.get("compositeType") not in COMPOSITE_TEMPLATES:
            missing.append("compositeType")
        for f in ("baseX", "baseY", "baseZ"):
            if action.get(f) is None:
                missing.append(f)
        return missing
    if act == "createProject":
        return ["projectName"] if not action.get("projectName") else []
    if act in ("deleteElement", "updateElement"):
        return ["elementId"] if not action.get("elementId") else []
    return []


def _ask_for_missing(missing: list[str], action: dict) -> str:
    act = action.get("action")
    if act == "createElement":
        et = action.get("elementType", "element")
        type_en = _TYPE_EN.get(et, et)
        mat = action.get("material", "Concrete")
        if all(f in missing for f in ("positionX", "positionY", "positionZ")):
            return (
                f"I'll add a {type_en} ({mat}).\n"
                f"Please provide the x, y, z coordinates for placement.\n"
                f"Example: 1, 0, 2  or  x=1 y=0 z=2"
            )
        field_labels = {"positionX": "x", "positionY": "y", "positionZ": "z"}
        missing_str = ", ".join(field_labels.get(f, f) for f in missing)
        return f"Please provide the {missing_str} coordinate(s)."

    if act == "createComposite":
        if "compositeType" in missing:
            types_str = "\n".join(
                f"  - {k}: {v['name']} ({v['desc']})"
                for k, v in COMPOSITE_TEMPLATES.items()
            )
            return f"Which composite structure would you like to create?\n{types_str}"
        ct = action.get("compositeType", "")
        tmpl = COMPOSITE_TEMPLATES.get(ct, {})
        name = tmpl.get("name", ct)
        count = len(tmpl.get("elements", []))
        return (
            f"I'll create a {name} structure ({count} elements).\n"
            f"Please provide the base coordinates (x, y, z).\n"
            f"Example: 0, 0, 0  or  x=5 y=0 z=3"
        )

    if act == "createProject":
        return (
            "I'll create a new BIM project.\n"
            "Please provide the project name.\n"
            "Example: Gangnam Office Tower, Hangang Bridge Repair"
        )
    if act in ("deleteElement", "updateElement"):
        verb = "delete" if act == "deleteElement" else "modify"
        return f"Please provide the ID of the element to {verb}."
    return "Please provide additional information."


def _call_spring_api(action: dict, project_id: str | None) -> tuple[bool, str]:
    base = SPRING_BASE_URL
    payload = {k: v for k, v in action.items() if not k.startswith("_") and k != "action"}
    act = action.get("action", "")
    try:
        if act == "createElement":
            if not payload.get("projectId") and project_id:
                payload["projectId"] = project_id
            if not payload.get("projectId"):
                return False, "No BIM project selected. Please select a project from the left panel first."
            if not payload.get("elementId"):
                payload["elementId"] = "ELEM-" + uuid.uuid4().hex[:8].upper()
            res = httpx.post(f"{base}/api/bim/element", json=payload, timeout=10)
            res.raise_for_status()
            return True, f"Element created. (Type: {action.get('elementType')}, Material: {action.get('material')})"

        elif act == "updateElement":
            res = httpx.put(f"{base}/api/bim/model/element", json=payload, timeout=10)
            res.raise_for_status()
            return True, f"Element (ID: {action.get('elementId')}) has been updated."

        elif act == "deleteElement":
            eid = action.get("elementId")
            res = httpx.delete(f"{base}/api/bim/element/{eid}", timeout=10)
            res.raise_for_status()
            return True, f"Element (ID: {eid}) has been deleted."

        elif act == "createComposite":
            if not payload.get("projectId") and project_id:
                payload["projectId"] = project_id
            if not payload.get("projectId"):
                return False, "No BIM project selected. Please select a project from the left panel first."

            composite_type = action.get("compositeType")
            template = COMPOSITE_TEMPLATES.get(composite_type)
            if not template:
                return False, f"Unsupported structure type: {composite_type}"

            bx = float(action.get("baseX") or 0.0)
            by = float(action.get("baseY") or 0.0)
            bz = float(action.get("baseZ") or 0.0)
            proj_id = payload["projectId"]

            elements_payload = [
                {
                    "elementId":  "ELEM-" + uuid.uuid4().hex[:8].upper(),
                    "projectId":  proj_id,
                    "elementType": el_type,
                    "material":   material,
                    "positionX":  round(bx + rx, 3),
                    "positionY":  round(by + ry, 3),
                    "positionZ":  round(bz + rz, 3),
                    "sizeX": sx, "sizeY": sy, "sizeZ": sz,
                }
                for el_type, material, rx, ry, rz, sx, sy, sz in template["elements"]
            ]

            res = httpx.post(f"{base}/api/bim/elements/batch", json=elements_payload, timeout=30)
            res.raise_for_status()
            return True, f"{template['name']} structure created. (Total: {len(elements_payload)} elements)"

        elif act == "createProject":
            if not payload.get("projectName"):
                return False, "Project name is missing. Please provide a project name."
            if "spanCount" in payload and payload["spanCount"] is not None:
                payload["spanCount"] = str(payload["spanCount"])
            res = httpx.post(f"{base}/api/bim/project", json=payload, timeout=10)
            res.raise_for_status()
            return True, f"Project '{action.get('projectName')}' has been created."

        else:
            return False, f"Unsupported action: {act}"

    except httpx.HTTPStatusError as e:
        body = ""
        try:
            body = e.response.text[:200]
        except Exception:
            pass
        return False, f"API error {e.response.status_code}: {body}"
    except httpx.ConnectError:
        return False, f"Cannot connect to Spring server ({SPRING_BASE_URL})"
    except httpx.TimeoutException:
        return False, "Spring server response timed out"
    except Exception as e:
        return False, f"Connection error: {e}"


def _build_success_reply(action: dict, message: str) -> str:
    reply = f"✅ {message}"
    act = action.get("action")
    if act == "createElement":
        reply += (
            f"\n- Type: {action.get('elementType')}"
            f"\n- Material: {action.get('material')}"
            f"\n- Position: ({action.get('positionX')}, {action.get('positionY')}, {action.get('positionZ')})"
            f"\n- Size: {action.get('sizeX')} × {action.get('sizeY')} × {action.get('sizeZ')} m"
        )
    elif act == "createComposite":
        ct = action.get("compositeType", "")
        tmpl = COMPOSITE_TEMPLATES.get(ct, {})
        reply += f"\n- Structure: {tmpl.get('name', ct)}"
        reply += f"\n- Base point: ({action.get('baseX')}, {action.get('baseY')}, {action.get('baseZ')})"
        reply += f"\n- Composition: {tmpl.get('desc', '')}"
    elif act == "createProject":
        reply += f"\n- Project name: {action.get('projectName')}"
        if action.get("structureType"):
            reply += f"\n- Structure type: {action.get('structureType')}"
        reply += "\n\nSelect the new project from the project list on the left to start BIM editing."
    return reply


_CLARIFY_MSG = (
    "I'd like to clarify what you need. Which of the following?\n\n"
    "1️⃣  Create a new BIM project (new project workspace)\n"
    "2️⃣  Add a composite structure to the current project\n"
    "   (pier, building frame, bridge, Leaning Tower, Eiffel Tower, pyramid, etc.)\n\n"
    "Reply with '1' or '2', or describe what you want in more detail."
)

_COMPOSITE_LIST_MSG = (
    "Which composite structure would you like to add?\n\n"
    "  • Bridge Pier (pier)\n"
    "  • Building Frame (building_frame)\n"
    "  • Bridge Span (bridge_span)\n"
    "  • Incheon Bridge / Cable-stayed (incheon_bridge)\n"
    "  • Leaning Tower of Pisa (leaning_tower)\n"
    "  • Eiffel Tower (eiffel_tower)\n"
    "  • Egyptian Pyramid (pyramid)\n\n"
    "Please tell me the name of the structure you want."
)


def _bim_builder_impl(state: AgentState) -> dict:
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    project_id = state.get("bim_project_id")
    pending_action = state.get("pending_action")

    # Case 1: pending_action exists

    if pending_action:

        # 1-A. Waiting for clarification (_clarify)
        clarify = pending_action.get("_clarify")
        if clarify == "project_or_composite":
            txt = user_text.lower().replace(" ", "")
            if "1" in txt or "프로젝트" in txt or "project" in txt:
                action = {"action": "createProject", "_missing": ["projectName"]}
                return {
                    "messages": [AIMessage(content=_ask_for_missing(["projectName"], action))],
                    "pending_action": action,
                }
            elif "2" in txt or any(k in txt for k in ["구조물", "추가", "골조", "교각", "교량", "피사", "에펠", "피라미드",
                                                        "composite", "structure", "pier", "frame", "bridge", "pyramid"]):
                ct = _detect_composite_type(user_text)
                if ct:
                    action = {"action": "createComposite", "compositeType": ct, "_missing": ["baseX", "baseY", "baseZ"]}
                else:
                    action = {"action": "createComposite", "_missing": ["compositeType", "baseX", "baseY", "baseZ"]}
                return {
                    "messages": [AIMessage(content=_ask_for_missing(action["_missing"], action))],
                    "pending_action": action,
                }
            else:
                # Still ambiguous → ask again
                return {
                    "messages": [AIMessage(content=_CLARIFY_MSG)],
                    "pending_action": pending_action,
                }

        # 1-B. Fill in missing values
        missing = pending_action.get("_missing", [])
        fields_str = ", ".join(missing)

        extracted: dict = {}
        if missing == ["projectName"]:
            name = user_text.strip().strip('"\'')
            if name:
                extracted["projectName"] = name
        else:
            # First: fast regex extraction
            extracted = _parse_coords_regex(user_text, missing)

            # Second: LLM supplement if still missing
            still_missing = [f for f in missing if f not in extracted or extracted[f] is None]
            if still_missing:
                try:
                    resp = llm_precise.invoke([
                        SystemMessage(content=_EXTRACT_SYSTEM.format(fields=fields_str)),
                        HumanMessage(content=user_text),
                    ])
                    llm_extracted = _extract_json(resp.content) or {}
                    _key_alias = {"x": "positionX", "y": "positionY", "z": "positionZ"}
                    for k, v in llm_extracted.items():
                        normalized = _key_alias.get(k.lower(), k)
                        if normalized in missing and v is not None and normalized not in extracted:
                            extracted[normalized] = v
                except Exception:
                    pass

        # Merge extracted values into pending_action
        action = dict(pending_action)
        for field in missing:
            if field in extracted and extracted[field] is not None:
                action[field] = extracted[field]

        # Check for still-missing fields
        new_missing = _find_missing_fields(action)
        if new_missing:
            action["_missing"] = new_missing
            return {
                "messages": [AIMessage(content=_ask_for_missing(new_missing, action))],
                "pending_action": action,
            }

        # All fields available → call API
        action.pop("_missing", None)
        action.pop("_clarify", None)
        success, message = _call_spring_api(action, project_id)
        reply = _build_success_reply(action, message) if success else f"❌ Operation failed: {message}"
        return {
            "messages": [AIMessage(content=reply)],
            "query_result": json.dumps(action, ensure_ascii=False),
            "pending_action": None,
        }

    # Case 2: New BIM request

    # 2-A. Pre-classification: direct composite keyword detection → bypass LLM
    pre_ct = _detect_composite_type(user_text)
    if pre_ct and not _EXPLICIT_PROJECT_PAT.search(user_text):
        coords = _parse_coords_regex(user_text, ["baseX", "baseY", "baseZ"])
        action: dict = {
            "action": "createComposite",
            "compositeType": pre_ct,
            "baseX": coords.get("baseX"),
            "baseY": coords.get("baseY"),
            "baseZ": coords.get("baseZ"),
        }
        if project_id:
            action["projectId"] = project_id
        missing = _find_missing_fields(action)
        if missing:
            action["_missing"] = missing
            return {
                "messages": [AIMessage(content=_ask_for_missing(missing, action))],
                "pending_action": action,
            }
        success, message = _call_spring_api(action, project_id)
        reply = _build_success_reply(action, message) if success else f"❌ Operation failed: {message}"
        return {
            "messages": [AIMessage(content=reply)],
            "query_result": json.dumps(action, ensure_ascii=False),
            "pending_action": None,
        }

    # 2-B. Composite pattern found but type unknown → ask for type
    if _COMPOSITE_PAT.search(user_text) and not _EXPLICIT_PROJECT_PAT.search(user_text):
        action = {"action": "createComposite", "_missing": ["compositeType", "baseX", "baseY", "baseZ"]}
        if project_id:
            action["projectId"] = project_id
        return {
            "messages": [AIMessage(content=_COMPOSITE_LIST_MSG)],
            "pending_action": action,
        }

    # 2-C. LLM parsing
    try:
        resp = llm_precise.invoke([
            SystemMessage(content=_PARSE_SYSTEM),
            HumanMessage(content=user_text),
        ])
        action = _extract_json(resp.content)
    except Exception:
        action = None

    if not action or not action.get("action"):
        return {
            "messages": [AIMessage(content=(
                "I could not understand your request.\n"
                "Examples:\n"
                "- 'Add a concrete column'\n"
                "- 'Create the Leaning Tower of Pisa'\n"
                "- 'Create a beam at position 1, 0, 2'\n"
                "- 'Create a new project'"
            ))],
            "pending_action": None,
        }

    # 2-D. LLM chose createProject but no explicit project keyword → ask for clarification
    if action.get("action") == "createProject" and not _EXPLICIT_PROJECT_PAT.search(user_text):
        return {
            "messages": [AIMessage(content=_CLARIFY_MSG)],
            "pending_action": {"_clarify": "project_or_composite"},
        }

    # Apply defaults and check missing fields
    action = _apply_defaults(action)
    if project_id and not action.get("projectId"):
        action["projectId"] = project_id
    missing = _find_missing_fields(action)

    if missing:
        action["_missing"] = missing
        return {
            "messages": [AIMessage(content=_ask_for_missing(missing, action))],
            "pending_action": action,
        }

    # All information ready → call API
    success, message = _call_spring_api(action, project_id)
    if success:
        reply = _build_success_reply(action, message)
    else:
        reply = f"❌ Operation failed: {message}\nPlease select a BIM project first."

    return {
        "messages": [AIMessage(content=reply)],
        "query_result": json.dumps(action, ensure_ascii=False),
        "pending_action": None,
    }


def bim_builder_node(state: AgentState) -> dict:
    """
    Multi-language entry point.
    Runs _bim_builder_impl, then translates the reply to the user's language.
    Language is detected from the last 5 messages for robustness in multi-step flows.
    """
    recent_text = " ".join(
        msg.content for msg in state["messages"][-5:]
        if hasattr(msg, "content")
    )
    lang = detect_lang(recent_text)

    result = _bim_builder_impl(state)

    if lang != "en" and result.get("messages"):
        result = {
            **result,
            "messages": [
                AIMessage(content=translate_reply(msg.content, lang))
                if (hasattr(msg, "content") and msg.content) else msg
                for msg in result["messages"]
            ],
        }
    return result
