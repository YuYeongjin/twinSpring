/**
 * BIM → WBS 공정 자동 생성 공통 로직
 * BimLinkedPanel(WBS탭)과 AddStructureModal(통합관제탭)에서 동일하게 사용
 *
 * 생성 구조 (작업계획 차트와 동일한 공사 단계별):
 *   BIM: {bimProjectName}          (루트, notes: BIM:{bimId}:ROOT)
 *     ├─ 토공사 및 기초굴착        (notes: BIM:{bimId}:PLAN:0)
 *     ├─ 기초공사                  (notes: BIM:{bimId}:PLAN:1)
 *     ├─ 1층 골조공사              (notes: BIM:{bimId}:PLAN:2)
 *     ├─ 1층 슬래브 공사           (notes: BIM:{bimId}:PLAN:3)
 *     ├─ ...
 *     ├─ 마감공사                  (notes: BIM:{bimId}:PLAN:N-2)
 *     └─ 검사 및 준공              (notes: BIM:{bimId}:PLAN:N-1)
 */
import AxiosCustom from '../../axios/AxiosCustom';
import { computeWorkPlan } from '../bim/component/WorkPlanDashboard';
import { detectFloors } from '../integration/floorUtils';

// ── 런타임 번역 (BIM 자동생성 태스크 표시용) ─────────────────────
// notes 패턴으로 phase/type을 감지해 현재 언어로 번역 반환
const PHASE_TO_KEY = {
  earthwork:  'taskEarthwork',
  foundation: 'taskFoundation',
  finishing:  'taskFinishing',
  mep:        'taskMep',
  completion: 'taskCompletion',
  design:     'taskDesign',
  temporary:  'taskTemporary',
};

/**
 * BIM 자동생성 태스크의 이름을 현재 언어로 반환한다.
 * t는 'workPlan' 네임스페이스의 번역 함수여야 한다.
 * notes 패턴을 인식하지 못하면 task.taskName을 그대로 반환.
 */
export function getBimAutoTaskLabel(task, t) {
  const notes = task.notes || '';

  // FLOOR 포맷: BIM:{id}:FLOOR:{n}:FRAME|SLAB
  const floorMatch = notes.match(/^BIM:[^:]+:FLOOR:(\d+):(FRAME|SLAB)$/);
  if (floorMatch) {
    const floor = `F${parseInt(floorMatch[1]) + 1}`;
    return floorMatch[2] === 'FRAME'
      ? t('taskFrame', { floor })
      : t('taskSlab',  { floor });
  }

  // PLAN 포맷 (신규): BIM:{id}:PLAN:{i}:{phase}[:{floorIdx}]
  const planMatch = notes.match(/^BIM:[^:]+:PLAN:\d+:([a-z]+)(?::(\d+))?$/);
  if (planMatch) {
    const phase    = planMatch[1];
    const floorIdx = planMatch[2] !== undefined ? parseInt(planMatch[2]) : null;

    if (floorIdx !== null && (phase === 'frame' || phase === 'slab' || phase === 'wall')) {
      const floor = `F${floorIdx + 1}`;
      if (phase === 'frame') return t('taskFrame', { floor });
      if (phase === 'slab')  return t('taskSlab',  { floor });
      if (phase === 'wall')  return t('taskWall',  { floor });
    }
    if (PHASE_TO_KEY[phase]) return t(PHASE_TO_KEY[phase]);
  }

  return task.taskName || '';
}

// computeWorkPlan에 전달할 한국어 번역 스텁 (DB taskName 저장용 — 표시는 getBimAutoTaskLabel이 담당)
function koreanT(key, params = {}) {
  switch (key) {
    case 'taskFrame':    return `${params.floor} 골조공사`;
    case 'taskSlab':     return `${params.floor} 슬래브 공사`;
    case 'taskWall':     return `${params.floor} 벽체공사`;
    case 'floorAbove':   return `${params.n}층`;
    case 'floorBelow':   return `B${params.n}`;
    case 'finAreaBasis': return `${params.n}㎡ 기준`;
    case 'valDays':      return `${params.n}일`;
    case 'valPersons':   return `${params.n}명`;
    case 'peak':         return `최대 ${params.n}명`;
    default: break;
  }
  const map = {
    taskDesign: '설계 및 인허가', taskTemporary: '가설공사',
    taskEarthwork: '토공사 및 기초굴착', taskFoundation: '기초공사',
    taskFinishing: '마감공사', taskMep: '설비 및 전기공사',
    taskCompletion: '검사 및 준공', taskFrameOnly: '골조공사',
    rolesDesignTeam: '건축사·구조기술사·감리',
    rolesTemporaryTeam: '형틀목수·일반공·안전관리자',
    rolesEarthworkTeam: '굴착기 운전사·덤프 운전사·측량사',
    rolesFoundationTeam: '항타공·철근공·콘크리트공·측량사',
    rolesFinishingTeam: '미장공·타일공·도장공·창호공',
    rolesMepTeam: '배관공·전기공·소방공',
    rolesCompletionTeam: '감리원·검사관·측량사',
    rolesFormworkRebarConcrete: '거푸집공·철근공·콘크리트공',
    rolesWelderAssemblerSignal: '용접공·조립공·신호수',
    rolesCarpenterSignal: '목수·신호수', rolesSteelConcrete: '철골공·콘크리트공',
    rolesRebarConcrete: '철근공·콘크리트공', rolesDeckWelder: '데크공·용접공',
    rolesCarpenter: '목수', rolesDeckConcrete: '데크공·콘크리트공', rolesGeneral: '일반공',
    equipCadBim: 'CAD/BIM 소프트웨어', equipExcavatorCrane1: '굴착기 1대, 이동 크레인 1대',
    equipEarthworkEquip: '굴착기 2대, 덤프트럭 4대, 항타기',
    equipFoundationEquip: '항타기 1대, 펌프카 1대, 진동기 2대',
    equipFinishingEquip: '시스템 비계, 믹서 1대',
    equipMepEquip: '배관·전기 공구 세트, 고소 작업차',
    equipCompletionEquip: '측량기, 내화 시험 장비',
    equipPumpCrane1: '펌프카 1대, 타워 크레인 1대',
    equipFormworkVibratorPump: '거푸집, 진동기, 콘크리트 펌프카',
    equipWelderTowerCrane: '용접기, 타워 크레인',
    equipPowerToolsMobileCrane: '전동공구, 이동 크레인',
    equipWelderPumpCrane: '용접기, 펌프카, 타워 크레인',
    equipWelderBoltCrane: '용접기, 고장력 볼트 공구, 타워 크레인',
    equipVibratorLevelingPump: '바이브레이터, 레벨링 장비, 콘크리트 펌프카',
    equipPinWelderTowerCrane: '핀 용접기, 타워 크레인',
    equipPowerToolsNailGun: '전동공구, 못 박기 총',
    equipPinWelderVibratorPump: '핀 용접기, 바이브레이터, 펌프카',
    equipEuroformVibratorPump: '유로폼, 진동기, 콘크리트 펌프카',
    equipWelderMobileCrane: '용접기, 이동 크레인',
    equipPowerTools: '전동공구',
    equipFormworkVibratorCranePump: '거푸집, 진동기, 이동 크레인, 펌프카',
    equipWelderLargeMobileCrane: '용접기, 대형 이동 크레인',
    equipGeneral: '일반 공구',
  };
  return map[key] ?? key;
}

// ── 공종 메타 ────────────────────────────────────────────────────
export const ELEMENT_META = {
  IfcSlab:   { i18nKey: 'bimSlab',   name: 'Slab / Foundation', icon: '⬛', color: '#22c55e', daysPerM3: 0.3 },
  IfcColumn: { i18nKey: 'bimColumn', name: 'Column Work',       icon: '🏛',  color: '#8b5cf6', daysPerM3: 0.5 },
  IfcBeam:   { i18nKey: 'bimBeam',   name: 'Beam Work',         icon: '📏',  color: '#3b82f6', daysPerM3: 0.4 },
  IfcWall:   { i18nKey: 'bimWall',   name: 'Wall Work',         icon: '🧱',  color: '#f59e0b', daysPerM3: 0.35 },
  IfcPier:   { i18nKey: 'bimPier',   name: 'Pier Work',         icon: '🗼',  color: '#ef4444', daysPerM3: 0.6 },
};

export const ELEMENT_ORDER = ['IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcWall', 'IfcPier'];

export const SUB_TASKS = {
  IfcSlab: [
    { i18nKey: 'subExcavation',    name: 'Excavation',    daysPerM3: 0.15,  minDays: 1 },
    { i18nKey: 'subLeanConcrete',  name: 'Lean Concrete', daysPerM3: 0.04,  minDays: 1 },
    { i18nKey: 'subFormwork',      name: 'Formwork',      daysPerM3: 0.10,  minDays: 1 },
    { i18nKey: 'subRebar',         name: 'Rebar',         daysPerM3: 0.15,  minDays: 1 },
    { i18nKey: 'subConcretePour',  name: 'Concrete Pour', daysPerM3: 0.025, minDays: 1 },
    { i18nKey: 'subCuring',        name: 'Curing',        daysPerM3: 0,     minDays: 4 },
  ],
  IfcColumn: [
    { i18nKey: 'subFormwork',      name: 'Formwork',      daysPerM3: 0.20,  minDays: 1 },
    { i18nKey: 'subRebar',         name: 'Rebar',         daysPerM3: 0.30,  minDays: 1 },
    { i18nKey: 'subConcretePour',  name: 'Concrete Pour', daysPerM3: 0.05,  minDays: 1 },
    { i18nKey: 'subCuring',        name: 'Curing',        daysPerM3: 0,     minDays: 3 },
    { i18nKey: 'subStripping',     name: 'Stripping',     daysPerM3: 0.08,  minDays: 1 },
  ],
  IfcBeam: [
    { i18nKey: 'subShoring',       name: 'Shoring',       daysPerM3: 0.15,  minDays: 1 },
    { i18nKey: 'subFormwork',      name: 'Formwork',      daysPerM3: 0.20,  minDays: 1 },
    { i18nKey: 'subRebar',         name: 'Rebar',         daysPerM3: 0.25,  minDays: 1 },
    { i18nKey: 'subConcretePour',  name: 'Concrete Pour', daysPerM3: 0.04,  minDays: 1 },
    { i18nKey: 'subCuring',        name: 'Curing',        daysPerM3: 0,     minDays: 3 },
  ],
  IfcWall: [
    { i18nKey: 'subFormwork',      name: 'Formwork',      daysPerM3: 0.18,  minDays: 1 },
    { i18nKey: 'subRebar',         name: 'Rebar',         daysPerM3: 0.25,  minDays: 1 },
    { i18nKey: 'subConcretePour',  name: 'Concrete Pour', daysPerM3: 0.04,  minDays: 1 },
    { i18nKey: 'subCuring',        name: 'Curing',        daysPerM3: 0,     minDays: 3 },
    { i18nKey: 'subStripping',     name: 'Stripping',     daysPerM3: 0.07,  minDays: 1 },
  ],
  IfcPier: [
    { i18nKey: 'subExcavation',    name: 'Excavation',    daysPerM3: 0.20,  minDays: 2 },
    { i18nKey: 'subLeanConcrete',  name: 'Lean Concrete', daysPerM3: 0.05,  minDays: 1 },
    { i18nKey: 'subFormwork',      name: 'Formwork',      daysPerM3: 0.15,  minDays: 1 },
    { i18nKey: 'subRebar',         name: 'Rebar',         daysPerM3: 0.25,  minDays: 2 },
    { i18nKey: 'subConcretePour',  name: 'Concrete Pour', daysPerM3: 0.04,  minDays: 1 },
    { i18nKey: 'subCuring',        name: 'Curing',        daysPerM3: 0,     minDays: 5 },
  ],
};

// ── 내부 유틸 (BimLinkedPanel 데이터 확인용 공종별 통계에서 사용) ──
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
  const base = dateStr || new Date().toISOString().slice(0, 10);
  const d = new Date(String(base).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
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
 * BIM 요소 → WBS 공정 자동 생성 (작업계획 차트와 동일한 공사 단계별 구조)
 *
 * 구조:
 *   [BIM 루트 태스크]     notes: BIM:{bimId}:ROOT
 *     [공사 단계 태스크]  notes: BIM:{bimId}:PLAN:{i}  (earthwork, foundation, frame/slab/wall, finishing, mep, completion)
 *
 * @param {object} params
 * @param {string}        params.wbsProjectId    - WBS 프로젝트 ID
 * @param {string|number} params.bimProjectId    - BIM 프로젝트 ID
 * @param {string}        [params.bimProjectName] - BIM 프로젝트 이름
 * @param {Array}         params.elements         - BIM 요소 배열
 * @param {Array}         params.existingTasks    - 현재 WBS 태스크 배열 (중복 방지, cursor 계산용)
 * @param {string}        [params.startDate]      - 시작일 YYYY-MM-DD (없으면 기존 태스크 이후 or 오늘)
 * @param {Array|null}    [params.layers]         - BIM 레이어 배열 (층 정보 보강용, 선택)
 * @returns {Promise<number>} 생성된 공정 태스크 수
 */
export async function generateBimWbsTasks({
  wbsProjectId,
  bimProjectId,
  bimProjectName = null,
  elements,
  existingTasks = [],
  startDate = null,
  layers = null,
  instanceKey = null,   // 동일 BIM 여러 번 추가 시 구분용 고유 키
}) {
  const bimId      = String(bimProjectId);
  // instanceKey 가 있으면 BIM:{id}:ROOT:{key}, 없으면 BIM:{id}:ROOT
  const rootMarker = instanceKey ? `BIM:${bimId}:ROOT:${instanceKey}` : `BIM:${bimId}:ROOT`;

  // 동일한 instanceKey 의 루트가 이미 있으면 중복 생성 방지
  if (existingTasks.find(t => t.notes === rootMarker)) return 0;

  // 작업계획 차트와 동일한 알고리즘으로 공사 단계별 계획 계산
  const plan = computeWorkPlan(elements, koreanT, layers);
  if (!plan || !plan.tasks?.length) return 0;

  // startDate가 있을 때만 날짜 계산 — 없으면 duration만 저장
  let rootStartStr = null;
  let rootEndStr   = null;
  let shiftDate    = () => null;

  if (startDate) {
    const nonBimTasks = existingTasks.filter(t => !(t.notes || '').startsWith(`BIM:${bimId}:`));
    const latestEnd   = nonBimTasks.reduce((acc, t) => (
      !t.endDate ? acc : (!acc || t.endDate > acc ? t.endDate : acc)
    ), null);
    const baseStartStr = latestEnd ? addDays(latestEnd, 1) : startDate;

    const planStart = plan.projectStart;
    const baseStart = new Date(baseStartStr.slice(0, 10) + 'T00:00:00');
    const offsetMs  = baseStart - planStart;
    shiftDate = (d) => {
      if (!d || isNaN(d.getTime()) || isNaN(offsetMs)) return baseStartStr;
      const shifted = new Date(d.getTime() + offsetMs);
      return isNaN(shifted.getTime()) ? baseStartStr : shifted.toISOString().slice(0, 10);
    };

    rootStartStr = baseStartStr;
    rootEndStr   = shiftDate(plan.projectEnd);
  }

  // sortOrder / wbsCode 베이스
  let globalSortOrder = Math.max(0, ...existingTasks.map(t => t.sortOrder || 0)) + 1;
  const rootCodeNum   = Math.max(
    0,
    ...existingTasks.filter(t => !t.parentTaskId && t.wbsCode).map(t => parseInt(t.wbsCode) || 0)
  ) + 1;
  const rootCode = String(rootCodeNum);

  // ── BIM 루트 태스크 생성 ─────────────────────────────────────
  const rootRes = await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
    taskName:       bimProjectName ? `BIM: ${bimProjectName}` : `BIM 프로젝트 (${bimId})`,
    startDate:      rootStartStr,
    endDate:        rootEndStr,
    duration:       plan.totalDays,
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
  const rootTaskId = rootRes.data?.taskId;
  if (!rootTaskId) return 0;

  // ── 공사 단계별 태스크 생성 (루트 하위) ─────────────────────
  // notes에 phase(및 층별 floorIdx)를 포함해 표시 시점에 다국어 번역이 가능하게 한다.
  let planFloorIdx = -1;
  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];

    let noteSuffix = task.phase || '';
    if (task.phase === 'frame' || task.phase === 'slab' || task.phase === 'wall') {
      if (task.phase === 'frame') planFloorIdx++;
      if (planFloorIdx < 0) planFloorIdx = 0;
      noteSuffix = `${task.phase}:${planFloorIdx}`;
    }

    await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
      taskName:       task.name,
      startDate:      shiftDate(task.start),
      endDate:        shiftDate(task.end),
      duration:       task.days,
      progress:       0,
      status:         'NOT_STARTED',
      responsible:    `${task.workers}`,
      notes:          `BIM:${bimId}:PLAN:${i}:${noteSuffix}`,
      source:         'BIM_AUTO',
      wbsCode:        `${rootCode}.${i + 1}`,
      sortOrder:      globalSortOrder++,
      predecessorIds: '',
      parentTaskId:   rootTaskId,
    });
  }

  return plan.tasks.length;
}

// ── 층별 태스크 days 계산 헬퍼 ─────────────────────────────────────
const FRAME_TYPES = new Set(['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcPier', 'IfcMember']);
const SLAB_TYPES  = new Set(['IfcSlab']);

function calcFloorFrameDays(floorElements, workers = 4) {
  let totalDays = 0;
  FRAME_TYPES.forEach(type => {
    const els = floorElements.filter(el => el.elementType === type);
    if (!els.length) return;
    const vol     = calcTotalVolume(els);
    const subDefs = SUB_TASKS[type];
    if (subDefs) {
      subDefs.forEach(sub => { totalDays += calcSubDays(sub, vol, workers); });
    } else {
      const meta = ELEMENT_META[type];
      totalDays += Math.max(1, Math.ceil((vol * (meta?.daysPerM3 || 0.3)) / workers));
    }
  });
  return Math.max(7, Math.round(totalDays));
}

function calcFloorSlabDays(floorElements, workers = 4) {
  const els = floorElements.filter(el => SLAB_TYPES.has(el.elementType));
  if (!els.length) return 0;
  const vol     = calcTotalVolume(els);
  const subDefs = SUB_TASKS['IfcSlab'];
  let totalDays = 0;
  if (subDefs) {
    subDefs.forEach(sub => { totalDays += calcSubDays(sub, vol, workers); });
  } else {
    totalDays = Math.max(1, Math.ceil((vol * 0.3) / workers));
  }
  return Math.max(5, Math.round(totalDays));
}

/**
 * BIM 요소 → 층별 WBS 공정 자동 생성
 *
 * 구조:
 *   [BIM 루트]              notes: BIM:{bimId}:ROOT
 *     [{n}층 골조공사]      notes: BIM:{bimId}:FLOOR:{floorIdx}:FRAME  (기둥/보/벽)
 *     [{n}층 슬래브 공사]   notes: BIM:{bimId}:FLOOR:{floorIdx}:SLAB
 *     [{n+1}층 골조공사]    notes: BIM:{bimId}:FLOOR:{floorIdx+1}:FRAME  (이전 슬래브 완료 후)
 *     ...
 *
 * @returns {Promise<number>} 생성된 태스크 수
 */
export async function generateFloorWbsTasks({
  wbsProjectId,
  bimProjectId,
  bimProjectName = null,
  elements,
  existingTasks = [],
  startDate = null,
}) {
  const bimId      = String(bimProjectId);
  const rootMarker = `BIM:${bimId}:ROOT`;

  if (existingTasks.find(t => t.notes === rootMarker)) return 0;

  const floors = detectFloors(elements);
  if (floors.length === 0) return 0;

  // 시작일 결정
  const nonBimTasks = existingTasks.filter(t => !(t.notes || '').startsWith(`BIM:${bimId}:`));
  const latestEnd   = nonBimTasks.reduce(
    (acc, t) => (!t.endDate ? acc : (!acc || t.endDate > acc ? t.endDate : acc)), null
  );
  const baseStart = latestEnd
    ? addDays(latestEnd, 1)
    : (startDate || new Date().toISOString().slice(0, 10));

  // 전체 루트 공기 사전 계산
  const WORKERS = 4;
  let totalDays = 0;
  floors.forEach(f => {
    totalDays += calcFloorFrameDays(f.elements, WORKERS);
    totalDays += calcFloorSlabDays(f.elements, WORKERS);
  });
  totalDays = Math.max(totalDays, floors.length * 14);

  let globalSortOrder = Math.max(0, ...existingTasks.map(t => t.sortOrder || 0)) + 1;
  const rootCodeNum   = Math.max(
    0,
    ...existingTasks.filter(t => !t.parentTaskId && t.wbsCode).map(t => parseInt(t.wbsCode) || 0)
  ) + 1;
  const rootCode = String(rootCodeNum);

  // 루트 태스크 생성
  const rootRes = await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
    taskName:       bimProjectName ? `BIM: ${bimProjectName}` : `BIM 프로젝트 (${bimId})`,
    startDate:      baseStart,
    endDate:        addDays(baseStart, totalDays - 1),
    duration:       totalDays,
    progress:       0,
    status:         'NOT_STARTED',
    notes:          rootMarker,
    source:         'BIM_AUTO',
    wbsCode:        rootCode,
    sortOrder:      globalSortOrder++,
    predecessorIds: '',
    parentTaskId:   null,
  });
  const rootTaskId = rootRes.data?.taskId;
  if (!rootTaskId) return 0;

  let cursor    = baseStart;
  let taskCount = 0;
  const aboveFloors = floors.filter(f => f.avgY >= 0.5);

  for (let fi = 0; fi < floors.length; fi++) {
    const floor = floors[fi];
    // 층 레이블: 지상/지하 구분
    const isBasement = floor.avgY < 0.5;
    const aboveIdx   = aboveFloors.indexOf(floor);
    const floorLabel = isBasement
      ? `B${floors.filter(f => f.avgY < 0.5 && f !== floor).length + 1}층`
      : `${aboveIdx + 1}층`;

    const frameElems = floor.elements.filter(el => FRAME_TYPES.has(el.elementType));
    const slabElems  = floor.elements.filter(el => SLAB_TYPES.has(el.elementType));

    const frameDays = calcFloorFrameDays(floor.elements, WORKERS);
    const slabDays  = calcFloorSlabDays(floor.elements, WORKERS);

    // FRAME 태스크 (기둥·보·벽)
    if (frameElems.length > 0) {
      const frameStart = cursor;
      const frameEnd   = addDays(frameStart, frameDays - 1);
      await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
        taskName:       `${floorLabel} 골조공사`,
        startDate:      frameStart,
        endDate:        frameEnd,
        duration:       frameDays,
        progress:       0,
        status:         'NOT_STARTED',
        responsible:    `${WORKERS}명`,
        notes:          `BIM:${bimId}:FLOOR:${fi}:FRAME`,
        source:         'BIM_AUTO',
        wbsCode:        `${rootCode}.${fi * 2 + 1}`,
        sortOrder:      globalSortOrder++,
        predecessorIds: '',
        parentTaskId:   rootTaskId,
      });
      cursor = addDays(frameEnd, 1);
      taskCount++;
    }

    // SLAB 태스크 (슬래브)
    if (slabElems.length > 0 && slabDays > 0) {
      const slabStart = cursor;
      const slabEnd   = addDays(slabStart, slabDays - 1);
      await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
        taskName:       `${floorLabel} 슬래브 공사`,
        startDate:      slabStart,
        endDate:        slabEnd,
        duration:       slabDays,
        progress:       0,
        status:         'NOT_STARTED',
        responsible:    `${WORKERS}명`,
        notes:          `BIM:${bimId}:FLOOR:${fi}:SLAB`,
        source:         'BIM_AUTO',
        wbsCode:        `${rootCode}.${fi * 2 + 2}`,
        sortOrder:      globalSortOrder++,
        predecessorIds: '',
        parentTaskId:   rootTaskId,
      });
      cursor = addDays(slabEnd, 1);
      taskCount++;
    }
  }

  return taskCount;
}
