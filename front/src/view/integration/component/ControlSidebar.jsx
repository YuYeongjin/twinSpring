import { useRef, useState } from 'react';
import { useIntegration, useIntegrationDispatch } from '../IntegrationStore';
import AddStructureModal, { resizeImageDataUrl } from './AddStructureModal';
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
    structures, terrain,
  } = useIntegration();
  const dispatch = useIntegrationDispatch();

  const [showAddStructure, setShowAddStructure] = useState(false);
  const terrainInputRef = useRef(null);

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
            <div style={{ fontSize: 9, color: '#22c55e', marginBottom: 6 }}>
              {t('terrainSet', { w: terrain.width, h: terrain.height })}
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
        {structures.map(s => (
          <Row key={s.id}>
            <span style={{ fontSize: 11 }}>{s.type === 'bim' ? '🏗' : '📂'}</span>
            <span style={{ flex: 1, fontSize: 10, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name}
            </span>
            <span style={{ fontSize: 9, color: s.elements?.length > 0 ? '#22c55e' : '#f59e0b', flexShrink: 0 }}>
              {s.elements === null ? t('structLoading') : s.elements.length > 0 ? `${s.elements.length}ea` : t('structEmpty')}
            </span>
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
        ))}
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

      {/* 작업자 */}
      <Section title={t('sectionWorkers', { n: workers.length })}>
        {workers.map(w => (
          <Row key={w.id}>
            <span style={{ fontSize: 11 }}>👷</span>
            <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {w.name}
            </span>
            <span style={{ fontSize: 9, color: w.gear ? '#22c55e' : '#a855f7', fontWeight: 700, flexShrink: 0 }}>
              {w.gear ? 'O' : t('noGear')}
            </span>
            <button
              onClick={() => dispatch({ type: 'REMOVE_WORKER', id: w.id })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0 }}
            >✕</button>
          </Row>
        ))}
        <Btn small onClick={handleAddWorker}>{t('addWorker')}</Btn>
      </Section>

      {/* 장비 */}
      <Section title={t('sectionEquipment', { n: equipment.length })}>
        {equipment.map(e => (
          <Row key={e.id}>
            <span style={{ fontSize: 11 }}>{EQUIP_ICON[e.type] || '🔧'}</span>
            <span style={{ flex: 1, fontSize: 11, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.name}
            </span>
            <span style={{ fontSize: 9, color: e.speed > 0 ? '#22c55e' : '#f59e0b', fontWeight: 700, flexShrink: 0 }}>
              {e.speed > 0 ? t('equipRunning') : t('equipIdle')}
            </span>
          </Row>
        ))}
      </Section>

      {/* 위험구역 */}
      <Section title={t('sectionHazardZones', { n: dangerZones.length })}>
        {dangerZones.map(z => (
          <Row key={z.id}>
            <span style={{ fontSize: 10 }}>⚠</span>
            <span style={{ flex: 1, fontSize: 10, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {z.name}
            </span>
            <button
              onClick={() => dispatch({ type: 'TOGGLE_ZONE', id: z.id })}
              style={{
                background: 'none', border: `1px solid ${z.active ? '#22c55e' : '#374151'}`,
                borderRadius: 3, cursor: 'pointer', color: z.active ? '#22c55e' : '#4b5563',
                fontSize: 9, fontWeight: 700, padding: '0 4px',
              }}
            >{z.active ? 'ON' : 'OFF'}</button>
            <button
              onClick={() => dispatch({ type: 'REMOVE_ZONE', id: z.id })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4b5563', fontSize: 11, padding: 0 }}
            >✕</button>
          </Row>
        ))}
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
