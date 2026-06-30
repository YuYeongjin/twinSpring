"""
Node: Tab Guide

Provides information and usage guidance for the four main dashboard tabs:
  - simulation : Excavator 3D simulation & IoT sensor monitoring
  - bim        : BIM model viewer / editor
  - test       : Collision test (excavator ↔ BIM building)
  - safe       : AI-powered safety monitoring (helmet / restricted area)

Flow:
  - Detect which tab(s) the user is asking about
  - Build structured context from TAB_INFO
  - LLM generates a natural-language response
  - Translate to user's language if necessary
"""

import re
import logging
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

from config.state import AgentState
from config.llm_config import llm_chat
from config.lang_util import detect_lang, lang_instruction, translate_reply

# ──────────────────────────────────────────────
# Reference data for each tab
# ──────────────────────────────────────────────
TAB_INFO: dict[str, dict] = {
    "simulation": {
        "name": "Simulation",
        "icon": "🚜",
        "description": (
            "3D excavator simulation dashboard. "
            "Control a virtual excavator in real time and monitor IoT sensor data."
        ),
        "features": [
            "Three.js 3D excavator model",
            "Presets: IDLE / DIG / DUMP / TRAVEL",
            "Manual joint angle control: Boom, Arm, Bucket, Swing",
            "Position movement (X, Y, Z coordinates)",
            "Real-time IoT sensor data (temperature & humidity via WebSocket)",
            "Operation mode display",
        ],
        "usage": [
            "Select a simulation project from the Simulation Projects list.",
            "Use preset buttons (IDLE / DIG / DUMP / TRAVEL) to quickly apply poses.",
            "Use sliders to fine-tune individual joint angles.",
            "Monitor real-time sensor data in the info panel.",
            "Or just ask the AI agent in natural language.",
        ],
        "ai_commands": [
            "굴착 자세로 설정해줘  /  Set to DIG pose",
            "붐 각도 45도로 변경  /  Set boom angle to 45°",
            "굴착기 현재 상태 보여줘  /  Show excavator status",
            "IDLE 모드로 초기화  /  Reset to IDLE mode",
            "암 각도 90도, 버킷 -20도로 설정  /  Set arm 90° and bucket -20°",
        ],
    },
    "bim": {
        "name": "BIM Viewer",
        "icon": "🏗",
        "description": (
            "3D BIM model viewer and editor for building / infrastructure projects. "
            "Create, visualize, and manage structural elements interactively."
        ),
        "features": [
            "3D visualization of BIM elements: Column (IfcColumn), Beam (IfcBeam), "
            "Wall (IfcWall), Slab (IfcSlab), Pier (IfcPier)",
            "Element creation, editing, and deletion",
            "Layer management (visibility toggle, color coding)",
            "IFC file import",
            "Drone analysis result → BIM project conversion",
            "Project management: create, rename, delete",
            "2D floor plan view",
        ],
        "usage": [
            "Go to BIM Projects to create or select a project.",
            "Click any element in the 3D viewer to select and edit it.",
            "Use the Layers panel to show/hide groups of elements.",
            "Import IFC files from the project list toolbar.",
            "Ask the AI agent to add, modify, or query elements.",
        ],
        "ai_commands": [
            "기둥 5개 추가해줘  /  Add 5 columns",
            "벽 생성해줘  /  Create a wall",
            "BIM 프로젝트 목록 보여줘  /  Show BIM project list",
            "부재 통계 알려줘  /  Show element statistics",
            "피사의 사탑 만들어줘  /  Build the Leaning Tower of Pisa",
        ],
    },
    "test": {
        "name": "Collision Test  (Beta)",
        "icon": "🧪",
        "description": (
            "Interactive collision detection test. "
            "Drive the excavator with keyboard controls and see which BIM building elements "
            "the arm collides with in real time."
        ),
        "features": [
            "Real-time 3D collision detection (excavator arm joints vs. BIM elements)",
            "Keyboard-driven excavator control",
            "Auto Mode: automated excavation cycle through 5 poses",
            "BIM project overlay (transparent elements turn red on collision)",
            "Collision log with timestamps",
            "Status monitor: joint angles, position, collision count",
        ],
        "keyboard_controls": {
            "W / S": "Move Forward / Backward",
            "A / D": "Rotate Body Left / Right",
            "Q / E": "Swing Left / Right",
            "R / F": "Boom Up / Down",
            "T / G": "Arm Extend / Retract",
            "Y / H": "Bucket Open / Close",
        },
        "usage": [
            "Select a BIM project from the left panel (building loads as transparent overlay).",
            "Control the excavator using keyboard shortcuts.",
            "Toggle Auto Mode to run an automatic dig-dump cycle.",
            "Colliding elements highlight in red; a warning banner appears.",
            "Review the Collision Log in the left panel for history.",
            "Press Reset (↺) or use the button to return to default pose.",
        ],
    },
    "safe": {
        "name": "Safety Monitoring  (Beta)",
        "icon": "🦺",
        "description": (
            "AI-powered safety monitoring using webcam feed. "
            "Detects missing safety helmets and restricted-area violations in real time."
        ),
        "features": [
            "Real-time webcam stream in the browser",
            "YOLOv8-based object detection (runs on the Spring server)",
            "Helmet / hard-hat absence detection → Danger alert",
            "Restricted / danger-zone entry detection → Danger alert",
            "3D scene visualization of detected persons (Three.js)",
            "Detection history log: total scans, danger count, helmet violations, area violations",
            "WebSocket push alerts from IoT sensor events",
        ],
        "detection_classes": {
            "no-hard-hat / no-helmet": "⛑ Missing helmet → DANGER",
            "restricted / danger-zone": "🚫 Restricted area violation → DANGER",
            "person / worker": "👷 Person detected (safe)",
        },
        "usage": [
            "Allow camera access in the browser when prompted.",
            "Click Live Detect to start continuous scanning (every 5 seconds).",
            "A red ⚠ DANGER banner appears when a violation is found.",
            "Click Make to render detected persons/objects in the 3D scene.",
            "Review the Detection Log at the bottom for statistics.",
            "Requires the detection server (Spring /api/detection) to be running.",
        ],
    },
}

# ──────────────────────────────────────────────
# Tab detection patterns
# ──────────────────────────────────────────────
_TAB_PATTERNS: dict[str, re.Pattern] = {
    "simulation": re.compile(
        r"simulation\s*탭|시뮬레이션\s*탭|simulation\s*대시보드|시뮬레이션\s*대시보드"
        r"|simulation\s*tab|simulation\s*dashboard"
        r"|굴착기\s*탭|굴착기\s*대시보드",
        re.IGNORECASE,
    ),
    "bim": re.compile(
        r"bim\s*탭|bim\s*뷰어|bim\s*뷰|bim\s*대시보드|bim\s*viewer|bim\s*tab|bim\s*dashboard",
        re.IGNORECASE,
    ),
    "test": re.compile(
        r"test\s*탭|테스트\s*탭|충돌\s*테스트|collision\s*test|test\s*tab|test\s*dashboard"
        r"|테스트\s*대시보드|키보드\s*단축키|키보드\s*조작|keyboard\s*control",
        re.IGNORECASE,
    ),
    "safe": re.compile(
        r"safe\s*탭|안전\s*탭|safety\s*탭|safe\s*tab|safety\s*tab|safety\s*dashboard"
        r"|안전\s*모니터링|safety\s*monitor|헬멧\s*감지|helmet\s*detect|webcam\s*detect"
        r"|cctv\s*감지|안전\s*감시|safe\s*대시보드",
        re.IGNORECASE,
    ),
}

# General "overview" keywords that trigger an all-tab summary
_OVERVIEW_PATTERN = re.compile(
    r"탭.*?(종류|목록|소개|뭐가|어떤|전체|모두|안내|설명)"
    r"|어떤.*탭.*?(있|있나|있어|있어요|있습니까)"
    r"|기능.*안내|기능.*소개|기능.*설명|대시보드.*안내|대시보드.*소개"
    r"|tab.*overview|what.*tabs|tabs.*available|all.*features",
    re.IGNORECASE,
)

# ──────────────────────────────────────────────
# System prompt
# ──────────────────────────────────────────────
_SYSTEM_BASE = (
    "You are a helpful assistant for a BIM Digital Twin platform. "
    "Answer questions about dashboard tabs and their features based on the provided tab information. "
    "Be concise, specific, and practical. "
    "Include keyboard shortcuts, AI commands, or step-by-step instructions where relevant. "
    "Use markdown formatting (headers, bold, bullet lists) for clarity."
)


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def _detect_tabs(text: str) -> list[str]:
    """Return which tabs the user is asking about (or all if overview/unknown)."""
    if _OVERVIEW_PATTERN.search(text):
        return list(TAB_INFO.keys())

    detected = [tab for tab, pat in _TAB_PATTERNS.items() if pat.search(text)]
    return detected if detected else list(TAB_INFO.keys())


def _build_context(tabs: list[str]) -> str:
    """Render structured context for the requested tabs."""
    parts: list[str] = []

    for tab in tabs:
        info = TAB_INFO.get(tab)
        if not info:
            continue

        lines: list[str] = [f"## {info['icon']} {info['name']} Tab"]
        lines.append(f"**Description:** {info['description']}")

        if info.get("features"):
            lines.append("\n**Features:**")
            lines += [f"- {f}" for f in info["features"]]

        if tab == "test" and info.get("keyboard_controls"):
            lines.append("\n**Keyboard Controls:**")
            for key, action in info["keyboard_controls"].items():
                lines.append(f"- `{key}` → {action}")

        if tab == "safe" and info.get("detection_classes"):
            lines.append("\n**Detection Classes:**")
            for cls, desc in info["detection_classes"].items():
                lines.append(f"- **{cls}**: {desc}")

        if info.get("usage"):
            lines.append("\n**How to use:**")
            lines += [f"{i + 1}. {u}" for i, u in enumerate(info["usage"])]

        if info.get("ai_commands"):
            lines.append("\n**AI Agent commands you can try:**")
            lines += [f'- "{cmd}"' for cmd in info["ai_commands"]]

        parts.append("\n".join(lines))

    return "\n\n---\n\n".join(parts)


# ──────────────────────────────────────────────
# Node entry point
# ──────────────────────────────────────────────
def tab_guide_node(state: AgentState) -> dict:
    logger.info("[NODE] ▶ tab_guide_node 진입")
    last_message = state["messages"][-1]
    user_text = last_message.content if hasattr(last_message, "content") else str(last_message)
    logger.info("[tab_guide] 입력 텍스트: %.80s", user_text)

    # Language detection
    recent_text = " ".join(
        msg.content for msg in state["messages"][-5:]
        if hasattr(msg, "content")
    )
    lang = state.get("lang") or detect_lang(recent_text)
    note = lang_instruction(lang)
    system_content = _SYSTEM_BASE + (" " + note if note else "")

    # Build context
    tabs = _detect_tabs(user_text)
    context = _build_context(tabs)

    try:
        response = llm_chat.invoke([
            SystemMessage(content=system_content),
            HumanMessage(content=f"{context}\n\nUser question: {user_text}"),
        ])
        content = response.content.strip()
    except Exception:
        # Fallback: return raw structured info
        content = context

    # Translate if not English
    if lang != "en" and content:
        content = translate_reply(content, lang)

    return {"messages": [AIMessage(content=content)]}
