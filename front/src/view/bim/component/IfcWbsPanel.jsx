import React, { useState, useCallback, useMemo } from 'react';
import { WBS_NODE_TYPES } from '../../../utils/wbsGenerator';
import { useT } from '../../../i18n/LanguageContext';

const NODE_TYPE_ICON = {
  [WBS_NODE_TYPES.PROJECT]:  '🏗',
  [WBS_NODE_TYPES.BUILDING]: '🏢',
  [WBS_NODE_TYPES.STOREY]:   '📐',
  [WBS_NODE_TYPES.TASK]:     '🔧',
};

function progressColor(p) {
  if (p === 0)   return '#475569';
  if (p === 100) return '#4ade80';
  if (p >= 70)   return '#60a5fa';
  if (p >= 30)   return '#fbbf24';
  return '#f97316';
}

// ── WBS 노드 행 ──────────────────────────────────────────────────────
function WbsRow({
  node, depth, isOpen, hasChildren, isSelected,
  onClick, onToggle, onProgressChange, editingId, setEditingId, t,
}) {
  const indent = depth * 14;
  const color  = progressColor(node.progress || 0);
  const isTask = node.nodeType === WBS_NODE_TYPES.TASK;

  const progressLabel = (p) => {
    if (p === 0)   return t('wbsNotStarted');
    if (p === 100) return t('wbsComplete');
    return `${p}%`;
  };

  const handleProgressInput = useCallback(e => {
    e.stopPropagation();
    const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
    onProgressChange?.(node.wbsId, val);
  }, [node.wbsId, onProgressChange]);

  return (
    <div>
      <div
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          paddingLeft: 6 + indent, paddingRight: 8,
          paddingTop: 5, paddingBottom: 5,
          cursor: 'pointer', borderRadius: 6,
          background: isSelected ? '#1a3a5c' : 'transparent',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#0d1f30'; }}
        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
      >
        <span
          onClick={e => { e.stopPropagation(); onToggle?.(); }}
          style={{
            width: 14, fontSize: 9, color: '#475569', flexShrink: 0,
            opacity: hasChildren ? 1 : 0, cursor: hasChildren ? 'pointer' : 'default',
          }}
        >
          {isOpen ? '▼' : '▶'}
        </span>

        <span style={{ fontSize: 13, flexShrink: 0 }}>
          {NODE_TYPE_ICON[node.nodeType] || '▸'}
        </span>

        {node.wbsCode && (
          <span style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace', flexShrink: 0 }}>
            {node.wbsCode}
          </span>
        )}

        <span style={{
          flex: 1, fontSize: 12,
          color: isSelected ? '#93c5fd' : '#cbd5e1',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {node.wbsName}
        </span>

        {node.elementCount > 0 && (
          <span style={{
            fontSize: 10, color: '#475569',
            background: '#0d1b2a', borderRadius: 4,
            padding: '1px 5px', flexShrink: 0,
          }}>
            {node.elementCount}
          </span>
        )}

        {isTask && (
          <span
            onClick={e => { e.stopPropagation(); setEditingId(node.wbsId); }}
            style={{
              fontSize: 11, fontWeight: 700, color,
              minWidth: 40, textAlign: 'right', flexShrink: 0, cursor: 'text',
            }}
            title={t('wbsNotStarted')}
          >
            {editingId === node.wbsId ? null : progressLabel(node.progress || 0)}
          </span>
        )}
      </div>

      {isTask && (node.progress > 0 || editingId === node.wbsId) && (
        <div style={{ marginLeft: 20 + indent, marginRight: 8, marginTop: -3, marginBottom: 3 }}>
          <div style={{ height: 3, borderRadius: 2, background: '#1a2a3a', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${node.progress || 0}%`,
              background: color, borderRadius: 2, transition: 'width 0.3s',
            }} />
          </div>
          {editingId === node.wbsId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input
                type="range" min={0} max={100} value={node.progress || 0}
                onChange={handleProgressInput} onClick={e => e.stopPropagation()}
                style={{ flex: 1, accentColor: color, cursor: 'pointer', height: 3 }}
              />
              <input
                type="number" min={0} max={100} value={node.progress || 0}
                onChange={handleProgressInput} onClick={e => e.stopPropagation()}
                onBlur={() => setEditingId(null)} autoFocus
                style={{
                  width: 46, fontSize: 11, textAlign: 'center',
                  background: '#0d1b2a', border: '1px solid #253347',
                  borderRadius: 4, color: '#cbd5e1', padding: '2px 4px',
                }}
              />
              <span style={{ fontSize: 11, color: '#475569' }}>%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 재귀 트리 렌더링 ──────────────────────────────────────────────────
function WbsTreeNodes({
  nodes, depth, openSet, onToggle, selectedWbsId, onNodeClick,
  onProgressChange, editingId, setEditingId, t,
}) {
  return (
    <>
      {nodes.map(node => {
        const isOpen = openSet.has(node.wbsId);
        const hasCh  = node.children && node.children.length > 0;
        const isSel  = selectedWbsId === node.wbsId;
        return (
          <div key={node.wbsId}>
            <WbsRow
              node={node} depth={depth} isOpen={isOpen}
              hasChildren={hasCh} isSelected={isSel}
              onClick={() => onNodeClick(node)}
              onToggle={() => onToggle(node.wbsId)}
              onProgressChange={onProgressChange}
              editingId={editingId} setEditingId={setEditingId}
              t={t}
            />
            {isOpen && hasCh && (
              <WbsTreeNodes
                nodes={node.children} depth={depth + 1}
                openSet={openSet} onToggle={onToggle}
                selectedWbsId={selectedWbsId} onNodeClick={onNodeClick}
                onProgressChange={onProgressChange}
                editingId={editingId} setEditingId={setEditingId}
                t={t}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────────
export default function IfcWbsPanel({
  wbsTree,
  elementWbsMap,
  selectedElement,
  onSelectElements,
  onProgressChange,
  progressMode,
  onToggleProgress,
}) {
  const t = useT('bimDashboard');

  const [openSet, setOpenSet]        = useState(() => new Set(['ROOT']));
  const [selectedWbsId, setSelected] = useState(null);
  const [editingId, setEditingId]    = useState(null);

  const handleToggle = useCallback(wbsId => {
    setOpenSet(prev => {
      const next = new Set(prev);
      next.has(wbsId) ? next.delete(wbsId) : next.add(wbsId);
      return next;
    });
  }, []);

  const linkedWbsId = useMemo(() => {
    if (!selectedElement?.data?.elementId || !elementWbsMap) return null;
    return elementWbsMap.get(selectedElement.data.elementId) || null;
  }, [selectedElement, elementWbsMap]);

  const handleNodeClick = useCallback(node => {
    setSelected(node.wbsId);
    setEditingId(null);
    if (elementWbsMap && node.nodeType === WBS_NODE_TYPES.TASK) {
      const ids = [];
      for (const [elId, wId] of elementWbsMap.entries()) {
        if (wId === node.wbsId) ids.push(elId);
      }
      onSelectElements?.(ids);
    }
  }, [elementWbsMap, onSelectElements]);

  if (!wbsTree || wbsTree.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#475569', fontSize: 12 }}>
        {t('wbsEmpty')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 툴바 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderBottom: '1px solid #1a2a3a', flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: '#64748b', flex: 1 }}>
          {t('wbsTaskCount', { n: countTasks(wbsTree) })}
        </span>

        <button
          onClick={onToggleProgress}
          title={progressMode ? t('wbsVizOn') : t('wbsVizOff')}
          style={{
            padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            border: `1px solid ${progressMode ? '#3b82f6' : '#253347'}`,
            background: progressMode ? '#1e3a5f' : '#0d1b2a',
            color: progressMode ? '#60a5fa' : '#64748b',
            cursor: 'pointer',
          }}
        >
          {progressMode ? t('wbsVizOn') : t('wbsVizOff')}
        </button>

        <button
          onClick={() => setOpenSet(new Set(collectAllIds(wbsTree)))}
          title={t('wbsExpandAll')}
          style={{
            padding: '3px 8px', borderRadius: 6, fontSize: 11,
            border: '1px solid #253347', background: '#0d1b2a',
            color: '#64748b', cursor: 'pointer',
          }}
        >
          ↕
        </button>
      </div>

      {linkedWbsId && selectedElement && (
        <div style={{
          padding: '6px 10px', background: '#0a1929',
          borderBottom: '1px solid #1a2a3a', flexShrink: 0,
        }}>
          <p style={{ fontSize: 10, color: '#60a5fa', margin: 0 }}>
            {t('wbsLinkedWbs')}
          </p>
          <p style={{ fontSize: 11, color: '#93c5fd', margin: '2px 0 0', fontWeight: 600 }}>
            {linkedWbsId}
          </p>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        <WbsTreeNodes
          nodes={wbsTree} depth={0}
          openSet={openSet} onToggle={handleToggle}
          selectedWbsId={selectedWbsId || linkedWbsId}
          onNodeClick={handleNodeClick}
          onProgressChange={onProgressChange}
          editingId={editingId} setEditingId={setEditingId}
          t={t}
        />
      </div>
    </div>
  );
}

// ── 헬퍼 ──────────────────────────────────────────────────────────

function countTasks(nodes) {
  let n = 0;
  for (const node of nodes) {
    if (node.nodeType === WBS_NODE_TYPES.TASK) n++;
    if (node.children) n += countTasks(node.children);
  }
  return n;
}

function collectAllIds(nodes) {
  const ids = [];
  for (const node of nodes) {
    ids.push(node.wbsId);
    if (node.children) ids.push(...collectAllIds(node.children));
  }
  return ids;
}
