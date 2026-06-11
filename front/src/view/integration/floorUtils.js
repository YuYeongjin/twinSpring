// 층 감지 · 진행율 캐스케이딩 유틸리티
// IntegrationScene, ControlSidebar 공통 사용

export const FLOOR_GAP    = 2.0;   // 층 구분 최소 높이 간격 (m)
const        OVERLAP_RATIO = 1.0;  // 1.0 = 하층 100% 완료 후 상층 착수 (엄격 순차)

// positionY 범위로 단위 추정 — getStructureScale 과 동일 기준(500)
// range > 500 → mm 단위(→ ×0.001 하면 미터), 그 이하 → 이미 미터
function inferYScale(elements) {
  let minY = Infinity, maxY = -Infinity;
  elements.forEach(el => {
    const y = Number(el.positionY) || 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  const range = maxY - minY;
  if (range === 0) return 1;
  return range > 500 ? 0.001 : 1;
}

/**
 * 부재 배열을 높이(m) 기준으로 층 그룹화 (아래→위 순서 반환)
 * @returns {{ avgY, minY, maxY, scale, elements }[]}
 *   avgY/minY/maxY 는 미터 단위. scale 은 positionY * scale = meters.
 */
export function detectFloors(elements) {
  if (!elements?.length) return [];
  const scale  = inferYScale(elements);
  const gapRaw = FLOOR_GAP / scale;   // raw 좌표 기준 층 간격 임계값

  const heightOf = el => Number(el.positionY) || 0;

  const sorted = [...elements].sort((a, b) => heightOf(a) - heightOf(b));
  const groups = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = groups[groups.length - 1];
    if (heightOf(sorted[i]) - heightOf(prev[prev.length - 1]) >= gapRaw)
      groups.push([sorted[i]]);
    else
      prev.push(sorted[i]);
  }
  return groups.map(g => {
    const ys  = g.map(heightOf);
    const avg = ys.reduce((a, b) => a + b) / ys.length;
    return {
      avgY:     avg * scale,
      minY:     Math.min(...ys) * scale,
      maxY:     Math.max(...ys) * scale,
      scale,                    // getElementFloorIndex 에서 재사용
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
  const hMeters = (Number(el.positionY) || 0) * scale;

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
