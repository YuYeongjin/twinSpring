/**
 * wbsGenerator.js
 * IFC 구조 기반 WBS(Work Breakdown Structure) 자동 생성
 *
 * 계층 구조:
 *   프로젝트(root)
 *   └── 동(building)
 *       └── 층(storey)
 *           └── 공종(elementType)  ← 실제 태스크 노드
 */

export const WBS_TYPE_LABEL = {
  IfcWall:    '벽체공사',
  IfcColumn:  '기둥공사',
  IfcBeam:    '보공사',
  IfcSlab:    '슬래브공사',
  IfcWindow:  '창호공사',
  IfcDoor:    '문공사',
  IfcStair:   '계단공사',
  IfcRoof:    '지붕공사',
  IfcMember:  '부재공사',
  IfcPier:    '교각공사',
};

// WBS 노드 타입
export const WBS_NODE_TYPES = {
  PROJECT:  'PROJECT',
  BUILDING: 'BUILDING',
  STOREY:   'STOREY',
  TASK:     'TASK',
};

/**
 * elements 배열에서 WBS 노드 목록과 부재↔WBS 매핑을 생성한다.
 *
 * @param {BimElementDTO[]} elements  - storey / building 필드 포함
 * @param {string}          projectId
 * @returns {{ wbsNodes: BimWbsNodeDTO[], mappings: {elementId, wbsId, projectId}[] }}
 */
export function generateWbsFromElements(elements, projectId) {
  if (!elements || elements.length === 0) return { wbsNodes: [], mappings: [] };

  const wbsNodes = [];
  const mappings = [];

  // 루트 노드
  const rootId = `${projectId}-ROOT`;
  wbsNodes.push({
    wbsId:       rootId,
    projectId,
    parentWbsId: null,
    wbsCode:     '00',
    wbsName:     '전체 공사',
    nodeType:    WBS_NODE_TYPES.PROJECT,
    building:    null,
    storey:      null,
    elementType: null,
    elementCount: elements.length,
    progress:    0,
    sortOrder:   0,
  });

  // 동 → 층 → 공종 그룹핑
  // 동이 없으면 '(공통)' 키 사용
  const byBuilding = groupBy(elements, e => e.building || '(공통)');
  let buildingOrder = 0;

  for (const [building, buildingEls] of sortedEntries(byBuilding)) {
    buildingOrder++;
    const buildingId = `${projectId}-B-${safeSuffix(building)}`;

    wbsNodes.push({
      wbsId:       buildingId,
      projectId,
      parentWbsId: rootId,
      wbsCode:     String(buildingOrder).padStart(2, '0'),
      wbsName:     building,
      nodeType:    WBS_NODE_TYPES.BUILDING,
      building,
      storey:      null,
      elementType: null,
      elementCount: buildingEls.length,
      progress:    0,
      sortOrder:   buildingOrder * 100,
    });

    const byStorey = groupBy(buildingEls, e => e.storey || '(층 미지정)');
    let storeyOrder = 0;

    for (const [storey, storeyEls] of sortedStoreyEntries(byStorey)) {
      storeyOrder++;
      const storeyId = `${projectId}-S-${safeSuffix(building)}-${safeSuffix(storey)}`;

      wbsNodes.push({
        wbsId:       storeyId,
        projectId,
        parentWbsId: buildingId,
        wbsCode:     `${String(buildingOrder).padStart(2, '0')}.${String(storeyOrder).padStart(2, '0')}`,
        wbsName:     storey,
        nodeType:    WBS_NODE_TYPES.STOREY,
        building,
        storey,
        elementType: null,
        elementCount: storeyEls.length,
        progress:    0,
        sortOrder:   buildingOrder * 100 + storeyOrder,
      });

      const byType = groupBy(storeyEls, e => e.elementType);
      let typeOrder = 0;

      for (const [elementType, typeEls] of Object.entries(byType)) {
        if (!WBS_TYPE_LABEL[elementType]) continue; // 지원 대상 타입만
        typeOrder++;
        const taskId = `${projectId}-T-${safeSuffix(building)}-${safeSuffix(storey)}-${elementType}`;

        wbsNodes.push({
          wbsId:       taskId,
          projectId,
          parentWbsId: storeyId,
          wbsCode:     `${String(buildingOrder).padStart(2, '0')}.${String(storeyOrder).padStart(2, '0')}.${String(typeOrder).padStart(2, '0')}`,
          wbsName:     WBS_TYPE_LABEL[elementType],
          nodeType:    WBS_NODE_TYPES.TASK,
          building,
          storey,
          elementType,
          elementCount: typeEls.length,
          progress:    0,
          sortOrder:   buildingOrder * 10000 + storeyOrder * 100 + typeOrder,
        });

        for (const el of typeEls) {
          mappings.push({ elementId: el.elementId, wbsId: taskId, projectId });
        }
      }
    }
  }

  return { wbsNodes, mappings };
}

/**
 * WBS 노드 목록으로부터 트리 구조를 빌드한다.
 * @param {BimWbsNodeDTO[]} nodes
 * @returns {BimWbsNodeDTO[]} 루트 노드 배열 (children 포함)
 */
export function buildWbsTree(nodes) {
  if (!nodes || nodes.length === 0) return [];
  const map = {};
  const roots = [];

  for (const n of nodes) {
    map[n.wbsId] = { ...n, children: [] };
  }
  for (const n of nodes) {
    if (n.parentWbsId && map[n.parentWbsId]) {
      map[n.parentWbsId].children.push(map[n.wbsId]);
    } else if (!n.parentWbsId) {
      roots.push(map[n.wbsId]);
    }
  }

  // children 정렬
  const sortChildren = node => {
    node.children.sort((a, b) => a.sortOrder - b.sortOrder);
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.sortOrder - b.sortOrder);
  roots.forEach(sortChildren);

  return roots;
}

// ── 헬퍼 ──────────────────────────────────────────────────────────

function groupBy(arr, keyFn) {
  const map = {};
  for (const item of arr) {
    const key = keyFn(item);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return map;
}

function sortedEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => a.localeCompare(b, 'ko'));
}

// 층 이름 정렬: 지하층(B) → 지상층(숫자) → 기타
function sortedStoreyEntries(obj) {
  return Object.entries(obj).sort(([a], [b]) => {
    const rank = name => {
      if (!name || name === '(층 미지정)') return 9999;
      const lc = name.toLowerCase();
      const bMatch = lc.match(/^b(\d+)/);
      if (bMatch) return -parseInt(bMatch[1], 10);
      const fMatch = name.match(/^(\d+)/);
      if (fMatch) return parseInt(fMatch[1], 10);
      if (lc.includes('roof') || lc.includes('옥상')) return 1000;
      return 500;
    };
    return rank(a) - rank(b);
  });
}

function safeSuffix(str) {
  return (str || 'null').replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 30);
}
