// 층 감지 · 진행율 캐스케이딩 유틸리티
// IntegrationScene, ControlSidebar 공통 사용

export const FLOOR_GAP    = 2.0;   // 층 구분 최소 높이 간격 (m)
const        OVERLAP_RATIO = 1.0;  // 1.0 = 하층 100% 완료 후 상층 착수 (엄격 순차)

// positionZ(Z-up 높이) 범위로 단위 추정 — getStructureScale 과 동일 기준(500)
// range > 500 → mm 단위(→ ×0.001 하면 미터), 그 이하 → 이미 미터
function inferYScale(elements) {
  let minZ = Infinity, maxZ = -Infinity;
  elements.forEach(el => {
    // Z-up DB: positionZ = 높이 방향
    const z = Number(el.positionZ) || 0;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  });
  const range = maxZ - minZ;
  if (range === 0) return 1;
  return range > 500 ? 0.001 : 1;
}

/**
 * 부재 배열을 높이(m) 기준으로 층 그룹화 (아래→위 순서 반환)
 * @returns {{ avgY, minY, maxY, scale, elements }[]}
 *   avgY/minY/maxY 는 미터 단위. scale 은 positionZ * scale = meters.
 */
export function detectFloors(elements) {
  if (!elements?.length) return [];
  const heightOf = el => Number(el.positionZ) || 0;

  // IfcSlab elements cluster cleanly at each floor level.
  // IfcMember elements span continuous Z ranges → cause false single-group detection.
  // When ≥2 slabs exist, use them as floor anchors and assign all elements to nearest floor.
  const slabs   = elements.filter(el => el.elementType === 'IfcSlab');
  const anchors  = slabs.length >= 2 ? slabs : elements;
  const scale    = inferYScale(anchors);
  const gapRaw   = FLOOR_GAP / scale;

  const anchorSorted = [...anchors].sort((a, b) => heightOf(a) - heightOf(b));
  const levelGroups  = [[anchorSorted[0]]];
  for (let i = 1; i < anchorSorted.length; i++) {
    const prev = levelGroups[levelGroups.length - 1];
    if (heightOf(anchorSorted[i]) - heightOf(prev[prev.length - 1]) >= gapRaw)
      levelGroups.push([anchorSorted[i]]);
    else
      prev.push(anchorSorted[i]);
  }

  if (slabs.length < 2) {
    return levelGroups.map(g => {
      const ys  = g.map(heightOf);
      const avg = ys.reduce((a, b) => a + b) / ys.length;
      return { avgY: avg * scale, minY: Math.min(...ys) * scale, maxY: Math.max(...ys) * scale, scale, elements: g };
    });
  }

  // Compute slab-floor centroids, then reassign ALL elements to their nearest floor
  const centroids = levelGroups.map(g => {
    const ys = g.map(heightOf);
    return ys.reduce((a, b) => a + b) / ys.length;
  });

  const allGroups = centroids.map(() => []);
  elements.forEach(el => {
    const h = heightOf(el);
    let best = 0, bestDist = Infinity;
    centroids.forEach((c, i) => {
      const d = Math.abs(h - c);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    allGroups[best].push(el);
  });

  return centroids.map((c, i) => {
    const g  = allGroups[i];
    const ys = g.length > 0 ? g.map(heightOf) : [c];
    const avg = ys.reduce((a, b) => a + b) / ys.length;
    return {
      avgY:     avg * scale,
      minY:     Math.min(...ys) * scale,
      maxY:     Math.max(...ys) * scale,
      scale,
      elements: g,
    };
  });
}

/**
 * 층 레이블 반환 (i18n: floorAbove, floorBelow)
 * avgY >= 0.5m → 지상층, 미만 → 지하층
 */
export function getFloorLabel(floorIndex, floors, t) {
  const f = floors[floorIndex];
  if (!f) return String(floorIndex + 1);
  if (f.avgY >= 0.5) {
    const aboveList = floors.filter(x => x.avgY >= 0.5);
    const n = aboveList.findIndex(x => x === f) + 1;
    return t('floorAbove', { n });
  } else {
    const belowList = [...floors.filter(x => x.avgY < 0.5)].sort((a, b) => b.avgY - a.avgY);
    const n = belowList.findIndex(x => x === f) + 1;
    return t('floorBelow', { n });
  }
}

/**
 * 부재가 속한 층 인덱스 반환 (미터 기준 비교)
 * floors 는 detectFloors() 반환 배열 — avgY가 미터, scale 포함
 */
export function getElementFloorIndex(el, floors) {
  if (!floors?.length) return 0;
  const scale   = floors[0]?.scale ?? 1;
  // Z-up DB: positionZ = 높이
  const hMeters = (Number(el.positionZ) || 0) * scale;

  let best = 0, bestDist = Infinity;
  floors.forEach((f, i) => {
    const d = Math.abs(hMeters - f.avgY);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/**
 * 캐스케이딩 층 진도 (엄격 순차: 하층 100% 완료 후 상층 착수)
 * @param {number} floorIndex     0 = 최하층
 * @param {number} totalFloors
 * @param {number} overallProgress  0-100
 * @returns {number} 0-100
 */
export function getFloorProgress(floorIndex, totalFloors, overallProgress) {
  if (totalFloors <= 1) return overallProgress;
  const stride = 100 / totalFloors;
  const start  = floorIndex * stride * OVERLAP_RATIO;
  return Math.min(100, Math.max(0, (overallProgress - start) / stride * 100));
}

/** 진도 기반 층 상태 문자열 ('done' | 'active' | 'pending') */
export function getFloorStatus(cascadeProgress) {
  if (cascadeProgress >= 100) return 'done';
  if (cascadeProgress >    0) return 'active';
  return 'pending';
}

/** 층 상태별 색상 */
export function getFloorStatusColor(status) {
  if (status === 'done')   return '#60a5fa';
  if (status === 'active') return '#22c55e';
  return '#374151';
}
