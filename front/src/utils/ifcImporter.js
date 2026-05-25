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
} from 'web-ifc';

// IFC 엔티티 타입 → 우리 서비스 elementType 매핑
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

// 4x4 컬럼-메이저 행렬의 3x3 회전 부분으로 법선 변환 (이동 없음)
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

/**
 * IFC 파일을 파싱하여 BimElementDTO 배열 + 실제 Three.js 지오메트리 데이터를 반환한다.
 *
 * 좌표계 변환:
 *   IFC  : X=오른쪽, Y=앞방향, Z=위
 *   Three.js: X=오른쪽, Y=위, Z=앞방향
 *
 * @param {File}     file       .ifc 파일 객체
 * @param {Function} onProgress 진행률 콜백 (0~100)
 * @returns {{ elements: BimElementDTO[], ifcMeshes: IfcMeshData[] }}
 */
export async function parseIfcFile(file, onProgress) {
  const ifcAPI = new IfcAPI();
  ifcAPI.SetWasmPath((process.env.PUBLIC_URL || '') + '/', true);
  await ifcAPI.Init();

  const buffer = await file.arrayBuffer();
  const modelId = ifcAPI.OpenModel(new Uint8Array(buffer));
  const scale   = detectUnitScale(ifcAPI, modelId);

  onProgress?.(5);

  // ── Step 1: expressId → ourType 맵 구축 ─────────────────────────
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
    return { elements: [], ifcMeshes: [] };
  }

  // ── Step 2: StreamAllMeshesWithTypes로 지오메트리 스트리밍 ────────
  const uniqueTypes = [...new Set(ELEMENT_TYPE_MAP.map(m => m.ifcType))];
  const elements    = [];  // AABB 기반 BimElementDTO (DB 저장용)
  const ifcMeshes   = [];  // 실제 Three.js 지오메트리 (클라이언트 렌더링용)
  let   processed   = 0;
  const total       = elemTypeMap.size;

  ifcAPI.StreamAllMeshesWithTypes(modelId, uniqueTypes, (mesh) => {
    const expressId = mesh.expressID;
    const ourType   = elemTypeMap.get(expressId);
    if (!ourType || mesh.geometries.size() === 0) return;

    // ── AABB 누산 + 실제 지오메트리 수집 ─────────────────────────
    let wMinX = Infinity, wMinY = Infinity, wMinZ = Infinity;
    let wMaxX = -Infinity, wMaxY = -Infinity, wMaxZ = -Infinity;

    // Three.js 공간에서 이 요소의 모든 정점/법선/인덱스
    const chunkPositions = [];  // Float32Array[]
    const chunkNormals   = [];  // Float32Array[]
    const chunkIndices   = [];  // Uint32Array[]
    let   baseIndex      = 0;
    let   meshColor      = null;

    for (let g = 0; g < mesh.geometries.size(); g++) {
      const geom = mesh.geometries.get(g);
      const mat  = geom.flatTransformation; // Float64Array, column-major 4×4

      // 첫 번째 지오메트리의 색상 사용
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

        const vertCount = verts.length / 6; // stride 6: x,y,z, nx,ny,nz
        const posArr    = new Float32Array(vertCount * 3);
        const normArr   = new Float32Array(vertCount * 3);

        for (let vi = 0; vi < vertCount; vi++) {
          const lx = verts[vi*6],   ly = verts[vi*6+1], lz = verts[vi*6+2];
          const nx = verts[vi*6+3], ny = verts[vi*6+4], nz = verts[vi*6+5];

          // 4×4 행렬 적용 → IFC 월드 좌표
          const [wx, wy, wz] = transformPoint(mat, lx, ly, lz);

          // 스케일 + IFC(Z-up) → Three.js(Y-up) 좌표 변환
          //   Three.js X = IFC X * scale
          //   Three.js Y = IFC Z * scale  (높이 방향)
          //   Three.js Z = IFC Y * scale  (깊이 방향)
          const tx = wx * scale;
          const ty = wz * scale;
          const tz = wy * scale;

          posArr[vi*3]   = tx;
          posArr[vi*3+1] = ty;
          posArr[vi*3+2] = tz;

          // 법선 변환 (3×3 회전 부분만, 스케일 없음)
          const [wnx, wny, wnz] = transformNormal(mat, nx, ny, nz);
          normArr[vi*3]   = wnx;
          normArr[vi*3+1] = wnz; // IFC NZ → Three.js NY
          normArr[vi*3+2] = wny; // IFC NY → Three.js NZ

          // AABB 갱신 (Three.js 공간 기준)
          if (tx < wMinX) wMinX = tx; if (tx > wMaxX) wMaxX = tx;
          if (ty < wMinY) wMinY = ty; if (ty > wMaxY) wMaxY = ty;
          if (tz < wMinZ) wMinZ = tz; if (tz > wMaxZ) wMaxZ = tz;
        }

        chunkPositions.push(posArr);
        chunkNormals.push(normArr);

        // 인덱스를 baseIndex만큼 오프셋해서 병합
        const adjIdx = new Uint32Array(idxs.length);
        for (let ii = 0; ii < idxs.length; ii++) adjIdx[ii] = idxs[ii] + baseIndex;
        chunkIndices.push(adjIdx);
        baseIndex += vertCount;

      } catch { /* 개별 지오메트리 오류는 스킵 */ }
      finally { geomData?.delete(); }
    }

    if (!isFinite(wMinX)) return;

    // ── AABB → BimElementDTO ─────────────────────────────────────
    // Three.js 공간에서의 AABB (이미 좌표 변환 완료)
    const sizeX = Math.max(wMaxX - wMinX, 0.05);
    const sizeY = Math.max(wMaxY - wMinY, 0.05);
    const sizeZ = Math.max(wMaxZ - wMinZ, 0.05);

    elements.push({
      elementId:   `IFC-${expressId}`,
      elementType: ourType,
      positionX:   parseFloat(((wMinX + wMaxX) / 2).toFixed(4)),
      positionY:   parseFloat(wMinY.toFixed(4)),
      positionZ:   parseFloat(((wMinZ + wMaxZ) / 2).toFixed(4)),
      sizeX:       parseFloat(sizeX.toFixed(4)),
      sizeY:       parseFloat(sizeY.toFixed(4)),
      sizeZ:       parseFloat(sizeZ.toFixed(4)),
      rotationX: 0, rotationY: 0, rotationZ: 0,
      material:  getMaterial(ourType),
    });

    // ── 지오메트리 청크 병합 → ifcMesh ─────────────────────────────
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
        elementId: `IFC-${expressId}`,
        elementType: ourType,
        color: meshColor || [0.7, 0.7, 0.7, 1.0], // [r, g, b, a]
        positions: mergedPos,
        normals:   mergedNorm,
        indices:   mergedIdx,
      });
    }

    processed++;
    onProgress?.(5 + Math.round((processed / total) * 85));
  });

  ifcAPI.CloseModel(modelId);

  if (elements.length === 0) {
    onProgress?.(100);
    return { elements: [], ifcMeshes: [] };
  }

  // ── Step 3: 중앙 정렬 — XZ 중심 = 원점, Y 기저 = 0 ──────────────
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const el of elements) {
    if (el.positionX < minX) minX = el.positionX;
    if (el.positionX > maxX) maxX = el.positionX;
    if (el.positionY < minY) minY = el.positionY;
    if (el.positionZ < minZ) minZ = el.positionZ;
    if (el.positionZ > maxZ) maxZ = el.positionZ;
  }

  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // elements 중앙 정렬
  const centered = elements.map(el => ({
    ...el,
    positionX: parseFloat((el.positionX - cx).toFixed(3)),
    positionY: parseFloat((el.positionY - minY).toFixed(3)),
    positionZ: parseFloat((el.positionZ - cz).toFixed(3)),
  }));

  // ifcMeshes 정점 위치 중앙 정렬
  for (const mesh of ifcMeshes) {
    const pos = mesh.positions;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i]   -= cx;
      pos[i+1] -= minY;
      pos[i+2] -= cz;
    }
  }

  onProgress?.(100);
  return { elements: centered, ifcMeshes };
}
