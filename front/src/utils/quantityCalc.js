/**
 * quantityCalc.js  —  Phase 1: 시방서 기준 하드코딩 테이블
 *
 * Phase 2 마이그레이션:
 *   resolveQuantity() 함수 본문만 Agent/RAG API 호출로 교체.
 *   호출부(wbsGenerator.js)와 DB 스키마는 변경 없음.
 */

// 단위 체적당 철근량 (kg/m³) — KDS / AIJ / ACI
const REBAR_DENSITY = {
  KDS: {
    IfcColumn: { avg: 155, formula: 'V(m³) × 155 kg/m³', reason: 'KDS 14 20 52 기둥 철근비 약 1.55% 적용' },
    IfcBeam:   { avg: 130, formula: 'V(m³) × 130 kg/m³', reason: 'KDS 14 20 22 보 철근비 약 1.30% 적용' },
    IfcWall:   { avg:  80, formula: 'V(m³) × 80 kg/m³',  reason: 'KDS 14 20 72 전단벽 철근비 0.25~0.6% 평균' },
    IfcSlab:   { avg: 110, formula: 'V(m³) × 110 kg/m³', reason: 'KDS 14 20 50 슬래브 철근비 약 1.10% 적용' },
    IfcRoof:   { avg: 110, formula: 'V(m³) × 110 kg/m³', reason: 'KDS 지붕 슬래브 — 슬래브 동일 기준 적용' },
    IfcPier:   { avg: 160, formula: 'V(m³) × 160 kg/m³', reason: 'KDS 기둥형 교각 철근비 기준' },
    IfcMember: { avg: 100, formula: 'V(m³) × 100 kg/m³', reason: 'KDS 일반 구조부재 평균 철근비' },
  },
  AIJ: {
    IfcColumn: { avg: 175, formula: 'V(m³) × 175 kg/m³', reason: 'AIJ 건축공사표준시방서 기둥 철근비 기준' },
    IfcBeam:   { avg: 145, formula: 'V(m³) × 145 kg/m³', reason: 'AIJ 보 철근비 기준' },
    IfcWall:   { avg:  90, formula: 'V(m³) × 90 kg/m³',  reason: 'AIJ 벽 철근비 기준' },
    IfcSlab:   { avg: 120, formula: 'V(m³) × 120 kg/m³', reason: 'AIJ 슬래브 철근비 기준' },
    IfcRoof:   { avg: 120, formula: 'V(m³) × 120 kg/m³', reason: 'AIJ 지붕 슬래브 — 슬래브 동일 기준 적용' },
    IfcPier:   { avg: 180, formula: 'V(m³) × 180 kg/m³', reason: 'AIJ 교각형 기둥 철근비 기준' },
    IfcMember: { avg: 110, formula: 'V(m³) × 110 kg/m³', reason: 'AIJ 일반 구조부재 평균 철근비' },
  },
  ACI: {
    IfcColumn: { avg: 150, formula: 'V(m³) × 150 kg/m³', reason: 'ACI 318 §18.7 기둥 철근비 1.0~8.0% 평균' },
    IfcBeam:   { avg: 125, formula: 'V(m³) × 125 kg/m³', reason: 'ACI 318 §9.6 보 최소/최대 철근비 기준' },
    IfcWall:   { avg:  75, formula: 'V(m³) × 75 kg/m³',  reason: 'ACI 318 §11.6 전단벽 0.25~0.5%' },
    IfcSlab:   { avg: 105, formula: 'V(m³) × 105 kg/m³', reason: 'ACI 318 §7.6 슬래브 철근비 기준' },
    IfcRoof:   { avg: 105, formula: 'V(m³) × 105 kg/m³', reason: 'ACI 318 지붕 슬래브 — 슬래브 동일 기준 적용' },
    IfcPier:   { avg: 155, formula: 'V(m³) × 155 kg/m³', reason: 'ACI 318 기둥형 교각 철근비 기준' },
    IfcMember: { avg:  95, formula: 'V(m³) × 95 kg/m³',  reason: 'ACI 318 일반 구조부재 평균 철근비' },
  },
};

// 거푸집 면적 비율 (m²/m³ — 체적 대비 접촉 면적)
const FORMWORK_RATIO = {
  IfcColumn: { ratio: 4.0, formula: 'V(m³) × 4.0 m²/m³', reason: '기둥 4면 기준, 평균 단면·높이 비율' },
  IfcBeam:   { ratio: 3.5, formula: 'V(m³) × 3.5 m²/m³', reason: '보 밑면+양측면 기준' },
  IfcWall:   { ratio: 5.0, formula: 'V(m³) × 5.0 m²/m³', reason: '벽체 양면 기준 (두께 대비)' },
  IfcSlab:   { ratio: 2.5, formula: 'V(m³) × 2.5 m²/m³', reason: '슬래브 밑면 기준' },
  IfcRoof:   { ratio: 3.0, formula: 'V(m³) × 3.0 m²/m³', reason: '지붕 슬래브 — 경사면 거푸집 면적 포함' },
  IfcPier:   { ratio: 3.8, formula: 'V(m³) × 3.8 m²/m³', reason: '교각 단면(원형/사각) 기준' },
  IfcMember: { ratio: 3.0, formula: 'V(m³) × 3.0 m²/m³', reason: '일반 구조부재 평균 비율' },
};

// 양생 기간 (일)
const CURING_DAYS = {
  IfcColumn: { days:  5, formula:  '5일', reason: 'KDS 14 20 10 기둥 초기 양생 최소 5일' },
  IfcBeam:   { days:  7, formula:  '7일', reason: 'KDS 보 지지하중 고려 양생 최소 7일' },
  IfcWall:   { days:  5, formula:  '5일', reason: 'KDS 벽체 양생 기준 최소 5일' },
  IfcSlab:   { days: 14, formula: '14일', reason: 'KDS 슬래브 구조 양생 최소 14일' },
  IfcRoof:   { days: 14, formula: '14일', reason: 'KDS 지붕 슬래브 — 슬래브 동일 양생 기준' },
  IfcPier:   { days:  7, formula:  '7일', reason: 'KDS 교각 양생 기준 최소 7일' },
  IfcMember: { days:  5, formula:  '5일', reason: 'KDS 일반 구조부재 양생 기준' },
};

// 바운딩박스 → 실제 체적 보정계수 (개구부·내부공간 제외)
const VOLUME_CORRECTION = {
  IfcColumn: 0.95,
  IfcBeam:   0.80,
  IfcWall:   0.85,
  IfcSlab:   0.95,
  IfcRoof:   0.90,
  IfcPier:   0.90,
  IfcMember: 0.88,
};

/**
 * 단일 element의 콘크리트 체적(m³) 추정
 */
export function elementVolume(el) {
  const c = VOLUME_CORRECTION[el.elementType] ?? 0.90;
  return ((el.sizeX || 0) * (el.sizeY || 0) * (el.sizeZ || 0)) * c;
}

/**
 * 한 부재그룹(elementType × storey)의 공종별 수량을 반환한다.
 *
 * Phase 1: 하드코딩 테이블에서 수치 조회.
 * Phase 2: ragCitations 가 있으면 시방서 출처를 reason 필드에 반영.
 *          (수치는 검증된 하드코딩 테이블 유지, 근거 텍스트만 RAG로 보강)
 *
 * @param {string}            elementType   예: 'IfcColumn'
 * @param {number}            totalVolumeM3 해당 그룹 체적 합계 (m³)
 * @param {'KDS'|'AIJ'|'ACI'} standard
 * @param {Array}             ragCitations  [{source, series, content}] — 옵션
 */
export function resolveQuantity(elementType, totalVolumeM3, standard = 'KDS', ragCitations = []) {
  const vol     = +totalVolumeM3.toFixed(3);
  const density = REBAR_DENSITY[standard]?.[elementType];
  const fw      = FORMWORK_RATIO[elementType];
  const cur     = CURING_DAYS[elementType];

  // RAG 시방서 출처가 있으면 첫 2개 인용을 reason 문자열로 합성
  // source/content 둘 다 없는 항목은 제외하여 공문자열이 reason을 덮어쓰는 버그 방지
  const ragParts = ragCitations.slice(0, 2)
    .map(c => [c.source, c.content?.slice(0, 80)].filter(Boolean).join(': '))
    .filter(s => s.length > 0);
  const ragReason = ragParts.length > 0 ? ragParts.join(' | ') : null;

  return {
    rebar: density
      ? { value: +(vol * density.avg).toFixed(1), unit: 'kg', formula: density.formula, reason: ragReason || density.reason }
      : null,
    formwork: fw
      ? { value: +(vol * fw.ratio).toFixed(2), unit: 'm²', formula: fw.formula, reason: ragReason || fw.reason }
      : null,
    concrete: {
      value: vol,
      unit: 'm³',
      formula: `${elementType} 부재 체적 합계`,
      reason: ragReason || '콘크리트 타설량 = 부재 체적(바운딩박스 × 보정계수)',
    },
    curing: cur
      ? { value: cur.days, unit: '일', formula: cur.formula, reason: ragReason || cur.reason }
      : null,
  };
}

/** 거푸집/철근 수량 산출 대상 구조 부재 타입 */
export const STRUCTURAL_TYPES = Object.keys(FORMWORK_RATIO);

/** 지원 시방서 기준 목록 */
export const STANDARDS = ['KDS', 'AIJ', 'ACI'];
