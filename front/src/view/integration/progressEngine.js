// Construction resource dependency rules for BIM element types
// elementType → 어떤 장비/인원이 있어야 진행되는지, 있으면 얼마나 빠른지

export const EQUIP_LABEL = { excavator: '굴착기', dump: '덤프트럭', crane: '크레인' };

export const TASK_RULES = {

  IfcSlab: {
    // 기초/슬래브: 굴착기 + 덤프트럭이 모두 있어야 시작 가능
    // - 굴착기 없으면 기초 굴착 자체가 불가
    // - 덤프트럭 없으면 토사를 반출할 수 없어 진행 불가
    blockers: [
      { type: 'excavator', min: 1, reason: '굴착기 없음 → 기초 굴착 불가' },
      { type: 'dump',      min: 1, reason: '덤프트럭 없음 → 토사 반출 불가' },
    ],
    equipBonus: [
      { type: 'excavator', perUnit: 0.40 }, // 굴착기 1대 추가 → +40% 속도
      { type: 'dump',      perUnit: 0.25 }, // 덤프트럭 1대 추가 → +25% 속도
    ],
    workerBonus:      0.12, // 작업자 1명당 +12% 속도
    minWorkers:       1,    // 최소 1명 이상 있어야 표준속도
    fewWorkerPenalty: 0.60, // 1명 미만: 속도 × 0.6
  },

  IfcColumn: {
    // 기둥: 크레인 없으면 부재 인양 자체가 불가
    blockers: [
      { type: 'crane', min: 1, reason: '크레인 없음 → 기둥 인양 불가' },
    ],
    equipBonus: [
      { type: 'crane', perUnit: 0.50 }, // 크레인 추가 1대 → +50% 속도
    ],
    workerBonus:      0.15,
    minWorkers:       2,    // 최소 2명 (신호수 + 체결 작업자)
    fewWorkerPenalty: 0.50,
  },

  IfcBeam: {
    // 보: 크레인 없으면 보 인양 불가 (기둥과 동일 패턴)
    blockers: [
      { type: 'crane', min: 1, reason: '크레인 없음 → 보 인양 불가' },
    ],
    equipBonus: [
      { type: 'crane', perUnit: 0.40 },
    ],
    workerBonus:      0.15,
    minWorkers:       2,
    fewWorkerPenalty: 0.50,
  },

  IfcWall: {
    // 벽체: 장비 블로커 없음 (인력 집약 공종 — 벽돌/거푸집/철근 등)
    // 작업자 수가 속도에 직결됨
    blockers:   [],
    equipBonus: [],
    workerBonus:      0.30, // 작업자 효과가 가장 큼
    minWorkers:       2,    // 2명 미만이면 속도 대폭 감소
    fewWorkerPenalty: 0.25,
  },

  IfcPier: {
    // 교각: 크레인 + 굴착기 모두 필수 (가장 복합 공종)
    // 덤프트럭도 있으면 추가 가속
    blockers: [
      { type: 'crane',     min: 1, reason: '크레인 없음 → 교각 콘크리트 타설/인양 불가' },
      { type: 'excavator', min: 1, reason: '굴착기 없음 → 교각 기초 굴착 불가' },
    ],
    equipBonus: [
      { type: 'crane',     perUnit: 0.50 },
      { type: 'excavator', perUnit: 0.30 },
      { type: 'dump',      perUnit: 0.20 },
    ],
    workerBonus:      0.10,
    minWorkers:       3,    // 최소 3명 (안전 인원 + 신호수 + 작업자)
    fewWorkerPenalty: 0.40,
  },
};

export const RECALC_INTERVAL_MS = 10000; // 10초마다 실시간 진도 재계산

/**
 * 자원 구성 기반 공정 진도 속도 계산
 *
 * @param {string} elementType - 'IfcSlab' | 'IfcColumn' | 'IfcBeam' | 'IfcWall' | 'IfcPier'
 * @param {Array}  workers     - IntegrationStore.workers 배열
 * @param {Array}  equipment   - IntegrationStore.equipment 배열
 * @returns {{ rate: number, blocked: boolean, reason: string|null }}
 *   rate:    속도 배율 (0 = 진행불가, 1.0 = 표준, >1 = 가속)
 *   blocked: true이면 필수 장비 부재로 완전 정지
 *   reason:  blocked 사유 문자열 (사용자 표시용)
 */
export function calcProgressRate(elementType, workers, equipment) {
  const rule = TASK_RULES[elementType];
  if (!rule) return { rate: 1.0, blocked: false, reason: null };

  // standby 장비는 실제 투입 중이 아니므로 제외
  const activeEquip = equipment.filter(e => e.mode !== 'standby');
  const workerCount = workers.length;

  // 필수 장비(blocker) 확인 — 하나라도 없으면 즉시 진행 불가
  for (const req of rule.blockers) {
    const count = activeEquip.filter(e => e.type === req.type).length;
    if (count < req.min) {
      return { rate: 0, blocked: true, reason: req.reason };
    }
  }

  // 기본 속도 1.0에서 시작
  let rate = 1.0;

  // 장비 보너스: 투입 대수에 비례해 속도 상승
  for (const bonus of rule.equipBonus) {
    const count = activeEquip.filter(e => e.type === bonus.type).length;
    rate += count * bonus.perUnit;
  }

  // 작업자 효과
  if (workerCount < (rule.minWorkers || 0)) {
    // 최소 인원 미달 → 속도 패널티
    rate *= (rule.fewWorkerPenalty || 0.5);
  } else {
    // 충분한 인원 → 추가 작업자마다 속도 상승 (최대 8명까지 반영)
    rate += Math.min(workerCount, 8) * (rule.workerBonus || 0.1);
  }

  return { rate: Math.max(0, rate), blocked: false, reason: null };
}

/**
 * 현재 자원 배율 기준 완료 예상일 계산
 *
 * @param {{ progress, startDate, endDate, duration }} task
 * @param {number} rate - calcProgressRate 결과 (> 0)
 * @returns {{
 *   done: boolean,
 *   predictedDate: Date|null,
 *   remainingDays: number,
 *   isDelayed: boolean,
 *   plannedEndDate: Date|null
 * }|null}  null = 일정 정보 부족
 */
export function predictCompletion(task, rate) {
  const progress = task.progress || 0;
  if (progress >= 100) return { done: true, predictedDate: null, remainingDays: 0, isDelayed: false, plannedEndDate: null };
  if (rate <= 0) return null; // blocked → 예측 불가

  let plannedDays;
  let plannedEndDate = null;

  if (task.startDate && task.endDate) {
    const s = new Date(task.startDate);
    const e = new Date(task.endDate);
    plannedEndDate = e;
    plannedDays = Math.max(1, (e - s) / 86_400_000);
  } else if (task.startDate && task.duration) {
    const s = new Date(task.startDate);
    plannedDays = Math.max(1, Number(task.duration));
    plannedEndDate = new Date(s.getTime() + plannedDays * 86_400_000);
  } else {
    return null;
  }

  // 자원 배율을 적용한 실효 기간
  const effectiveDays = plannedDays / rate;

  // 남은 진도를 현재 속도로 완료하는 데 필요한 일수
  const remaining    = 100 - progress;
  const daysPerPct   = effectiveDays / 100;
  const remainingDays = Math.max(0, Math.ceil(remaining * daysPerPct));

  const predictedDate = new Date();
  predictedDate.setDate(predictedDate.getDate() + remainingDays);

  const isDelayed = !!(plannedEndDate && predictedDate > plannedEndDate);
  const delayDays = isDelayed
    ? Math.ceil((predictedDate - plannedEndDate) / 86_400_000)
    : 0;

  return { done: false, predictedDate, remainingDays, isDelayed, delayDays, plannedEndDate };
}

/**
 * 실제 달력 시간 기반 공정율 계산
 *
 * 원리:
 *   rate = 1.0 → 계획 그대로 진행
 *   rate = 2.0 → 2배 자원 → 절반 기간에 완료 (effectiveDays = plannedDays / 2)
 *   rate = 0.5 → 자원 부족 → 2배 기간 소요
 *   blocked    → 진도 동결 (null 반환)
 *
 * @param {{ startDate: string, endDate?: string, duration?: number }} task
 * @param {number} rate - calcProgressRate 결과의 rate
 * @returns {number|null} 0-100 진도율, null이면 갱신하지 않음
 */
export function calcRealTimeProgress(task, rate) {
  if (!task.startDate) return null;
  if (rate <= 0) return null; // 블로킹 → 현재 진도 유지

  const startDate = new Date(task.startDate);
  const now = new Date();

  // 아직 시작 전
  if (now < startDate) return 0;

  const elapsedDays = (now - startDate) / 86_400_000; // ms → 일

  // 계획 기간 산출 (endDate 우선, 없으면 duration)
  let plannedDays;
  if (task.endDate) {
    const endDate = new Date(task.endDate);
    plannedDays = Math.max(1, (endDate - startDate) / 86_400_000);
  } else if (task.duration) {
    plannedDays = Math.max(1, Number(task.duration));
  } else {
    return null; // 기간 정보 없음
  }

  // 자원 배율을 적용한 실효 기간 (자원이 2배면 절반 기간에 완료)
  const effectiveDays = plannedDays / rate;

  return Math.min(100, (elapsedDays / effectiveDays) * 100);
}

/**
 * 현재 자원 구성 기준 개선 추천 목록 반환
 *
 * priority: 'critical' = 없으면 진행 불가  /  'warning' = 속도 패널티  /  'boost' = 추가하면 빨라짐
 *
 * @returns {{ priority: string, text: string }[]}
 */
export function getRecommendations(elementType, workers, equipment) {
  const rule = TASK_RULES[elementType];
  if (!rule) return [];

  const activeEquip = equipment.filter(e => e.mode !== 'standby');
  const workerCount = workers.length;
  const recs = [];

  // ① 필수 장비 부재 (critical)
  for (const req of rule.blockers) {
    const have   = activeEquip.filter(e => e.type === req.type).length;
    const needed = req.min - have;
    if (needed > 0) {
      recs.push({
        priority: 'critical',
        text: `${EQUIP_LABEL[req.type]} ${needed}대 추가 → 진행 가능`,
      });
    }
  }

  // ② 최소 인원 미달 (warning) — 블로킹이 없는 경우에도 표시
  if (workerCount < (rule.minWorkers || 0)) {
    const needed = rule.minWorkers - workerCount;
    recs.push({
      priority: 'warning',
      text: `작업자 ${needed}명 추가 필요 (현재 ${workerCount}명 → 최소 ${rule.minWorkers}명)`,
    });
  }

  // ③ 속도 향상 가능 장비 (boost) — 블로킹이 없을 때만 표시
  const isBlocked = recs.some(r => r.priority === 'critical');
  if (!isBlocked) {
    for (const bonus of rule.equipBonus) {
      const pct = Math.round(bonus.perUnit * 100);
      recs.push({
        priority: 'boost',
        text: `${EQUIP_LABEL[bonus.type]} 1대 추가 → 속도 +${pct}%`,
      });
    }
    if ((rule.workerBonus || 0) > 0) {
      const pct = Math.round(rule.workerBonus * 100);
      recs.push({
        priority: 'boost',
        text: `작업자 1명 추가 → 속도 +${pct}%`,
      });
    }
  }

  return recs;
}

/**
 * 장비 타입 → 담당 태스크명 자동 매핑
 * 진행 중인 BIM 태스크를 기반으로 각 장비 타입이 어떤 작업에 쓰이는지 반환
 *
 * @param {Array} wbsTasks  - IntegrationStore.wbsTasks 배열
 * @returns {{ [equipType: string]: string }} e.g. { excavator: '기초 슬래브 공사', crane: '기둥 설치' }
 */
export function getEquipTaskMap(wbsTasks) {
  const map = {};
  wbsTasks.forEach(task => {
    if (typeof task.notes !== 'string' || !/^BIM:[^:]+:[^:]+/.test(task.notes)) return;
    if (task.status === 'COMPLETED' || task.status === 'NOT_STARTED') return;
    const elementType = task.notes.split(':')[2];
    const rule = TASK_RULES[elementType];
    if (!rule) return;
    const involved = new Set([
      ...(rule.blockers   || []).map(b => b.type),
      ...(rule.equipBonus || []).map(b => b.type),
    ]);
    involved.forEach(type => {
      if (!map[type]) map[type] = task.taskName || elementType;
    });
  });
  return map;
}
