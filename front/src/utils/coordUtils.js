/**
 * 좌표계 변환 유틸리티
 *
 * 좌표계 관계:
 *   IFC   : X=오른쪽, Y=앞방향(북), Z=위  (Z-up)
 *   Three : X=오른쪽, Y=위,           Z=앞방향 (Y-up)
 *
 * 변환 공식:
 *   Three.X =  IFC.X * scale - ifcOffsetX
 *   Three.Y =  IFC.Z * scale - ifcOffsetZ   ← IFC Z(높이) → Three Y(높이)
 *   Three.Z =  IFC.Y * scale - ifcOffsetY   ← IFC Y(북)   → Three Z(앞)
 *
 * ※ 렌더링 파이프라인 변경 금지. 이 함수는 순수 계산 전용.
 */

/**
 * Three.js 정규화 좌표 → IFC 월드 좌표 (Z-up)
 * @param {number} normX  Three.js X (화면 기준)
 * @param {number} normY  Three.js Y (높이)
 * @param {number} normZ  Three.js Z (깊이)
 * @param {object} geoOrigin  parseIfcFile() 반환값의 geoOrigin
 * @returns {{ ifc_X, ifc_Y, ifc_Z }} IFC 월드 좌표 (미터, Z-up)
 */
export function toIfcWorld(normX, normY, normZ, geoOrigin) {
  const { ifcOffsetX, ifcOffsetY, ifcOffsetZ, scale } = geoOrigin;
  const tx = normX + ifcOffsetX;   // Three.js X → IFC X 오프셋 복원
  const ty = normY + ifcOffsetZ;   // Three.js Y → IFC Z 오프셋 복원
  const tz = normZ + ifcOffsetY;   // Three.js Z → IFC Y 오프셋 복원
  return {
    ifc_X: tx / scale,
    ifc_Y: tz / scale,  // Three.js Z → IFC Y (북방향)
    ifc_Z: ty / scale,  // Three.js Y → IFC Z (높이)
  };
}

/**
 * IFC 월드 좌표 (Z-up) → Three.js 정규화 좌표
 * @param {number} ifcX  IFC X
 * @param {number} ifcY  IFC Y (북방향)
 * @param {number} ifcZ  IFC Z (높이)
 * @param {object} geoOrigin
 * @returns {{ normX, normY, normZ }}
 */
export function fromIfcWorld(ifcX, ifcY, ifcZ, geoOrigin) {
  const { ifcOffsetX, ifcOffsetY, ifcOffsetZ, scale } = geoOrigin;
  return {
    normX: ifcX * scale - ifcOffsetX,
    normY: ifcZ * scale - ifcOffsetZ,  // IFC Z(높이) → Three.js Y
    normZ: ifcY * scale - ifcOffsetY,  // IFC Y(북)   → Three.js Z
  };
}

/**
 * GPS(위경도) → IFC 월드 좌표 (단순 평면 근사, 소규모 현장용)
 * geoOrigin에 latitude/longitude가 있어야 동작.
 * @param {number} lat
 * @param {number} lng
 * @param {object} geoOrigin  { latitude, longitude }
 * @returns {{ ifcX, ifcY } | null}
 */
export function gpsToIfcWorld(lat, lng, geoOrigin) {
  if (geoOrigin.latitude == null || geoOrigin.longitude == null) return null;
  const R = 6_378_137; // 지구 반경 (m)
  const dLat = (lat - geoOrigin.latitude)  * (Math.PI / 180);
  const dLng = (lng - geoOrigin.longitude) * (Math.PI / 180);
  const ifcX = R * dLng * Math.cos(geoOrigin.latitude * (Math.PI / 180));
  const ifcY = R * dLat;
  return { ifcX, ifcY, ifcZ: 0 };
}

/**
 * IFC 월드 좌표 → GPS(위경도)
 * @param {number} ifcX
 * @param {number} ifcY
 * @param {object} geoOrigin  { latitude, longitude }
 * @returns {{ lat, lng } | null}
 */
export function ifcWorldToGps(ifcX, ifcY, geoOrigin) {
  if (geoOrigin.latitude == null || geoOrigin.longitude == null) return null;
  const R = 6_378_137;
  const dLat = ifcY / R;
  const dLng = ifcX / (R * Math.cos(geoOrigin.latitude * (Math.PI / 180)));
  return {
    lat: geoOrigin.latitude  + dLat * (180 / Math.PI),
    lng: geoOrigin.longitude + dLng * (180 / Math.PI),
  };
}

/**
 * Three.js 정규화 좌표 → GPS (geoOrigin에 위경도가 있을 때)
 * @param {number} normX
 * @param {number} normY
 * @param {number} normZ
 * @param {object} geoOrigin
 * @returns {{ lat, lng } | null}
 */
export function normToGps(normX, normY, normZ, geoOrigin) {
  const ifc = toIfcWorld(normX, normY, normZ, geoOrigin);
  return ifcWorldToGps(ifc.ifc_X, ifc.ifc_Y, geoOrigin);
}

/**
 * 드론 EXIF GPS → Three.js 정규화 좌표
 * 드론 사진의 EXIF GPS를 BIM 뷰어 Three.js 좌표로 변환할 때 사용.
 * @param {number} lat        드론 GPS 위도
 * @param {number} lng        드론 GPS 경도
 * @param {number} altitudeM  드론 고도 (해발 m, EXIF GPSAltitude)
 * @param {object} geoOrigin  { latitude, longitude, elevation, ifcOffsetX/Y/Z, scale }
 * @returns {{ normX, normY, normZ } | null}
 */
export function droneGpsToNorm(lat, lng, altitudeM, geoOrigin) {
  const ifc = gpsToIfcWorld(lat, lng, geoOrigin);
  if (!ifc) return null;
  const ifcZ = geoOrigin.elevation != null ? altitudeM - geoOrigin.elevation : altitudeM;
  return fromIfcWorld(ifc.ifcX, ifc.ifcY, ifcZ, geoOrigin);
}
