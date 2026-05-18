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

function getMaterial(ourType) {
  if (ourType === 'IfcMember') return 'Steel S355';
  if (ourType === 'IfcWall')   return 'Concrete C25';
  return 'Concrete C30';
}

// 모든 요소를 XZ 중심 = 원점, Y 기저 = 0 으로 정렬
function centerElements(elements) {
  if (!elements.length) return elements;

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

  return elements.map(el => ({
    ...el,
    positionX: parseFloat((el.positionX - cx).toFixed(3)),
    positionY: parseFloat((el.positionY - minY).toFixed(3)),
    positionZ: parseFloat((el.positionZ - cz).toFixed(3)),
  }));
}

/**
 * IFC 파일을 파싱하여 BimElementDTO 배열로 변환한다.
 *
 * 좌표계 변환:
 *   IFC  : X=오른쪽, Y=앞방향, Z=위
 *   Three.js: X=오른쪽, Y=위, Z=앞방향
 *
 * @param {File}     file       .ifc 파일 객체
 * @param {Function} onProgress 진행률 콜백 (0~100)
 */
export async function parseIfcFile(file, onProgress) {
  const ifcAPI = new IfcAPI();
  // absolute=true: webpack 번들 경로가 앞에 붙지 않도록
  ifcAPI.SetWasmPath((process.env.PUBLIC_URL || '') + '/', true);
  await ifcAPI.Init();

  const buffer = await file.arrayBuffer();
  const modelId = ifcAPI.OpenModel(new Uint8Array(buffer));
  const scale   = detectUnitScale(ifcAPI, modelId);

  onProgress?.(5);

  // ── Step 1: expressId → ourType 맵 구축 ──────────────────────────
  const elemTypeMap = new Map(); // expressId(number) → ourType(string)
  for (const { ifcType, ourType } of ELEMENT_TYPE_MAP) {
    const ids = ifcAPI.GetLineIDsWithType(modelId, ifcType, false);
    for (let i = 0; i < ids.size(); i++) {
      const id = ids.get(i);
      if (!elemTypeMap.has(id)) elemTypeMap.set(id, ourType); // 첫 매칭 우선
    }
  }

  if (elemTypeMap.size === 0) {
    ifcAPI.CloseModel(modelId);
    onProgress?.(100);
    return [];
  }

  // ── Step 2: StreamAllMeshesWithTypes로 지오메트리 일괄 스트리밍 ──
  // GetFlatMesh 개별 호출은 공유 인스턴스를 놓칠 수 있어서 StreamAllMeshesWithTypes 사용
  const uniqueTypes = [...new Set(ELEMENT_TYPE_MAP.map(m => m.ifcType))];
  const elements    = [];
  let   processed   = 0;
  const total       = elemTypeMap.size;

  ifcAPI.StreamAllMeshesWithTypes(modelId, uniqueTypes, (mesh) => {
    const expressId = mesh.expressID;
    const ourType   = elemTypeMap.get(expressId);
    if (!ourType || mesh.geometries.size() === 0) return;

    // 모든 geometry의 world-space 바운딩박스 누산
    let wMinX = Infinity, wMinY = Infinity, wMinZ = Infinity;
    let wMaxX = -Infinity, wMaxY = -Infinity, wMaxZ = -Infinity;

    for (let g = 0; g < mesh.geometries.size(); g++) {
      const geom = mesh.geometries.get(g);
      const mat  = geom.flatTransformation; // Float64Array, column-major
      let geomData = null;

      try {
        geomData = ifcAPI.GetGeometry(modelId, geom.geometryExpressID);
        const verts = ifcAPI.GetVertexArray(
          geomData.GetVertexData(),
          geomData.GetVertexDataSize()
        );

        // 로컬 바운딩박스 계산 (stride 6: x,y,z,nx,ny,nz)
        let lMinX = Infinity, lMinY = Infinity, lMinZ = Infinity;
        let lMaxX = -Infinity, lMaxY = -Infinity, lMaxZ = -Infinity;

        for (let vi = 0; vi < verts.length; vi += 6) {
          const lx = verts[vi], ly = verts[vi+1], lz = verts[vi+2];
          if (lx < lMinX) lMinX = lx; if (lx > lMaxX) lMaxX = lx;
          if (ly < lMinY) lMinY = ly; if (ly > lMaxY) lMaxY = ly;
          if (lz < lMinZ) lMinZ = lz; if (lz > lMaxZ) lMaxZ = lz;
        }

        if (!isFinite(lMinX)) return;

        // 8 코너를 world 좌표로 변환 (행렬 곱 8번)
        const corners = [
          [lMinX,lMinY,lMinZ],[lMaxX,lMinY,lMinZ],
          [lMinX,lMaxY,lMinZ],[lMaxX,lMaxY,lMinZ],
          [lMinX,lMinY,lMaxZ],[lMaxX,lMinY,lMaxZ],
          [lMinX,lMaxY,lMaxZ],[lMaxX,lMaxY,lMaxZ],
        ];
        for (const [cx, cy, cz] of corners) {
          const [wx, wy, wz] = transformPoint(mat, cx, cy, cz);
          const sx = wx * scale, sy = wy * scale, sz = wz * scale;
          if (sx < wMinX) wMinX = sx; if (sx > wMaxX) wMaxX = sx;
          if (sy < wMinY) wMinY = sy; if (sy > wMaxY) wMaxY = sy;
          if (sz < wMinZ) wMinZ = sz; if (sz > wMaxZ) wMaxZ = sz;
        }
      } catch { /* 개별 geometry 오류는 스킵 */ }
      finally { geomData?.delete(); }
    }

    if (!isFinite(wMinX)) return;

    // IFC(X,Y,Z) → Three.js(X,Z,Y): IFC Z=위 → Three.js Y=위
    const threeMinX = wMinX, threeMaxX = wMaxX;
    const threeMinY = wMinZ, threeMaxY = wMaxZ; // IFC Z = Three.js Y (높이)
    const threeMinZ = wMinY, threeMaxZ = wMaxY; // IFC Y = Three.js Z (깊이)

    const sizeX = Math.max(threeMaxX - threeMinX, 0.05);
    const sizeY = Math.max(threeMaxY - threeMinY, 0.05);
    const sizeZ = Math.max(threeMaxZ - threeMinZ, 0.05);

    elements.push({
      elementId:   `IFC-${expressId}`,
      elementType: ourType,
      positionX:   parseFloat(((threeMinX + threeMaxX) / 2).toFixed(4)),
      positionY:   parseFloat(threeMinY.toFixed(4)),
      positionZ:   parseFloat(((threeMinZ + threeMaxZ) / 2).toFixed(4)),
      sizeX:       parseFloat(sizeX.toFixed(4)),
      sizeY:       parseFloat(sizeY.toFixed(4)),
      sizeZ:       parseFloat(sizeZ.toFixed(4)),
      rotationX: 0, rotationY: 0, rotationZ: 0,
      material:  getMaterial(ourType),
    });

    processed++;
    onProgress?.(5 + Math.round((processed / total) * 85));
  });

  ifcAPI.CloseModel(modelId);

  const result = centerElements(elements);
  onProgress?.(100);
  return result;
}
