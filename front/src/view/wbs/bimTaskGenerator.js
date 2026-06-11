/**
 * BIM → WBS 공정 자동 생성 공통 로직
 * BimLinkedPanel(WBS탭)과 AddStructureModal(통합관제탭)에서 동일하게 사용
 *
 * 생성 구조:
 *   BIM: {bimProjectName}          (루트 부모, notes: BIM:{bimId}:ROOT)
 *     └─ 슬래브/기초 공사 (×N)    (공종 부모, notes: BIM:{bimId}:{elementType})
 *          ├─ 터파기               (세부 공정, notes: BIM_SUB:{bimId}:{elementType}:{subName})
 *          └─ ...
 */
import AxiosCustom from '../../axios/AxiosCustom';

// ── 공종 메타 ────────────────────────────────────────────────────
export const ELEMENT_META = {
  IfcSlab:   { name: '슬래브/기초 공사', icon: '⬛', color: '#22c55e', daysPerM3: 0.3 },
  IfcColumn: { name: '기둥 공사',        icon: '🏛',  color: '#8b5cf6', daysPerM3: 0.5 },
  IfcBeam:   { name: '보 공사',          icon: '📏',  color: '#3b82f6', daysPerM3: 0.4 },
  IfcWall:   { name: '벽체 공사',        icon: '🧱',  color: '#f59e0b', daysPerM3: 0.35 },
  IfcPier:   { name: '교각 공사',        icon: '🗼',  color: '#ef4444', daysPerM3: 0.6 },
};

export const ELEMENT_ORDER = ['IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcWall', 'IfcPier'];

export const SUB_TASKS = {
  IfcSlab: [
    { name: '터파기',           daysPerM3: 0.15,  minDays: 1 },
    { name: '버림콘크리트 타설', daysPerM3: 0.04,  minDays: 1 },
    { name: '거푸집 설치',       daysPerM3: 0.10,  minDays: 1 },
    { name: '철근 조립',         daysPerM3: 0.15,  minDays: 1 },
    { name: '콘크리트 타설',     daysPerM3: 0.025, minDays: 1 },
    { name: '양생',             daysPerM3: 0,     minDays: 4 },
  ],
  IfcColumn: [
    { name: '거푸집 설치',   daysPerM3: 0.20,  minDays: 1 },
    { name: '철근 조립',     daysPerM3: 0.30,  minDays: 1 },
    { name: '콘크리트 타설', daysPerM3: 0.05,  minDays: 1 },
    { name: '양생',         daysPerM3: 0,     minDays: 3 },
    { name: '탈형',         daysPerM3: 0.08,  minDays: 1 },
  ],
  IfcBeam: [
    { name: '동바리 설치',   daysPerM3: 0.15,  minDays: 1 },
    { name: '거푸집 설치',   daysPerM3: 0.20,  minDays: 1 },
    { name: '철근 조립',     daysPerM3: 0.25,  minDays: 1 },
    { name: '콘크리트 타설', daysPerM3: 0.04,  minDays: 1 },
    { name: '양생',         daysPerM3: 0,     minDays: 3 },
  ],
  IfcWall: [
    { name: '거푸집 설치',   daysPerM3: 0.18,  minDays: 1 },
    { name: '철근 조립',     daysPerM3: 0.25,  minDays: 1 },
    { name: '콘크리트 타설', daysPerM3: 0.04,  minDays: 1 },
    { name: '양생',         daysPerM3: 0,     minDays: 3 },
    { name: '탈형',         daysPerM3: 0.07,  minDays: 1 },
  ],
  IfcPier: [
    { name: '굴착',             daysPerM3: 0.20,  minDays: 2 },
    { name: '버림콘크리트 타설', daysPerM3: 0.05,  minDays: 1 },
    { name: '거푸집 설치',       daysPerM3: 0.15,  minDays: 1 },
    { name: '철근 조립',         daysPerM3: 0.25,  minDays: 2 },
    { name: '콘크리트 타설',     daysPerM3: 0.04,  minDays: 1 },
    { name: '양생',             daysPerM3: 0,     minDays: 5 },
  ],
};

// ── 내부 유틸 ────────────────────────────────────────────────────
export function calcTotalVolume(elements) {
  const total = elements.reduce((sum, el) => {
    const x = Number(el.sizeX) || 0;
    const y = Number(el.sizeY) || 0;
    const z = Number(el.sizeZ) || 0;
    const vol = x * y * z;
    return sum + (vol > 0 ? vol : 1);
  }, 0);
  return Math.max(total, 0.1);
}

export function calcSubDays(sub, totalVol, workers = 1) {
  const w = Math.max(1, workers);
  return Math.max(sub.minDays, Math.ceil((totalVol * sub.daysPerM3) / w));
}

function addDays(dateStr, n) {
  const d = new Date((dateStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * BIM 요소 기반 최적 인원 계산
 */
export function calcOptimalWorkers(elements, targetDays = 90) {
  const byType = {};
  elements.forEach(el => {
    if (!byType[el.elementType]) byType[el.elementType] = [];
    byType[el.elementType].push(el);
  });

  let totalManDays = 0;
  Object.entries(byType).forEach(([elementType, els]) => {
    const vol     = calcTotalVolume(els);
    const subDefs = SUB_TASKS[elementType];
    if (subDefs) {
      subDefs.forEach(sub => {
        if (sub.daysPerM3 > 0) totalManDays += Math.ceil(vol * sub.daysPerM3);
      });
    } else {
      const meta = ELEMENT_META[elementType];
      totalManDays += Math.max(1, Math.ceil(vol * (meta?.daysPerM3 || 0.3)));
    }
  });

  return Math.max(1, Math.ceil(totalManDays / Math.max(1, targetDays)));
}

/**
 * BIM 요소 → WBS 공정 자동 생성 (트리 구조)
 *
 * 구조:
 *   [BIM 루트 태스크]          notes: BIM:{bimId}:ROOT
 *     [공종 태스크]            notes: BIM:{bimId}:{elementType}
 *       [세부 공정 태스크]     notes: BIM_SUB:{bimId}:{elementType}:{subName}
 *
 * @param {object} params
 * @param {string}       params.wbsProjectId    - WBS 프로젝트 ID
 * @param {string|number} params.bimProjectId   - BIM 프로젝트 ID
 * @param {string}       [params.bimProjectName] - BIM 프로젝트 이름 (루트 태스크 이름에 사용)
 * @param {Array}        params.elements         - BIM 요소 배열
 * @param {Array}        params.existingTasks    - 현재 WBS 태스크 배열 (중복 방지, cursor 계산용)
 * @param {number}       [params.workers]        - 투입 인원 (없으면 체적 기반 자동 계산)
 * @param {string}       [params.startDate]      - 시작일 YYYY-MM-DD
 * @returns {Promise<number>} 생성된 공종 태스크 수
 */
export async function generateBimWbsTasks({
  wbsProjectId,
  bimProjectId,
  bimProjectName = null,
  elements,
  existingTasks = [],
  workers: workersParam = null,
  startDate = null,
}) {
  const bimId     = String(bimProjectId);
  const rootMarker = `BIM:${bimId}:ROOT`;

  // elementType 별 그룹화
  const byType = {};
  elements.forEach(el => {
    if (!byType[el.elementType]) byType[el.elementType] = [];
    byType[el.elementType].push(el);
  });

  const orderedTypes = [
    ...ELEMENT_ORDER.filter(t => byType[t]),
    ...Object.keys(byType).filter(t => !ELEMENT_ORDER.includes(t)),
  ];
  if (orderedTypes.length === 0) return 0;

  const workers = workersParam != null ? workersParam : calcOptimalWorkers(elements);

  // cursor: 기존 태스크 중 가장 늦은 endDate 다음날 or startDate or 오늘
  // BIM 루트 태스크 자신은 제외 (이미 존재하는 경우 재계산 방지)
  const nonBimTasks = existingTasks.filter(t => !(t.notes || '').startsWith(`BIM:${bimId}:`));
  const latestEnd = nonBimTasks.reduce((acc, t) => (
    !t.endDate ? acc : (!acc || t.endDate > acc ? t.endDate : acc)
  ), null);
  const rootStart = latestEnd
    ? addDays(latestEnd, 1)
    : (startDate || new Date().toISOString().slice(0, 10));

  // 전체 공종 일정 사전 계산 (루트 endDate 결정을 위해)
  let innerCursor = rootStart;
  const typeSchedules = orderedTypes.map(elementType => {
    const vol     = calcTotalVolume(byType[elementType]);
    const subDefs = SUB_TASKS[elementType];
    const duration = subDefs
      ? subDefs.reduce((s, sub) => s + calcSubDays(sub, vol, workers), 0)
      : Math.max(1, Math.ceil((vol * (ELEMENT_META[elementType]?.daysPerM3 || 0.3)) / workers));
    const start = innerCursor;
    const end   = addDays(start, duration - 1);
    innerCursor = addDays(end, 1);
    return { elementType, vol, subDefs, duration, start, end };
  });

  const totalDuration = typeSchedules.reduce((s, { duration }) => s + duration, 0);
  const rootEnd = addDays(rootStart, totalDuration - 1);

  // sortOrder / wbsCode 기준 (기존 루트 태스크 기준)
  let globalSortOrder = Math.max(0, ...existingTasks.map(t => t.sortOrder || 0)) + 1;
  const rootCodeNum   = Math.max(
    0,
    ...existingTasks.filter(t => !t.parentTaskId && t.wbsCode).map(t => parseInt(t.wbsCode) || 0)
  ) + 1;
  const rootCode = String(rootCodeNum);

  // ── BIM 루트 태스크 생성 (없을 때만) ──────────────────────────
  let rootTaskId = existingTasks.find(t => t.notes === rootMarker)?.taskId ?? null;

  if (!rootTaskId) {
    const rootRes = await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
      taskName:       bimProjectName ? `BIM: ${bimProjectName}` : `BIM 프로젝트 (${bimId})`,
      startDate:      rootStart,
      endDate:        rootEnd,
      duration:       totalDuration,
      progress:       0,
      status:         'NOT_STARTED',
      responsible:    '',
      notes:          rootMarker,
      source:         'BIM_AUTO',
      wbsCode:        rootCode,
      sortOrder:      globalSortOrder++,
      predecessorIds: '',
      parentTaskId:   null,
    });
    rootTaskId = rootRes.data?.taskId;
  }

  // ── 공종별 태스크 생성 (루트 하위) ────────────────────────────
  let created = 0;

  for (let ti = 0; ti < typeSchedules.length; ti++) {
    const { elementType, vol, subDefs, duration, start, end } = typeSchedules[ti];
    const marker = `BIM:${bimId}:${elementType}`;
    const meta   = ELEMENT_META[elementType] || { name: elementType };
    const count  = byType[elementType].length;

    // 이미 생성된 공종이면 건너뜀
    if (existingTasks.find(t => t.notes === marker)) {
      created++;
      continue;
    }

    const elemCode = `${rootCode}.${ti + 1}`;
    const elemRes = await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
      taskName:       `${meta.name} (×${count})`,
      startDate:      start,
      endDate:        end,
      duration,
      progress:       0,
      status:         'NOT_STARTED',
      responsible:    '',
      notes:          marker,
      source:         'BIM_AUTO',
      wbsCode:        elemCode,
      sortOrder:      globalSortOrder++,
      predecessorIds: '',
      parentTaskId:   rootTaskId,
    });
    const elemTaskId = elemRes.data?.taskId;

    // 세부 공정 태스크 생성 (공종 하위)
    if (subDefs && elemTaskId) {
      let subCursor = start;
      let prevSubId = null;
      for (let si = 0; si < subDefs.length; si++) {
        const sub     = subDefs[si];
        const subDays = calcSubDays(sub, vol, workers);
        const subStart = subCursor;
        const subEnd   = addDays(subStart, subDays - 1);
        subCursor = addDays(subEnd, 1);

        const subRes = await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
          taskName:       sub.name,
          startDate:      subStart,
          endDate:        subEnd,
          duration:       subDays,
          progress:       0,
          status:         'NOT_STARTED',
          responsible:    '',
          notes:          `BIM_SUB:${bimId}:${elementType}:${sub.name}`,
          source:         'BIM_AUTO',
          wbsCode:        `${elemCode}.${si + 1}`,
          sortOrder:      globalSortOrder++,
          predecessorIds: prevSubId || '',
          parentTaskId:   elemTaskId,
        });
        prevSubId = subRes.data?.taskId || null;
      }
    }

    created++;
  }

  return created;
}
