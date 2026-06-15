import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useIntegration, useIntegrationDispatch, computeStructureBounds } from '../IntegrationStore';
import AddStructureModal, { resizeImageDataUrl } from './AddStructureModal';
import EquipmentOptionsPanel from './EquipmentOptionsPanel';
import WorkerOptionsPanel from './WorkerOptionsPanel';
import ZoneOptionsPanel from './ZoneOptionsPanel';
import BimWorkPlanPanel from './BimWorkPlanPanel';
import { useT } from '../../../i18n/LanguageContext';
import { calcProgressRate, getRecommendations, TASK_RULES, EQUIP_LABEL } from '../progressEngine';
import {
  detectFloors, getFloorLabel, getFloorProgress,
  getFloorStatus, getFloorStatusColor,
} from '../floorUtils';
import AxiosCustom from '../../../axios/AxiosCustom';

// 자동 작업 중 표시 뱃지 (깜빡이는 점)
function AutoWorkBadge({ count }) {
  const t = useT('integrationProject');
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn(v => !v), 700);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 8px', marginBottom: 8, borderRadius: 5,
      background: '#0f1f00', border: '1px solid #22c55e55',
    }}>
      <span style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: on ? '#22c55e' : '#0f1f00',
        boxShadow: on ? '0 0 6px #22c55e' : 'none',
        transition: 'background 0.2s, box-shadow 0.2s',
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 9, color: '#4ade80', fontWeight: 700 }}>
        {t('autoWorkBadge', { count })}
      </span>
    </div>
  );
}

const STATUS_COLOR = {
  NOT_STARTED: '#94a3b8',
  IN_PROGRESS:  '#60a5fa',
  COMPLETED:    '#4ade80',
  DELAYED:      '#ef4444',
};
const STATUS_T_KEY = {
  NOT_STARTED: 'drStatusNotStarted',
  IN_PROGRESS: 'drStatusInProgress',
  COMPLETED:   'drStatusCompleted',
  DELAYED:     'drStatusDelayed',
};
const PROGRESS_COLOR = p =>
  p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#374151';

// BIM 공종 자동 규칙 디테일 패널
function TaskRuleDetail({ task, workers, equipment }) {
  const t = useT('integrationProject');
  const elementType = task.notes?.split(':')[2];
  const rule = TASK_RULES[elementType];
  if (!rule) return null;

  const { rate, blocked, reason } = calcProgressRate(elementType, workers, equipment);
  const recs = getRecommendations(elementType, workers, equipment);
  const activeEquip = equipment.filter(e => e.mode !== 'standby');

  const rateColor = blocked ? '#ef4444' : rate >= 1.5 ? '#22c55e' : rate >= 1.0 ? '#60a5fa' : '#f97316';

  return (
    <div style={{
      marginTop: 6, padding: '8px 9px',
      background: '#060f18', borderRadius: 5,
      border: `1px solid ${blocked ? '#7f1d1d' : '#1e3a5f'}`,
    }}>
      {/* 공종명 + 속도 배율 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {elementType}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 800, color: rateColor,
          background: blocked ? '#1a0000' : '#0a1a10',
          padding: '1px 7px', borderRadius: 10,
          border: `1px solid ${rateColor}44`,
        }}>
          {blocked ? t('ruleBlocked') : `⚡ ×${rate.toFixed(2)}`}
        </span>
      </div>

      {/* 블로커 장비 상태 */}
      {rule.blockers.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('ruleRequired')}
          </div>
          {rule.blockers.map((req, i) => {
            const have = activeEquip.filter(e => e.type === req.type).length;
            const ok   = have >= req.min;
            return (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '2px 0', fontSize: 9,
              }}>
                <span style={{ color: ok ? '#8896a4' : '#fca5a5' }}>
                  {EQUIP_LABEL[req.type] || req.type} × {req.min}
                </span>
                <span style={{
                  color: ok ? '#22c55e' : '#ef4444', fontWeight: 700, fontSize: 8,
                }}>
                  {ok ? t('ruleEquipOk', { n: have }) : t('ruleEquipNG', { n: have, min: req.min })}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 속도 보너스 */}
      {rule.equipBonus.length > 0 && !blocked && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('ruleBonus')}
          </div>
          {rule.equipBonus.map((b, i) => {
            const cnt = activeEquip.filter(e => e.type === b.type).length;
            const gain = cnt * b.perUnit;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '1px 0' }}>
                <span style={{ color: '#6b7280' }}>{EQUIP_LABEL[b.type] || b.type} +{Math.round(b.perUnit * 100)}%</span>
                <span style={{ color: gain > 0 ? '#4ade80' : '#4b5563' }}>
                  {cnt > 0 && <span style={{ color: '#22c55e' }}>{t('ruleActiveCount', { n: cnt })}</span>}
                </span>
              </div>
            );
          })}
          {(rule.workerBonus || 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '1px 0' }}>
              <span style={{ color: '#6b7280' }}>+{Math.round(rule.workerBonus * 100)}%/worker</span>
              <span style={{ color: workers.length > 0 ? '#4ade80' : '#4b5563' }}>
                {workers.length > 0 && <span style={{ color: '#22c55e' }}>{t('ruleWorkerCount', { n: workers.length })}</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 추천사항 */}
      {recs.length > 0 && (
        <div>
          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('ruleRecs')}
          </div>
          {recs.map((rec, i) => (
            <div key={i} style={{
              fontSize: 8, lineHeight: 1.6, padding: '1px 0',
              color: rec.priority === 'critical' ? '#fca5a5' : rec.priority === 'warning' ? '#fde68a' : '#6ee7b7',
            }}>
              {rec.priority === 'critical' ? '⛔ ' : rec.priority === 'warning' ? '⚠ ' : '↑ '}{rec.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BIM/WBS 현황 미니 패널 ────────────────────────────────────────
function BimWbsPanel({ wbsTasks, workers, equipment, t }) {
  const [open, setOpen]           = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const total   = wbsTasks.length;
  const done    = wbsTasks.filter(tk => (tk.progress || 0) >= 100).length;
  const overall = total > 0
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / total * 10) / 10
    : 0;

  const overallColor = PROGRESS_COLOR(overall);

  return (
    <div>
      {/* 헤더 — 클릭하면 태스크 목록 펼침 */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
          padding: '5px 6px', borderRadius: 5,
          background: open ? '#0c1e35' : 'transparent',
          border: `1px solid ${open ? '#1e3a5f' : 'transparent'}`,
          marginBottom: open ? 8 : 0,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 700 }}>
              {t('wbsOverall')}
            </span>
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 800 }}>{overall.toFixed(1)}%</span>
          </div>
          <div style={{ background: '#111e2d', borderRadius: 3, height: 5, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${overall}%`,
              background: overallColor, borderRadius: 3,
              transition: 'width 1s ease',
            }} />
          </div>
          {total > 0 && (
            <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3 }}>
              {t('wbsTaskProgress', { done, total })}
            </div>
          )}
        </div>
        <span style={{ fontSize: 9, color: '#374151', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* 펼침 — 태스크 목록 */}
      {open && (
        <div style={{ paddingLeft: 2 }}>
          {total === 0 ? (
            <div style={{ fontSize: 9, color: '#374151', padding: '4px 0' }}>{t('wbsNoTasks')}</div>
          ) : (
            wbsTasks.map(tk => {
              const p           = tk.progress || 0;
              const c           = PROGRESS_COLOR(p);
              const statusColor = STATUS_COLOR[tk.status];
              const statusLabel = STATUS_T_KEY[tk.status] ? t(STATUS_T_KEY[tk.status]) : null;
              const isBimTask   = typeof tk.notes === 'string' && /^BIM:[^:]+:[^:]+/.test(tk.notes);
              const isSelected  = selectedTaskId === tk.taskId;

              return (
                <div key={tk.taskId} style={{ marginBottom: 7 }}>
                  {/* 태스크 행 */}
                  <div
                    onClick={() => isBimTask && setSelectedTaskId(isSelected ? null : tk.taskId)}
                    style={{
                      cursor: isBimTask ? 'pointer' : 'default',
                      padding: '3px 4px', borderRadius: 4,
                      background: isSelected ? '#0c1e35' : 'transparent',
                      border: `1px solid ${isSelected ? '#1e3a5f' : 'transparent'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{
                        fontSize: 9, color: '#8896a4',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 108,
                      }}>
                        {isBimTask && <span style={{ color: '#3b82f6', marginRight: 3 }}>■</span>}
                        {tk.taskName}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {statusLabel && (
                          <span style={{ fontSize: 8, color: statusColor, fontWeight: 700 }}>
                            {statusLabel}
                          </span>
                        )}
                        <span style={{ fontSize: 9, color: c, fontWeight: 700 }}>{(p).toFixed(1)}%</span>
                        {isBimTask && (
                          <span style={{ fontSize: 8, color: isSelected ? '#60a5fa' : '#374151' }}>
                            {isSelected ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ background: '#111e2d', borderRadius: 2, height: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, p)}%`, background: c, borderRadius: 2, transition: 'width 1s ease' }} />
                    </div>
                  </div>

                  {/* BIM 공종 규칙 디테일 (선택 시 펼침) */}
                  {isSelected && (
                    <TaskRuleDetail task={tk} workers={workers} equipment={equipment} />
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── 층별 진행현황 패널 ───────────────────────────────────────────
function BimFloorPanel({ wbsTasks, structures, workers, equipment, t }) {
  const [openKey,     setOpenKey]     = useState(null);
  const [activePulse, setActivePulse] = useState(true);

  // 진행 중 층 강조를 위한 펄스
  useEffect(() => {
    const id = setInterval(() => setActivePulse(v => !v), 900);
    return () => clearInterval(id);
  }, []);

  // WBS notes → 공종별 진도 맵  {bimProjectId:elementType → progress}
  const progressMap = useMemo(() => {
    const m = {};
    wbsTasks.forEach(tk => {
      if (!tk.notes) return;
      const match = tk.notes.match(/^BIM:([^:]+):([^:]+)/);
      if (match) m[`${match[1]}:${match[2]}`] = Math.min(100, Math.max(0, tk.progress || 0));
    });
    return m;
  }, [wbsTasks]);

  const total   = wbsTasks.length;
  const done    = wbsTasks.filter(tk => (tk.progress || 0) >= 100).length;
  const overall = total > 0
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / total * 10) / 10
    : 0;
  const overallColor = PROGRESS_COLOR(overall);

  // BIM 요소가 로드된 구조물만
  const bimStructs = structures.filter(s => s.type === 'bim' && s.elements?.length > 0);

  return (
    <div>
      {/* 전체 진행률 헤더 */}
      <div style={{
        padding: '6px 8px', borderRadius: 5, marginBottom: 10,
        background: '#071018', border: '1px solid #1e3a5f',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: overallColor, fontWeight: 700 }}>
            {t('wbsOverall')}
          </span>
          <span style={{ fontSize: 11, color: overallColor, fontWeight: 800 }}>
            {overall.toFixed(1)}%
          </span>
        </div>
        <div style={{ background: '#111e2d', borderRadius: 3, height: 5, overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ height: '100%', width: `${overall}%`, background: overallColor, borderRadius: 3, transition: 'width 1.2s ease' }} />
        </div>
        {total > 0 && (
          <div style={{ fontSize: 9, color: '#4b5563' }}>
            {t('wbsTaskProgress', { done, total })}
          </div>
        )}
      </div>

      {/* BIM 구조물 없거나 요소 미로드 → 플랫 태스크 목록 */}
      {bimStructs.length === 0 && (
        <div style={{ paddingLeft: 2 }}>
          {total === 0 ? (
            <div style={{ fontSize: 9, color: '#374151' }}>{t('wbsNoTasks')}</div>
          ) : (
            wbsTasks.map(tk => {
              const p = Math.round((tk.progress || 0) * 10) / 10;
              const c = PROGRESS_COLOR(p);
              return (
                <div key={tk.taskId} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2 }}>
                    <span style={{ color: '#8896a4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
                      {tk.taskName}
                    </span>
                    <span style={{ color: c, fontWeight: 700, flexShrink: 0 }}>{p.toFixed(1)}%</span>
                  </div>
                  <div style={{ background: '#111e2d', borderRadius: 2, height: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, p)}%`, background: c, borderRadius: 2, transition: 'width 1s ease' }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 구조물별 층 패널 */}
      {bimStructs.map(struct => {
        const floors = detectFloors(struct.elements);
        const N      = floors.length;
        if (N === 0) return null;
        const pid = struct.bimProjectId;

        return (
          <div key={struct.id} style={{ marginBottom: 8 }}>
            {/* 구조물명 (2개 이상일 때만) */}
            {bimStructs.length > 1 && (
              <div style={{
                fontSize: 8, color: '#4b6a8a', fontWeight: 700, marginBottom: 5,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {struct.name}
              </div>
            )}

            {/* 층별 섹션 제목 */}
            <div style={{
              fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 5,
              textTransform: 'uppercase', letterSpacing: '0.07em',
              borderBottom: '1px solid #111e2d', paddingBottom: 3,
            }}>
              {t('bimFloorPanel')}
            </div>

            {/* 층 목록: 아래층(index 0)부터 표시 */}
            {floors.map((floor, floorIdx) => {
              const label = getFloorLabel(floorIdx, floors, t);

              // 이 층에 있는 공종 목록
              const types = [...new Set(floor.elements.map(el => el.elementType))].sort();

              // 이 층 공종들의 WBS 진도 평균
              const typePcts = types.map(type =>
                progressMap[`${pid}:${type}`] ?? overall
              );
              const avgTypePct = typePcts.length
                ? typePcts.reduce((a, b) => a + b, 0) / typePcts.length
                : 0;

              // 캐스케이딩 층 진도
              const cascadePct  = getFloorProgress(floorIdx, N, avgTypePct);
              const status      = getFloorStatus(cascadePct);
              const color       = getFloorStatusColor(status);
              const statusLabel = t(`floor${status.charAt(0).toUpperCase() + status.slice(1)}`);
              const rowKey      = `${struct.id}_${floorIdx}`;
              const isOpen      = openKey === rowKey;
              const isActive    = status === 'active';

              // 진행 중 층: 좌측 경계선 펄스
              const accentOpacity = isActive ? (activePulse ? 0.75 : 0.20) : 0;

              return (
                <div key={floorIdx} style={{ marginBottom: 3 }}>
                  {/* 층 헤더 행 */}
                  <div
                    onClick={() => setOpenKey(isOpen ? null : rowKey)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 6px', cursor: 'pointer', borderRadius: 4,
                      background: isOpen ? '#071018' : 'transparent',
                      borderTop:    `1px solid ${isOpen ? '#1e3a5f' : 'transparent'}`,
                      borderRight:  `1px solid ${isOpen ? '#1e3a5f' : 'transparent'}`,
                      borderBottom: `1px solid ${isOpen ? '#1e3a5f' : 'transparent'}`,
                      borderLeft: `2px solid rgba(${
                        isActive ? '34,197,94' : status === 'done' ? '96,165,250' : '55,65,81'
                      },${accentOpacity || (isOpen ? 0.3 : 0)})`,
                      transition: 'border-color 0.35s, background 0.2s',
                    }}
                  >
                    {/* 층 라벨 */}
                    <span style={{
                      fontSize: 10, color, fontWeight: 800,
                      flexShrink: 0, minWidth: 24,
                    }}>
                      {label}
                    </span>

                    {/* 진행 바 */}
                    <div style={{ flex: 1, background: '#111e2d', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${cascadePct}%`,
                        background: color, borderRadius: 2,
                        transition: 'width 1.2s ease',
                      }} />
                    </div>

                    {/* 진도 수치 */}
                    <span style={{ fontSize: 9, color, fontWeight: 700, flexShrink: 0, minWidth: 36, textAlign: 'right' }}>
                      {cascadePct.toFixed(1)}%
                    </span>

                    {/* 상태 뱃지 */}
                    <span style={{
                      fontSize: 7, color, flexShrink: 0,
                      background: `${color}18`, padding: '1px 5px', borderRadius: 3,
                      border: `1px solid ${color}30`, minWidth: 38, textAlign: 'center',
                      opacity: isActive ? (activePulse ? 1 : 0.55) : 1,
                      transition: 'opacity 0.35s',
                    }}>
                      {statusLabel}
                    </span>

                    <span style={{ fontSize: 8, color: '#374151', flexShrink: 0 }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </div>

                  {/* 공종 상세 (펼침) */}
                  {isOpen && (
                    <div style={{ paddingLeft: 8, paddingTop: 3, paddingBottom: 5 }}>
                      <div style={{ fontSize: 7, color: '#253347', marginBottom: 4 }}>
                        {t('floorTypeCount', { n: types.length })}
                      </div>

                      {types.map(type => {
                        const rawPct  = progressMap[`${pid}:${type}`] ?? 0;
                        const typePct = getFloorProgress(floorIdx, N, rawPct);
                        const tc      = getFloorStatusColor(getFloorStatus(typePct));
                        const selectedTask = wbsTasks.find(
                          tk => tk.notes?.startsWith(`BIM:${pid}:${type}`)
                        );

                        return (
                          <div key={type} style={{ marginBottom: 5 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 8, marginBottom: 2 }}>
                              <span style={{ color: '#6b7280', fontWeight: 600 }}>{type}</span>
                              <span style={{ color: tc, fontWeight: 700 }}>{typePct.toFixed(1)}%</span>
                            </div>
                            <div style={{ background: '#0d1b2a', borderRadius: 2, height: 3, overflow: 'hidden', marginBottom: selectedTask ? 3 : 0 }}>
                              <div style={{ height: '100%', width: `${typePct}%`, background: tc, borderRadius: 2, transition: 'width 1.2s ease' }} />
                            </div>
                            {/* 해당 공종 WBS 태스크에 TaskRuleDetail 연결 */}
                            {selectedTask && (
                              <TaskRuleDetail task={selectedTask} workers={workers} equipment={equipment} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── GPS 설정 패널 ─────────────────────────────────────────────────
function GpsSetupPanel({ gpsMode, equipment, workers, dispatch, t }) {
  const [equipInputs,  setEquipInputs]  = useState(() =>
    Object.fromEntries(equipment.map(e => [e.id, e.gpsDeviceId || '']))
  );
  const [workerInputs, setWorkerInputs] = useState(() =>
    Object.fromEntries(workers.map(w => [w.id, w.gpsDeviceId || '']))
  );

  const saveEquipDevice = (id, value) => {
    const trimmed = value.trim();
    dispatch({ type: 'SET_EQUIP_DEVICE_ID', id, deviceId: trimmed || null });
    if (gpsMode && trimmed) dispatch({ type: 'UPDATE_EQUIPMENT', id, updates: { mode: 'gps' } });
  };
  const saveWorkerDevice = (id, value) => {
    dispatch({ type: 'SET_WORKER_DEVICE_ID', id, deviceId: value.trim() || null });
  };

  const linkedEquip  = equipment.filter(e => e.gpsDeviceId);
  const activeEquip  = equipment.filter(e => e.mode === 'gps' && e.gpsDeviceId);
  const linkedWorker = workers.filter(w => w.gpsDeviceId);

  return (
    <div style={{
      marginTop: 8, background: '#06101c', border: '1px solid #1e3a5f',
      borderRadius: 6, overflow: 'hidden',
    }}>
      {/* 헤더 + 전체 토글 */}
      <div style={{
        padding: '7px 10px', borderBottom: '1px solid #0d2040',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700, letterSpacing: '0.05em' }}>
          {t('gpsPanelTitle')}
        </span>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_GPS_MODE' })}
          style={{
            background: gpsMode ? '#1e1040' : '#0f1a2e',
            border: `1px solid ${gpsMode ? '#7c3aed' : '#1e3a5f'}`,
            borderRadius: 4, color: gpsMode ? '#a78bfa' : '#4b5563',
            fontSize: 9, fontWeight: 700, padding: '3px 8px', cursor: 'pointer',
          }}
        >
          {gpsMode ? t('gpsGlobalOn') : t('gpsGlobalOff')}
        </button>
      </div>

      {/* 상태 요약 */}
      {gpsMode && (
        <div style={{
          padding: '4px 10px', background: '#08111f',
          fontSize: 8, color: '#4b6a8a', borderBottom: '1px solid #0d2040',
        }}>
          <span style={{ color: activeEquip.length > 0 ? '#22c55e' : '#374151', fontWeight: 700 }}>
            {t('gpsStatusActive')} {activeEquip.length}
          </span>
          <span style={{ margin: '0 6px', color: '#1e3a5f' }}>|</span>
          <span style={{ color: '#60a5fa' }}>
            {t('gpsEquipSection')} {linkedEquip.length} / {t('gpsWorkerSection')} {linkedWorker.length}
          </span>
        </div>
      )}

      <div style={{ padding: '8px 10px', maxHeight: 260, overflowY: 'auto' }}>
        {/* 장비 목록 */}
        <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 5,
          textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          {t('gpsEquipSection')}
        </div>
        {equipment.map(e => {
          const isActive = e.mode === 'gps' && e.gpsDeviceId && gpsMode;
          const statusColor = isActive ? '#22c55e' : e.gpsDeviceId ? '#60a5fa' : '#374151';
          const statusLabel = isActive ? t('gpsStatusActive') : e.gpsDeviceId ? t('gpsStatusLinked') : t('gpsStatusNone');
          return (
            <div key={e.id} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: '#8896a4', fontWeight: 600 }}>{e.name}</span>
                <span style={{ fontSize: 7, color: statusColor,
                  background: `${statusColor}15`, border: `1px solid ${statusColor}30`,
                  padding: '1px 5px', borderRadius: 3 }}>
                  {statusLabel}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="text"
                  value={equipInputs[e.id] ?? ''}
                  onChange={ev => setEquipInputs(p => ({ ...p, [e.id]: ev.target.value }))}
                  onBlur={ev => saveEquipDevice(e.id, ev.target.value)}
                  onKeyDown={ev => ev.key === 'Enter' && saveEquipDevice(e.id, ev.target.value)}
                  placeholder={t('gpsDeviceIdPlaceholder')}
                  style={{
                    flex: 1, background: '#0d1b2a', border: `1px solid ${isActive ? '#22c55e55' : '#1e3a5f'}`,
                    borderRadius: 3, color: '#c8d8e8', fontSize: 9, padding: '3px 6px', outline: 'none',
                  }}
                />
                {e.gpsDeviceId && gpsMode && (
                  <button
                    onClick={() => dispatch({ type: 'UPDATE_EQUIPMENT', id: e.id,
                      updates: { mode: e.mode === 'gps' ? 'auto' : 'gps' } })}
                    style={{
                      background: e.mode === 'gps' ? '#22c55e22' : '#1e3a5f',
                      border: `1px solid ${e.mode === 'gps' ? '#22c55e55' : '#253347'}`,
                      borderRadius: 3, color: e.mode === 'gps' ? '#22c55e' : '#4b6a8a',
                      fontSize: 8, padding: '0 6px', cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    {e.mode === 'gps' ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* 작업자 목록 */}
        <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, margin: '10px 0 5px',
          textTransform: 'uppercase', letterSpacing: '0.07em', borderTop: '1px solid #0d2040', paddingTop: 8 }}>
          {t('gpsWorkerSection')}
        </div>
        {workers.map(w => {
          const isActive = w.gpsDeviceId && w.gpsPos && gpsMode;
          const statusColor = isActive ? '#22c55e' : w.gpsDeviceId ? '#60a5fa' : '#374151';
          const statusLabel = isActive ? t('gpsStatusActive') : w.gpsDeviceId ? t('gpsStatusLinked') : t('gpsStatusNone');
          return (
            <div key={w.id} style={{ marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: '#8896a4', fontWeight: 600 }}>{w.name}</span>
                <span style={{ fontSize: 7, color: statusColor,
                  background: `${statusColor}15`, border: `1px solid ${statusColor}30`,
                  padding: '1px 5px', borderRadius: 3 }}>
                  {statusLabel}
                </span>
              </div>
              <input
                type="text"
                value={workerInputs[w.id] ?? ''}
                onChange={ev => setWorkerInputs(p => ({ ...p, [w.id]: ev.target.value }))}
                onBlur={ev => saveWorkerDevice(w.id, ev.target.value)}
                onKeyDown={ev => ev.key === 'Enter' && saveWorkerDevice(w.id, ev.target.value)}
                placeholder={t('gpsDeviceIdPlaceholder')}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0d1b2a', border: `1px solid ${isActive ? '#22c55e55' : '#1e3a5f'}`,
                  borderRadius: 3, color: '#c8d8e8', fontSize: 9, padding: '3px 6px', outline: 'none',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const EQUIP_ICON = { excavator: '🚜', dump: '🚛', crane: '🏗', vehicle: '🚗', other: '🔧' };
const EQUIP_TYPE_KEY = {
  excavator: 'equipExcavator', dump: 'equipDump', crane: 'equipCrane',
  vehicle:   'equipVehicle',   other: 'equipOther',
};

// ── 현장 카메라 관리 패널 ─────────────────────────────────────────
const EMPTY_CAM = { name: '', url: '', worldX: '0', worldY: '6', worldZ: '0', yaw: '0', fovH: '90' };

function CameraSection({ cameras, projectId, referencePoint, dispatch }) {
  const t = useT('integrationProject');
  const [form,    setForm]    = useState(EMPTY_CAM);
  const [editing, setEditing] = useState(null);  // cameraId being edited
  const [originForm, setOriginForm] = useState({ lat: '', lng: '' });
  const [originSaved, setOriginSaved] = useState(false);

  useEffect(() => {
    if (referencePoint) {
      setOriginForm({ lat: referencePoint.lat.toFixed(6), lng: referencePoint.lng.toFixed(6) });
    }
  }, [referencePoint]);

  const handleSaveOrigin = async () => {
    if (!projectId) return;
    const lat = parseFloat(originForm.lat);
    const lng = parseFloat(originForm.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    await AxiosCustom.put(`/api/integration/project/${projectId}/site-origin`, { refLat: lat, refLng: lng }).catch(() => {});
    dispatch({ type: 'SET_SITE_ORIGIN', lat, lng });
    setOriginSaved(true);
    setTimeout(() => setOriginSaved(false), 1500);
  };

  const handleAdd = async () => {
    if (!projectId || !form.name.trim() || !form.url.trim()) return;
    const body = {
      name: form.name.trim(), url: form.url.trim(),
      worldX: parseFloat(form.worldX) || 0, worldY: parseFloat(form.worldY) || 6,
      worldZ: parseFloat(form.worldZ) || 0, yaw: parseFloat(form.yaw) || 0,
      fovH: parseFloat(form.fovH) || 90, active: true,
    };
    const res = await AxiosCustom.post(`/api/integration/project/${projectId}/cameras`, body).catch(() => null);
    if (res?.data) {
      dispatch({ type: 'ADD_CAMERA', camera: res.data });
      setForm(EMPTY_CAM);
    }
  };

  const handleDelete = async (cameraId) => {
    if (!projectId) return;
    await AxiosCustom.delete(`/api/integration/project/${projectId}/cameras/${cameraId}`).catch(() => {});
    dispatch({ type: 'REMOVE_CAMERA', cameraId });
  };

  const handleToggle = async (cam) => {
    if (!projectId) return;
    const updated = { ...cam, active: !cam.active };
    await AxiosCustom.put(`/api/integration/project/${projectId}/cameras/${cam.cameraId}`, updated).catch(() => {});
    dispatch({ type: 'UPDATE_CAMERA', cameraId: cam.cameraId, updates: { active: updated.active } });
  };

  const inputStyle = {
    width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
    borderRadius: 4, color: '#d1d5db', fontSize: 10,
    padding: '3px 6px', boxSizing: 'border-box', outline: 'none',
  };

  return (
    <div style={{ marginBottom: 0 }}>

      {/* 현장 원점 (GPS 기준점) */}
      <div style={{ background: '#071018', border: '1px solid #1e3a5f', borderRadius: 5,
        padding: '6px 8px', marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#4b5563', fontWeight: 700, marginBottom: 4 }}>
          {t('cameraOriginTitle')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 5 }}>
          {[[t('cameraOriginLat'), 'lat'], [t('cameraOriginLng'), 'lng']].map(([lbl, key]) => (
            <div key={key}>
              <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 2 }}>{lbl}</div>
              <input type="number" step="0.000001" value={originForm[key]}
                onChange={e => setOriginForm(f => ({ ...f, [key]: e.target.value }))}
                style={inputStyle} />
            </div>
          ))}
        </div>
        <button onClick={handleSaveOrigin} style={{
          width: '100%', background: originSaved ? '#0a2a0a' : '#1e3a5f',
          border: `1px solid ${originSaved ? '#4ade80' : '#3b82f6'}`,
          borderRadius: 4, padding: '4px 0', fontSize: 9, fontWeight: 700,
          color: originSaved ? '#4ade80' : '#93c5fd', cursor: 'pointer',
        }}>
          {originSaved ? t('cameraOriginSaved') : t('cameraOriginSave')}
        </button>
      </div>

      {/* 등록된 카메라 목록 */}
      {cameras?.map(cam => (
        <div key={cam.cameraId} style={{
          background: '#071018', border: `1px solid ${cam.active ? '#1e3a5f' : '#1e293b'}`,
          borderRadius: 5, padding: '6px 8px', marginBottom: 4,
          opacity: cam.active ? 1 : 0.55,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 9, color: cam.active ? '#60a5fa' : '#4b5563', flex: 1, fontWeight: 700 }}>
              {cam.active ? '🟢' : '⚫'} {cam.name}
            </span>
            <button onClick={() => handleToggle(cam)} style={{
              background: 'none', border: '1px solid #253347', borderRadius: 3,
              padding: '1px 5px', color: '#6b7280', fontSize: 8, cursor: 'pointer',
            }}>
              {cam.active ? t('cameraOff') : t('cameraOn')}
            </button>
            <button onClick={() => handleDelete(cam.cameraId)} style={{
              background: 'none', border: '1px solid #374151', borderRadius: 3,
              padding: '1px 5px', color: '#6b7280', fontSize: 8, cursor: 'pointer',
            }}>{t('cameraDeleteBtn')}</button>
          </div>
          <div style={{ fontSize: 8, color: '#374151', wordBreak: 'break-all' }}>{cam.url}</div>
          <div style={{ fontSize: 8, color: '#253347', marginTop: 2 }}>
            X:{cam.worldX?.toFixed(1)} Y:{cam.worldY?.toFixed(1)} Z:{cam.worldZ?.toFixed(1)}
            &nbsp;| Yaw:{cam.yaw?.toFixed(0)}° FOV:{cam.fovH?.toFixed(0)}°
          </div>
        </div>
      ))}

      {/* 카메라 추가 폼 */}
      <div style={{ background: '#071018', border: '1px solid #1a2a3a', borderRadius: 5, padding: '6px 8px' }}>
        <div style={{ fontSize: 9, color: '#374151', fontWeight: 700, marginBottom: 5 }}>{t('cameraAddTitle')}</div>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 2 }}>{t('cameraNameLabel')}</div>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder={t('cameraNamePlaceholder')} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 2 }}>{t('cameraUrlLabel')}</div>
          <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
            placeholder={t('cameraUrlPlaceholder')} style={inputStyle} />
        </div>
        <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 3 }}>{t('cameraCoordLabel')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 4 }}>
          {[['X', 'worldX'], ['Y(H)', 'worldY'], ['Z', 'worldZ']].map(([lbl, key]) => (
            <div key={key}>
              <div style={{ fontSize: 8, color: '#374151', marginBottom: 2, textAlign: 'center' }}>{lbl}</div>
              <input type="number" step="0.1" value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                style={{ ...inputStyle, textAlign: 'center' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
          {[[t('cameraYawLabel'), 'yaw'], [t('cameraFovLabel'), 'fovH']].map(([lbl, key]) => (
            <div key={key}>
              <div style={{ fontSize: 8, color: '#374151', marginBottom: 2 }}>{lbl}</div>
              <input type="number" step="1" value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                style={inputStyle} />
            </div>
          ))}
        </div>
        <button onClick={handleAdd} disabled={!form.name.trim() || !form.url.trim()}
          style={{
            width: '100%', background: '#1e3a5f', border: '1px solid #3b82f6',
            borderRadius: 4, padding: '5px 0', fontSize: 10, fontWeight: 700,
            color: '#60a5fa', cursor: 'pointer', opacity: (!form.name.trim() || !form.url.trim()) ? 0.4 : 1,
          }}>
          {t('cameraRegBtn')}
        </button>
      </div>
    </div>
  );
}

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────
function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 9, fontWeight: 700, color: '#374151', letterSpacing: '0.1em',
          textTransform: 'uppercase', padding: '3px 0', borderBottom: '1px solid #111e2d',
          marginBottom: open ? 8 : 0, cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 8, color: '#253347', marginLeft: 4 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && children}
    </div>
  );
}

function Btn({ onClick, children, color, textColor = '#93c5fd', small, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: color || '#1e3a5f', color: textColor, border: 'none',
      borderRadius: 5, padding: small ? '5px 10px' : '7px 12px',
      fontSize: small ? 10 : 11, cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: 600, opacity: disabled ? 0.5 : 1,
      minHeight: 32, touchAction: 'manipulation',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </button>
  );
}

function Row({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>{children}</div>;
}

// ── BIM 프로젝트 재배정 드롭다운 ──────────────────────────────────
function ReassignRow({ structures, currentStructId, onAssign }) {
  const t = useT('integrationProject');
  const [sel, setSel] = useState(currentStructId || '');
  const bimList = structures.filter(s => s.type === 'bim' && s.visible !== false);
  if (!bimList.length) return (
    <div style={{ fontSize: 8, color: '#374151' }}>{t('reassignNoBim')}</div>
  );
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
      <span style={{ fontSize: 8, color: '#4b6a8a', fontWeight: 700, flexShrink: 0 }}>🔄</span>
      <select
        value={sel}
        onChange={e => setSel(e.target.value)}
        style={{
          flex: 1, background: '#0d1b2a', border: '1px solid #1e3a5f',
          borderRadius: 3, color: '#d1d5db', fontSize: 8, padding: '2px 3px', outline: 'none',
        }}
      >
        <option value="">{t('reassignSelect')}</option>
        {bimList.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <button
        onClick={() => sel && onAssign(sel)}
        disabled={!sel}
        style={{
          background: sel ? '#0c2233' : '#060a0f',
          border: `1px solid ${sel ? '#38bdf8' : '#1e3a5f'}`,
          borderRadius: 3, color: sel ? '#38bdf8' : '#374151',
          fontSize: 8, padding: '2px 7px', cursor: sel ? 'pointer' : 'default', fontWeight: 700,
        }}
      >{t('reassignBtn')}</button>
    </div>
  );
}

// ── WBS 태스크 배정 패널 ──────────────────────────────────────────────
function WbsTaskAssignPanel({ entityId, equipType, assignedWbsTaskId, wbsTasks, dispatch, t }) {
  const bimTasks = wbsTasks.filter(tk => /^BIM:[^:]+:[^:]+/.test(tk.notes || ''));

  // 장비 타입별 호환 태스크 필터 (작업자는 모두 표시)
  const availableTasks = equipType
    ? bimTasks.filter(tk => {
        const elemType = tk.notes.split(':')[2];
        const rule = TASK_RULES[elemType];
        if (!rule) return true;
        return rule.blockers.some(b => b.type === equipType) ||
               rule.equipBonus.some(b => b.type === equipType);
      })
    : bimTasks;

  const currentTask = wbsTasks.find(tk => tk.taskId === assignedWbsTaskId);
  const [selId, setSelId] = useState(assignedWbsTaskId || '');

  // 외부에서 assignedWbsTaskId가 바뀌면 동기화
  useEffect(() => { setSelId(assignedWbsTaskId || ''); }, [assignedWbsTaskId]);

  const apply = () => {
    if (selId !== (assignedWbsTaskId || ''))
      dispatch({ type: 'ASSIGN_WBS_TASK', entityId, taskId: selId || null });
  };
  const clear = () => {
    setSelId('');
    dispatch({ type: 'ASSIGN_WBS_TASK', entityId, taskId: null });
  };

  return (
    <div style={{
      marginTop: 6, padding: '7px 8px',
      background: '#06101c', border: '1px solid #0d2040', borderRadius: 5,
    }}>
      <div style={{ fontSize: 8, color: '#4b6a8a', fontWeight: 700, marginBottom: 5,
        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {t('wbsAssignTitle')}
      </div>

      {/* 현재 배정 */}
      {currentTask ? (
        <div style={{
          fontSize: 8, marginBottom: 5, padding: '3px 6px',
          background: '#0a2a0a', border: '1px solid #22c55e30',
          borderRadius: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ color: '#22c55e', fontWeight: 600 }}>
            {t('wbsAssignWorking')}: {currentTask.taskName || currentTask.notes?.split(':')[2]}
          </span>
          <span style={{ color: '#4ade80', fontWeight: 700, fontSize: 9 }}>
            {Math.round((currentTask.progress || 0) * 10) / 10}%
          </span>
        </div>
      ) : (
        <div style={{ fontSize: 8, color: '#374151', marginBottom: 5 }}>{t('wbsAssignNone')}</div>
      )}

      {availableTasks.length === 0 ? (
        <div style={{ fontSize: 8, color: '#253347' }}>{t('wbsNoTasks')}</div>
      ) : (
        <>
          <select
            value={selId}
            onChange={e => setSelId(e.target.value)}
            style={{
              width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
              borderRadius: 3, color: '#c8d8e8', fontSize: 9, padding: '4px 6px',
              marginBottom: 5, outline: 'none', cursor: 'pointer',
            }}
          >
            <option value="">{t('wbsAssignSelect')}</option>
            {availableTasks.map(tk => {
              const elemType = tk.notes?.split(':')[2] || '';
              const pct = Math.round((tk.progress || 0) * 10) / 10;
              return (
                <option key={tk.taskId} value={tk.taskId}>
                  {tk.taskName || elemType}  ({pct}%)
                </option>
              );
            })}
          </select>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={apply}
              disabled={!selId || selId === (assignedWbsTaskId || '')}
              style={{
                flex: 1, borderRadius: 3, fontSize: 8, padding: '4px 0', cursor: 'pointer',
                background: (selId && selId !== (assignedWbsTaskId || '')) ? '#0f2200' : '#0a1010',
                border: `1px solid ${(selId && selId !== (assignedWbsTaskId || '')) ? '#22c55e55' : '#1e3a5f'}`,
                color: (selId && selId !== (assignedWbsTaskId || '')) ? '#4ade80' : '#374151',
              }}
            >
              {t('wbsAssignApply')}
            </button>
            {assignedWbsTaskId && (
              <button
                onClick={clear}
                style={{
                  borderRadius: 3, fontSize: 8, padding: '4px 10px', cursor: 'pointer',
                  background: '#1a0808', border: '1px solid #55111130', color: '#f87171',
                }}
              >
                {t('wbsAssignClear')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── 배정 현황 + 재배정 패널 ────────────────────────────────────────
function WorkAssignmentPanel({ assignedStructId, assignedBimProjectId, structures, wbsTasks, workableTypes, onReassign }) {
  const t = useT('integrationProject');
  const assignedStruct = structures.find(s => s.id === assignedStructId);
  const projTasks = assignedBimProjectId
    ? wbsTasks.filter(tk => !tk.notes?.match(/^BIM:[^:]+:/) || tk.notes.startsWith(`BIM:${assignedBimProjectId}:`))
    : [];

  return (
    <div style={{
      background: '#060f18', border: '1px solid #1e3a5f',
      borderRadius: 5, padding: '7px 9px', marginTop: 4, marginBottom: 4,
    }}>
      <div style={{ fontSize: 8, color: '#4b6a8a', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {t('assignPanelTitle')}
      </div>

      {assignedStruct ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 3 }}>
            🏗 {assignedStruct.name}
          </div>
          {workableTypes?.length > 0 && (
            <div style={{ fontSize: 8, color: '#6b7280', marginBottom: 4 }}>
              {t('assignTypes')} <span style={{ color: '#a78bfa' }}>{workableTypes.slice(0, 3).join(' · ')}</span>
            </div>
          )}
          {projTasks.length === 0 ? (
            <div style={{ fontSize: 8, color: '#374151' }}>{t('assignNoTasksLinked')}</div>
          ) : (
            projTasks.slice(0, 4).map(tk => {
              const p = Math.round((tk.progress || 0) * 10) / 10;
              const col = p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#374151';
              return (
                <div key={tk.taskId} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
                    <span style={{ color: '#9ca3af', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.taskName}</span>
                    <span style={{ color: col, fontWeight: 700, flexShrink: 0 }}>{p.toFixed(1)}%</span>
                  </div>
                  <div style={{ background: '#0a1525', borderRadius: 2, height: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${p}%`, background: col, borderRadius: 2, transition: 'width 0.5s' }} />
                  </div>
                </div>
              );
            })
          )}
          {projTasks.length > 4 && (
            <div style={{ fontSize: 7, color: '#374151' }}>{t('assignMoreTasks', { n: projTasks.length - 4 })}</div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#374151', marginBottom: 6 }}>
          {t('assignUnassigned')}
        </div>
      )}

      <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: 6, marginTop: 2 }}>
        <div style={{ fontSize: 8, color: '#4b6a8a', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>{t('assignReassign')}</div>
        <ReassignRow
          structures={structures}
          currentStructId={assignedStructId}
          onAssign={onReassign}
        />
      </div>
    </div>
  );
}

// ── 메인 사이드바 ─────────────────────────────────────────────────
export default function ControlSidebar() {
  const t = useT('integrationProject');
  const {
    workers, equipment, dangerZones, simulationRunning,
    referencePoint, isLoading, projectMeta,
    structures, terrain, selectedEquipId, selectedWorkerId, selectedZoneId,
    surveyOrigin, wbsTasks, cameras, gpsMode,
  } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const [showAddStructure, setShowAddStructure] = useState(false);
  const [expandedStructId, setExpandedStructId] = useState(null);
  const [selectedBimStructId, setSelectedBimStructId] = useState(null);
  const [showGpsPanel, setShowGpsPanel] = useState(false);
  const terrainInputRef = useRef(null);

  // 측량 기준점 폼
  const [surveyForm, setSurveyForm] = useState({ label: '', x: '0', y: '0', z: '0' });
  const [surveyApplied, setSurveyApplied] = useState(false);
  useEffect(() => {
    if (surveyOrigin) {
      setSurveyForm({
        label: surveyOrigin.label || '',
        x: surveyOrigin.x.toString(),
        y: surveyOrigin.y.toString(),
        z: surveyOrigin.z.toString(),
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const letters = 'ABCDEFGHIJKLMN';

  const handleAddWorker = () => {
    const n = workers.length + 1;
    dispatch({
      type: 'ADD_WORKER',
      worker: {
        id: `w_${Date.now()}`,
        name: t('workerDefault', { letter: letters[(n - 1) % letters.length] }),
        initialPos: [(Math.random() - 0.5) * 24, 0, (Math.random() - 0.5) * 24],
        gear: Math.random() > 0.2,
        gpsDeviceId: null,
        gpsPos: null,
        assignedWbsTaskId: null,
      },
    });
  };

  const handleAddZone = () => {
    dispatch({
      type: 'ADD_ZONE',
      zone: {
        id: `z_${Date.now()}`,
        name: t('zoneName', { n: dangerZones.length + 1 }),
        center: [(Math.random() - 0.5) * 20, 2, (Math.random() - 0.5) * 20],
        halfSize: [3 + Math.random() * 2, 4, 3 + Math.random() * 2],
        type: 'excavation',
        active: true,
      },
    });
  };

  const handleTerrainFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const { dataUrl, w, h } = await resizeImageDataUrl(e.target.result, 1024, 0.8);
      const aspect = h / w;
      dispatch({ type: 'SET_TERRAIN', terrain: { imageDataUrl: dataUrl, width: 80, height: Math.round(80 * aspect) } });
    };
    reader.readAsDataURL(file);
  };

  // 자동 작업 — BIM 프로젝트별로 장비/인원 분배
  const handleBimPatrol = () => {
    const bimStructures = structures.filter(s => s.type === 'bim' && s.visible && s.elements?.length);

    if (!bimStructures.length) {
      // BIM 없음 → 기존 랜덤 자동 작업
      dispatch({ type: 'AUTO_SIM_START' });
      if (!simulationRunning) dispatch({ type: 'TOGGLE_SIM' });
      return;
    }

    const projCount = bimStructures.length;

    // 장비를 BIM 프로젝트 수로 round-robin 배정
    equipment.forEach((e, eIdx) => {
      const proj = bimStructures[eIdx % projCount];
      const offset = proj.offset || [0, 0, 0];
      const cx = offset[0], cz = offset[2];

      // 배정된 프로젝트에서 이 장비 타입이 작업 가능한 위치 수집
      const seen = new Set();
      const pts = [];
      proj.elements.forEach(el => {
        if (seen.has(el.elementType)) return;
        const rule = TASK_RULES[el.elementType];
        if (!rule) return;
        const canWork = rule.blockers.some(b => b.type === e.type) ||
                        rule.equipBonus.some(b => b.type === e.type);
        if (!canWork) return;
        seen.add(el.elementType);
        pts.push([
          (Number(el.positionX) || 0) + offset[0],
          0,
          (Number(el.positionZ) || 0) + offset[2],
        ]);
      });

      // 해당 공종 없으면 프로젝트 중심 순환
      if (!pts.length) {
        const r = 4 + Math.random() * 2;
        pts.push(
          [cx - r, 0, cz - r], [cx + r, 0, cz - r],
          [cx + r, 0, cz + r], [cx - r, 0, cz + r],
        );
      }

      const route = pts.slice(0, 6).flatMap(pt => [
        pt,
        [pt[0] + (Math.random() - 0.5) * 2.5, 0, pt[2] + (Math.random() - 0.5) * 2.5],
      ]);

      dispatch({ type: 'UPDATE_EQUIPMENT', id: e.id, updates: {
        mode: 'auto', route, speed: 1.5,
        assignedBimProjectId: proj.bimProjectId,
        assignedStructId: proj.id,
      }});
    });

    // 작업자도 프로젝트별 배정
    workers.forEach((w, wIdx) => {
      const proj = bimStructures[wIdx % projCount];
      dispatch({ type: 'UPDATE_WORKER', id: w.id, updates: {
        assignedStructId: proj.id,
        assignedBimProjectId: proj.bimProjectId,
      }});
    });

    if (!simulationRunning) dispatch({ type: 'TOGGLE_SIM' });
  };

  // 장비 개별 재배정 — 선택한 BIM 프로젝트로 경로 재생성
  const handleReassignEquipment = (equip, structId) => {
    const proj = structures.find(s => s.id === structId);
    if (!proj?.elements?.length) return;
    const offset = proj.offset || [0, 0, 0];
    const seen = new Set();
    const pts = [];
    proj.elements.forEach(el => {
      if (seen.has(el.elementType)) return;
      const rule = TASK_RULES[el.elementType];
      if (!rule) return;
      const canWork = rule.blockers.some(b => b.type === equip.type) ||
                      rule.equipBonus.some(b => b.type === equip.type);
      if (!canWork) return;
      seen.add(el.elementType);
      pts.push([
        (Number(el.positionX) || 0) + offset[0], 0,
        (Number(el.positionZ) || 0) + offset[2],
      ]);
    });
    if (!pts.length) {
      const cx = offset[0], cz = offset[2], r = 4 + Math.random() * 2;
      pts.push([cx-r,0,cz-r],[cx+r,0,cz-r],[cx+r,0,cz+r],[cx-r,0,cz+r]);
    }
    const route = pts.slice(0, 6).flatMap(pt => [
      pt, [pt[0]+(Math.random()-0.5)*2.5, 0, pt[2]+(Math.random()-0.5)*2.5],
    ]);
    dispatch({ type: 'UPDATE_EQUIPMENT', id: equip.id, updates: {
      mode: 'auto', route, speed: 1.5,
      assignedBimProjectId: proj.bimProjectId,
      assignedStructId: proj.id,
    }});
    if (!simulationRunning) dispatch({ type: 'TOGGLE_SIM' });
  };

  return (
    <div style={{
      width: '100%', minWidth: 0, flexShrink: 0, background: '#0a1525',
      borderRight: '1px solid #111e2d', overflowY: 'auto', padding: '14px 12px',
      boxSizing: 'border-box', height: '100%',
    }}>

      <div style={{ fontSize: 12, fontWeight: 800, color: '#60a5fa', marginBottom: 16, letterSpacing: 0.5 }}>
        {t('sidebarTitle')}
      </div>

      {/* 연결 현황 */}
      <Section title={t('sectionLinks')}>
        {isLoading && <div style={{ fontSize: 10, color: '#374151' }}>{t('loading')}</div>}
        <Row>
          <span style={{ fontSize: 11 }}>📊</span>
          <span style={{ flex: 1, fontSize: 10, color: projectMeta?.wbsProjectId ? '#a78bfa' : '#374151', fontWeight: 600 }}>WBS</span>
          <span style={{ fontSize: 9, color: projectMeta?.wbsProjectId ? '#6d5f9a' : '#253347' }}>
            {projectMeta?.wbsProjectId ? t('connected') : t('notConnected')}
          </span>
        </Row>
      </Section>

      {/* BIM/WBS 현황 — WBS 태스크가 있을 때만 표시 */}
      {(projectMeta?.wbsProjectId || projectMeta?.bimProjectId || wbsTasks.length > 0) && (
        <Section title={t('bimWbsSection')}>
          <BimFloorPanel wbsTasks={wbsTasks} structures={structures} workers={workers} equipment={equipment} t={t} />
        </Section>
      )}

      {/* 드론 지형 */}
      <Section title={t('sectionDroneTerrain')}>
        {terrain ? (
          <>
            {/* 가로/세로 크기 조절 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
              {[['W', 'width'], ['H', 'height']].map(([label, key]) => (
                <div key={key}>
                  <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 2 }}>{label} (m)</div>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={terrain[key]}
                    onChange={e => {
                      const val = parseFloat(e.target.value) || 1;
                      dispatch({ type: 'SET_TERRAIN', terrain: { ...terrain, [key]: val } });
                    }}
                    style={{
                      width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
                      borderRadius: 4, color: '#d1d5db', fontSize: 11,
                      padding: '3px 5px', boxSizing: 'border-box', outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              <Btn small onClick={() => terrainInputRef.current?.click()} color="#0c2233" textColor="#38bdf8">
                {t('terrainChange')}
              </Btn>
              <Btn small onClick={() => dispatch({ type: 'CLEAR_TERRAIN' })} color="#1a0a0a" textColor="#ef4444">
                {t('terrainDelete')}
              </Btn>
            </div>
          </>
        ) : (
          <Btn small onClick={() => terrainInputRef.current?.click()} color="#0c2233" textColor="#38bdf8">
            {t('terrainUpload')}
          </Btn>
        )}
        <input
          ref={terrainInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={e => handleTerrainFile(e.target.files[0])}
        />
      </Section>

      {/* 구조물 */}
      <Section title={t('sectionStructures', { n: structures.length })}>
        {/* 선택된 BIM 구조물: 좌표 + 작업계획 패널 */}
        {selectedBimStructId && (() => {
          const sel = structures.find(s => s.id === selectedBimStructId);
          if (!sel) return null;
          const off = sel.offset || [0, 0, 0];
          return (
            <>
              {/* BIM 프로젝트 영역 좌표 */}
              {(() => {
                const b = computeStructureBounds(sel);
                const ox = surveyOrigin?.x || 0, oz = surveyOrigin?.z || 0;
                const minX = b.minX + ox, maxX = b.maxX + ox;
                const minZ = b.minZ + oz, maxZ = b.maxZ + oz;
                const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
                return (
                  <div style={{
                    background: '#060f18', border: '1px solid #1e3a5f',
                    borderRadius: 5, padding: '6px 9px', marginBottom: 6,
                  }}>
                    <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {t('bimAreaTitle')} {surveyOrigin ? t('bimAreaSurvey') : ''}
                    </div>
                    {/* X 범위 */}
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>X</span>
                        <span style={{ fontSize: 9, color: '#d1d5db', fontWeight: 600 }}>{minX.toFixed(2)} ~ {maxX.toFixed(2)}</span>
                        <span style={{ fontSize: 8, color: '#4b5563' }}>{t('bimAreaWidth', { w: w.toFixed(1) })}</span>
                      </div>
                      <div style={{ height: 2, background: '#111e2d', borderRadius: 1 }}>
                        <div style={{ height: '100%', width: '100%', background: '#ef444488', borderRadius: 1 }} />
                      </div>
                    </div>
                    {/* Z 범위 */}
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: '#3b82f6', fontWeight: 700 }}>Z</span>
                        <span style={{ fontSize: 9, color: '#d1d5db', fontWeight: 600 }}>{minZ.toFixed(2)} ~ {maxZ.toFixed(2)}</span>
                        <span style={{ fontSize: 8, color: '#4b5563' }}>{t('bimAreaDepth', { d: d.toFixed(1) })}</span>
                      </div>
                      <div style={{ height: 2, background: '#111e2d', borderRadius: 1 }}>
                        <div style={{ height: '100%', width: '100%', background: '#3b82f688', borderRadius: 1 }} />
                      </div>
                    </div>
                    {/* 오프셋 기준점 */}
                    <div style={{ fontSize: 8, color: '#253347', borderTop: '1px solid #111e2d', paddingTop: 4 }}>
                      {t('bimAreaOffset')} X:{off[0].toFixed(1)} Y:{off[1].toFixed(1)} Z:{off[2].toFixed(1)}
                    </div>
                  </div>
                );
              })()}
              <BimWorkPlanPanel structure={sel} />
            </>
          );
        })()}

        {structures.length === 0 && (
          <div style={{ fontSize: 10, color: '#374151', marginBottom: 6, whiteSpace: 'pre-line' }}>
            {t('structHint')}
          </div>
        )}
        {structures.map(s => {
          const isExpanded = expandedStructId === s.id;
          const isBimSelected = selectedBimStructId === s.id;
          const offset = s.offset || [0, 0, 0];
          return (
            <div key={s.id} style={{ marginBottom: 5 }}>
              <Row>
                {/* BIM 구조물은 아이콘+이름 클릭으로 작업계획 패널 토글 */}
                <span
                  style={{ fontSize: 11, cursor: s.type === 'bim' ? 'pointer' : 'default' }}
                  onClick={() => s.type === 'bim' && setSelectedBimStructId(isBimSelected ? null : s.id)}
                >
                  {s.type === 'bim' ? '🏗' : '📂'}
                </span>
                <span
                  onClick={() => s.type === 'bim' && setSelectedBimStructId(isBimSelected ? null : s.id)}
                  style={{
                    flex: 1, fontSize: 10,
                    color: isBimSelected ? '#60a5fa' : '#d1d5db',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    cursor: s.type === 'bim' ? 'pointer' : 'default',
                    fontWeight: isBimSelected ? 700 : 400,
                  }}
                >
                  {s.name}
                </span>
                <span style={{ fontSize: 9, color: s.elements?.length > 0 ? '#22c55e' : '#f59e0b', flexShrink: 0 }}>
                  {s.elements === null ? t('structLoading') : s.elements.length > 0 ? `${s.elements.length}ea` : t('structEmpty')}
                </span>
                <button
                  onClick={() => setExpandedStructId(isExpanded ? null : s.id)}
                  style={{
                    background: 'none', border: `1px solid ${isExpanded ? '#60a5fa' : '#1e3a5f'}`,
                    borderRadius: 3, cursor: 'pointer',
                    color: isExpanded ? '#60a5fa' : '#4b5563',
                    fontSize: 9, fontWeight: 700, padding: '0 4px', flexShrink: 0,
                  }}
                >XYZ</button>
                <button
                  onClick={() => dispatch({ type: 'TOGGLE_STRUCTURE', id: s.id })}
                  style={{
                    background: 'none', border: `1px solid ${s.visible !== false ? '#22c55e' : '#374151'}`,
                    borderRadius: 3, cursor: 'pointer',
                    color: s.visible !== false ? '#22c55e' : '#4b5563',
                    fontSize: 9, fontWeight: 700, padding: '0 4px', flexShrink: 0,
                  }}
                >
                  {s.visible !== false ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={async () => {
                    if (selectedBimStructId === s.id) setSelectedBimStructId(null);
                    // BIM 구조물 제거 시 연결된 project_link도 삭제 (재로드 시 재추가 방지)
                    if (s.type === 'bim' && s.bimProjectId && projectMeta?.wbsProjectId) {
                      try {
                        if (s.linkId) {
                          // linkId가 구조물에 저장되어 있으면 직접 삭제
                          await AxiosCustom.delete(`/api/project-link/${s.linkId}`);
                        } else {
                          // 폴백: rootMarker로 검색 후 삭제
                          const res = await AxiosCustom.get(
                            `/api/project-link/linked?type=BIM&id=${s.bimProjectId}`
                          );
                          const rootMarker = `BIM:${s.bimProjectId}:ROOT:${s.id}`;
                          const links = (res.data || []).filter(
                            l => String(l.wbsProjectId) === String(projectMeta.wbsProjectId)
                          );
                          const link = links.find(l => l.note === rootMarker) || links[0];
                          if (link) await AxiosCustom.delete(`/api/project-link/${link.linkId}`);
                        }
                      } catch { /* 링크 없거나 삭제 실패 — 무시 */ }
                    }
                    dispatch({ type: 'REMOVE_STRUCTURE', id: s.id });
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0, flexShrink: 0 }}
                >✕</button>
              </Row>
              {isExpanded && (
                <div style={{ paddingLeft: 4, marginBottom: 4 }}>
                  {/* BIM 요소 정보 */}
                  {s.type === 'bim' && (
                    <div style={{ marginBottom: 8, background: '#060f18', borderRadius: 5, border: '1px solid #1e3a5f', padding: '6px 8px' }}>
                      {s.elements === null ? (
                        <div style={{ fontSize: 9, color: '#4b5563' }}>{t('structLoading')}</div>
                      ) : s.elements.length === 0 ? (
                        <div style={{ fontSize: 9, color: '#f59e0b' }}>{t('structEmpty')}</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                            {t('bimElementsLabel', { n: s.elements.length })}
                          </div>
                          {Object.entries(
                            s.elements.reduce((acc, el) => {
                              const type = el.elementType || 'Other';
                              acc[type] = (acc[type] || 0) + 1;
                              return acc;
                            }, {})
                          ).map(([type, count]) => (
                            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '1px 0' }}>
                              <span style={{ color: '#6b7280' }}>{type}</span>
                              <span style={{ color: '#22c55e', fontWeight: 700 }}>{count}ea</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  {/* 위치 오프셋 */}
                  <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 3 }}>{t('structPositionLabel')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                    {['X', 'Y', 'Z'].map((axis, i) => (
                      <div key={axis}>
                        <div style={{ fontSize: 9, color: '#4b5563', marginBottom: 2, textAlign: 'center' }}>{axis}</div>
                        <input
                          type="number"
                          step="0.5"
                          value={offset[i]}
                          onChange={e => {
                            const val = parseFloat(e.target.value) || 0;
                            const next = [...offset];
                            next[i] = val;
                            dispatch({ type: 'UPDATE_STRUCTURE_OFFSET', id: s.id, offset: next });
                          }}
                          style={{
                            width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
                            borderRadius: 4, color: '#d1d5db', fontSize: 11,
                            padding: '3px 5px', boxSizing: 'border-box', outline: 'none',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <Btn small onClick={() => setShowAddStructure(true)}>{t('addStructure')}</Btn>
      </Section>

      {/* 시뮬레이션 제어 */}
      <Section title={t('sectionSimulation')}>
        {/* 자동 작업 중 상태 표시 */}
        {equipment.some(e => e.mode === 'auto') && simulationRunning && (
          <AutoWorkBadge count={equipment.filter(e => e.mode === 'auto').length} />
        )}
        <Row>
          <Btn
            onClick={() => dispatch({ type: 'TOGGLE_SIM' })}
            color={simulationRunning ? '#1a3a1a' : '#1a1a3a'}
            textColor={simulationRunning ? '#22c55e' : '#a78bfa'}
          >
            {simulationRunning ? t('simPause') : t('simResume')}
          </Btn>
          <Btn
            onClick={handleBimPatrol}
            color={equipment.some(e => e.mode === 'auto') ? '#0f2200' : '#1a1200'}
            textColor={equipment.some(e => e.mode === 'auto') ? '#4ade80' : '#f97316'}
            title={t('simAutoDesc')}
          >
            {t('simAuto')}
          </Btn>
          <Btn
            onClick={() => setShowGpsPanel(v => !v)}
            color={gpsMode ? '#0e1a2e' : '#0f0f1a'}
            textColor={gpsMode ? '#a78bfa' : '#4b5563'}
            title={t('gpsPanelTitle')}
          >
            {gpsMode ? t('gpsBtn') : t('gpsBtn')}
          </Btn>
        </Row>
        <div style={{ fontSize: 9, color: '#374151', lineHeight: 1.5, marginTop: 2 }}>
          {t('simAutoDesc')}
        </div>
        <div style={{ fontSize: 9, color: '#253347', lineHeight: 1.5 }}>
          {t('refPoint', { lat: referencePoint.lat.toFixed(4), lng: referencePoint.lng.toFixed(4) })}
        </div>

        {/* GPS 설정 패널 */}
        {showGpsPanel && (
          <GpsSetupPanel
            gpsMode={gpsMode}
            equipment={equipment}
            workers={workers}
            dispatch={dispatch}
            t={t}
          />
        )}
      </Section>

      {/* 측량 기준점 */}
      <Section title={t('sectionSurveyOrigin')}>
        {surveyOrigin && (
          <div style={{
            background: '#12110a', border: '1px solid #facc1555', borderRadius: 5,
            padding: '5px 8px', marginBottom: 8, fontSize: 9,
          }}>
            <div style={{ color: '#facc15', fontWeight: 700, marginBottom: 2 }}>
              {t('surveyAppliedText', { label: surveyOrigin.label || t('surveyDefaultLabel') })}
            </div>
            <div style={{ color: '#a09060' }}>
              X:{surveyOrigin.x.toFixed(3)} Y:{surveyOrigin.y.toFixed(3)} Z:{surveyOrigin.z.toFixed(3)}
            </div>
          </div>
        )}

        {/* 이름 */}
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, marginBottom: 3 }}>{t('surveyNameLabel')}</div>
          <input
            type="text"
            value={surveyForm.label}
            onChange={e => setSurveyForm(f => ({ ...f, label: e.target.value }))}
            placeholder={t('surveyNamePlaceholder')}
            style={{
              width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
              borderRadius: 4, color: '#d1d5db', fontSize: 11,
              padding: '4px 7px', boxSizing: 'border-box', outline: 'none',
            }}
          />
        </div>

        {/* 원점의 측량 XYZ */}
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, marginBottom: 3 }}>
            {t('surveyCoordLabel')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            {[['X', 'x'], ['Y(H)', 'y'], ['Z', 'z']].map(([lbl, key]) => (
              <div key={key}>
                <div style={{ fontSize: 8, color: '#4b5563', marginBottom: 2, textAlign: 'center' }}>{lbl}</div>
                <input
                  type="number"
                  step="0.001"
                  value={surveyForm[key]}
                  onChange={e => setSurveyForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{
                    width: '100%', background: '#0d1b2a', border: '1px solid #1e3a5f',
                    borderRadius: 4, color: '#d1d5db', fontSize: 11,
                    padding: '4px 5px', boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={() => {
              const ox = parseFloat(surveyForm.x) || 0;
              const oy = parseFloat(surveyForm.y) || 0;
              const oz = parseFloat(surveyForm.z) || 0;
              dispatch({ type: 'SET_SURVEY_ORIGIN', origin: { label: surveyForm.label, x: ox, y: oy, z: oz } });
              setSurveyApplied(true);
              setTimeout(() => setSurveyApplied(false), 1200);
            }}
            style={{
              flex: 1,
              background: surveyApplied ? '#1a2a00' : '#1e3a5f',
              border: `1px solid ${surveyApplied ? '#facc15' : '#60a5fa'}`,
              borderRadius: 5, padding: '5px 0',
              color: surveyApplied ? '#facc15' : '#60a5fa',
              fontSize: 10, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {surveyApplied ? t('applied') : t('surveySetBtn')}
          </button>
          {surveyOrigin && (
            <button
              onClick={() => {
                dispatch({ type: 'SET_SURVEY_ORIGIN', origin: null });
                setSurveyForm({ label: '', x: '0', y: '0', z: '0' });
              }}
              style={{
                background: '#1a0a0a', border: '1px solid #374151', borderRadius: 5,
                padding: '5px 8px', color: '#6b7280', fontSize: 10, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {t('surveyReleaseBtn')}
            </button>
          )}
        </div>
      </Section>

      {/* 현장 카메라 */}
      <Section title={t('sectionCameras', { n: cameras?.length || 0 })} defaultOpen={false}>
        <CameraSection
          cameras={cameras}
          projectId={projectMeta?.projectId}
          referencePoint={referencePoint}
          dispatch={dispatch}
        />
      </Section>

      {/* 작업자 */}
      <Section title={t('sectionWorkers', { n: workers.length })}>
        {/* 선택된 작업자 설정 패널 */}
        <WorkerOptionsPanel />

        {workers.map(w => {
          const isSelected = w.id === selectedWorkerId;
          return (
            <React.Fragment key={w.id}>
            <div
              onClick={() => {
                dispatch({ type: 'SELECT_WORKER',    id: isSelected ? null : w.id });
                dispatch({ type: 'SELECT_EQUIPMENT', id: null });
                dispatch({ type: 'SELECT_ZONE',      id: null });
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                padding: '3px 5px', borderRadius: 4, cursor: 'pointer',
                background: isSelected ? '#0c2a1a' : 'transparent',
                border: `1px solid ${isSelected ? '#1e4a2a' : 'transparent'}`,
              }}
            >
              <span style={{ fontSize: 11 }}>👷</span>
              <span style={{ flex: 1, fontSize: 11, color: isSelected ? '#22c55e' : '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.name}
              </span>
              <span style={{ fontSize: 9, color: w.gear ? '#22c55e' : '#a855f7', fontWeight: 700, flexShrink: 0 }}>
                {w.gear ? 'O' : t('noGear')}
              </span>
              <button
                onClick={ev => { ev.stopPropagation(); dispatch({ type: 'REMOVE_WORKER', id: w.id }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0, flexShrink: 0 }}
              >✕</button>
            </div>
            {isSelected && (
              <>
                <WorkAssignmentPanel
                  assignedStructId={w.assignedStructId}
                  assignedBimProjectId={w.assignedBimProjectId}
                  structures={structures}
                  wbsTasks={wbsTasks}
                  workableTypes={null}
                  onReassign={structId => {
                    const proj = structures.find(s => s.id === structId);
                    if (proj) dispatch({ type: 'UPDATE_WORKER', id: w.id, updates: {
                      assignedStructId: structId,
                      assignedBimProjectId: proj.bimProjectId,
                    }});
                  }}
                />
                <WbsTaskAssignPanel
                  entityId={w.id}
                  equipType={null}
                  assignedWbsTaskId={w.assignedWbsTaskId}
                  wbsTasks={wbsTasks}
                  dispatch={dispatch}
                  t={t}
                />
              </>
            )}
            </React.Fragment>
          );
        })}
        <Btn small onClick={handleAddWorker}>{t('addWorker')}</Btn>
      </Section>

      {/* 장비 */}
      <Section title={t('sectionEquipment', { n: equipment.length })}>
        {/* 선택된 장비 옵션 패널 */}
        <EquipmentOptionsPanel />

        {equipment.map(e => {
          const isSelected = e.id === selectedEquipId;
          const modeColor  = e.mode === 'gps' ? '#a78bfa' : e.mode === 'standby' ? '#f59e0b' : '#22c55e';
          const modeLabel  = e.mode === 'gps' ? 'GPS' : e.mode === 'standby' ? t('equipIdle') : t('equipRunning');
          return (
            <React.Fragment key={e.id}>
            <div
              onClick={() => dispatch({ type: 'SELECT_EQUIPMENT', id: isSelected ? null : e.id })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                padding: '3px 5px', borderRadius: 4, cursor: 'pointer',
                background: isSelected ? '#0c2040' : 'transparent',
                border: `1px solid ${isSelected ? '#1e3a5f' : 'transparent'}`,
              }}
            >
              <span style={{ fontSize: 11 }}>{EQUIP_ICON[e.type] || '🔧'}</span>
              <span style={{
                fontSize: 8, color: '#4b6a8a', flexShrink: 0,
                background: '#0a1830', border: '1px solid #1e3a5f',
                borderRadius: 3, padding: '0 4px', lineHeight: '16px',
              }}>
                {t(EQUIP_TYPE_KEY[e.type] || 'equipOther')}
              </span>
              <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.name}
              </span>
              <span style={{ fontSize: 9, color: modeColor, fontWeight: 700, flexShrink: 0 }}>
                {modeLabel}
              </span>
              <button
                onClick={ev => { ev.stopPropagation(); dispatch({ type: 'REMOVE_EQUIPMENT', id: e.id }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0, flexShrink: 0 }}
              >✕</button>
            </div>
            {isSelected && (
              <>
                <WorkAssignmentPanel
                  assignedStructId={e.assignedStructId}
                  assignedBimProjectId={e.assignedBimProjectId}
                  structures={structures}
                  wbsTasks={wbsTasks}
                  workableTypes={
                    Object.entries(TASK_RULES)
                      .filter(([, rule]) =>
                        rule.blockers.some(b => b.type === e.type) ||
                        rule.equipBonus.some(b => b.type === e.type)
                      )
                      .map(([type]) => type)
                  }
                  onReassign={structId => handleReassignEquipment(e, structId)}
                />
                <WbsTaskAssignPanel
                  entityId={e.id}
                  equipType={e.type}
                  assignedWbsTaskId={e.assignedWbsTaskId}
                  wbsTasks={wbsTasks}
                  dispatch={dispatch}
                  t={t}
                />
              </>
            )}
            </React.Fragment>
          );
        })}
        <Btn small onClick={() => {
          const types = ['excavator', 'dump', 'crane'];
          const type  = types[equipment.length % types.length];
          const EQUIP_EN = { excavator: 'Excavator', dump: 'Dump', crane: 'Crane' };
          const defSizes = { excavator: [2.8,2.5,3.5], dump: [2.8,2.5,3.5], crane: [1.5,9.0,1.5] };
          const sameTypeCount = equipment.filter(e => e.type === type).length;
          dispatch({
            type: 'ADD_EQUIPMENT',
            equipment: {
              id:          `eq_${Date.now()}`,
              type,
              name:        `${EQUIP_EN[type] || type}-${sameTypeCount + 1}`,
              initialPos:  [(Math.random()-0.5)*20, 0, (Math.random()-0.5)*20],
              route:       [],
              speed:       1.0,
              mode:             'standby',
              size:             defSizes[type],
              gpsDeviceId:      null,
              gpsPos:           null,
              assignedWbsTaskId: null,
            },
          });
        }}>
          {t('addEquipment')}
        </Btn>
      </Section>

      {/* 위험구역 */}
      <Section title={t('sectionHazardZones', { n: dangerZones.length })}>
        {/* 선택된 위험구역 설정 패널 */}
        <ZoneOptionsPanel />

        {dangerZones.map(z => {
          const isSelected = z.id === selectedZoneId;
          const zoneColor = z.type === 'restricted' ? '#f97316' : z.type === 'dump_site' ? '#22d3ee' : '#ef4444';
          return (
            <div
              key={z.id}
              onClick={() => {
                dispatch({ type: 'SELECT_ZONE',      id: isSelected ? null : z.id });
                dispatch({ type: 'SELECT_WORKER',    id: null });
                dispatch({ type: 'SELECT_EQUIPMENT', id: null });
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                padding: '3px 5px', borderRadius: 4, cursor: 'pointer',
                background: isSelected ? `${zoneColor}15` : 'transparent',
                border: `1px solid ${isSelected ? `${zoneColor}55` : 'transparent'}`,
              }}
            >
              <span style={{ fontSize: 10, color: zoneColor }}>⚠</span>
              <span style={{ flex: 1, fontSize: 10, color: isSelected ? zoneColor : '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {z.name}
              </span>
              <button
                onClick={ev => { ev.stopPropagation(); dispatch({ type: 'TOGGLE_ZONE', id: z.id }); }}
                style={{
                  background: 'none', border: `1px solid ${z.active ? '#22c55e' : '#374151'}`,
                  borderRadius: 3, cursor: 'pointer', color: z.active ? '#22c55e' : '#4b5563',
                  fontSize: 9, fontWeight: 700, padding: '0 4px', flexShrink: 0,
                }}
              >{z.active ? 'ON' : 'OFF'}</button>
              <button
                onClick={ev => { ev.stopPropagation(); dispatch({ type: 'REMOVE_ZONE', id: z.id }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0, flexShrink: 0 }}
              >✕</button>
            </div>
          );
        })}
        <Btn small onClick={handleAddZone}>{t('addZone')}</Btn>
      </Section>

      {/* 작업자 상태 범례 */}
      <Section title={t('sectionWorkerLegend')}>
        {[
          [t('legendNormal'),    '#22c55e'],
          [t('legendHazard'),    '#f59e0b'],
          [t('legendCollision'), '#ef4444'],
          [t('legendNoGear'),    '#a855f7'],
        ].map(([l, c]) => (
          <Row key={l}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: c, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#8896a4' }}>{l}</span>
          </Row>
        ))}
      </Section>

      {/* 장비 유형 범례 */}
      <Section title={t('sectionEquipLegend')}>
        {[
          [t('equipExcavator'), '#f97316', '🚜'],
          [t('equipDump'),      '#3b82f6', '🚛'],
          [t('equipCrane'),     '#eab308', '🏗'],
        ].map(([l, c, ic]) => (
          <Row key={l}>
            <span style={{ fontSize: 11 }}>{ic}</span>
            <div style={{ width: 9, height: 9, borderRadius: 2, background: c, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#8896a4' }}>{l}</span>
          </Row>
        ))}
      </Section>

      {showAddStructure && <AddStructureModal onClose={() => setShowAddStructure(false)} />}
    </div>
  );
}
