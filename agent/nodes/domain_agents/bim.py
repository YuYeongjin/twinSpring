"""
BIM Domain Agent — LLM 없음, Tool 전용 디스패처

키워드 매칭으로 적절한 BIM tool을 직접 호출합니다.
"""
from __future__ import annotations

import re
import json
import logging

from langchain_core.messages import AIMessage as _AIMessage
from config.state import AgentState

logger = logging.getLogger(__name__)

_CREATE_PAT     = re.compile(r"추가|생성|만들|create|add|作成|追加", re.I)
_DELETE_PAT     = re.compile(r"삭제|제거|delete|remove|削除", re.I)
_STATS_PAT      = re.compile(r"통계|현황|개수|몇\s*개|stats|count|統計", re.I)
_UNDO_PAT       = re.compile(
    r"취소|되돌리|undo|ctrl.{0,3}z|이전\s*상태|되돌아"
    r"|取り消し|元に戻す|アンドゥ",
    re.I,
)
_SAVE_PAT       = re.compile(
    r"저장|save|스냅샷|snapshot|백업|backup"
    r"|保存|スナップショット|バックアップ",
    re.I,
)
_RESTORE_PAT    = re.compile(
    r"복원|restore|되돌려|저장\s*(상태|시점|된\s*상태)로"
    r"|復元|リストア|元の状態に",
    re.I,
)
_LAYER_PAT      = re.compile(r"레이어|layer|レイヤー", re.I)
_LAYER_LIST_PAT = re.compile(
    r"레이어.{0,10}(목록|보여|확인|list|조회)|list.{0,5}layer"
    r"|レイヤー.{0,10}(一覧|表示|確認|リスト)",
    re.I,
)
_LAYER_ADD_PAT  = re.compile(
    r"레이어.{0,10}(추가|생성|만들|create|new)|new.{0,5}layer|create.{0,5}layer"
    r"|レイヤー.{0,10}(追加|作成|新規)|new.{0,5}レイヤー|create.{0,5}レイヤー",
    re.I,
)
_LAYER_VIS_PAT  = re.compile(
    r"레이어.{0,10}(켜|꺼|숨|보이|show|hide|on|off|visible)"
    r"|レイヤー.{0,10}(表示|非表示|オン|オフ|見せ|隠)",
    re.I,
)
_LAYER_PUT_PAT  = re.compile(
    r"레이어에.{0,5}(넣|추가|할당|assign)"
    r"|レイヤーに.{0,5}(追加|入れ|割り当て|アサイン)",
    re.I,
)
_LAYER_DEL_PAT  = re.compile(
    r"레이어.{0,10}(삭제|제거|delete|remove)"
    r"|レイヤー.{0,10}(削除|除去)",
    re.I,
)
_SELECTED_PAT   = re.compile(
    r"선택(한|된|중인)?\s*(부재|요소|element|elem)"
    r"|선택.{0,10}(만|only|those)"
    r"|selected.{0,10}(element|부재)"
    r"|현재\s*선택"
    r"|選択(した|された|中)?\s*(部材|要素|エレメント)"
    r"|現在\s*選択",
    re.I,
)
_ROTATE_PAT     = re.compile(
    r"회전|rotate|rotation|돌리|돌려|각도|기울|tilt|spin"
    r"|回転|傾け|回す|スピン|チルト",
    re.I,
)
_SCALE_PAT      = re.compile(
    r"크기|사이즈|scale|resize|확대|축소|배율|키워|줄여|늘려|작게|크게|shrink|reduce"
    r"|サイズ|スケール|拡大|縮小|リサイズ",
    re.I,
)
_TRANSLATE_PAT  = re.compile(
    r"전체.{0,15}(이동|내리|내려|올리|올려|옮기|평행이동|translate|offset)"
    r"|모두.{0,15}(이동|내리|내려|올리|올려|옮기)"
    r"|부재\s*(전체|모두|all)?.{0,20}(이동|내리|내려|올리|올려|옮기|옮겨|평행이동)"
    r"|all.{0,15}(move|translate|shift|offset)"
    r"|translate.*element|offset.*element"
    r"|全体.{0,15}(移動|下げ|上げ|平行移動)"
    r"|全部.{0,15}(移動|下げ|上げ)"
    r"|全て.{0,15}(移動|下げ|上げ)",
    re.I,
)
_DRONE_PAT      = re.compile(r"드론|drone|aerial|ドローン", re.I)
_STRUCT_PAT     = re.compile(r"구조\s*(해석|분析)|structural\s*anal|構造.{0,5}解析", re.I)
_IFC_PAT        = re.compile(r"ifc.{0,10}(import|가져오기)", re.I)
_PROJ_PAT       = re.compile(r"프로젝트.{0,10}(생성|만들)|create.{0,10}project|プロジェクト.{0,5}作成", re.I)
_COMPOSITE_PAT  = re.compile(
    r"피사의?\s*사탑|에펠탑|피라미드|인천대교|교각구조|건물골조|교량경간"
    r"|pier.struct|bridge.span|building.frame|landmark", re.I)

_ELEMENT_TYPES = [
    ("기둥", "IfcColumn"), ("column", "IfcColumn"), ("柱", "IfcColumn"),
    ("보",   "IfcBeam"),   ("beam",   "IfcBeam"),   ("梁", "IfcBeam"),
    ("벽",   "IfcWall"),   ("wall",   "IfcWall"),   ("壁", "IfcWall"),
    ("슬래브", "IfcSlab"), ("slab",   "IfcSlab"),
    ("교각", "IfcPier"),   ("pier",   "IfcPier"),   ("橋脚", "IfcPier"),
]

_COMPOSITE_TYPES = [
    (re.compile(r"인천대교|incheon.bridge", re.I), "incheon_bridge"),
    (re.compile(r"교량경간|bridge.span",    re.I), "bridge_span"),
    (re.compile(r"교각구조|pier.struct",    re.I), "pier"),
    (re.compile(r"건물골조|building.frame", re.I), "building_frame"),
]


def _awaiting_project_name(messages: list) -> bool:
    """이전 AI 응답이 프로젝트 이름을 물었는지 확인."""
    for m in reversed(messages[:-1]):
        if isinstance(m, _AIMessage):
            return "프로젝트 이름" in (m.content or "")
    return False


def _element_type(text: str) -> str:
    for kw, etype in _ELEMENT_TYPES:
        if kw.lower() in text.lower():
            return etype
    return "IfcColumn"


def _extract_json(text: str) -> dict | None:
    """마크다운 코드블록 또는 순수 JSON 텍스트에서 dict 추출."""
    # ```json ... ``` 또는 ``` ... ``` 블록 제거
    clean = re.sub(r"```(?:json)?\s*([\s\S]*?)```", r"\1", text).strip()
    if not clean:
        clean = text.strip()
    try:
        parsed = json.loads(clean)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _invoke(tool_fn, args: dict) -> dict:
    logger.info("[bim] tool 호출: %s args=%s", tool_fn.name, args)
    try:
        raw = tool_fn.invoke(args)
        result = json.loads(raw) if isinstance(raw, str) else raw
        logger.info("[bim] tool 완료: %s → success=%s", tool_fn.name, result.get("success", "?"))
        return result
    except Exception as e:
        logger.error("[bim] %s 실패 (args=%s): %s", tool_fn.name, args, e, exc_info=True)
        return {"success": False, "error": "BIM 작업을 처리할 수 없습니다."}


def _make_undo(desc: str, tool_name: str, inv_args: dict) -> dict:
    """역연산 레코드를 생성합니다."""
    import time as _t
    return {"desc": desc, "inverse_tool": tool_name, "inverse_args": inv_args, "ts": _t.time()}


def _extract_layer_name(text: str) -> str | None:
    """텍스트에서 따옴표로 감싼 레이어 이름을 추출합니다."""
    m = re.search(r'["\'「]([^"\'」]{1,30})["\'」]', text)
    return m.group(1) if m else None


# ── 차트 색상 팔레트 ────────────────────────────────────────────────────────────
_ELEM_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
                "#06b6d4", "#f97316", "#84cc16"]
_ELEM_LABELS_KO = {
    "IfcColumn": "기둥(Column)", "IfcBeam": "보(Beam)", "IfcWall": "벽(Wall)",
    "IfcSlab":   "슬래브(Slab)", "IfcPier": "교각(Pier)",
}
_MAT_COLORS = {
    "Concrete":  "#94a3b8",
    "Steel":     "#f59e0b",
    "Timber":    "#a16207",
    "Composite": "#7c3aed",
}


def _fetch_stats_chart(get_bim_full_stats_fn, project_id: str) -> dict | None:
    """
    get_bim_full_stats 로 타입 + 재료 분포 차트 데이터를 생성합니다.
    Chart.js 호환 datasets 구조로 반환합니다.
    """
    try:
        result     = _invoke(get_bim_full_stats_fn, {"project_id": str(project_id)})
        elem_stats = result.get("elementStats", [])
        mat_stats  = result.get("materialStats", [])
        cross      = result.get("crossStats", {})
        total      = result.get("total", 0)

        if not elem_stats and not mat_stats:
            return None

        # ── 부재 타입 도넛 차트 ──────────────────────────────────────────────
        e_labels = [_ELEM_LABELS_KO.get(s["elementType"], s["elementType"]) for s in elem_stats]
        e_data   = [s["elementCount"] for s in elem_stats]
        e_colors = [_ELEM_COLORS[i % len(_ELEM_COLORS)] for i in range(len(e_labels))]

        # ── 재료 바 차트 ─────────────────────────────────────────────────────
        m_labels = [s["material"] for s in mat_stats]
        m_data   = [s["count"]    for s in mat_stats]
        m_colors = [_MAT_COLORS.get(s["material"], "#9ca3af") for s in mat_stats]

        # ── 타입 × 재료 스택 바 차트 ────────────────────────────────────────
        all_mats   = list({m for type_mats in cross.values() for m in type_mats})
        cross_labels  = [_ELEM_LABELS_KO.get(k, k) for k in cross]
        cross_datasets = [
            {
                "label": mat,
                "data":  [cross.get(etype, {}).get(mat, 0) for etype in cross],
                "backgroundColor": _MAT_COLORS.get(mat, "#9ca3af"),
            }
            for mat in all_mats
        ]

        return {
            "projectId":     project_id,
            "stats":         elem_stats,      # 기존 호환용
            "materialStats": mat_stats,
            "crossStats":    cross,
            "total":         total,
            "charts": {
                # 부재 타입 분포 도넛
                "elementType": {
                    "type":  "doughnut",
                    "title": "부재 타입 분포",
                    "labels": e_labels,
                    "datasets": [{
                        "label": "부재 수",
                        "data":  e_data,
                        "backgroundColor": e_colors,
                    }],
                },
                # 재료 분포 수평 바
                "material": {
                    "type":  "bar",
                    "title": "재료 분포",
                    "labels": m_labels,
                    "indexAxis": "y",
                    "datasets": [{
                        "label": "부재 수",
                        "data":  m_data,
                        "backgroundColor": m_colors,
                    }],
                },
                # 타입 × 재료 스택 바
                "crossStack": {
                    "type":   "bar",
                    "title":  "부재 타입별 재료 구성",
                    "labels": cross_labels,
                    "stacked": True,
                    "datasets": cross_datasets,
                },
            },
            "chartType": "multi",
        }
    except Exception:
        logger.error("[bim] _fetch_stats_chart 실패", exc_info=True)
        return None


def run_bim_agent(state: AgentState) -> dict:
    logger.info("[NODE] ▶ bim_agent 진입")
    from tools.bim_tools import (
        list_bim_projects, get_bim_stats, get_bim_full_stats,
        create_bim_element, delete_bim_element, create_bim_project, create_composite_structure,
        transform_bim_elements, translate_bim_elements, translate_selected_elements,
        list_bim_layers, create_bim_layer, set_bim_layer_visibility,
        assign_elements_to_layer, delete_bim_layer,
        snapshot_bim_project, restore_bim_from_snapshot,
        get_drone_analysis_info, get_structural_analysis, get_ifc_import_guide,
    )

    # 역연산 툴 이름 → 함수 매핑 (undo 실행용)
    _UNDO_TOOL_MAP = {
        "transform_bim_elements":     transform_bim_elements,
        "translate_bim_elements":     translate_bim_elements,
        "translate_selected_elements": translate_selected_elements,
        "delete_bim_element":         delete_bim_element,
    }

    messages    = state.get("messages", [])
    text        = messages[-1].content if messages and hasattr(messages[-1], "content") else ""
    proj_id     = state.get("bim_project_id")
    sel_ids     = state.get("selected_element_ids") or None
    undo_stack  = list(state.get("bim_undo_stack") or [])
    bim_snap    = state.get("bim_snapshot")      # 저장된 스냅샷 (복원용)
    logger.info("[bim] 입력 텍스트: %.80s", text)

    bim_data    = None
    fetch_stats = False
    undo_record = None   # 이번 작업의 역연산 레코드
    new_snap    = None   # 저장 시 채워짐

    pid = str(proj_id) if proj_id else "1"

    def _ret(res, *, snap_out=None):
        """통일된 반환 빌더. undo_record 가 있으면 스택에 push."""
        nonlocal bim_data
        if fetch_stats and proj_id:
            bim_data = _fetch_stats_chart(get_bim_full_stats, str(proj_id))
        if undo_record and res.get("success"):
            undo_stack.append(undo_record)
        out: dict = {
            "tool_results":    {"data": res, "bim_data": bim_data},
            "bim_data":        bim_data,
            "bim_undo_stack":  undo_stack,
        }
        if snap_out is not None:
            out["bim_snapshot"] = snap_out
        return out

    # ── 이전 AI가 프로젝트 이름을 물었다면 현재 메시지를 이름으로 처리 ──────────
    if _awaiting_project_name(messages) and text.strip() and len(text.strip()) <= 60:
        result = _invoke(create_bim_project, {"project_name": text.strip()})
        return {"tool_results": {"data": result, "bim_data": None}, "bim_data": None}

    # ── JSON 구조 입력 우선 처리 ────────────────────────────────────────────────
    parsed_json = _extract_json(text)
    if parsed_json:
        if "project_name" in parsed_json or ("name" in parsed_json and "element_type" not in parsed_json):
            name = parsed_json.get("project_name") or parsed_json.get("name") or "새 프로젝트"
            result = _invoke(create_bim_project, {"project_name": name})
            return {"tool_results": {"data": result, "bim_data": None}, "bim_data": None}
        if "element_type" in parsed_json:
            pid2 = str(parsed_json.get("project_id", pid))
            result = _invoke(create_bim_element, {
                "element_type": parsed_json.get("element_type", "IfcColumn"),
                "project_id":   pid2,
                "material":     parsed_json.get("material", "Concrete"),
                "position_x":   float(parsed_json.get("position_x", 0.0)),
                "position_y":   float(parsed_json.get("position_y", 0.0)),
                "position_z":   float(parsed_json.get("position_z", 0.0)),
            })
            eid = result.get("elementId", "")
            if eid:
                undo_record = _make_undo(f"부재 생성 {eid}", "delete_bim_element", {"element_id": eid})
            fetch_stats = True
            return _ret(result)

    # ────────────────────────────────────────────────────────────────────────────
    # ── 취소 (Undo) ─────────────────────────────────────────────────────────────
    elif _UNDO_PAT.search(text):
        n_m = re.search(r'(\d+)\s*번', text)
        n   = int(n_m.group(1)) if n_m else 1
        n   = min(n, len(undo_stack))
        if n == 0:
            result = {"success": False, "message": "취소할 작업이 없습니다."}
        else:
            undone = []
            for _ in range(n):
                rec      = undo_stack.pop()
                tool_fn  = _UNDO_TOOL_MAP.get(rec.get("inverse_tool", ""))
                inv_args = rec.get("inverse_args", {})
                inv_res  = _invoke(tool_fn, inv_args) if tool_fn else {"success": False, "error": "알 수 없는 역연산"}
                undone.append({"desc": rec.get("desc", ""), "success": inv_res.get("success", False)})
            result      = {"success": True, "undone": len(undone), "details": undone}
            fetch_stats = True
        return _ret(result)

    # ── 저장 (Snapshot) ─────────────────────────────────────────────────────────
    elif _SAVE_PAT.search(text) and not _RESTORE_PAT.search(text):
        result   = _invoke(snapshot_bim_project, {"project_id": pid})
        new_snap = result.get("elements") if result.get("success") else bim_snap
        return _ret(result, snap_out=new_snap)

    # ── 복원 (Restore) ──────────────────────────────────────────────────────────
    elif _RESTORE_PAT.search(text):
        if not bim_snap:
            result = {"success": False, "message": "저장된 스냅샷이 없습니다. '저장해줘'로 먼저 저장하세요."}
        else:
            result      = _invoke(restore_bim_from_snapshot, {"project_id": pid, "elements": bim_snap})
            fetch_stats = True
        return _ret(result, snap_out=bim_snap)

    # ── 레이어 삭제 ─────────────────────────────────────────────────────────────
    elif _LAYER_PAT.search(text) and _LAYER_DEL_PAT.search(text):
        nums = re.findall(r'\d+', text)
        lname = _extract_layer_name(text)
        # layerId 가 숫자면 사용, 아니면 이름으로 검색 후 삭제
        if nums:
            result = _invoke(delete_bim_layer, {"layer_id": nums[0]})
        else:
            # 이름으로 찾아 ID 추출 후 삭제
            layers_res = _invoke(list_bim_layers, {"project_id": pid})
            lid = next((la.get("layerId") for la in layers_res.get("layers", [])
                        if lname and lname.lower() in (la.get("layerName") or "").lower()), None)
            result = _invoke(delete_bim_layer, {"layer_id": lid}) if lid else \
                     {"success": False, "error": f"레이어를 찾을 수 없습니다: {lname}"}

    # ── 레이어 가시성 토글 ────────────────────────────────────────────────────────
    elif _LAYER_PAT.search(text) and _LAYER_VIS_PAT.search(text):
        visible = not bool(re.search(r"꺼|숨|hide|off|invisible|非表示|隠す|オフ", text, re.I))
        lname   = _extract_layer_name(text)
        result  = _invoke(set_bim_layer_visibility, {
            "project_id": pid,
            "visible":    visible,
            "layer_name": lname,
        })

    # ── 레이어에 부재 할당 ────────────────────────────────────────────────────────
    elif _LAYER_PAT.search(text) and _LAYER_PUT_PAT.search(text):
        lname    = _extract_layer_name(text)
        elem_ids = sel_ids or []
        result   = _invoke(assign_elements_to_layer, {
            "project_id": pid,
            "element_ids": elem_ids,
            "layer_name":  lname,
        })

    # ── 레이어 생성 ─────────────────────────────────────────────────────────────
    elif _LAYER_PAT.search(text) and _LAYER_ADD_PAT.search(text):
        lname  = _extract_layer_name(text) or "새 레이어"
        color_m = re.search(r"#[0-9a-fA-F]{6}", text)
        color  = color_m.group(0) if color_m else "#3b82f6"
        result = _invoke(create_bim_layer, {
            "project_id": pid,
            "layer_name": lname,
            "color":      color,
        })

    # ── 레이어 목록 조회 ─────────────────────────────────────────────────────────
    elif _LAYER_PAT.search(text) and (_LAYER_LIST_PAT.search(text) or _STATS_PAT.search(text)):
        result = _invoke(list_bim_layers, {"project_id": pid})
        layers = result.get("layers", [])
        bim_data = {
            "layers":    layers,
            "count":     len(layers),
            "chartType": "layerList",
        }

    # ── 기존 dispatch ────────────────────────────────────────────────────────────
    elif _DRONE_PAT.search(text):
        result = _invoke(get_drone_analysis_info, {})
    elif _STRUCT_PAT.search(text):
        result = _invoke(get_structural_analysis, {"project_id": proj_id} if proj_id else {})
    elif _IFC_PAT.search(text):
        result = _invoke(get_ifc_import_guide, {})
    elif _COMPOSITE_PAT.search(text):
        ctype = "building_frame"
        for pat, ct in _COMPOSITE_TYPES:
            if pat.search(text):
                ctype = ct; break
        result = _invoke(create_composite_structure, {"composite_type": ctype, "project_id": pid})
        fetch_stats = True
    elif _SELECTED_PAT.search(text) and _TRANSLATE_PAT.search(text):
        nums = re.findall(r'[\d.]+', text)
        val  = float(nums[0]) if nums else 0.0
        dx = dy = dz = 0.0
        if re.search(r"x\s*축|x-axis|x방향|x\s*軸|x方向", text, re.I):
            dx = -val if re.search(r"내리|내려|빼|minus|マイナス|下げ", text, re.I) else val
        elif re.search(r"y\s*축|y-axis|y방향|y\s*軸|y方向", text, re.I):
            dy = -val if re.search(r"내리|내려|빼|minus|マイナス|下げ", text, re.I) else val
        else:
            dz = -val if re.search(r"내리|내려|아래|down|minus|下げ|下方|マイナス", text, re.I) else val
        result = _invoke(translate_selected_elements, {
            "project_id": pid, "element_ids": sel_ids or [],
            "delta_x": dx, "delta_y": dy, "delta_z": dz,
        })
        undo_record = _make_undo(
            f"선택 이동 (ΔX={dx},ΔY={dy},ΔZ={dz})",
            "transform_bim_elements",
            {"project_id": pid, "element_ids": sel_ids,
             "delta_pos_x": -dx, "delta_pos_y": -dy, "delta_pos_z": -dz},
        )
        fetch_stats = True
    elif _TRANSLATE_PAT.search(text):
        nums = re.findall(r'[\d.]+', text)
        val  = float(nums[0]) if nums else 0.0
        dx = dy = dz = 0.0
        if re.search(r"x\s*축|x-axis|x방향|x\s*軸|x方向", text, re.I):
            dx = -val if re.search(r"내리|내려|빼|minus|マイナス|下げ", text, re.I) else val
        elif re.search(r"y\s*축|y-axis|y방향|y\s*軸|y方向", text, re.I):
            dy = -val if re.search(r"내리|내려|빼|minus|マイナス|下げ", text, re.I) else val
        else:
            dz = -val if re.search(r"내리|내려|아래|down|minus|下げ|下方|マイナス", text, re.I) else val
        result = _invoke(translate_bim_elements, {
            "project_id": pid, "delta_x": dx, "delta_y": dy, "delta_z": dz,
        })
        undo_record = _make_undo(
            f"전체 이동 (ΔX={dx},ΔY={dy},ΔZ={dz})",
            "transform_bim_elements",
            {"project_id": pid, "delta_pos_x": -dx, "delta_pos_y": -dy, "delta_pos_z": -dz},
        )
        fetch_stats = True
    elif _ROTATE_PAT.search(text) or _SCALE_PAT.search(text):
        nums = re.findall(r'[\d.]+', text)
        val  = float(nums[0]) if nums else 0.0
        drx = dry = drz = 0.0
        if _ROTATE_PAT.search(text):
            deg = -val if re.search(r"반시계|counter|ccw|왼쪽으로|反時計|左回り", text, re.I) else val
            if   re.search(r"x\s*축|x-axis|x방향|x\s*軸|x方向", text, re.I): drx = deg
            elif re.search(r"y\s*축|y-axis|y방향|y\s*軸|y方向", text, re.I): dry = deg
            else:                                                               drz = deg
        sx = sy = sz = 1.0
        if _SCALE_PAT.search(text):
            factor = val if val > 0 else 1.0
            if re.search(r"절반|반으로|50\s*%|半分|half", text, re.I):
                factor = 0.5
            elif re.search(r"축소|줄여|작게|縮小|小さく|shrink|reduce", text, re.I) and factor > 1:
                factor = round(1.0 / factor, 4)
            if   re.search(r"x\s*축|x방향|x\s*軸|x方向", text, re.I): sx = factor
            elif re.search(r"y\s*축|y방향|y\s*軸|y方向", text, re.I): sy = factor
            elif re.search(r"z\s*축|z방향|z\s*軸|z方向", text, re.I): sz = factor
            else:                                                        sx = sy = sz = factor
        tr_sel = state.get("selected_element_ids") or None
        result = _invoke(transform_bim_elements, {
            "project_id":  pid, "element_ids": tr_sel,
            "delta_rot_x": drx, "delta_rot_y": dry, "delta_rot_z": drz,
            "scale_x": sx, "scale_y": sy, "scale_z": sz,
        })
        undo_record = _make_undo(
            f"변환 (회전 ΔZ={drz}°, 크기 ×{sx})",
            "transform_bim_elements",
            {"project_id": pid, "element_ids": tr_sel,
             "delta_rot_x": -drx, "delta_rot_y": -dry, "delta_rot_z": -drz,
             "scale_x": round(1/sx, 4) if sx not in (0, 1) else 1.0,
             "scale_y": round(1/sy, 4) if sy not in (0, 1) else 1.0,
             "scale_z": round(1/sz, 4) if sz not in (0, 1) else 1.0},
        )
        fetch_stats = True
    elif _DELETE_PAT.search(text):
        nums   = re.findall(r'\d+', text)
        eid    = str(nums[0]) if nums else "1"
        result = _invoke(delete_bim_element, {"element_id": eid})
        fetch_stats = True
    elif _PROJ_PAT.search(text) and _CREATE_PAT.search(text):
        name_m = re.search(r'["\'「]([^"\'」]+)["\'」]', text)
        if not name_m:
            return {"tool_results": {"need_project_name": True}, "bim_data": None}
        result = _invoke(create_bim_project, {"project_name": name_m.group(1)})
    elif _CREATE_PAT.search(text):
        etype  = _element_type(text)
        result = _invoke(create_bim_element, {
            "element_type": etype, "project_id": pid,
            "material": "Concrete",
            "position_x": 0.0, "position_y": 0.0, "position_z": 0.0,
        })
        eid = result.get("elementId", "")
        if eid:
            undo_record = _make_undo(f"부재 생성 {eid}", "delete_bim_element", {"element_id": eid})
        fetch_stats = True
    elif _STATS_PAT.search(text):
        result   = _invoke(get_bim_stats, {"project_id": proj_id} if proj_id else {})
        bim_data = _fetch_stats_chart(get_bim_full_stats, pid)
    else:
        result   = _invoke(list_bim_projects, {})
        projects = result.get("projects", [])
        if projects:
            bim_data = {"projects": projects, "count": result.get("count", len(projects)), "chartType": "list"}

    return _ret(result)
