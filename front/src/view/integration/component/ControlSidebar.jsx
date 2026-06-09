import { useRef, useState, useEffect } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import AddStructureModal, { resizeImageDataUrl } from './AddStructureModal';
import EquipmentOptionsPanel from './EquipmentOptionsPanel';
import WorkerOptionsPanel from './WorkerOptionsPanel';
import ZoneOptionsPanel from './ZoneOptionsPanel';
import { useT } from '../../../i18n/LanguageContext';

const EQUIP_ICON = { excavator: '🚜', dump: '🚛', crane: '🏗' };

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
      borderRadius: 5, padding: small ? '3px 8px' : '5px 10px',
      fontSize: small ? 10 : 11, cursor: disabled ? 'not-allowed' : 'pointer',
      fontWeight: 600, opacity: disabled ? 0.5 : 1,
    }}>
      {children}
    </button>
  );
}

function Row({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>{children}</div>;
}

// ── 메인 사이드바 ─────────────────────────────────────────────────
export default function ControlSidebar() {
  const t = useT('integrationProject');
  const {
    workers, equipment, dangerZones, simulationRunning,
    referencePoint, bimElements, isLoading, projectMeta,
    structures, terrain, selectedEquipId, selectedWorkerId, selectedZoneId,
    surveyOrigin,
  } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const [showAddStructure, setShowAddStructure] = useState(false);
  const [expandedStructId, setExpandedStructId] = useState(null);
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

  return (
    <div style={{
      width: 220, flexShrink: 0, background: '#0a1525',
      borderRight: '1px solid #111e2d', overflowY: 'auto', padding: '14px 12px',
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
        <Row>
          <span style={{ fontSize: 11 }}>🏗</span>
          <span style={{ flex: 1, fontSize: 10, color: projectMeta?.bimProjectId ? '#60a5fa' : '#374151', fontWeight: 600 }}>BIM</span>
          <span style={{ fontSize: 9, color: projectMeta?.bimProjectId ? '#2a5080' : '#253347' }}>
            {projectMeta?.bimProjectId ? t('connected') : t('notConnected')}
          </span>
        </Row>
        {bimElements.length > 0 && (
          <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2 }}>
            {t('bimLoaded', { n: bimElements.length })}
          </div>
        )}
      </Section>

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
        {structures.length === 0 && (
          <div style={{ fontSize: 10, color: '#374151', marginBottom: 6, whiteSpace: 'pre-line' }}>
            {t('structHint')}
          </div>
        )}
        {structures.map(s => {
          const isExpanded = expandedStructId === s.id;
          const offset = s.offset || [0, 0, 0];
          return (
            <div key={s.id} style={{ marginBottom: 5 }}>
              <Row>
                <span style={{ fontSize: 11 }}>{s.type === 'bim' ? '🏗' : '📂'}</span>
                <span style={{ flex: 1, fontSize: 10, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                  onClick={() => dispatch({ type: 'REMOVE_STRUCTURE', id: s.id })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0, flexShrink: 0 }}
                >✕</button>
              </Row>
              {isExpanded && (
                <div style={{ paddingLeft: 4, marginBottom: 4 }}>
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
        <Row>
          <Btn
            onClick={() => dispatch({ type: 'TOGGLE_SIM' })}
            color={simulationRunning ? '#1a3a1a' : '#1a1a3a'}
            textColor={simulationRunning ? '#22c55e' : '#a78bfa'}
          >
            {simulationRunning ? t('simPause') : t('simResume')}
          </Btn>
        </Row>
        <div style={{ fontSize: 9, color: '#374151', lineHeight: 1.5 }}>
          {t('refPoint', { lat: referencePoint.lat.toFixed(4), lng: referencePoint.lng.toFixed(4) })}
        </div>
      </Section>

      {/* 측량 기준점 */}
      <Section title="측량 기준점">
        {surveyOrigin && (
          <div style={{
            background: '#12110a', border: '1px solid #facc1555', borderRadius: 5,
            padding: '5px 8px', marginBottom: 8, fontSize: 9,
          }}>
            <div style={{ color: '#facc15', fontWeight: 700, marginBottom: 2 }}>
              📍 {surveyOrigin.label || '기준점'} 적용 중
            </div>
            <div style={{ color: '#a09060' }}>
              X:{surveyOrigin.x.toFixed(3)} Y:{surveyOrigin.y.toFixed(3)} Z:{surveyOrigin.z.toFixed(3)}
            </div>
          </div>
        )}

        {/* 이름 */}
        <div style={{ marginBottom: 5 }}>
          <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 700, marginBottom: 3 }}>이름 (선택)</div>
          <input
            type="text"
            value={surveyForm.label}
            onChange={e => setSurveyForm(f => ({ ...f, label: e.target.value }))}
            placeholder="예: 기준점A"
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
            씬 원점(0,0,0)의 측량 좌표
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            {[['X', 'x'], ['Y(고)', 'y'], ['Z', 'z']].map(([lbl, key]) => (
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
            {surveyApplied ? '✓ 적용됨' : '기준점 설정'}
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
              해제
            </button>
          )}
        </div>
      </Section>

      {/* 작업자 */}
      <Section title={t('sectionWorkers', { n: workers.length })}>
        {/* 선택된 작업자 설정 패널 */}
        <WorkerOptionsPanel />

        {workers.map(w => {
          const isSelected = w.id === selectedWorkerId;
          return (
            <div
              key={w.id}
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
            <div
              key={e.id}
              onClick={() => dispatch({ type: 'SELECT_EQUIPMENT', id: isSelected ? null : e.id })}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5,
                padding: '3px 5px', borderRadius: 4, cursor: 'pointer',
                background: isSelected ? '#0c2040' : 'transparent',
                border: `1px solid ${isSelected ? '#1e3a5f' : 'transparent'}`,
              }}
            >
              <span style={{ fontSize: 11 }}>{EQUIP_ICON[e.type] || '🔧'}</span>
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
