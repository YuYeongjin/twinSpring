/**
 * wbsGenerator.js
 * IFC 구조 기반 WBS 자동 생성 — 공사 단계(Phase) 기반
 *
 * 계층 구조:
 *   PROJECT  (루트)
 *   └── BUILDING  (동)
 *       └── PHASE  (가설·토공·기초·지하구조·지상구조)
 *           └── STOREY  (층, UNDER/ABOVE 단계에만 존재)
 *               └── ELEMENT  (부재 유형 그룹 — 요소 매핑 대상)
 *                   └── TASK  (철근·거푸집·타설·양생, 수량 포함)
 *
 * 수량 산출:
 *   quantityCalc.resolveQuantity() 호출 → Phase 2에서 Agent/RAG로 교체 가능
 */

import { resolveQuantity, elementVolume, STRUCTURAL_TYPES } from './quantityCalc';

// ── 노드 타입 ─────────────────────────────────────────────────────────
export const WBS_NODE_TYPES = {
  PROJECT:  'PROJECT',
  BUILDING: 'BUILDING',
  PHASE:    'PHASE',
  STOREY:   'STOREY',
  ELEMENT:  'ELEMENT',
  TASK:     'TASK',
};

// 부재 유형 한글 레이블 (UI 표시)
export const WBS_TYPE_LABEL = {
  IfcWall:   '벽체', IfcColumn: '기둥',  IfcBeam:  '보',   IfcSlab:  '슬래브',
  IfcWindow: '창호', IfcDoor:   '문',    IfcStair: '계단', IfcRoof:  '지붕',
  IfcMember: '부재', IfcPier:   '교각',
};

// ── 공사 단계 정의 ────────────────────────────────────────────────────
const PHASES = [
  { id: 'TEMP',  name: '가설공사',     sortBase: 100 },
  { id: 'EARTH', name: '토공사',       sortBase: 200 },
  { id: 'FOUND', name: '기초공사',     sortBase: 300 },
  { id: 'UNDER', name: '지하구조공사', sortBase: 400 },
  { id: 'ABOVE', name: '지상구조공사', sortBase: 500 },
];

// 구조 단계별 공종 태스크 (철근→거푸집→타설→양생)
const SUB_TASKS = [
  { id: 'REBAR', name: '철근공사',      field: 'rebar'    },
  { id: 'FORM',  name: '거푸집공사',    field: 'formwork' },
  { id: 'POUR',  name: '콘크리트 타설', field: 'concrete' },
  { id: 'CURE',  name: '양생',          field: 'curing'   },
];

/**
 * IFC 부재 배열에서 WBS 노드 목록과 부재↔WBS 매핑을 생성한다.
 *
 * @param {object[]} elements  - {elementId, elementType, storey, building, sizeX, sizeY, sizeZ}
 * @param {string}   projectId
 * @param {object}   options   - {storeys, geoOrigin, standard}
 * @returns {{ wbsNodes: object[], mappings: object[] }}
 */
export function generateWbsFromElements(elements, projectId, options = {}) {
  if (!elements || elements.length === 0) return { wbsNodes: [], mappings: [] };

  const { storeys = [], geoOrigin = null, standard = 'KDS' } = options;
  const wbsNodes = [];
  const mappings = [];

  // 층이름 → 고도 맵 (지하/지상 분류용)
  const elevMap = {};
  for (const s of storeys) {
    const name = s.storeyName ?? s.name;
    if (name != null) elevMap[name] = s.elevation ?? null;
  }
  const groundElev = geoOrigin?.elevation ?? null;

  // ── 내부 헬퍼 ───────────────────────────────────────────────────────

  // 노드 객체 생성 후 wbsNodes에 추가
  function push(wbsId, parentWbsId, wbsCode, wbsName, nodeType, building, storey, elementType, elementCount, sortOrder, extra = {}) {
    wbsNodes.push({
      wbsId, projectId, parentWbsId, wbsCode, wbsName,
      nodeType, building, storey, elementType,
      elementCount, progress: 0, sortOrder,
      quantity: null, unit: null, formula: null, reason: null, standard,
      ...extra,
    });
  }

  // ── 루트 노드 ──────────────────────────────────────────────────────
  const rootId = `${projectId}-ROOT`;
  push(rootId, null, '00', '전체 공사', WBS_NODE_TYPES.PROJECT, null, null, null, elements.length, 0);

  // ── 동(Building)별 처리 ────────────────────────────────────────────
  const byBuilding = groupBy(elements, e => e.building || '(공통)');
  let bIdx = 0;

  for (const [building, bEls] of sortedEntries(byBuilding)) {
    bIdx++;
    const bId   = nid(projectId, 'B', building);
    const bCode = p2(bIdx);
    push(bId, rootId, bCode, building, WBS_NODE_TYPES.BUILDING, building, null, null, bEls.length, bIdx * 100000);

    const underEls = bEls.filter(e => isUnderground(e.storey, elevMap, groundElev));
    const aboveEls = bEls.filter(e => !isUnderground(e.storey, elevMap, groundElev));
    const hasUnder = underEls.length > 0;

    // ── 공사 단계(Phase)별 처리 ────────────────────────────────────
    let phIdx = 0;
    for (const ph of PHASES) {
      if (ph.id === 'UNDER' && !hasUnder) continue;
      phIdx++;
      const phId   = nid(projectId, 'PH', building, ph.id);
      const phCode = `${bCode}.${p2(phIdx)}`;
      const phBase = bIdx * 100000 + ph.sortBase * 100;
      push(phId, bId, phCode, ph.name, WBS_NODE_TYPES.PHASE, building, null, null, 0, phBase);

      if (ph.id === 'TEMP') {
        // 가설공사 — 수량 없음, 진도 관리용
        push(nid(projectId, 'T', building, 'PREP'), phId,
          `${phCode}.01`, '가설 및 준비공사', WBS_NODE_TYPES.TASK,
          building, null, null, 0, phBase + 1);

      } else if (ph.id === 'EARTH') {
        // 토공사 — 지하 부재 체적 기반 굴착량 추정
        const uVol  = underEls.reduce((s, e) => s + elementVolume(e), 0);
        const excV  = +(uVol * 3.5).toFixed(2);
        const leanV = +(uVol * 0.05).toFixed(3);
        push(nid(projectId, 'T', building, 'EXC'), phId,
          `${phCode}.01`, '터파기', WBS_NODE_TYPES.TASK,
          building, null, null, 0, phBase + 1,
          { quantity: excV, unit: 'm³', formula: `지하 부재 체적(${uVol.toFixed(3)}m³) × 3.5`, reason: '흙막이·여유폭 포함 굴착량 기준' });
        push(nid(projectId, 'T', building, 'LEAN'), phId,
          `${phCode}.02`, '버림콘크리트', WBS_NODE_TYPES.TASK,
          building, null, null, 0, phBase + 2,
          { quantity: leanV, unit: 'm³', formula: `지하 체적(${uVol.toFixed(3)}m³) × 5%`, reason: '버림콘크리트 두께 50mm 기준' });

      } else if (ph.id === 'FOUND') {
        // 기초공사 — 최하층 부재 체적으로 추정
        const fEls = bottomFloorElements(hasUnder ? underEls : bEls, elevMap, groundElev);
        const fVol = fEls.reduce((s, e) => s + elementVolume(e), 0);
        if (fVol > 0) {
          const qty = resolveQuantity('IfcSlab', fVol, standard);
          if (qty.rebar)    push(nid(projectId, 'T', building, 'FR'), phId, `${phCode}.01`, '기초 철근공사',       WBS_NODE_TYPES.TASK, building, null, null, fEls.length, phBase + 1, qExtra(qty.rebar));
          if (qty.formwork) push(nid(projectId, 'T', building, 'FF'), phId, `${phCode}.02`, '기초 거푸집공사',     WBS_NODE_TYPES.TASK, building, null, null, fEls.length, phBase + 2, qExtra(qty.formwork));
          if (qty.concrete) push(nid(projectId, 'T', building, 'FP'), phId, `${phCode}.03`, '기초 콘크리트 타설', WBS_NODE_TYPES.TASK, building, null, null, fEls.length, phBase + 3, qExtra(qty.concrete));
        } else {
          push(nid(projectId, 'T', building, 'FND'), phId,
            `${phCode}.01`, '기초공사', WBS_NODE_TYPES.TASK,
            building, null, null, 0, phBase + 1);
        }

      } else {
        // 지하구조공사 / 지상구조공사 — STOREY → ELEMENT → TASK(4개)
        const phEls = ph.id === 'UNDER' ? underEls : aboveEls;
        const bySt  = groupBy(phEls, e => e.storey || '(층 미지정)');
        let sIdx = 0;

        for (const [storey, sEls] of sortedStoreyEntries(bySt)) {
          sIdx++;
          const sId   = nid(projectId, 'ST', building, ph.id, storey);
          const sCode = `${phCode}.${p2(sIdx)}`;
          push(sId, phId, sCode, storey, WBS_NODE_TYPES.STOREY, building, storey, null, sEls.length, phBase + sIdx * 1000);

          const byTy = groupBy(sEls, e => e.elementType);
          let tIdx = 0;

          for (const [elementType, tEls] of sortedTypeEntries(byTy)) {
            tIdx++;
            const elId   = nid(projectId, 'EL', building, ph.id, storey, elementType);
            const elCode = `${sCode}.${p2(tIdx)}`;
            const label  = WBS_TYPE_LABEL[elementType] ?? elementType;
            push(elId, sId, elCode, label, WBS_NODE_TYPES.ELEMENT, building, storey, elementType, tEls.length, phBase + sIdx * 1000 + tIdx * 10);

            // 부재 → ELEMENT 노드 매핑 (3D 뷰어 선택 연동)
            for (const el of tEls) {
              mappings.push({ elementId: el.elementId, wbsId: elId, projectId });
            }

            // 구조 부재에 한해 공종 태스크 4개 생성
            if (STRUCTURAL_TYPES.includes(elementType)) {
              const totalVol = tEls.reduce((s, e) => s + elementVolume(e), 0);
              const qty      = resolveQuantity(elementType, totalVol, standard);
              let subIdx = 0;
              for (const st of SUB_TASKS) {
                const q = qty[st.field];
                if (!q) continue;
                subIdx++;
                wbsNodes.push({
                  wbsId:        nid(projectId, 'TSK', building, ph.id, storey, elementType, st.id),
                  projectId,
                  parentWbsId:  elId,
                  wbsCode:      `${elCode}.${p2(subIdx)}`,
                  wbsName:      st.name,
                  nodeType:     WBS_NODE_TYPES.TASK,
                  building, storey, elementType,
                  elementCount: tEls.length,
                  progress:     0,
                  sortOrder:    phBase + sIdx * 1000 + tIdx * 10 + subIdx,
                  quantity:     q.value,
                  unit:         q.unit,
                  formula:      q.formula,
                  reason:       q.reason,
                  standard,
                });
              }
            }
          }
        }
      }
    }
  }

  return { wbsNodes, mappings };
}

/**
 * WBS 노드 목록 → 트리 구조 (children 포함)
 */
export function buildWbsTree(nodes) {
  if (!nodes || nodes.length === 0) return [];
  const map   = {};
  const roots = [];
  for (const n of nodes) map[n.wbsId] = { ...n, children: [] };
  for (const n of nodes) {
    if (n.parentWbsId && map[n.parentWbsId]) map[n.parentWbsId].children.push(map[n.wbsId]);
    else if (!n.parentWbsId) roots.push(map[n.wbsId]);
  }
  const sort = nd => { nd.children.sort((a, b) => a.sortOrder - b.sortOrder); nd.children.forEach(sort); };
  roots.sort((a, b) => a.sortOrder - b.sortOrder);
  roots.forEach(sort);
  return roots;
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────

function isUnderground(storeyName, elevMap, groundElev) {
  if (groundElev != null) {
    const elev = elevMap[storeyName];
    if (elev != null) return elev < groundElev;
  }
  const lc = (storeyName || '').toLowerCase();
  return lc.startsWith('b') || lc.includes('지하') || lc.includes('basement');
}

function bottomFloorElements(els, elevMap, groundElev) {
  if (els.length === 0) return [];
  // elevation이 있으면 가장 낮은 층 선택, 없으면 이름 기반
  const storeys = [...new Set(els.map(e => e.storey || '(층 미지정)'))];
  let minElev = Infinity;
  let bottomStorey = storeys[0];
  for (const s of storeys) {
    const elev = elevMap[s] ?? (isUnderground(s, elevMap, groundElev) ? -9999 : 9999);
    if (elev < minElev) { minElev = elev; bottomStorey = s; }
  }
  return els.filter(e => (e.storey || '(층 미지정)') === bottomStorey);
}

function qExtra(q) {
  return { quantity: q.value, unit: q.unit, formula: q.formula, reason: q.reason };
}

function nid(...parts) {
  return parts.map(p => ss(String(p ?? 'null'))).join('-');
}

function ss(str) {
  return str.replace(/[^a-zA-Z0-9가-힣_]/g, '_').slice(0, 30);
}

function p2(n) {
  return String(n).padStart(2, '0');
}

function groupBy(arr, keyFn) {
  const m = {};
  for (const item of arr) {
    const k = keyFn(item);
    if (!m[k]) m[k] = [];
    m[k].push(item);
  }
  return m;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'ko'));
}

function sortedStoreyEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => storeyRank(a) - storeyRank(b));
}

function storeyRank(name) {
  if (!name || name === '(층 미지정)') return 9999;
  const lc = name.toLowerCase();
  const bm = lc.match(/^b(\d+)/);
  if (bm) return -parseInt(bm[1], 10);
  const fm = name.match(/^(\d+)/);
  if (fm) return parseInt(fm[1], 10);
  if (lc.includes('roof') || lc.includes('옥상')) return 1000;
  return 500;
}

const TYPE_ORDER = ['IfcColumn', 'IfcBeam', 'IfcWall', 'IfcSlab', 'IfcPier', 'IfcMember', 'IfcWindow', 'IfcDoor', 'IfcStair', 'IfcRoof'];
function sortedTypeEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => {
    const ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
