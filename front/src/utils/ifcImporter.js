import {
  IfcAPI,
  IFCCOLUMN,
  IFCCOLUMNSTANDARDCASE,       // IFC4 (A-1)
  IFCBEAM,
  IFCBEAMSTANDARDCASE,         // IFC4 (A-1)
  IFCWALL,
  IFCWALLSTANDARDCASE,
  IFCSLAB,
  IFCMEMBER,
  IFCFOOTING,
  IFCPILE,
  IFCPLATE,
  IFCDOOR,
  IFCDOORSTANDARDCASE,         // IFC4 (A-7)
  IFCWINDOW,
  IFCWINDOWSTANDARDCASE,       // IFC4 (A-7)
  IFCSTAIR,
  IFCSTAIRFLIGHT,
  IFCRAMP,                     // 경사로 (A-4)
  IFCRAMPFLIGHT,               // (A-4)
  IFCROOF,
  IFCCURTAINWALL,              // 커튼월 (A-2)
  IFCRAILING,                  // 난간 (A-3)
  IFCCOVERING,                 // 마감재 (A-5)
  IFCBUILDINGELEMENTPROXY,     // 기타 미분류 (A-6)
  IFCREINFORCINGBAR,           // 철근 (A-8)
  IFCREINFORCINGMESH,          // 철근망 (A-8)
  IFCSIUNIT,
  IFCSITE,
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELAGGREGATES,
  IFCRELASSOCIATESMATERIAL,
  IFCRELDEFINEDBYPROPERTIES,
} from 'web-ifc';

// IFC 엔티티 타입 → 서비스 elementType 매핑
const ELEMENT_TYPE_MAP = [
  // 기둥
  { ifcType: IFCCOLUMN,               ourType: 'IfcColumn'      },
  { ifcType: IFCCOLUMNSTANDARDCASE,   ourType: 'IfcColumn'      }, // IFC4 (A-1)
  // 보
  { ifcType: IFCBEAM,                 ourType: 'IfcBeam'        },
  { ifcType: IFCBEAMSTANDARDCASE,     ourType: 'IfcBeam'        }, // IFC4 (A-1)
  // 벽체
  { ifcType: IFCWALL,                 ourType: 'IfcWall'        },
  { ifcType: IFCWALLSTANDARDCASE,     ourType: 'IfcWall'        },
  // 슬래브
  { ifcType: IFCSLAB,                 ourType: 'IfcSlab'        },
  // 구조 부재
  { ifcType: IFCMEMBER,               ourType: 'IfcMember'      },
  { ifcType: IFCPLATE,                ourType: 'IfcMember'      },
  // 기초
  { ifcType: IFCFOOTING,              ourType: 'IfcFoundation'  },
  { ifcType: IFCPILE,                 ourType: 'IfcPier'        },
  // 개구부 요소
  { ifcType: IFCDOOR,                 ourType: 'IfcDoor'        },
  { ifcType: IFCDOORSTANDARDCASE,     ourType: 'IfcDoor'        }, // IFC4 (A-7)
  { ifcType: IFCWINDOW,               ourType: 'IfcWindow'      },
  { ifcType: IFCWINDOWSTANDARDCASE,   ourType: 'IfcWindow'      }, // IFC4 (A-7)
  // 수직 동선
  { ifcType: IFCSTAIR,                ourType: 'IfcStair'       },
  { ifcType: IFCSTAIRFLIGHT,          ourType: 'IfcStair'       },
  { ifcType: IFCRAMP,                 ourType: 'IfcRamp'        }, // 경사로 (A-4)
  { ifcType: IFCRAMPFLIGHT,           ourType: 'IfcRamp'        }, // (A-4)
  // 지붕
  { ifcType: IFCROOF,                 ourType: 'IfcRoof'        },
  // 커튼월 (A-2)
  { ifcType: IFCCURTAINWALL,          ourType: 'IfcCurtainWall' },
  // 난간 (A-3)
  { ifcType: IFCRAILING,              ourType: 'IfcRailing'     },
  // 마감재 (A-5)
  { ifcType: IFCCOVERING,             ourType: 'IfcCovering'    },
  // 기타 미분류 (A-6)
  { ifcType: IFCBUILDINGELEMENTPROXY, ourType: 'IfcProxy'       },
  // 철근 (A-8)
  { ifcType: IFCREINFORCINGBAR,       ourType: 'IfcRebar'       },
  { ifcType: IFCREINFORCINGMESH,      ourType: 'IfcRebar'       },
];

// IFC 파일의 길이 단위 → 미터 스케일 팩터 감지
function detectUnitScale(ifcAPI, modelId) {
  try {
    const unitIds = ifcAPI.GetLineIDsWithType(modelId, IFCSIUNIT, false);
    for (let i = 0; i < unitIds.size(); i++) {
      const unit = ifcAPI.GetLine(modelId, unitIds.get(i), false);
      if (unit?.UnitType?.value === 'LENGTHUNIT') {
        const prefix = unit.Prefix?.value;
        if (prefix === 'MILLI') return 0.001;
        if (prefix === 'CENTI') return 0.01;
        if (prefix === 'DECI')  return 0.1;
        return 1.0;
      }
    }
  } catch { /* 무시 */ }
  return 1.0;
}

// 4x4 컬럼-메이저 행렬로 점 변환
function transformPoint(mat, x, y, z) {
  return [
    mat[0]*x + mat[4]*y + mat[8]*z  + mat[12],
    mat[1]*x + mat[5]*y + mat[9]*z  + mat[13],
    mat[2]*x + mat[6]*y + mat[10]*z + mat[14],
  ];
}

// 4x4 컬럼-메이저 행렬의 3x3 회전 부분으로 법선 변환
function transformNormal(mat, nx, ny, nz) {
  return [
    mat[0]*nx + mat[4]*ny + mat[8]*nz,
    mat[1]*nx + mat[5]*ny + mat[9]*nz,
    mat[2]*nx + mat[6]*ny + mat[10]*nz,
  ];
}

// IFC 재료가 없을 때 사용하는 타입별 폴백값
function getMaterialFallback(ourType) {
  if (ourType === 'IfcRebar')                              return 'Steel SD400';
  if (ourType === 'IfcMember' || ourType === 'IfcRailing') return 'Steel S355';
  if (ourType === 'IfcWall')        return 'Concrete C25';
  if (ourType === 'IfcCurtainWall') return 'Glass';
  if (ourType === 'IfcCovering')    return 'Finish';
  if (ourType === 'IfcProxy')       return 'Unknown';
  return 'Concrete C30';
}

// IfcRelAssociatesMaterial 순회 → expressId → 재료명 맵
function buildMaterialMap(ifcAPI, modelId) {
  const map = new Map();
  try {
    const relIds = ifcAPI.GetLineIDsWithType(modelId, IFCRELASSOCIATESMATERIAL, false);
    for (let i = 0; i < relIds.size(); i++) {
      try {
        const rel = ifcAPI.GetLine(modelId, relIds.get(i), true);
        const name = _extractMatName(rel?.RelatingMaterial);
        if (!name || !rel?.RelatedObjects) continue;
        for (const obj of rel.RelatedObjects) {
          const id = obj?.value ?? obj;
          if (id != null) map.set(id, name);
        }
      } catch { /* 개별 실패 무시 */ }
    }
  } catch { /* 무시 */ }
  return map;
}

function _extractMatName(mat) {
  if (!mat) return null;
  if (mat.Name?.value)                      return mat.Name.value;
  if (mat.MaterialLayers) {
    for (const l of (mat.MaterialLayers || []))
      if (l?.Material?.Name?.value) return l.Material.Name.value;
  }
  if (mat.ForLayerSet?.MaterialLayers) {
    for (const l of (mat.ForLayerSet.MaterialLayers || []))
      if (l?.Material?.Name?.value) return l.Material.Name.value;
  }
  if (mat.MaterialConstituents) {
    for (const c of (mat.MaterialConstituents || []))
      if (c?.Material?.Name?.value) return c.Material.Name.value;
  }
  if (mat.Materials) {
    for (const m of (mat.Materials || []))
      if (m?.Name?.value) return m.Name.value;
  }
  if (mat.ForProfileSet?.MaterialProfiles) {
    for (const mp of (mat.ForProfileSet.MaterialProfiles || []))
      if (mp?.Material?.Name?.value) return mp.Material.Name.value;
  }
  return null;
}

// IfcRelDefinesByProperties 순회 → expressId → { key: value } 속성 맵
function buildPropertiesMap(ifcAPI, modelId) {
  const map = new Map();
  try {
    const relIds = ifcAPI.GetLineIDsWithType(modelId, IFCRELDEFINEDBYPROPERTIES, false);
    for (let i = 0; i < relIds.size(); i++) {
      try {
        const rel = ifcAPI.GetLine(modelId, relIds.get(i), true);
        const pdef = rel?.RelatingPropertyDefinition;
        if (!pdef?.HasProperties || !rel?.RelatedObjects) continue;
        const props = {};
        for (const p of pdef.HasProperties) {
          const key = p?.Name?.value;
          if (!key) continue;
          const nominal = p?.NominalValue;
          props[key] = nominal?.value ?? null;
        }
        if (Object.keys(props).length === 0) continue;
        for (const obj of rel.RelatedObjects) {
          const id = obj?.value ?? obj;
          if (id == null) continue;
          const prev = map.get(id) || {};
          map.set(id, { ...prev, ...props });
        }
      } catch { /* 개별 실패 무시 */ }
    }
  } catch { /* 무시 */ }
  return map;
}

// column-major 4×4 행렬(flatTransformation)에서 ZYX Euler 각(degree)을 추출.
// flatTransformation은 월드 변환 행렬 — 이미 누적된 상위 배치 포함.
function extractRotationFromMatrix(mat) {
  // 열 벡터 길이로 스케일 제거
  const len0 = Math.sqrt(mat[0] ** 2 + mat[1] ** 2 + mat[2] ** 2) || 1;
  const len1 = Math.sqrt(mat[4] ** 2 + mat[5] ** 2 + mat[6] ** 2) || 1;
  const len2 = Math.sqrt(mat[8] ** 2 + mat[9] ** 2 + mat[10] ** 2) || 1;

  const r00 = mat[0] / len0, r10 = mat[1] / len0, r20 = mat[2] / len0;
  const r01 = mat[4] / len1, r11 = mat[5] / len1, r21 = mat[6] / len1;
  const r02 = mat[8] / len2, r12 = mat[9] / len2, r22 = mat[10] / len2;

  const ry = Math.asin(-Math.max(-1, Math.min(1, r20)));
  let rx, rz;
  if (Math.abs(Math.cos(ry)) > 1e-6) {
    rx = Math.atan2(r21, r22);
    rz = Math.atan2(r10, r00);
  } else {
    rx = Math.atan2(-r12, r11);
    rz = 0;
  }
  const toDeg = v => Math.round(v * (180 / Math.PI) * 100) / 100;
  return { rotationX: toDeg(rx), rotationY: toDeg(ry), rotationZ: toDeg(rz) };
}

// ── IfcSite 파싱 ───────────────────────────────────────────────────
function dmsToDecimal(arr) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  const [deg, min, sec, micro = 0] = arr;
  return deg + min / 60 + (sec + micro / 1_000_000) / 3600;
}

function extractSiteInfo(ifcAPI, modelId) {
  try {
    const siteIds = ifcAPI.GetLineIDsWithType(modelId, IFCSITE, false);
    if (siteIds.size() === 0) {
      console.warn('[IFC GeoOrigin] IfcSite 엔티티 없음 → 위경도 정보 없음');
      return null;
    }

    const site = ifcAPI.GetLine(modelId, siteIds.get(0), true);

    const rawLat = site.RefLatitude?.value;
    const rawLon = site.RefLongitude?.value;
    const rawElev = site.RefElevation?.value ?? null;

    const latitude  = dmsToDecimal(rawLat);
    const longitude = dmsToDecimal(rawLon);
    const elevation = typeof rawElev === 'number' ? rawElev : null;

    console.group('[IFC GeoOrigin] IfcSite 파싱 결과');
    console.log('Name       :', site.Name?.value ?? '(없음)');
    console.log('RefLatitude:', rawLat,  '→', latitude  !== null ? `${latitude.toFixed(6)}°`  : 'null');
    console.log('RefLongitude:', rawLon, '→', longitude !== null ? `${longitude.toFixed(6)}°` : 'null');
    console.log('RefElevation:', rawElev, 'm');

    const hasRealGeo = latitude !== null && longitude !== null &&
                       !(latitude === 0 && longitude === 0);
    if (hasRealGeo) {
      console.log('GIS 연동 가능: 실제 위경도 포함');
    } else {
      console.warn('GIS 연동 불가: 위경도가 null 이거나 (0,0)');
    }
    console.groupEnd();

    return { latitude, longitude, elevation };
  } catch (e) {
    console.warn('[IFC GeoOrigin] IfcSite 파싱 실패:', e);
    return null;
  }
}

// ── IFC 공간 구조(층/동) 추출 ──────────────────────────────────────
/**
 * IfcBuildingStorey / IfcBuilding 계층을 파싱하여
 * expressId → { storey, storeyElevation, building } 매핑과
 * 층 목록을 반환한다.
 */
function extractSpatialStructure(ifcAPI, modelId) {
  const elemToSpatial = new Map(); // expressId → { storey, storeyElevation, building }
  const storeys = [];              // { expressId, name, elevation, building, elementExpressIds[] }

  try {
    // Step 1: 층(IfcBuildingStorey) 목록 수집
    const storeyInfoMap = new Map();
    try {
      const storeyIds = ifcAPI.GetLineIDsWithType(modelId, IFCBUILDINGSTOREY, false);
      for (let i = 0; i < storeyIds.size(); i++) {
        const id = storeyIds.get(i);
        const ent = ifcAPI.GetLine(modelId, id, false);
        const name = ent?.LongName?.value || ent?.Name?.value || `Level_${i + 1}`;
        const elevation = typeof ent?.Elevation?.value === 'number' ? ent.Elevation.value : null;
        storeyInfoMap.set(id, { name, elevation, expressId: id });
      }
    } catch {}

    // Step 2: 건물(IfcBuilding) 목록 수집
    const buildingInfoMap = new Map();
    try {
      const bldgIds = ifcAPI.GetLineIDsWithType(modelId, IFCBUILDING, false);
      for (let i = 0; i < bldgIds.size(); i++) {
        const id = bldgIds.get(i);
        const ent = ifcAPI.GetLine(modelId, id, false);
        const name = ent?.LongName?.value || ent?.Name?.value || `Building_${i + 1}`;
        buildingInfoMap.set(id, { name, expressId: id });
      }
    } catch {}

    // Step 3: IfcRelAggregates로 층 → 건물 매핑
    const storeyToBuilding = new Map();
    try {
      const aggIds = ifcAPI.GetLineIDsWithType(modelId, IFCRELAGGREGATES, false);
      for (let i = 0; i < aggIds.size(); i++) {
        const rel = ifcAPI.GetLine(modelId, aggIds.get(i), false);
        const parentId = rel?.RelatingObject?.value;
        if (parentId === undefined || !buildingInfoMap.has(parentId)) continue;
        const related = rel?.RelatedObjects;
        if (!Array.isArray(related)) continue;
        for (const ref of related) {
          const childId = typeof ref === 'object' ? ref.value : ref;
          if (storeyInfoMap.has(childId)) storeyToBuilding.set(childId, parentId);
        }
      }
    } catch {}

    // Step 4: storeys 배열 초기화 (elevation 기준 정렬)
    for (const [sid, info] of storeyInfoMap) {
      const buildingId = storeyToBuilding.get(sid);
      const building = buildingId ? buildingInfoMap.get(buildingId) : null;
      storeys.push({
        expressId: sid,
        name: info.name,
        elevation: info.elevation,
        building: building?.name || null,
        buildingExpressId: buildingId || null,
        elementExpressIds: [],
      });
    }
    storeys.sort((a, b) => {
      if (a.building !== b.building) return (a.building || '').localeCompare(b.building || '');
      return (a.elevation ?? 0) - (b.elevation ?? 0);
    });

    // Step 5: IfcRelContainedInSpatialStructure로 부재 → 층 매핑
    try {
      const contIds = ifcAPI.GetLineIDsWithType(modelId, IFCRELCONTAINEDINSPATIALSTRUCTURE, false);
      for (let i = 0; i < contIds.size(); i++) {
        const rel = ifcAPI.GetLine(modelId, contIds.get(i), false);
        const structureId = rel?.RelatingStructure?.value;
        if (structureId === undefined) continue;
        const storeyInfo = storeyInfoMap.get(structureId);
        if (!storeyInfo) continue;

        const buildingId = storeyToBuilding.get(structureId);
        const buildingInfo = buildingId ? buildingInfoMap.get(buildingId) : null;
        const related = rel?.RelatedElements;
        if (!Array.isArray(related)) continue;

        const storeyEntry = storeys.find(s => s.expressId === structureId);
        for (const ref of related) {
          const elId = typeof ref === 'object' ? ref.value : ref;
          elemToSpatial.set(elId, {
            storey: storeyInfo.name,
            storeyElevation: storeyInfo.elevation,
            building: buildingInfo?.name || null,
          });
          if (storeyEntry && !storeyEntry.elementExpressIds.includes(elId)) {
            storeyEntry.elementExpressIds.push(elId);
          }
        }
      }
    } catch {}

    // Step 6: IfcRelAggregates 폴백 — 층에 직접 집계된 요소 매핑 (E-2)
    // 일부 소프트웨어(Tekla 등)는 ContainedIn 대신 Aggregates로 요소를 층에 연결
    try {
      const aggIds = ifcAPI.GetLineIDsWithType(modelId, IFCRELAGGREGATES, false);
      for (let i = 0; i < aggIds.size(); i++) {
        const rel = ifcAPI.GetLine(modelId, aggIds.get(i), false);
        const parentId = rel?.RelatingObject?.value;
        if (parentId === undefined || !storeyInfoMap.has(parentId)) continue;

        const storeyInfo  = storeyInfoMap.get(parentId);
        const buildingId  = storeyToBuilding.get(parentId);
        const buildingInfo = buildingId ? buildingInfoMap.get(buildingId) : null;
        const related = rel?.RelatedObjects;
        if (!Array.isArray(related)) continue;

        const storeyEntry = storeys.find(s => s.expressId === parentId);
        for (const ref of related) {
          const elId = typeof ref === 'object' ? ref.value : ref;
          if (elemToSpatial.has(elId)) continue; // 이미 매핑된 경우 스킵
          elemToSpatial.set(elId, {
            storey: storeyInfo.name,
            storeyElevation: storeyInfo.elevation,
            building: buildingInfo?.name || null,
          });
          if (storeyEntry && !storeyEntry.elementExpressIds.includes(elId)) {
            storeyEntry.elementExpressIds.push(elId);
          }
        }
      }
    } catch {}
  } catch (e) {
    console.warn('[IFC Spatial] 공간 구조 파싱 실패:', e);
  }

  console.log(`[IFC Spatial] 층 ${storeys.length}개 추출`, storeys.map(s => `${s.building || '-'}/${s.name}`));
  return { elemToSpatial, storeys };
}

// ── Three.js 정규화 좌표 → IFC 월드 좌표 역산 ─────────────────────
export function toIfcWorld(normX, normY, normZ, geoOrigin) {
  const { ifcOffsetX, ifcOffsetY, ifcOffsetZ, scale } = geoOrigin;
  const tx = normX + ifcOffsetX;
  const ty = normY + ifcOffsetZ;
  const tz = normZ + ifcOffsetY;
  return {
    ifc_X: tx / scale,
    ifc_Y: tz / scale,
    ifc_Z: ty / scale,
  };
}

/**
 * IFC 파일을 파싱하여 BimElementDTO 배열 + 실제 Three.js 지오메트리 데이터를 반환한다.
 *
 * @returns {{
 *   elements:      BimElementDTO[],  // globalId/ifcName/storey/building 포함
 *   ifcMeshes:     IfcMeshData[],
 *   detectedScale: number,
 *   geoOrigin:     object,
 *   storeys:       object[],          // 층 계층 구조 { name, elevation, building, elementIds }
 * }}
 */
export async function parseIfcFile(file, onProgress, userScale = 1.0) {
  const ifcAPI = new IfcAPI();
  ifcAPI.SetWasmPath((process.env.PUBLIC_URL || '') + '/', true);
  await ifcAPI.Init();

  const buffer = await file.arrayBuffer();
  const modelId = ifcAPI.OpenModel(new Uint8Array(buffer));
  const detectedScale = detectUnitScale(ifcAPI, modelId);
  const scale = detectedScale * userScale;

  onProgress?.(5);

  const siteInfo = extractSiteInfo(ifcAPI, modelId);

  // ── expressId → ourType 맵 ─────────────────────────────────────
  const elemTypeMap = new Map();
  for (const { ifcType, ourType } of ELEMENT_TYPE_MAP) {
    const ids = ifcAPI.GetLineIDsWithType(modelId, ifcType, false);
    for (let i = 0; i < ids.size(); i++) {
      const id = ids.get(i);
      if (!elemTypeMap.has(id)) elemTypeMap.set(id, ourType);
    }
  }

  // IfcRoof 재분류 (두 가지 패턴 처리)
  // 1) IfcSlab with PredefinedType=ROOF
  for (const [id, ourType] of elemTypeMap.entries()) {
    if (ourType !== 'IfcSlab') continue;
    try {
      const line = ifcAPI.GetLine(modelId, id, false);
      if (line?.PredefinedType?.value === 'ROOF') elemTypeMap.set(id, 'IfcRoof');
    } catch { /* skip */ }
  }
  // 2) IfcRoof 컨테이너의 자식 요소 (IfcRelAggregates)
  try {
    const roofIds = new Set();
    const rIds = ifcAPI.GetLineIDsWithType(modelId, IFCROOF, false);
    for (let i = 0; i < rIds.size(); i++) roofIds.add(rIds.get(i));

    if (roofIds.size > 0) {
      const aggIds = ifcAPI.GetLineIDsWithType(modelId, IFCRELAGGREGATES, false);
      for (let i = 0; i < aggIds.size(); i++) {
        const rel = ifcAPI.GetLine(modelId, aggIds.get(i), false);
        const parentId = rel?.RelatingObject?.value;
        if (!roofIds.has(parentId)) continue;
        const related = rel?.RelatedObjects;
        if (!Array.isArray(related)) continue;
        for (const ref of related) {
          const childId = typeof ref === 'object' ? ref.value : ref;
          if (elemTypeMap.has(childId)) elemTypeMap.set(childId, 'IfcRoof');
        }
      }
    }
  } catch { /* skip */ }

  if (elemTypeMap.size === 0) {
    ifcAPI.CloseModel(modelId);
    onProgress?.(100);
    return {
      elements: [], ifcMeshes: [], detectedScale, storeys: [],
      geoOrigin: {
        ...(siteInfo ?? { latitude: null, longitude: null, elevation: null }),
        ifcOffsetX: 0, ifcOffsetY: 0, ifcOffsetZ: 0, scale,
      },
    };
  }

  onProgress?.(10);

  // ── 공간 구조 추출 (층/동) ─────────────────────────────────────
  const { elemToSpatial, storeys } = extractSpatialStructure(ifcAPI, modelId);

  // ── GlobalId / Name 일괄 추출 ──────────────────────────────────
  const elemInfoMap = new Map(); // expressId → { globalId, name }
  for (const expressId of elemTypeMap.keys()) {
    try {
      const line = ifcAPI.GetLine(modelId, expressId, false);
      elemInfoMap.set(expressId, {
        globalId: line?.GlobalId?.value ?? null,
        name:     line?.Name?.value     ?? null,
      });
    } catch { /* 개별 실패 무시 */ }
  }

  // ── IFC 재료 맵 / 속성(Pset) 맵 빌드 ──────────────────────────
  const materialMap   = buildMaterialMap(ifcAPI, modelId);
  const propertiesMap = buildPropertiesMap(ifcAPI, modelId);

  onProgress?.(15);

  // ── StreamAllMeshesWithTypes로 지오메트리 스트리밍 ────────────
  const uniqueTypes = [...new Set(ELEMENT_TYPE_MAP.map(m => m.ifcType))];
  const elements    = [];
  const ifcMeshes   = [];
  let   processed   = 0;
  const total       = elemTypeMap.size;

  ifcAPI.StreamAllMeshesWithTypes(modelId, uniqueTypes, (mesh) => {
    const expressId = mesh.expressID;
    const ourType   = elemTypeMap.get(expressId);
    if (!ourType || mesh.geometries.size() === 0) return;

    let wMinX = Infinity, wMinY = Infinity, wMinZ = Infinity;
    let wMaxX = -Infinity, wMaxY = -Infinity, wMaxZ = -Infinity;
    let ifcMinX = Infinity, ifcMinY = Infinity, ifcMinZ = Infinity;
    let ifcMaxX = -Infinity, ifcMaxY = -Infinity, ifcMaxZ = -Infinity;

    const chunkPositions = [];
    const chunkNormals   = [];
    const chunkIndices   = [];
    let   baseIndex      = 0;
    let   meshColor      = null;
    let   firstMat       = null; // 첫 번째 geometry의 변환행렬 (rotation 추출용)

    for (let g = 0; g < mesh.geometries.size(); g++) {
      const geom = mesh.geometries.get(g);
      const mat  = geom.flatTransformation;
      if (!firstMat) firstMat = mat;

      if (!meshColor && geom.color) {
        meshColor = [geom.color.x, geom.color.y, geom.color.z, geom.color.w];
      }

      let geomData = null;
      try {
        geomData = ifcAPI.GetGeometry(modelId, geom.geometryExpressID);
        const verts = ifcAPI.GetVertexArray(
          geomData.GetVertexData(),
          geomData.GetVertexDataSize()
        );
        const idxs = ifcAPI.GetIndexArray(
          geomData.GetIndexData(),
          geomData.GetIndexDataSize()
        );

        const vertCount = verts.length / 6;
        const posArr    = new Float32Array(vertCount * 3);
        const normArr   = new Float32Array(vertCount * 3);

        for (let vi = 0; vi < vertCount; vi++) {
          const lx = verts[vi*6],   ly = verts[vi*6+1], lz = verts[vi*6+2];
          const nx = verts[vi*6+3], ny = verts[vi*6+4], nz = verts[vi*6+5];

          const [wx, wy, wz] = transformPoint(mat, lx, ly, lz);

          if (wx < ifcMinX) ifcMinX = wx; if (wx > ifcMaxX) ifcMaxX = wx;
          if (wy < ifcMinY) ifcMinY = wy; if (wy > ifcMaxY) ifcMaxY = wy;
          if (wz < ifcMinZ) ifcMinZ = wz; if (wz > ifcMaxZ) ifcMaxZ = wz;

          const tx = wx * scale;
          const ty = wz * scale;
          const tz = wy * scale;

          posArr[vi*3]   = tx;
          posArr[vi*3+1] = ty;
          posArr[vi*3+2] = tz;

          const [wnx, wny, wnz] = transformNormal(mat, nx, ny, nz);
          normArr[vi*3]   = wnx;
          normArr[vi*3+1] = wnz;
          normArr[vi*3+2] = wny;

          if (tx < wMinX) wMinX = tx; if (tx > wMaxX) wMaxX = tx;
          if (ty < wMinY) wMinY = ty; if (ty > wMaxY) wMaxY = ty;
          if (tz < wMinZ) wMinZ = tz; if (tz > wMaxZ) wMaxZ = tz;
        }

        chunkPositions.push(posArr);
        chunkNormals.push(normArr);

        const adjIdx = new Uint32Array(idxs.length);
        for (let ii = 0; ii < idxs.length; ii++) adjIdx[ii] = idxs[ii] + baseIndex;
        chunkIndices.push(adjIdx);
        baseIndex += vertCount;

      } catch { /* 개별 지오메트리 오류 스킵 */ }
      finally { geomData?.delete(); }
    }

    if (!isFinite(wMinX)) return;

    const sX = Math.max(wMaxX - wMinX, 0.05);
    const sY = Math.max(wMaxZ - wMinZ, 0.05);
    const sZ = Math.max(wMaxY - wMinY, 0.05);

    const spatial   = elemToSpatial.get(expressId) ?? {};
    const elemInfo  = elemInfoMap.get(expressId)   ?? {};
    const rotAngles = firstMat ? extractRotationFromMatrix(firstMat) : { rotationX: 0, rotationY: 0, rotationZ: 0 };

    elements.push({
      elementId:   `IFC-${expressId}`,
      elementType: ourType,
      positionX:   parseFloat(((wMinX + wMaxX) / 2).toFixed(4)),  // IFC X (m)
      positionY:   parseFloat(((wMinZ + wMaxZ) / 2).toFixed(4)),  // IFC Y (m) = Three.js Z
      positionZ:   parseFloat(((wMinY + wMaxY) / 2).toFixed(4)),  // IFC Z (m) = Three.js Y (높이 중심, D-3)
      sizeX:       parseFloat(sX.toFixed(4)),
      sizeY:       parseFloat(sY.toFixed(4)),
      sizeZ:       parseFloat(sZ.toFixed(4)),
      rotationX:   rotAngles.rotationX,
      rotationY:   rotAngles.rotationY,
      rotationZ:   rotAngles.rotationZ,
      material:       materialMap.get(expressId) || getMaterialFallback(ourType),
      ifcProperties:  (() => {
        const p = propertiesMap.get(expressId);
        return p && Object.keys(p).length > 0 ? JSON.stringify(p) : null;
      })(),

      // IFC 원본 좌표 (GIS용)
      ifcWorldX: isFinite(ifcMinX) ? parseFloat(((ifcMinX + ifcMaxX) / 2).toFixed(4)) : null,
      ifcWorldY: isFinite(ifcMinY) ? parseFloat(((ifcMinY + ifcMaxY) / 2).toFixed(4)) : null,
      ifcWorldZ: isFinite(ifcMinZ) ? parseFloat(((ifcMinZ + ifcMaxZ) / 2).toFixed(4)) : null,

      // IFC 구조 분석 결과
      globalId: elemInfo.globalId,
      ifcName:  elemInfo.name,
      storey:   spatial.storey   ?? null,
      building: spatial.building ?? null,
    });

    if (chunkPositions.length > 0) {
      const totalVerts = chunkPositions.reduce((s, a) => s + a.length, 0);
      const totalIdxs  = chunkIndices.reduce((s, a) => s + a.length, 0);

      const mergedPos  = new Float32Array(totalVerts);
      const mergedNorm = new Float32Array(totalVerts);
      const mergedIdx  = new Uint32Array(totalIdxs);

      let pOff = 0, iOff = 0;
      for (let ci = 0; ci < chunkPositions.length; ci++) {
        mergedPos.set(chunkPositions[ci], pOff);
        mergedNorm.set(chunkNormals[ci], pOff);
        mergedIdx.set(chunkIndices[ci], iOff);
        pOff += chunkPositions[ci].length;
        iOff += chunkIndices[ci].length;
      }

      ifcMeshes.push({
        expressId,
        elementId:   `IFC-${expressId}`,
        elementType: ourType,
        color: meshColor || [0.7, 0.7, 0.7, 1.0],
        positions: mergedPos,
        normals:   mergedNorm,
        indices:   mergedIdx,
      });
    }

    processed++;
    onProgress?.(15 + Math.round((processed / total) * 75));
  });

  ifcAPI.CloseModel(modelId);

  if (elements.length === 0) {
    onProgress?.(100);
    return {
      elements: [], ifcMeshes: [], detectedScale, storeys: [],
      geoOrigin: {
        ...(siteInfo ?? { latitude: null, longitude: null, elevation: null }),
        ifcOffsetX: 0, ifcOffsetY: 0, ifcOffsetZ: 0, scale,
      },
    };
  }

  // ── Step 3: 중앙 정렬 (D-3 수정: IFC 좌표계 기준 3축 통일) ─────
  // positionX = IFC X(m), positionY = IFC Y(m), positionZ = IFC Z(m, 높이 중심)
  // Three.js 축: X=IFC X, Y=IFC Z(높이), Z=IFC Y
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;  // IFC Y 범위
  let minZ = Infinity;                    // IFC Z 최솟값 → 지상 1층 근사

  for (const el of elements) {
    if (el.positionX < minX) minX = el.positionX;
    if (el.positionX > maxX) maxX = el.positionX;
    if (el.positionY < minY) minY = el.positionY;
    if (el.positionY > maxY) maxY = el.positionY;
    if (el.positionZ < minZ) minZ = el.positionZ;
  }

  const cx       = (minX + maxX) / 2;  // IFC X 중심
  const cy       = (minY + maxY) / 2;  // IFC Y 중심
  const czOrigin = isFinite(minZ) ? minZ : 0;  // IFC Z 지상 기준 (Python 동일)

  const centered = elements.map(el => ({
    ...el,
    positionX: parseFloat((el.positionX - cx).toFixed(3)),
    positionY: parseFloat((el.positionY - cy).toFixed(3)),
    positionZ: parseFloat((el.positionZ - czOrigin).toFixed(3)),
  }));

  // Three.js 메시 좌표 정렬: X-=cx, Y(=IFC Z)-=czOrigin, Z(=IFC Y)-=cy
  for (const mesh of ifcMeshes) {
    const pos = mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i]   -= cx;        // Three.js X  = IFC X  → -cx
      pos[i+1] -= czOrigin;  // Three.js Y  = IFC Z  → -czOrigin (지상 기준)
      pos[i+2] -= cy;        // Three.js Z  = IFC Y  → -cy
    }
  }

  // ── 층 목록에 정규화된 elementId 매핑 추가 ────────────────────────
  const normalizedStoreys = storeys.map(s => ({
    name:      s.name,
    elevation: s.elevation,
    building:  s.building,
    elementIds: s.elementExpressIds.map(xid => `IFC-${xid}`),
  }));

  const geoOrigin = {
    latitude:   siteInfo?.latitude  ?? null,
    longitude:  siteInfo?.longitude ?? null,
    elevation:  siteInfo?.elevation ?? null,
    ifcOffsetX: cx,        // IFC X 중심 (Three.js X 오프셋)
    ifcOffsetY: cy,        // IFC Y 중심 (Three.js Z 오프셋)
    ifcOffsetZ: czOrigin,  // IFC Z 지상 기준 (Three.js Y 오프셋)
    scale,
    detectedScale,
  };

  console.group('[IFC GeoOrigin] 최종 geoOrigin');
  console.log('latitude  :', geoOrigin.latitude);
  console.log('longitude :', geoOrigin.longitude);
  console.log('elevation :', geoOrigin.elevation, 'm');
  console.log('ifcOffsetX:', geoOrigin.ifcOffsetX.toFixed(4));
  console.log('ifcOffsetY:', geoOrigin.ifcOffsetY.toFixed(4));
  console.log('ifcOffsetZ:', geoOrigin.ifcOffsetZ.toFixed(4));
  console.log('scale     :', geoOrigin.scale);
  console.groupEnd();

  console.log(`[IFC Parse] 부재 ${centered.length}개, 층 ${normalizedStoreys.length}개 완료`);
  onProgress?.(100);
  return { elements: centered, ifcMeshes, detectedScale, geoOrigin, storeys: normalizedStoreys };
}
