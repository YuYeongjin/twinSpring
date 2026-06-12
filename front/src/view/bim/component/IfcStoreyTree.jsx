import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useT } from '../../../i18n/LanguageContext';

// ── 타입별 색상 ─────────────────────────────────────────────────────
const TYPE_COLOR = {
  IfcColumn:  '#60a5fa',
  IfcBeam:    '#34d399',
  IfcWall:    '#a78bfa',
  IfcSlab:    '#f59e0b',
  IfcDoor:    '#fb923c',
  IfcWindow:  '#38bdf8',
  IfcStair:   '#f472b6',
  IfcRoof:    '#4ade80',
  IfcMember:  '#94a3b8',
  IfcPier:    '#fbbf24',
};

const TYPE_ICON = {
  IfcColumn:  '🏛',
  IfcBeam:    '━',
  IfcWall:    '▬',
  IfcSlab:    '▭',
  IfcDoor:    '🚪',
  IfcWindow:  '🪟',
  IfcStair:   '🪜',
  IfcRoof:    '🏠',
  IfcMember:  '╱',
  IfcPier:    '⬛',
};

// type → translation key 매핑
const TYPE_TKEY = {
  IfcWall:    'typeIfcWall',
  IfcColumn:  'typeIfcColumn',
  IfcBeam:    'typeIfcBeam',
  IfcSlab:    'typeIfcSlab',
  IfcDoor:    'typeIfcDoor',
  IfcWindow:  'typeIfcWindow',
  IfcStair:   'typeIfcStair',
  IfcRoof:    'typeIfcRoof',
  IfcMember:  'typeIfcMember',
  IfcPier:    'typeIfcPier',
};

// ── 레이어 팝오버 ────────────────────────────────────────────────────
function LayerPopover({ ids, layers, onAssignToLayer, onRemoveFromLayer, onClose, t }) {
  const ref = useRef();

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!layers || layers.length === 0) {
    return (
      <div ref={ref} style={popoverStyle}>
        <p style={{ fontSize: 11, color: '#475569', textAlign: 'center', padding: '6px 0' }}>
          {t('storeyTreeNoLayers')}
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} style={popoverStyle} onClick={e => e.stopPropagation()}>
      <p style={{ fontSize: 10, color: '#475569', padding: '4px 8px 6px', borderBottom: '1px solid #1e3a5f' }}>
        {t('storeyTreeLayerAssign', { count: ids.length })}
      </p>
      {layers.map(layer => {
        const assignedCount = ids.filter(id => (layer.elementIds || []).includes(id)).length;
        const allIn = assignedCount === ids.length;
        const partIn = assignedCount > 0 && !allIn;
        return (
          <button
            key={layer.layerId}
            onClick={() => {
              if (allIn) {
                ids.forEach(id => onRemoveFromLayer(layer.layerId, id));
              } else {
                ids.forEach(id => onAssignToLayer(layer.layerId, id));
              }
              onClose();
            }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 7,
              padding: '5px 8px', fontSize: 11, cursor: 'pointer',
              background: allIn ? layer.color + '22' : partIn ? layer.color + '11' : 'transparent',
              border: 'none', borderBottom: '1px solid #0d1f30',
              color: allIn ? layer.color : partIn ? layer.color + 'cc' : '#94a3b8',
              textAlign: 'left',
            }}
          >
            <div style={{
              width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
              background: layer.color,
              outline: allIn ? `2px solid ${layer.color}` : 'none',
              outlineOffset: 1,
            }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {layer.layerName}
            </span>
            {partIn && <span style={{ fontSize: 10, opacity: 0.6 }}>{assignedCount}/{ids.length}</span>}
            {allIn && <span style={{ fontSize: 11 }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

const popoverStyle = {
  position: 'absolute', right: 0, top: '100%', zIndex: 100,
  minWidth: 160, maxWidth: 200,
  background: '#0d1b2a', border: '1px solid #1e3a5f',
  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  overflow: 'hidden',
};

// ── 부재 정보 패널 ────────────────────────────────────────────────────
function ElementInfoPanel({ element, onClose, t }) {
  if (!element) return null;
  const fields = [
    [t('infoId'),       element.elementId],
    [t('infoType'),     element.elementType?.replace('Ifc', '')],
    ['GlobalId',        element.globalId],
    ['IFC Name',        element.ifcName],
    [t('infoStorey'),   element.storey],
    [t('infoBuilding'), element.building],
    [t('infoPos') + ' X', element.positionX?.toFixed(2)],
    [t('infoPos') + ' Y', element.positionY?.toFixed(2)],
    [t('infoPos') + ' Z', element.positionZ?.toFixed(2)],
    [t('infoWidth'),    element.sizeX?.toFixed(2)],
    [t('infoDepth'),    element.sizeY?.toFixed(2)],
    [t('infoHeight'),   element.sizeZ?.toFixed(2)],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  return (
    <div style={{
      margin: '4px 8px 8px',
      background: '#0a1929', border: '1px solid #1e3a5f',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px', borderBottom: '1px solid #1e3a5f',
        background: '#0d1f35',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa' }}>{t('storeyTreeElemInfo')}</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13 }}
        >✕</button>
      </div>
      <div style={{ padding: '4px 0' }}>
        {fields.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 6, padding: '2px 8px', fontSize: 11 }}>
            <span style={{ color: '#475569', flexShrink: 0, width: 60 }}>{k}</span>
            <span style={{
              color: '#94a3b8', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }} title={String(v)}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 노드 컴포넌트 ────────────────────────────────────────────────────
function TreeRow({
  label, count, color, icon, depth, isOpen, hasChildren, isSelected,
  onClick, onToggle, ids,
  layers, onAssignToLayer, onRemoveFromLayer, t,
}) {
  const [showLayers, setShowLayers] = useState(false);
  const [hovered, setHovered]       = useState(false);
  const indent = depth * 12;

  const hasLayers = layers && layers.length > 0 && ids && ids.length > 0;

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingLeft: 8 + indent, paddingRight: 8,
          paddingTop: 4, paddingBottom: 4,
          cursor: 'pointer', borderRadius: 6,
          background: isSelected ? '#1e3a5f' : hovered ? '#12253a' : 'transparent',
          userSelect: 'none',
          transition: 'background 0.1s',
        }}
      >
        <span
          onClick={e => { e.stopPropagation(); onToggle?.(); }}
          style={{
            width: 14, fontSize: 10, color: '#475569', flexShrink: 0,
            opacity: hasChildren ? 1 : 0, cursor: hasChildren ? 'pointer' : 'default',
          }}
        >
          {isOpen ? '▼' : '▶'}
        </span>

        {icon && <span style={{ fontSize: 12, flexShrink: 0 }}>{icon}</span>}

        <span style={{
          flex: 1, fontSize: 12, color: isSelected ? '#93c5fd' : '#cbd5e1',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </span>

        {color && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        )}

        {count !== undefined && (
          <span style={{
            fontSize: 10, color: '#475569',
            background: '#0d1b2a', borderRadius: 4,
            padding: '1px 5px', flexShrink: 0,
          }}>
            {count}
          </span>
        )}

        {hasLayers && (hovered || showLayers) && (
          <button
            onClick={e => { e.stopPropagation(); setShowLayers(v => !v); }}
            title={t('storeyTreeLayerBtn')}
            style={{
              flexShrink: 0, fontSize: 10, padding: '1px 5px',
              background: showLayers ? '#1e3a5f' : '#0d1b2a',
              border: `1px solid ${showLayers ? '#3b82f6' : '#253347'}`,
              borderRadius: 4, color: showLayers ? '#60a5fa' : '#475569',
              cursor: 'pointer', lineHeight: 1.4,
            }}
          >
            {t('storeyTreeLayerBtn')}
          </button>
        )}
      </div>

      {showLayers && (
        <LayerPopover
          ids={ids}
          layers={layers}
          onAssignToLayer={onAssignToLayer}
          onRemoveFromLayer={onRemoveFromLayer}
          onClose={() => setShowLayers(false)}
          t={t}
        />
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function IfcStoreyTree({
  modelData,
  selectedElement,
  onSelectElements,
  onSelectElement,
  layers = [],
  onAssignToLayer,
  onRemoveFromLayer,
}) {
  const t = useT('bimDashboard');

  const [openBuildings, setOpenBuildings] = useState(new Set());
  const [openStoreys, setOpenStoreys]     = useState(new Set());
  const [openTypes, setOpenTypes]         = useState(new Set());
  const [selectedKey, setSelectedKey]     = useState(null);
  const [infoElement, setInfoElement]     = useState(null);

  const tree = useMemo(() => {
    if (!modelData || modelData.length === 0) return [];

    const byBuilding = {};
    for (const el of modelData) {
      const bKey = el.building || '__common__';
      if (!byBuilding[bKey]) byBuilding[bKey] = {};
      const sKey = el.storey || '__unassigned__';
      if (!byBuilding[bKey][sKey]) byBuilding[bKey][sKey] = {};
      const tKey = el.elementType;
      if (!byBuilding[bKey][sKey][tKey]) byBuilding[bKey][sKey][tKey] = [];
      byBuilding[bKey][sKey][tKey].push(el);
    }

    return Object.entries(byBuilding)
      .sort(([a], [b]) => a.localeCompare(b, 'ko'))
      .map(([buildingKey, storeys]) => ({
        buildingKey,
        storeys: Object.entries(storeys)
          .sort(([a], [b]) => storeyRank(a) - storeyRank(b))
          .map(([storeyKey, types]) => ({
            storeyKey,
            types: Object.entries(types)
              .sort(([a], [b]) => typeOrder(a) - typeOrder(b))
              .map(([type, elements]) => ({ type, elements })),
          })),
      }));
  }, [modelData]);

  const toggle = useCallback((setFn, key) => {
    setFn(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const handleBuildingClick = (buildingKey, allIds) => {
    setSelectedKey(`B:${buildingKey}`);
    onSelectElements?.(allIds);
    setInfoElement(null);
  };

  const handleStoreyClick = (buildingKey, storeyKey, allIds) => {
    setSelectedKey(`S:${buildingKey}:${storeyKey}`);
    onSelectElements?.(allIds);
    setInfoElement(null);
  };

  const handleTypeClick = (buildingKey, storeyKey, type, ids) => {
    setSelectedKey(`T:${buildingKey}:${storeyKey}:${type}`);
    onSelectElements?.(ids);
    setInfoElement(null);
  };

  const handleElementClick = el => {
    setSelectedKey(`E:${el.elementId}`);
    onSelectElement?.(el);
    setInfoElement(el);
  };

  if (!modelData || modelData.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#475569', fontSize: 12 }}>
        {t('storeyTreeEmpty').split('\n').map((line, i) => (
          <React.Fragment key={i}>{line}{i === 0 && <br />}</React.Fragment>
        ))}
      </div>
    );
  }

  const layerProps = { layers, onAssignToLayer, onRemoveFromLayer, t };

  return (
    <div style={{ overflowY: 'auto', height: '100%', padding: '4px 0' }}>
      {tree.map(({ buildingKey, storeys }) => {
        const bKey    = `B:${buildingKey}`;
        const bIsOpen = openBuildings.has(buildingKey);
        const bLabel  = buildingKey === '__common__' ? t('storeyTreeCommon') : buildingKey;
        const bAllIds = storeys.flatMap(s => s.types.flatMap(tp => tp.elements.map(e => e.elementId)));

        return (
          <div key={buildingKey}>
            <TreeRow
              label={bLabel}
              count={bAllIds.length}
              icon="🏢"
              depth={0}
              isOpen={bIsOpen}
              hasChildren={storeys.length > 0}
              isSelected={selectedKey === bKey}
              onClick={() => handleBuildingClick(buildingKey, bAllIds)}
              onToggle={() => toggle(setOpenBuildings, buildingKey)}
              ids={bAllIds}
              {...layerProps}
            />

            {bIsOpen && storeys.map(({ storeyKey, types }) => {
              const sKey    = `S:${buildingKey}:${storeyKey}`;
              const sIsOpen = openStoreys.has(sKey);
              const sLabel  = storeyKey === '__unassigned__' ? t('storeyTreeUnassigned') : storeyKey;
              const sAllIds = types.flatMap(tp => tp.elements.map(e => e.elementId));

              return (
                <div key={storeyKey}>
                  <TreeRow
                    label={sLabel}
                    count={sAllIds.length}
                    icon="📐"
                    depth={1}
                    isOpen={sIsOpen}
                    hasChildren={types.length > 0}
                    isSelected={selectedKey === sKey}
                    onClick={() => handleStoreyClick(buildingKey, storeyKey, sAllIds)}
                    onToggle={() => toggle(setOpenStoreys, sKey)}
                    ids={sAllIds}
                    {...layerProps}
                  />

                  {sIsOpen && types.map(({ type, elements: typeEls }) => {
                    const tKey    = `T:${buildingKey}:${storeyKey}:${type}`;
                    const tIsOpen = openTypes.has(tKey);
                    const tIds    = typeEls.map(e => e.elementId);
                    const color   = TYPE_COLOR[type];
                    const tLabel  = TYPE_TKEY[type] ? t(TYPE_TKEY[type]) : type.replace('Ifc', '');

                    return (
                      <div key={type}>
                        <TreeRow
                          label={tLabel}
                          count={typeEls.length}
                          icon={TYPE_ICON[type]}
                          color={color}
                          depth={2}
                          isOpen={tIsOpen}
                          hasChildren={typeEls.length > 0}
                          isSelected={selectedKey === tKey}
                          onClick={() => handleTypeClick(buildingKey, storeyKey, type, tIds)}
                          onToggle={() => toggle(setOpenTypes, tKey)}
                          ids={tIds}
                          {...layerProps}
                        />

                        {tIsOpen && typeEls.map(el => {
                          const eKey  = `E:${el.elementId}`;
                          const label = el.ifcName || el.globalId || el.elementId;
                          const isSel = selectedElement?.data?.elementId === el.elementId
                                     || selectedKey === eKey;
                          return (
                            <TreeRow
                              key={el.elementId}
                              label={label}
                              icon="▸"
                              color={color}
                              depth={3}
                              isOpen={false}
                              hasChildren={false}
                              isSelected={isSel}
                              onClick={() => handleElementClick(el)}
                              ids={[el.elementId]}
                              {...layerProps}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}

      {infoElement && (
        <ElementInfoPanel
          element={infoElement}
          onClose={() => setInfoElement(null)}
          t={t}
        />
      )}
    </div>
  );
}

// ── 헬퍼 ──────────────────────────────────────────────────────────

function storeyRank(key) {
  if (!key || key === '__unassigned__') return 9999;
  const lc = key.toLowerCase();
  const bMatch = lc.match(/^b(\d+)/);
  if (bMatch) return -parseInt(bMatch[1], 10);
  const fMatch = key.match(/(\d+)/);
  if (fMatch) return parseInt(fMatch[1], 10);
  if (lc.includes('roof') || lc.includes('옥상')) return 1000;
  return 500;
}

const TYPE_SORT_ORDER = [
  'IfcColumn', 'IfcBeam', 'IfcSlab', 'IfcWall',
  'IfcDoor', 'IfcWindow', 'IfcStair', 'IfcRoof',
  'IfcMember', 'IfcPier',
];
function typeOrder(type) {
  const idx = TYPE_SORT_ORDER.indexOf(type);
  return idx >= 0 ? idx : 99;
}
