// 층 감지 · 진행율 캐스케이딩 유틸리티
// IntegrationScene, ControlSidebar 공통 사용

export const FLOOR_GAP    = 2.0;   // 층 구분 최소 높이 간격 (m)
const        OVERLAP_RATIO = 0.80;  // 하층이 이 비율에 도달하면 상층 착수

// 통합관제 BIM 원본 데이터 좌표 규칙: positionY = 높이 (toIntegrationCoords 변환 전)
function elHeight(el) { return Number(el.positionY) || 0; }

/**
 * 부재 배열을 높이 기준으로 층 그룹화 (아래→위 순서 반환)
 * @returns {{ avgY, minY, maxY, elements }[]}
 */
export function detectFloors(elements) {
  if (!elements?.length) return [];
  const sorted = [...elements].sort((a, b) => elHeight(a) - elHeight(b));
  const groups = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = groups[groups.length - 1];
    if (elHeight(sorted[i]) - elHeight(prev[prev.length - 1]) >= FLOOR_GAP)
      groups.push([sorted[i]]);
    else
      prev.push(sorted[i]);
  }
  return groups.map(g => {
    const ys = g.map(elHeight);
    return {
      avgY:     ys.reduce((a, b) => a + b) / ys.length,
      minY:     Math.min(...ys),
      maxY:     Math.max(...ys),
      elements: g,
    };
  });
}

/**
 * 층 레이블 반환 (i18n: floorAbove, floorBelow)
 * avgY >= 0.5 → 지상층, 미만 → 지하층
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
 * 부재가 속한 층 인덱스 반환 (가장 가까운 층 그룹)
 */
export function getElementFloorIndex(el, floors) {
  if (!floors?.length) return 0;
  const h = elHeight(el);
  let best = 0, bestDist = Infinity;
  floors.forEach((f, i) => {
    const d = Math.abs(h - f.avgY);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

/**
 * 캐스케이딩 층 진도:
 *   하층이 OVERLAP_RATIO(80%) 도달 시 상층 착수, 균등 분배 기반
 * @param {number} floorIndex     0 = 최하층
 * @param {number} totalFloors
 * @param {number} overallProgress  0-100 (해당 공종 WBS 전체 진도)
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
