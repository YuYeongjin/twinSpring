/**
 * wbsGenerator.js
 * 💡 오직 UI Layer 배열 구조와 1:1 동기화하여 WBS를 생성하는 무결점 버전
 * (문자열 파싱 없음, 추가 유령 층 양산 원천 불가)
 */

import { resolveQuantity, elementVolume, STRUCTURAL_TYPES } from './quantityCalc';

let _IFC_TYPE_FROM_LABEL = null;
function getIfcTypeFromLabel(label) {
  if (!_IFC_TYPE_FROM_LABEL) {
    _IFC_TYPE_FROM_LABEL = Object.fromEntries(
        Object.entries(WBS_TYPE_LABEL).map(([k, v]) => [v, k])
    );
  }
  return _IFC_TYPE_FROM_LABEL[label] ?? null;
}

export const WBS_NODE_TYPES = {
  PROJECT:  'PROJECT',
  BUILDING: 'BUILDING',
  PHASE:    'PHASE',
  STOREY:   'STOREY',
  ELEMENT:  'ELEMENT',
  TASK:     'TASK',
};

export const WBS_TYPE_LABEL = {
  IfcWall:        '벽체공사',    IfcColumn:      '기둥공사',   IfcBeam:       '보공사',
  IfcSlab:        '슬래브 공사', IfcWindow:      '창호공사',   IfcDoor:       '문공사',
  IfcStair:       '계단공사',    IfcRoof:        '지붕공사',   IfcMember:     '부재공사',
  IfcPier:        '교각공사',    IfcFoundation:  '기초공사',
  // 신규 타입 (A-2~A-6)
  IfcCurtainWall: '커튼월공사',  IfcRailing:     '난간공사',   IfcRamp:       '경사로공사',
  IfcCovering:    '마감공사',    IfcProxy:       '기타공사',
};

const PHASES = [
  { id: 'TEMP',  name: '가설공사',          sortBase: 100 },
  { id: 'EARTH', name: '토공사 및 기초굴착', sortBase: 200 },
  { id: 'FOUND', name: '기초 및 지하구조공사', sortBase: 300 },
  { id: 'ABOVE', name: '지상구조공사',       sortBase: 500 },
];

// G-1: 지하층 이름 패턴 감지
// "B1", "B-1", "지하1층", "지하", "basement", "GL-1" 등
const _BASEMENT_RE = /^(?:b[-\s]?\d+|지\s*하|basement|gl[-\s]?\d+)/i;
const isBasementStorey = (name) => _BASEMENT_RE.test((name || '').trim());

// G-4: 기초 공종으로 라우팅되는 요소 타입
const FOUNDATION_TYPES = new Set(['IfcFoundation', 'IfcPier']);

const SUB_TASKS = [
  { id: 'REBAR', name: '철근공사',      field: 'rebar'    },
  { id: 'FORM',  name: '거푸집공사',    field: 'formwork' },
  { id: 'POUR',  name: '콘크리트 타설', field: 'concrete' },
  { id: 'CURE',  name: '양생',          field: 'curing'   }
];

/**
 * 💡 [영진님 요청 연동 핵심]
 * elements 날것 데이터를 쓰던 레거시를 전면 폐기하고,
 * 무조건 이미 생성 완료된 layers 트리를 그대로 받아 우측 그리드와 1:1 싱크를 맞춥니다.
 */
export async function generateWbsFromElements(elements, projectId, options = {}) {
  if (options.layers && options.layers.length > 0) {
    return generateWbsFromLayers(options.layers, projectId, elements, options);
  }
  return { wbsNodes: [], mappings: [] };
}

/**
 *  Layer 기반 한 층 한 층 WBS 자동 빌더
 *  options.axiosPost 가 있으면 유니크 elementType 별 RAG 시방서를 병렬 프리페치하여
 *  TASK 노드의 reason 필드를 실제 시방서 인용으로 보강합니다.
 */
export async function generateWbsFromLayers(layers, projectId, elements = [], options = {}) {
  if (!layers || layers.length === 0) return { wbsNodes: [], mappings: [] };

  const wbsNodes = [];
  const mappings = [];
  const elemDataMap = new Map(elements.map(el => [el.elementId, el]));

  // ID 식별 유틸 — layerId 끝 패턴으로 정확하게 식별 (projectId에 -B/-S/-T가 포함돼도 오감지 없음)
  const isBuildingLayer = (l) => /-B\d+$/.test(l.layerId);
  const isStoreyLayer   = (l) => /-S\d+$/.test(l.layerId);
  const isTypeLayer     = (l) => /-T\d+$/.test(l.layerId);

  const layerMap = new Map(layers.map(l => [l.layerId, l]));
  const buildingTree = [];

  // 1단계: 생성되어 내려온 Storey 레이어들만 정직하게 1번씩 순회하며 트리 뼈대 구축
  const storeyLayers = layers.filter(isStoreyLayer);

  for (const sLayer of storeyLayers) {
    let buildingName = '(공통)';
    let parent = layerMap.get(sLayer.parentLayerId);
    while (parent) {
      if (isBuildingLayer(parent)) {
        buildingName = parent.layerName ? parent.layerName.trim() : '(공통)';
        break;
      }
      parent = layerMap.get(parent.parentLayerId);
    }

    let bEntry = buildingTree.find(x => x.name === buildingName);
    if (!bEntry) {
      bEntry = { name: buildingName, storeys: [] };
      buildingTree.push(bEntry);
    }

    // 주관적인 수치 판별/정규식 완전 배제 -> 레이어에 찍혀있는 명칭과 계층 그대로 주입
    bEntry.storeys.push({
      layerId: sLayer.layerId,
      name: sLayer.layerName ? sLayer.layerName.trim() : '(층 미지정)',
      types: []
    });
  }

  // 2단계: 최하위 공종(Type) 레이어들을 부모 층 레이어에 정직하게 매핑
  for (const layer of layers) {
    if (!isTypeLayer(layer)) continue;

    const ifcType = getIfcTypeFromLabel(layer.layerName);
    if (!ifcType) continue;

    const parentStorey = layerMap.get(layer.parentLayerId);
    if (!parentStorey) continue;

    for (const b of buildingTree) {
      const sEntry = b.storeys.find(s => s.layerId === parentStorey.layerId);
      if (sEntry) {
        sEntry.types.push({
          ifcType,
          elementIds: layer.elementIds || []
        });
        break;
      }
    }
  }

  // 부재가 실제로 매핑된 유효 건물 그룹 확정
  const activeBuildings = buildingTree.filter(b => b.storeys.length > 0);
  if (activeBuildings.length === 0) return { wbsNodes: [], mappings: [] };

  function push(wbsId, parentWbsId, wbsCode, wbsName, nodeType, building, storey, elementType, elementCount, sortOrder, extra = {}) {
    wbsNodes.push({
      wbsId, projectId, parentWbsId, wbsCode, wbsName,
      nodeType, building, storey, elementType,
      elementCount, progress: 0, sortOrder,
      quantity: null, unit: null, formula: null, reason: null, standard: 'KDS',
      ...extra,
    });
  }

  const standard = options.standard || 'KDS';

  // RAG 프리페치: 유니크 elementType 별 시방서 인용을 병렬로 조회
  // options.axiosPost 가 없거나 실패하면 빈 맵으로 폴백 (하드코딩 reason 유지)
  const ragCitationMap = {}; // { "IfcColumn": [{source, series, content}] }
  if (options.axiosPost) {
    const uniqueTypes = [...new Set(
      layers.filter(isTypeLayer).map(l => getIfcTypeFromLabel(l.layerName)).filter(Boolean)
    )].filter(t => STRUCTURAL_TYPES.includes(t));

    if (uniqueTypes.length > 0) {
      const results = await Promise.allSettled(
        uniqueTypes.map(type =>
          options.axiosPost('/api/chat/wbs-task-spec', {
            elementType: type,
            taskName: WBS_TYPE_LABEL[type] || type,
            standard,
          })
        )
      );
      uniqueTypes.forEach((type, i) => {
        const r = results[i];
        ragCitationMap[type] = (r.status === 'fulfilled' && r.value?.data?.citations) || [];
      });
    }
  }

  // 루트 발급
  const totalAll = activeBuildings.reduce((s, b) => s + b.storeys.reduce((s2, st) => s2 + st.types.reduce((s3, t) => s3 + t.elementIds.length, 0), 0), 0);
  const rootId = `${projectId}-ROOT`;
  push(rootId, null, '00', '전체 공사', WBS_NODE_TYPES.PROJECT, null, null, null, totalAll, 0);

  // 3단계: 오직 레이어 기반 계층 구조로만 WBS 노드 생성 (가설/토공/기초 선행 후 바로 레이어 루프 결합)
  let bIdx = 0;
  for (const building of activeBuildings) {
    bIdx++;
    const buildingName = building.name;
    const bId   = nid(projectId, 'B', buildingName);
    const bCode = p2(bIdx);
    const bTotal = building.storeys.reduce((s, st) => s + st.types.reduce((s2, t) => s2 + t.elementIds.length, 0), 0);
    push(bId, rootId, bCode, buildingName, WBS_NODE_TYPES.BUILDING, buildingName, null, null, bTotal, bIdx * 100000);

    let phIdx = 0;
    for (const ph of PHASES) {
      phIdx++;
      const phId   = nid(projectId, 'PH', buildingName, ph.id);
      const phCode = `${bCode}.${p2(phIdx)}`;
      const phBase = bIdx * 100000 + ph.sortBase * 100;
      push(phId, bId, phCode, ph.name, WBS_NODE_TYPES.PHASE, buildingName, null, null, 0, phBase);

      if (ph.id === 'TEMP') {
        push(nid(projectId, 'T', buildingName, 'PREP'), phId, `${phCode}.01`, '가설 및 준비공사', WBS_NODE_TYPES.TASK, buildingName, null, null, 0, phBase + 1);

      } else if (ph.id === 'EARTH') {
        push(nid(projectId, 'T', buildingName, 'EXC'), phId, `${phCode}.01`, '토공사 및 기초굴착', WBS_NODE_TYPES.TASK, buildingName, null, null, 0, phBase + 1);

      } else if (ph.id === 'FOUND') {
        // 일반 기초공사 태스크
        push(nid(projectId, 'T', buildingName, 'FND'), phId, `${phCode}.01`, '기초공사', WBS_NODE_TYPES.TASK, buildingName, null, null, 0, phBase + 1);

        // G-4: IfcFoundation / IfcPier 요소를 기초공사 공종에 집계
        const foundElems = building.storeys.flatMap(s =>
          s.types.filter(t => FOUNDATION_TYPES.has(t.ifcType))
        );
        if (foundElems.length > 0) {
          let fIdx = 1;
          for (const { ifcType, elementIds } of foundElems) {
            fIdx++;
            const fId   = nid(projectId, 'EL', buildingName, 'FOUND', ifcType);
            const fCode = `${phCode}.${p2(fIdx)}`;
            const label = WBS_TYPE_LABEL[ifcType] ?? ifcType;
            push(fId, phId, fCode, label, WBS_NODE_TYPES.ELEMENT, buildingName, null, ifcType, elementIds.length, phBase + fIdx * 10);
            for (const elemId of elementIds) mappings.push({ elementId: elemId, wbsId: fId, projectId });
          }
        }

        // G-1: 지하층 공종 배치 (FOUND 아래)
        const basementStoreys = building.storeys.filter(s => isBasementStorey(s.name));
        let bsIdx = foundElems.length + 1;
        for (const storey of basementStoreys) {
          bsIdx++;
          _pushStoreyBlock({ storey, parentId: phId, phCode, sIdx: bsIdx, phBase, buildingName, ph: ph.id, projectId, wbsNodes, mappings, push, elemDataMap, ragCitationMap, standard });
        }

      } else if (ph.id === 'ABOVE') {
        // G-1: 지하층은 FOUND에서 처리했으므로 ABOVE에서 제외
        const aboveStoreys = building.storeys.filter(s => !isBasementStorey(s.name));

        let sIdx = 0;
        for (const storey of aboveStoreys) {
          sIdx++;
          _pushStoreyBlock({ storey, parentId: phId, phCode, sIdx, phBase, buildingName, ph: ph.id, projectId, wbsNodes, mappings, push, elemDataMap, ragCitationMap, standard });
        }
      }
    }
  }

  return { wbsNodes, mappings };
}

// 층 하나의 WBS 노드 블록(STOREY → ELEMENT → TASK)을 생성하는 내부 헬퍼.
// ABOVE와 FOUND(지하층) 두 곳에서 공유.
function _pushStoreyBlock({ storey, parentId, phCode, sIdx, phBase, buildingName, ph, projectId, wbsNodes, mappings, push, elemDataMap, ragCitationMap, standard }) {
  const storeyLabel = storey.name;
  const sId    = nid(projectId, 'ST', buildingName, ph, storeyLabel);
  const sCode  = `${phCode}.${p2(sIdx)}`;
  // G-4: 기초 타입은 FOUND 공종으로 이미 처리됨 → ABOVE/지하 블록에서 제외
  const validTypes = storey.types.filter(t => !FOUNDATION_TYPES.has(t.ifcType));
  const sTotal = validTypes.reduce((s, t) => s + t.elementIds.length, 0);

  push(sId, parentId, sCode, storeyLabel, WBS_NODE_TYPES.STOREY, buildingName, storeyLabel, null, sTotal, phBase + sIdx * 1000);

  let tIdx = 0;
  for (const { ifcType, elementIds } of validTypes) {
    tIdx++;
    const elId   = nid(projectId, 'EL', buildingName, ph, storeyLabel, ifcType);
    const elCode = `${sCode}.${p2(tIdx)}`;
    const label  = `${storeyLabel} ${WBS_TYPE_LABEL[ifcType] ?? ifcType}`;
    const elBase = phBase + sIdx * 1000 + tIdx * 10;

    push(elId, sId, elCode, label, WBS_NODE_TYPES.ELEMENT, buildingName, storeyLabel, ifcType, elementIds.length, elBase);

    for (const elemId of elementIds) {
      mappings.push({ elementId: elemId, wbsId: elId, projectId });
    }

    if (STRUCTURAL_TYPES.includes(ifcType)) {
      const totalVolume = elementIds.reduce((sum, id) => {
        const el = elemDataMap.get(id);
        return el ? sum + elementVolume(el) : sum;
      }, 0);

      const ragCitations = ragCitationMap[ifcType] || [];
      const qty = resolveQuantity(ifcType, totalVolume, standard, ragCitations);

      let subIdx = 0;
      for (const sub of SUB_TASKS) {
        const qData = qty[sub.field];
        if (!qData) continue;
        subIdx++;
        push(
          nid(projectId, 'TK', buildingName, ph, storeyLabel, ifcType, sub.id),
          elId,
          `${elCode}.${p2(subIdx)}`,
          sub.name,
          WBS_NODE_TYPES.TASK,
          buildingName, storeyLabel, ifcType, 0,
          elBase + subIdx,
          { quantity: qData.value, unit: qData.unit, formula: qData.formula, reason: qData.reason, standard },
        );
      }
    }
  }
}

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

// G-3: 짧은 해시를 붙여 이름 잘림에 의한 충돌 방지.
// 해시는 ss() 잘리기 전 원본 문자열로 계산 → 30자 이후 차이도 구분 가능.
function nid(...parts) {
  const original  = parts.map(p => String(p ?? 'null')).join('\x00'); // 원본 (해시용)
  const sanitized = parts.map(p => ss(String(p ?? 'null'))).join('-'); // 정제 (표시용)
  const h = _hash(original).toString(36).slice(0, 5);
  return `${sanitized.slice(0, 70)}-${h}`;
}

function _hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
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