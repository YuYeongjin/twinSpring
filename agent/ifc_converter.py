"""
IFC → GLB 변환기

ifcopenshell으로 IFC 파싱 후 pygltflib으로 GLB 바이너리 생성.
각 부재(element)는 glTF 내 별도 mesh node로 저장되며
node.name = elementId  (e.g. "IFC-12345")
node extras에 elementType, storey, color 포함.

반환:
  glb_bytes  : bytes  — model.glb 바이너리
  elements   : list   — BimElementDTO 형식 (DB 저장용)
  storeys    : list   — BimStoreyDTO 형식
  geo_origin : dict   — 위경도·오프셋·스케일
"""

from __future__ import annotations

import struct
import json
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# ── IFC 엔티티 타입 → 서비스 elementType 매핑 ─────────────────────
ELEMENT_TYPE_MAP = {
    "IfcColumn":             "IfcColumn",
    "IfcBeam":               "IfcBeam",
    "IfcWall":               "IfcWall",
    "IfcWallStandardCase":   "IfcWall",
    "IfcSlab":               "IfcSlab",
    "IfcMember":             "IfcMember",
    "IfcFooting":            "IfcFoundation",  # 기초 부재 — 슬래브와 분리
    "IfcPile":               "IfcPier",
    "IfcPlate":              "IfcMember",
    "IfcDoor":               "IfcDoor",
    "IfcWindow":             "IfcWindow",
    "IfcStair":              "IfcStair",
    "IfcStairFlight":        "IfcStair",
    "IfcRoof":               "IfcRoof",
}

ELEMENT_COLORS = {
    "IfcColumn":      [0.70, 0.70, 0.75, 1.0],
    "IfcBeam":        [0.60, 0.60, 0.70, 1.0],
    "IfcWall":        [0.80, 0.78, 0.72, 1.0],
    "IfcSlab":        [0.75, 0.75, 0.80, 1.0],
    "IfcFoundation":  [0.55, 0.42, 0.22, 1.0],  # 기초 — 흙/콘크리트 갈색
    "IfcMember":      [0.55, 0.65, 0.80, 1.0],
    "IfcPier":        [0.70, 0.70, 0.75, 1.0],
    "IfcDoor":        [0.65, 0.45, 0.30, 1.0],
    "IfcWindow":      [0.50, 0.70, 0.90, 0.6],
    "IfcStair":       [0.75, 0.72, 0.65, 1.0],
    "IfcRoof":        [0.60, 0.55, 0.50, 1.0],
}

def _dms_to_decimal(arr) -> Optional[float]:
    if not arr or len(arr) < 3:
        return None
    deg, min_, sec = arr[0], arr[1], arr[2]
    micro = arr[3] if len(arr) > 3 else 0
    return deg + min_ / 60.0 + (sec + micro / 1_000_000) / 3600.0


def _detect_unit_scale(ifc) -> float:
    """IFC 길이 단위 → 미터 변환 계수.
    IfcUnitAssignment를 우선 탐색하고, 없으면 IfcSIUnit 직접 탐색으로 폴백.
    IfcConversionBasedUnit(인치·피트 등)도 처리한다.
    """
    _PREFIXES = {".MILLI.": 0.001, ".CENTI.": 0.01, ".DECI.": 0.1}
    _LENGTH_TYPES = {".LENGTHUNIT.", "LENGTHUNIT"}

    # 1순위: IfcUnitAssignment (프로젝트 단위 정의)
    try:
        for ua in ifc.by_type("IfcUnitAssignment"):
            units = getattr(ua, "Units", None) or []
            for unit in units:
                if getattr(unit, "UnitType", None) not in _LENGTH_TYPES:
                    continue
                if unit.is_a("IfcSIUnit"):
                    return _PREFIXES.get(getattr(unit, "Prefix", None), 1.0)
                if unit.is_a("IfcConversionBasedUnit"):
                    factor = getattr(unit, "ConversionFactor", None)
                    if factor:
                        val = getattr(factor, "ValueComponent", None)
                        if val is not None:
                            return float(val)
    except Exception:
        pass

    # 2순위: IfcSIUnit 직접 탐색 (폴백)
    try:
        for unit in ifc.by_type("IfcSIUnit"):
            if getattr(unit, "UnitType", None) in _LENGTH_TYPES:
                return _PREFIXES.get(getattr(unit, "Prefix", None), 1.0)
    except Exception:
        pass

    return 1.0


def _extract_geo_origin(ifc) -> dict:
    try:
        sites = ifc.by_type("IfcSite")
        if sites:
            site = sites[0]
            lat = _dms_to_decimal(getattr(site, "RefLatitude", None))
            lon = _dms_to_decimal(getattr(site, "RefLongitude", None))
            elev = getattr(site, "RefElevation", None)
            return {
                "latitude":  lat,
                "longitude": lon,
                "elevation": float(elev) if elev is not None else None,
            }
    except Exception:
        pass
    return {"latitude": None, "longitude": None, "elevation": None}


def _extract_spatial_structure(ifc) -> tuple[dict, list]:
    """expressId → {storey, storeyElevation, building}  +  storeys list"""
    elem_to_spatial: dict[int, dict] = {}
    storeys: list[dict] = []

    # ── 1. 층(IfcBuildingStorey) 정보 수집 ───────────────────────────
    storey_info: dict[int, dict] = {}
    try:
        for s in ifc.by_type("IfcBuildingStorey"):
            name = getattr(s, "LongName", None) or getattr(s, "Name", None) or f"Level_{s.id()}"
            elev = getattr(s, "Elevation", None)
            storey_info[s.id()] = {
                "name": str(name),
                "elevation": float(elev) if elev is not None else None,
            }
    except Exception as e:
        logger.warning("[IFC Spatial] 층 정보 파싱 실패: %s", e)

    # ── 2. 건물(IfcBuilding) 정보 수집 ───────────────────────────────
    building_info: dict[int, str] = {}
    try:
        for b in ifc.by_type("IfcBuilding"):
            name = getattr(b, "LongName", None) or getattr(b, "Name", None) or f"Building_{b.id()}"
            building_info[b.id()] = str(name)
    except Exception as e:
        logger.warning("[IFC Spatial] 건물 정보 파싱 실패: %s", e)

    # ── 3. 층 → 건물 매핑 (IfcRelAggregates) ─────────────────────────
    storey_to_building: dict[int, int] = {}
    try:
        for rel in ifc.by_type("IfcRelAggregates"):
            parent = getattr(rel, "RelatingObject", None)
            if parent and parent.id() in building_info:
                for child in (getattr(rel, "RelatedObjects", []) or []):
                    if child.id() in storey_info:
                        storey_to_building[child.id()] = parent.id()
    except Exception as e:
        logger.warning("[IFC Spatial] 건물-층 매핑 실패: %s", e)

    storey_element_ids: dict[int, list] = {sid: [] for sid in storey_info}

    # ── 4. 요소 → 층 매핑 (IfcRelContainedInSpatialStructure) ─────────
    try:
        for rel in ifc.by_type("IfcRelContainedInSpatialStructure"):
            structure = getattr(rel, "RelatingStructure", None)
            if structure is None:
                continue
            sid = structure.id()

            if sid in storey_info:
                # 층에 직접 포함된 요소
                info = storey_info[sid]
                bld_id = storey_to_building.get(sid)
                bld_name = building_info.get(bld_id) if bld_id else None
                for elem in (getattr(rel, "RelatedElements", []) or []):
                    eid = elem.id()
                    if eid not in elem_to_spatial:
                        elem_to_spatial[eid] = {
                            "storey": info["name"],
                            "storeyElevation": info["elevation"],
                            "building": bld_name,
                        }
                        storey_element_ids[sid].append(f"IFC-{eid}")
            elif sid in building_info:
                # 건물에 직접 포함된 요소 (층 없음) → 건물 정보만 기록
                bld_name = building_info[sid]
                for elem in (getattr(rel, "RelatedElements", []) or []):
                    eid = elem.id()
                    if eid not in elem_to_spatial:
                        elem_to_spatial[eid] = {
                            "storey": None,
                            "storeyElevation": None,
                            "building": bld_name,
                        }
    except Exception as e:
        logger.warning("[IFC Spatial] 요소-층 매핑 실패: %s", e)

    # ── 5. 층 목록 구성 ───────────────────────────────────────────────
    try:
        for sid, info in storey_info.items():
            bld_id = storey_to_building.get(sid)
            storeys.append({
                "name": info["name"],
                "elevation": info["elevation"],
                "building": building_info.get(bld_id) if bld_id else None,
                "elementIds": storey_element_ids.get(sid, []),
            })
        storeys.sort(key=lambda s: (s["building"] or "", s["elevation"] or 0))
    except Exception as e:
        logger.warning("[IFC Spatial] 층 목록 정렬 실패: %s", e)

    logger.info("[IFC Spatial] 층 %d개, 요소-층 매핑 %d개", len(storeys), len(elem_to_spatial))
    return elem_to_spatial, storeys


# ── GLB 빌더 (pygltflib 없이 직접 바이너리 구성) ─────────────────────
# pygltflib 의존을 최소화하기 위해 glTF JSON + BIN 버퍼를 직접 작성

def _pack_f32(arr: np.ndarray) -> bytes:
    return arr.astype(np.float32).tobytes()

def _pack_u32(arr: np.ndarray) -> bytes:
    return arr.astype(np.uint32).tobytes()

def _align4(data: bytes) -> bytes:
    rem = len(data) % 4
    return data + b"\x00" * (4 - rem) if rem else data


class GlbBuilder:
    """glTF 2.0 GLB 바이너리를 직접 구성하는 헬퍼."""

    def __init__(self):
        self._bin: bytearray = bytearray()
        self._buffer_views: list[dict] = []
        self._accessors: list[dict] = []
        self._meshes: list[dict] = []
        self._nodes: list[dict] = []
        self._materials: list[dict] = []
        self._mat_cache: dict[tuple, int] = {}

    # ── 버퍼 뷰 / 액세서 등록 ────────────────────────────────────────

    def _add_buffer_view(self, data: bytes, target: int) -> int:
        offset = len(self._bin)
        self._bin.extend(data)
        # 4바이트 정렬
        pad = (4 - len(self._bin) % 4) % 4
        self._bin.extend(b"\x00" * pad)
        idx = len(self._buffer_views)
        self._buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        return idx

    def _add_accessor(self, bv_idx: int, component_type: int, count: int,
                      type_: str, min_=None, max_=None) -> int:
        acc: dict = {
            "bufferView": bv_idx,
            "byteOffset": 0,
            "componentType": component_type,
            "count": count,
            "type": type_,
        }
        if min_ is not None:
            acc["min"] = min_
        if max_ is not None:
            acc["max"] = max_
        idx = len(self._accessors)
        self._accessors.append(acc)
        return idx

    def _get_or_create_material(self, color: list) -> int:
        r, g, b, a = color
        key = (round(r, 3), round(g, 3), round(b, 3), round(a, 3))
        if key in self._mat_cache:
            return self._mat_cache[key]
        mat = {
            "pbrMetallicRoughness": {
                "baseColorFactor": [r, g, b, a],
                "metallicFactor": 0.05,
                "roughnessFactor": 0.7,
            },
            "doubleSided": True,
        }
        if a < 0.99:
            mat["alphaMode"] = "BLEND"
        idx = len(self._materials)
        self._materials.append(mat)
        self._mat_cache[key] = idx
        return idx

    # ── 부재 추가 ────────────────────────────────────────────────────

    def add_element(self, element_id: str, positions: np.ndarray,
                    normals: np.ndarray, indices: np.ndarray,
                    color: list, element_type: str, extras: dict) -> None:
        """positions: (N,3) float32, normals: (N,3) float32, indices: (M,) uint32"""

        ARRAY_BUFFER = 34962
        ELEMENT_ARRAY_BUFFER = 34963
        FLOAT = 5126
        UNSIGNED_INT = 5125

        pos_bytes = _pack_f32(positions)
        nrm_bytes = _pack_f32(normals)
        idx_bytes = _pack_u32(indices)

        bv_pos = self._add_buffer_view(pos_bytes, ARRAY_BUFFER)
        bv_nrm = self._add_buffer_view(nrm_bytes, ARRAY_BUFFER)
        bv_idx = self._add_buffer_view(idx_bytes, ELEMENT_ARRAY_BUFFER)

        min_pos = positions.min(axis=0).tolist()
        max_pos = positions.max(axis=0).tolist()

        n_verts = len(positions)
        n_idx   = len(indices)

        acc_pos = self._add_accessor(bv_pos, FLOAT,         n_verts, "VEC3", min_pos, max_pos)
        acc_nrm = self._add_accessor(bv_nrm, FLOAT,         n_verts, "VEC3")
        acc_idx = self._add_accessor(bv_idx, UNSIGNED_INT,  n_idx,   "SCALAR")

        mat_idx = self._get_or_create_material(color)

        mesh_idx = len(self._meshes)
        self._meshes.append({
            "primitives": [{
                "attributes": {"POSITION": acc_pos, "NORMAL": acc_nrm},
                "indices": acc_idx,
                "material": mat_idx,
            }]
        })

        node: dict = {
            "name": element_id,
            "mesh": mesh_idx,
            "extras": {**extras, "elementId": element_id, "elementType": element_type},
        }
        self._nodes.append(node)

    # ── GLB 최종 빌드 ────────────────────────────────────────────────

    def build(self) -> bytes:
        scene_nodes = list(range(len(self._nodes)))
        gltf_json = {
            "asset": {"version": "2.0", "generator": "twinSpring-ifc-converter"},
            "scene": 0,
            "scenes": [{"nodes": scene_nodes}],
            "nodes": self._nodes,
            "meshes": self._meshes,
            "materials": self._materials,
            "accessors": self._accessors,
            "bufferViews": self._buffer_views,
            "buffers": [{"byteLength": len(self._bin)}],
        }

        json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")
        # JSON 청크: 4바이트 정렬, 패딩은 space(0x20)
        json_pad = (4 - len(json_bytes) % 4) % 4
        json_bytes += b" " * json_pad

        bin_data = bytes(self._bin)

        # GLB 헤더: magic(4) + version(4) + length(4) = 12
        # JSON 청크: length(4) + type(4) + data
        # BIN  청크: length(4) + type(4) + data
        json_chunk = struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
        bin_chunk  = struct.pack("<II", len(bin_data),  0x004E4942) + bin_data
        total_len  = 12 + len(json_chunk) + len(bin_chunk)
        header     = struct.pack("<III", 0x46546C67, 2, total_len)

        return header + json_chunk + bin_chunk


# ── 메인 변환 함수 ────────────────────────────────────────────────────

def convert_ifc_to_glb(ifc_bytes: bytes, user_scale: float = 1.0, project_id: str = "") -> dict:
    """
    IFC 바이너리 → GLB + 메타데이터 변환.

    user_scale: 자동 감지 스케일에 추가로 곱하는 배율 (기본 1.0).
                mm 단위 IFC면 1000 입력.

    반환 dict:
      glb_bytes  : bytes
      elements   : list[dict]   BimElementDTO 형식
      storeys    : list[dict]
      geo_origin : dict
    """
    try:
        import ifcopenshell
        import ifcopenshell.geom
    except ImportError as e:
        raise RuntimeError("ifcopenshell 미설치: pip install ifcopenshell") from e

    import tempfile, os

    # ifcopenshell은 파일 경로가 필요 → 임시 파일 사용
    with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
        tmp.write(ifc_bytes)
        tmp_path = tmp.name

    try:
        ifc = ifcopenshell.open(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    scale = _detect_unit_scale(ifc) * user_scale
    geo_info = _extract_geo_origin(ifc)
    elem_to_spatial, storeys = _extract_spatial_structure(ifc)

    # ifcopenshell.geom 설정: 월드 좌표계, 삼각분할
    settings = ifcopenshell.geom.settings()
    try:
        settings.set(settings.USE_WORLD_COORDS, True)
        settings.set(settings.WELD_VERTICES, False)
    except AttributeError:
        # ifcopenshell 0.7+ 신규 API 폴백
        try:
            settings.set("use-world-coords", True)
            settings.set("weld-vertices", False)
        except Exception:
            pass

    builder = GlbBuilder()
    elements: list[dict] = []

    all_positions: list[np.ndarray] = []  # 중앙 정렬용
    raw_geoms: list[dict] = []            # 임시 저장
    processed_ids: set[int] = set()       # 서브타입 중복 처리 방지

    for ifc_type, our_type in ELEMENT_TYPE_MAP.items():
        for product in ifc.by_type(ifc_type):
            express_id = product.id()
            if express_id in processed_ids:
                continue  # IfcWall/IfcWallStandardCase 등 서브타입 중복 스킵
            processed_ids.add(express_id)
            # 이미 더 정밀한 타입으로 처리된 경우 스킵 (IfcWallStandardCase 등)
            try:
                shape = ifcopenshell.geom.create_shape(settings, product)
            except Exception:
                continue

            geom = shape.geometry
            verts_flat = geom.verts   # [x0,y0,z0, x1,y1,z1, ...]
            faces_flat = geom.faces   # [i0,i1,i2, ...]

            if not verts_flat or not faces_flat:
                continue

            # IFC 좌표계(Z-up) → Three.js/glTF(Y-up) 변환 + 스케일
            arr = np.array(verts_flat, dtype=np.float32).reshape(-1, 3)
            # IFC(Z-up) → glTF(Y-up): X=동, Y=위(IFC Z), Z=남(IFC -Y)
            px = arr[:, 0] * scale
            py = arr[:, 2] * scale   # IFC Z → glTF Y (높이)
            pz = -arr[:, 1] * scale  # IFC Y → glTF -Z

            pos = np.column_stack([px, py, pz]).astype(np.float32)

            idx = np.array(faces_flat, dtype=np.uint32)
            if len(idx) == 0:
                continue

            # 노말 계산
            try:
                nrm_flat = geom.normals
                if nrm_flat and len(nrm_flat) == len(verts_flat):
                    nrm_arr = np.array(nrm_flat, dtype=np.float32).reshape(-1, 3)
                    nx = nrm_arr[:, 0]
                    ny = nrm_arr[:, 2]   # IFC Z normal → glTF Y
                    nz = -nrm_arr[:, 1]  # IFC Y normal → glTF -Z
                    nrm = np.column_stack([nx, ny, nz]).astype(np.float32)
                else:
                    raise ValueError("no normals")
            except Exception:
                # 노말 직접 계산 (face normal → vertex normal)
                nrm = _compute_normals(pos, idx)

            express_id = product.id()
            element_id = f"IFC-{express_id}-{project_id}" if project_id else f"IFC-{express_id}"

            # IfcSlab with PredefinedType=ROOF → IfcRoof 재분류
            if our_type == "IfcSlab":
                pre = getattr(product, "PredefinedType", None)
                if pre == ".ROOF.":
                    our_type = "IfcRoof"

            spatial = elem_to_spatial.get(express_id, {})
            global_id = getattr(product, "GlobalId", None)
            ifc_name  = getattr(product, "Name", None)

            min_pos = pos.min(axis=0)
            max_pos = pos.max(axis=0)
            center  = (min_pos + max_pos) / 2.0
            size    = np.maximum(max_pos - min_pos, 0.05)

            raw_geoms.append({
                "element_id": element_id,
                "our_type": our_type,
                "pos": pos,
                "nrm": nrm,
                "idx": idx,
                "center": center,
                "size": size,
                "spatial": spatial,
                "global_id": global_id,
                "ifc_name": ifc_name,
            })
            all_positions.append(pos)

    if not raw_geoms:
        logger.warning("[IFC Convert] 변환 가능한 부재가 없습니다.")
        return {
            "glb_bytes": builder.build(),
            "elements": [],
            "storeys": storeys,
            "geo_origin": {**geo_info, "ifcOffsetX": 0, "ifcOffsetY": 0, "ifcOffsetZ": 0, "scale": scale},
        }

    # ── 중앙 정렬 계산 ────────────────────────────────────────────────
    all_pts = np.vstack(all_positions)
    cx = float((all_pts[:, 0].min() + all_pts[:, 0].max()) / 2.0)
    min_y = float(all_pts[:, 1].min())  # Y = 높이, 바닥 기준
    cz = float((all_pts[:, 2].min() + all_pts[:, 2].max()) / 2.0)

    geo_origin = {
        **geo_info,
        "ifcOffsetX": cx,
        "ifcOffsetY": min_y,
        "ifcOffsetZ": cz,
        "scale": scale,
    }

    for g in raw_geoms:
        pos = g["pos"].copy()
        pos[:, 0] -= cx
        pos[:, 1] -= min_y
        pos[:, 2] -= cz

        color = ELEMENT_COLORS.get(g["our_type"], [0.7, 0.7, 0.7, 1.0])
        center = g["center"].copy()
        center[0] -= cx
        center[1] -= min_y
        center[2] -= cz

        extras = {
            "elementType": g["our_type"],
            "storey":      g["spatial"].get("storey"),
            "building":    g["spatial"].get("building"),
            "globalId":    g["global_id"],
            "ifcName":     g["ifc_name"],
            "color":       color,
        }

        builder.add_element(
            element_id=g["element_id"],
            positions=pos,
            normals=g["nrm"],
            indices=g["idx"],
            color=color,
            element_type=g["our_type"],
            extras=extras,
        )

        size = g["size"]
        elements.append({
            "elementId":   g["element_id"],
            "elementType": g["our_type"],
            "positionX":   round(float(center[0]), 4),
            "positionY":   round(float(center[2]), 4),   # Three.js Y=Z
            "positionZ":   round(float(center[1]), 4),   # Three.js Z=Y(높이)
            "sizeX":       round(float(size[0]), 4),
            "sizeY":       round(float(size[2]), 4),
            "sizeZ":       round(float(size[1]), 4),
            "rotationX": 0, "rotationY": 0, "rotationZ": 0,
            "material":  "Steel S355" if g["our_type"] == "IfcMember" else "Concrete C30",
            "globalId":    g["global_id"],
            "ifcName":     g["ifc_name"],
            "storey":      g["spatial"].get("storey"),
            "building":    g["spatial"].get("building"),
        })

    logger.info("[IFC Convert] 부재 %d개, 층 %d개 변환 완료", len(elements), len(storeys))
    return {
        "glb_bytes": builder.build(),
        "elements":  elements,
        "storeys":   storeys,
        "geo_origin": geo_origin,
    }


def _compute_normals(positions: np.ndarray, indices: np.ndarray) -> np.ndarray:
    """face normal → vertex normal (평균)."""
    normals = np.zeros_like(positions)
    tris = indices.reshape(-1, 3)
    v0 = positions[tris[:, 0]]
    v1 = positions[tris[:, 1]]
    v2 = positions[tris[:, 2]]
    face_normals = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(face_normals, axis=1, keepdims=True)
    norms[norms == 0] = 1
    face_normals /= norms
    for i, tri in enumerate(tris):
        normals[tri[0]] += face_normals[i]
        normals[tri[1]] += face_normals[i]
        normals[tri[2]] += face_normals[i]
    norms2 = np.linalg.norm(normals, axis=1, keepdims=True)
    norms2[norms2 == 0] = 1
    return (normals / norms2).astype(np.float32)
