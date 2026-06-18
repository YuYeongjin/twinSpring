export const IFC_LAYER_LABEL = {
  IfcColumn:     '기둥공사',    IfcBeam:   '보공사',      IfcWall:      '벽체공사',
  IfcSlab:       '슬래브 공사', IfcPier:   '교각공사',    IfcMember:    '부재공사',
  IfcWindow:     '창호공사',    IfcDoor:   '문공사',      IfcStair:     '계단공사',
  IfcRoof:       '지붕공사',    IfcFoundation: '기초공사',
};
export const IFC_LAYER_COLOR = {
  IfcColumn: '#3b82f6', IfcBeam:       '#22c55e', IfcWall:   '#64748b',
  IfcSlab:   '#f59e0b', IfcPier:       '#ec4899', IfcMember: '#84cc16',
  IfcWindow: '#06b6d4', IfcDoor:       '#8b5cf6', IfcStair:  '#f97316',
  IfcRoof:   '#6366f1', IfcFoundation: '#92400e',
};
export const IFC_TYPE_ORDER = ['IfcColumn','IfcBeam','IfcFoundation','IfcSlab','IfcWall','IfcPier','IfcMember','IfcWindow','IfcDoor','IfcStair','IfcRoof'];

export function storeyRank(name) {
  if (!name || name === '(층 미지정)') return 9999;
  const lc = name.toLowerCase();
  const b = lc.match(/^b(\d+)/); if (b) return -parseInt(b[1], 10);
  const f = name.match(/^(\d+)/); if (f) return parseInt(f[1], 10);
  if (lc === 'rf' || lc.includes('roof') || lc.includes('옥상') || lc.includes('지붕')) return 1000;
  return 500;
}

const IFC_DUMMY_BUILDING_NAMES = new Set([
  '// building/name //', 'building name', 'building/name', 'building', 'default',
  'unnamed', 'no building', 'building_0', 'building_1', 'building_2', 'none', '(none)', '',
]);

export function isRealBuilding(name) {
  if (!name) return false;
  return !IFC_DUMMY_BUILDING_NAMES.has(name.trim().toLowerCase());
}

export function normalizeStoreyName(name) {
  if (!name) return null;
  const lc = name.toLowerCase().trim();
  const basementMatch = lc.match(/(b|지하|basement)\s*(\d+)/);
  if (basementMatch) return `B${basementMatch[2]}`;
  const floorMatch = lc.match(/(\d+)\s*(f|층|floor|level|story|storey)/);
  if (floorMatch) return `${floorMatch[1]}F`;
  const levelMatch = lc.match(/(floor|level|story|storey)\s*(\d+)/);
  if (levelMatch) return `${levelMatch[2]}F`;
  const numMatch = lc.match(/^(\d+)$/);
  if (numMatch) return `${numMatch[1]}F`;
  if (lc.includes('roof') || lc.includes('지붕') || lc.includes('옥상') || lc === 'rf') return 'RF';
  return name;
}

export function generateLayersFromElements(elements, projectId) {
  const byBuilding = new Map();
  for (const el of elements) {
    if (!IFC_LAYER_LABEL[el.elementType]) continue;
    const building = isRealBuilding(el.building) ? el.building : null;
    const storey   = el.storey || null;
    const normalizedStoreyName = normalizeStoreyName(storey) ?? '미분류';

    const bKey = building ?? '__none__';
    if (!byBuilding.has(bKey)) byBuilding.set(bKey, { name: building, storeys: new Map() });
    const byStorey = byBuilding.get(bKey).storeys;

    const sKey = normalizedStoreyName;
    if (!byStorey.has(sKey)) byStorey.set(sKey, { name: normalizedStoreyName, types: new Map() });
    const byType = byStorey.get(sKey).types;
    if (!byType.has(el.elementType)) byType.set(el.elementType, []);
    byType.get(el.elementType).push(el);
  }

  const layers = [];
  const sortedBuildingKeys = [...byBuilding.keys()].sort((a, b) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    return byBuilding.get(a).name.localeCompare(byBuilding.get(b).name, 'ko');
  });

  sortedBuildingKeys.forEach((bKey, bIdx) => {
    const { name: buildingName, storeys: byStorey } = byBuilding.get(bKey);
    const hasBuilding = buildingName !== null;
    const buildingId  = hasBuilding ? `layer-${projectId}-B${bIdx}` : null;

    if (hasBuilding) {
      layers.push({
        layerId: buildingId, projectId, parentLayerId: null,
        layerName: buildingName, color: '#94a3b8',
        visible: true, elementIds: [], sortOrder: bIdx * 10000,
      });
    }

    const sortedStoreyKeys = [...byStorey.keys()].sort((a, b) => {
      const na = byStorey.get(a).name, nb = byStorey.get(b).name;
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return storeyRank(na) - storeyRank(nb);
    });

    sortedStoreyKeys.forEach((sKey, sIdx) => {
      const { name: storeyName, types: byType } = byStorey.get(sKey);
      const hasStorey = storeyName !== null;
      const storeyId  = `layer-${projectId}-B${bIdx}-S${sIdx}`;

      if (hasStorey) {
        let sampleElement = null;
        for (const typeElements of byType.values()) {
          if (typeElements && typeElements.length > 0) { sampleElement = typeElements[0]; break; }
        }
        layers.push({
          layerId: storeyId, projectId, parentLayerId: buildingId,
          layerName: storeyName, color: '#64748b',
          visible: true, elementIds: [], sortOrder: bIdx * 10000 + sIdx * 100,
          elevation: sampleElement ? (sampleElement.elevation ?? null) : null,
          isUnderground: sampleElement ? (sampleElement.isUnderground ?? null) : null,
        });
      }

      const typeParentId = hasStorey ? storeyId : buildingId;
      const sortedTypes = [...byType.keys()].sort(
        (a, b) => IFC_TYPE_ORDER.indexOf(a) - IFC_TYPE_ORDER.indexOf(b)
      );

      sortedTypes.forEach((type, tIdx) => {
        const typeElements = byType.get(type);
        layers.push({
          layerId:       `layer-${projectId}-B${bIdx}-S${sIdx}-T${tIdx}`,
          projectId,
          parentLayerId: typeParentId,
          layerName:     IFC_LAYER_LABEL[type],
          color:         IFC_LAYER_COLOR[type] || '#888888',
          visible:       true,
          elementIds:    typeElements.map(el => el.elementId),
          sortOrder:     bIdx * 10000 + sIdx * 100 + tIdx,
        });
      });
    });
  });

  return layers;
}
