import {
  IfcAPI,
  IFCCOLUMN,
  IFCBEAM,
  IFCWALL,
  IFCWALLSTANDARDCASE,
  IFCSLAB,
  IFCMEMBER,
  IFCFOOTING,
  IFCPILE,
  IFCPLATE,
  IFCSIUNIT,
  IFCSITE,
  IFCBUILDING,
  IFCBUILDINGSTOREY,
  IFCDOOR,
  IFCWINDOW,
  IFCSTAIR,
  IFCSTAIRFLIGHT,
  IFCROOF,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELAGGREGATES,
} from 'web-ifc';

// IFC 엔티티 타입 → 서비스 elementType 매핑
const ELEMENT_TYPE_MAP = [
  { ifcType: IFCCOLUMN,           ourType: 'IfcColumn' },
  { ifcType: IFCBEAM,             ourType: 'IfcBeam'   },
  { ifcType: IFCWALL,             ourType: 'IfcWall'   },
  { ifcType: IFCWALLSTANDARDCASE, ourType: 'IfcWall'   },
  { ifcType: IFCSLAB,             ourType: 'IfcSlab'   },
  { ifcType: IFCMEMBER,           ourType: 'IfcMember' },
  { ifcType: IFCFOOTING,          ourType: 'IfcSlab'   },
  { ifcType: IFCPILE,             ourType: 'IfcPier'   },
  { ifcType: IFCPLATE,            ourType: 'IfcMember' },
  { ifcType: IFCDOOR,             ourType: 'IfcDoor'   },
  { ifcType: IFCWINDOW,           ourType: 'IfcWindow' },
  { ifcType: IFCSTAIR,            ourType: 'IfcStair'  },
  { ifcType: IFCSTAIRFLIGHT,      ourType: 'IfcStair'  },
  { ifcType: IFCROOF,             ourType: 'IfcRoof'   },
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

function getMaterial(ourType) {
  if (ourType === 'IfcMember') return 'Steel S355';
  if (ourType === 'IfcWall')   return 'Concrete C25';
  return 'Concrete C30';
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
      console.log('✅ GIS 연동 가능: 실제 위경도 포함');
    } else {
      console.warn('⚠️  GIS 연동 불가: 위경도가 null 이거나 (0,0)');
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

    for (let g = 0; g < mesh.geometries.size(); g++) {
      const geom = mesh.geometries.get(g);
      const mat  = geom.flatTransformation;

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

    const spatial  = elemToSpatial.get(expressId) ?? {};
    const elemInfo = elemInfoMap.get(expressId)   ?? {};

    elements.push({
      elementId:   `IFC-${expressId}`,
      elementType: ourType,
      positionX:   parseFloat(((wMinX + wMaxX) / 2).toFixed(4)),
      positionY:   parseFloat(((wMinZ + wMaxZ) / 2).toFixed(4)),
      positionZ:   parseFloat(wMinY.toFixed(4)),
      sizeX:       parseFloat(sX.toFixed(4)),
      sizeY:       parseFloat(sY.toFixed(4)),
      sizeZ:       parseFloat(sZ.toFixed(4)),
      rotationX: 0, rotationY: 0, rotationZ: 0,
      material:  getMaterial(ourType),

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

  // ── Step 3: 중앙 정렬 ────────────────────────────────────────────
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity;

  for (const el of elements) {
    if (el.positionX < minX) minX = el.positionX;
    if (el.positionX > maxX) maxX = el.positionX;
    if (el.positionY < minY) minY = el.positionY;
    if (el.positionY > maxY) maxY = el.positionY;
    if (el.positionZ < minZ) minZ = el.positionZ;
  }

  const cx = (minX + maxX) / 2;

  let actualMinZ = Infinity;
  for (const m of ifcMeshes) {
    const p = m.positions;
    for (let i = 2; i < p.length; i += 3) {
      if (p[i] < actualMinZ) actualMinZ = p[i];
    }
  }
  if (!isFinite(actualMinZ)) actualMinZ = (minY + maxY) / 2;

  const centered = elements.map(el => ({
    ...el,
    positionX: parseFloat((el.positionX - cx).toFixed(3)),
    positionY: parseFloat((el.positionY - actualMinZ).toFixed(3)),
    positionZ: parseFloat((el.positionZ - minZ).toFixed(3)),
  }));

  for (const mesh of ifcMeshes) {
    const pos = mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i]   -= cx;
      pos[i+1] -= minZ;
      pos[i+2] -= actualMinZ;
    }
  }

  // ── 층 목록에 정규화된 elementId 매핑 추가 ────────────────────────
  // expressId → 'IFC-{expressId}' 변환 (App.js에서 projectId suffix 추가 전 단계)
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
    ifcOffsetX: cx,
    ifcOffsetY: actualMinZ,
    ifcOffsetZ: minZ,
    scale,
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
