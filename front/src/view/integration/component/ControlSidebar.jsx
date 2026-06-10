import React, { useRef, useState, useEffect } from 'react';
import { useIntegration, useIntegrationDispatch, computeStructureBounds } from '../IntegrationStore';
import AddStructureModal, { resizeImageDataUrl } from './AddStructureModal';
import EquipmentOptionsPanel from './EquipmentOptionsPanel';
import WorkerOptionsPanel from './WorkerOptionsPanel';
import ZoneOptionsPanel from './ZoneOptionsPanel';
import BimWorkPlanPanel from './BimWorkPlanPanel';
import { useT } from '../../../i18n/LanguageContext';
import { calcProgressRate, getRecommendations, TASK_RULES, EQUIP_LABEL } from '../progressEngine';
import AxiosCustom from '../../../axios/AxiosCustom';

// 자동 작업 중 표시 뱃지 (깜빡이는 점)
function AutoWorkBadge({ count }) {
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
        자동 작업 중 · 장비 {count}대 운영
      </span>
    </div>
  );
}

const STATUS_META = {
  NOT_STARTED: { label: '미착', color: '#94a3b8' },
  IN_PROGRESS:  { label: '진행', color: '#60a5fa' },
  COMPLETED:    { label: '완료', color: '#4ade80' },
  DELAYED:      { label: '지연', color: '#ef4444' },
};
const PROGRESS_COLOR = p =>
  p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#374151';

// BIM 공종 자동 규칙 디테일 패널
function TaskRuleDetail({ task, workers, equipment }) {
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
          {blocked ? '⛔ 블록' : `⚡ ×${rate.toFixed(2)}`}
        </span>
      </div>

      {/* 블로커 장비 상태 */}
      {rule.blockers.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            필수 장비
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
                  {ok ? `✓ ${have}대` : `✗ ${have}/${req.min}`}
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
            속도 보너스
          </div>
          {rule.equipBonus.map((b, i) => {
            const cnt = activeEquip.filter(e => e.type === b.type).length;
            const gain = cnt * b.perUnit;
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '1px 0' }}>
                <span style={{ color: '#6b7280' }}>{EQUIP_LABEL[b.type] || b.type} 1대당</span>
                <span style={{ color: gain > 0 ? '#4ade80' : '#4b5563' }}>
                  +{Math.round(b.perUnit * 100)}%
                  {cnt > 0 && <span style={{ color: '#22c55e' }}> ({cnt}대 적용 중)</span>}
                </span>
              </div>
            );
          })}
          {(rule.workerBonus || 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, padding: '1px 0' }}>
              <span style={{ color: '#6b7280' }}>작업자 1명당</span>
              <span style={{ color: workers.length > 0 ? '#4ade80' : '#4b5563' }}>
                +{Math.round(rule.workerBonus * 100)}%
                {workers.length > 0 && <span style={{ color: '#22c55e' }}> ({workers.length}명)</span>}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 추천사항 */}
      {recs.length > 0 && (
        <div>
          <div style={{ fontSize: 8, color: '#374151', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            추천
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
    ? Math.round(wbsTasks.reduce((s, tk) => s + (tk.progress || 0), 0) / total)
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
            <span style={{ fontSize: 10, color: overallColor, fontWeight: 800 }}>{overall}%</span>
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
              const p          = tk.progress || 0;
              const c          = PROGRESS_COLOR(p);
              const statusMeta = STATUS_META[tk.status] || {};
              const isBimTask  = typeof tk.notes === 'string' && /^BIM:[^:]+:[^:]+/.test(tk.notes);
              const isSelected = selectedTaskId === tk.taskId;

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
                        {statusMeta.label && (
                          <span style={{ fontSize: 8, color: statusMeta.color, fontWeight: 700 }}>
                            {statusMeta.label}
                          </span>
                        )}
                        <span style={{ fontSize: 9, color: c, fontWeight: 700 }}>{Math.round(p)}%</span>
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
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#60a5fa', marginBottom: 8,
        borderBottom: '1px solid #1e3a5f', paddingBottom: 4 }}>
        {t('sectionCameras').replace('{n}', cameras?.length || 0)}
      </div>

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
          {[['X', 'worldX'], ['Y(높이)', 'worldY'], ['Z', 'worldZ']].map(([lbl, key]) => (
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
function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 9, fontWeight: 700, color: '#374151', letterSpacing: '0.1em',
        textTransform: 'uppercase', padding: '3px 0', borderBottom: '1px solid #111e2d', marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
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
    }}>
      {children}
    </button>
  );
}

function Row({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>{children}</div>;
}

// ── BIM 프로젝트 재배정 드롭다운 ──────────────────────────────────
function ReassignRow({ structures, currentStructId, onAssign }) {
  const [sel, setSel] = useState(currentStructId || '');
  const bimList = structures.filter(s => s.type === 'bim' && s.visible !== false);
  if (!bimList.length) return (
    <div style={{ fontSize: 8, color: '#374151' }}>등록된 BIM 프로젝트 없음</div>
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
        <option value="">— 프로젝트 선택 —</option>
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
      >배정</button>
    </div>
  );
}

// ── 배정 현황 + 재배정 패널 ────────────────────────────────────────
function WorkAssignmentPanel({ assignedStructId, assignedBimProjectId, structures, wbsTasks, workableTypes, onReassign }) {
  const assignedStruct = structures.find(s => s.id === assignedStructId);
  const projTasks = assignedBimProjectId
    ? wbsTasks.filter(t => !t.notes?.match(/^BIM:[^:]+:/) || t.notes.startsWith(`BIM:${assignedBimProjectId}:`))
    : [];

  return (
    <div style={{
      background: '#060f18', border: '1px solid #1e3a5f',
      borderRadius: 5, padding: '7px 9px', marginTop: 4, marginBottom: 4,
    }}>
      <div style={{ fontSize: 8, color: '#4b6a8a', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        📌 배정 현황
      </div>

      {assignedStruct ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: '#60a5fa', fontWeight: 700, marginBottom: 3 }}>
            🏗 {assignedStruct.name}
          </div>
          {workableTypes?.length > 0 && (
            <div style={{ fontSize: 8, color: '#6b7280', marginBottom: 4 }}>
              담당 공종: <span style={{ color: '#a78bfa' }}>{workableTypes.slice(0, 3).join(' · ')}</span>
            </div>
          )}
          {projTasks.length === 0 ? (
            <div style={{ fontSize: 8, color: '#374151' }}>연결된 WBS 태스크 없음</div>
          ) : (
            projTasks.slice(0, 4).map(tk => {
              const p = Math.round(tk.progress || 0);
              const col = p >= 100 ? '#60a5fa' : p >= 75 ? '#22c55e' : p >= 40 ? '#eab308' : p > 0 ? '#f97316' : '#374151';
              return (
                <div key={tk.taskId} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
                    <span style={{ color: '#9ca3af', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.taskName}</span>
                    <span style={{ color: col, fontWeight: 700, flexShrink: 0 }}>{p}%</span>
                  </div>
                  <div style={{ background: '#0a1525', borderRadius: 2, height: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${p}%`, background: col, borderRadius: 2, transition: 'width 0.5s' }} />
                  </div>
                </div>
              );
            })
          )}
          {projTasks.length > 4 && (
            <div style={{ fontSize: 7, color: '#374151' }}>+{projTasks.length - 4}개 태스크 더 있음</div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: '#374151', marginBottom: 6 }}>
          미배정 — 자동 작업 시 자동 배정됩니다
        </div>
      )}

      <div style={{ borderTop: '1px solid #1e3a5f', paddingTop: 6, marginTop: 2 }}>
        <div style={{ fontSize: 8, color: '#4b6a8a', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>다른 프로젝트로 재배정</div>
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
    surveyOrigin, wbsTasks, cameras,
  } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const [showAddStructure, setShowAddStructure] = useState(false);
  const [expandedStructId, setExpandedStructId] = useState(null);
  const [selectedBimStructId, setSelectedBimStructId] = useState(null);
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
        type: Math.random() > 0.5 ? 'excavation' : 'restricted',
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
      width: '100%', minWidth: 200, flexShrink: 0, background: '#0a1525',
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
          <BimWbsPanel wbsTasks={wbsTasks} workers={workers} equipment={equipment} t={t} />
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
                      📍 BIM 프로젝트 영역 {surveyOrigin ? '(측량 좌표)' : ''}
                    </div>
                    {/* X 범위 */}
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>X</span>
                        <span style={{ fontSize: 9, color: '#d1d5db', fontWeight: 600 }}>{minX.toFixed(2)} ~ {maxX.toFixed(2)}</span>
                        <span style={{ fontSize: 8, color: '#4b5563' }}>폭 {w.toFixed(1)}m</span>
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
                        <span style={{ fontSize: 8, color: '#4b5563' }}>깊이 {d.toFixed(1)}m</span>
                      </div>
                      <div style={{ height: 2, background: '#111e2d', borderRadius: 1 }}>
                        <div style={{ height: '100%', width: '100%', background: '#3b82f688', borderRadius: 1 }} />
                      </div>
                    </div>
                    {/* 오프셋 기준점 */}
                    <div style={{ fontSize: 8, color: '#253347', borderTop: '1px solid #111e2d', paddingTop: 4 }}>
                      씬 오프셋 X:{off[0].toFixed(1)} Y:{off[1].toFixed(1)} Z:{off[2].toFixed(1)}
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
                  onClick={() => {
                    if (selectedBimStructId === s.id) setSelectedBimStructId(null);
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
            onClick={() => dispatch({ type: 'AUTO_SIM_START' })}
            color={equipment.some(e => e.mode === 'auto') ? '#0f2200' : '#1a1200'}
            textColor={equipment.some(e => e.mode === 'auto') ? '#4ade80' : '#f97316'}
            title={t('simAutoDesc')}
          >
            {equipment.some(e => e.mode === 'auto') ? t('simAuto') : t('simAuto')}
          </Btn>
        </Row>
        <div style={{ fontSize: 9, color: '#374151', lineHeight: 1.5, marginTop: 2 }}>
          {t('simAutoDesc')}
        </div>
        <div style={{ fontSize: 9, color: '#253347', lineHeight: 1.5 }}>
          {t('refPoint', { lat: referencePoint.lat.toFixed(4), lng: referencePoint.lng.toFixed(4) })}
        </div>
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
      <CameraSection
        cameras={cameras}
        projectId={projectMeta?.projectId}
        referencePoint={referencePoint}
        dispatch={dispatch}
      />

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
            )}
            </React.Fragment>
          );
        })}
        <Btn small onClick={() => {
          const types = ['excavator', 'dump', 'crane'];
          const type  = types[equipment.length % types.length];
          const typeKeys = { excavator: 'equipExcavator', dump: 'equipDump', crane: 'equipCrane' };
          const defSizes = { excavator: [2.8,2.5,3.5], dump: [2.8,2.5,3.5], crane: [1.5,9.0,1.5] };
          dispatch({
            type: 'ADD_EQUIPMENT',
            equipment: {
              id:          `eq_${Date.now()}`,
              type,
              name:        `${t(typeKeys[type])}-${equipment.length + 1}`,
              initialPos:  [(Math.random()-0.5)*20, 0, (Math.random()-0.5)*20],
              route:       [],
              speed:       1.0,
              mode:        'standby',
              size:        defSizes[type],
              gpsDeviceId: null,
              gpsPos:      null,
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
          const zoneColor = z.type === 'restricted' ? '#f97316' : '#ef4444';
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
