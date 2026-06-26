import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { pushAlert, pushWbsSuggest } from '../../utils/alertStore';
import AxiosCustom from '../../axios/AxiosCustom';
import TheoryModal from './TheoryModal';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { GltfBimViewerSuspense } from '../bim/element/GltfBimViewer';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ReferenceLine,
} from 'recharts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MATERIALS = {
  // Concrete grades
  concrete_20: { id: 'concrete_20', label: 'Concrete C20', density: 24, allowCompressive: 13.3, allowShear: 1.1 },
  concrete_24: { id: 'concrete_24', label: 'Concrete C24', density: 24, allowCompressive: 16,   allowShear: 1.4 },
  concrete_25: { id: 'concrete_25', label: 'Concrete C25', density: 24, allowCompressive: 16.7, allowShear: 1.5 },
  concrete_30: { id: 'concrete_30', label: 'Concrete C30', density: 24, allowCompressive: 20,   allowShear: 1.7 },
  concrete_35: { id: 'concrete_35', label: 'Concrete C35', density: 24, allowCompressive: 23.3, allowShear: 1.9 },
  concrete_40: { id: 'concrete_40', label: 'Concrete C40', density: 24, allowCompressive: 26.7, allowShear: 2.1 },
  concrete_50: { id: 'concrete_50', label: 'Concrete C50', density: 25, allowCompressive: 33.3, allowShear: 2.5 },
  concrete_60: { id: 'concrete_60', label: 'Concrete C60 / Prestressed', density: 25, allowCompressive: 40, allowShear: 3.0 },
  // Steel grades
  steel_235: { id: 'steel_235', label: 'Steel SS275 / Grade A', density: 78.5, allowCompressive: 157, allowShear: 91  },
  steel_400: { id: 'steel_400', label: 'Steel SS400 / Grade B', density: 78.5, allowCompressive: 163, allowShear: 94  },
  steel_275: { id: 'steel_275', label: 'Steel SHN275',          density: 78.5, allowCompressive: 180, allowShear: 104 },
  steel_355: { id: 'steel_355', label: 'Steel SHN355 / SM355',  density: 78.5, allowCompressive: 237, allowShear: 137 },
  // Timber
  timber_pine:   { id: 'timber_pine',   label: 'Timber Pine / LVL',    density: 5.5, allowCompressive: 18, allowShear: 2.5 },
  timber_glulam: { id: 'timber_glulam', label: 'Timber Glulam / CLT',  density: 4.5, allowCompressive: 24, allowShear: 3.0 },
  // Composite
  composite_src: { id: 'composite_src', label: 'Steel-Concrete Composite', density: 40, allowCompressive: 80,  allowShear: 30 },
  composite_frp: { id: 'composite_frp', label: 'FRP / Carbon Fiber',        density: 20, allowCompressive: 150, allowShear: 60 },
};

// BIM 에디터 재료 문자열 → MATERIALS 키 매핑
function resolveMaterialFromBim(bimMaterial, fallbackId) {
  if (!bimMaterial) return fallbackId;
  const m = bimMaterial.toLowerCase();
  if (m.includes('c60') || m.includes('high-strength') || m.includes('prestressed')) return 'concrete_60';
  if (m.includes('c50'))  return 'concrete_50';
  if (m.includes('c40'))  return 'concrete_40';
  if (m.includes('c35'))  return 'concrete_35';
  if (m.includes('c30'))  return 'concrete_30';
  if (m.includes('c25'))  return 'concrete_25';
  if (m.includes('c24'))  return 'concrete_24';
  if (m.includes('c20') || m.includes('concrete')) return 'concrete_20';
  if (m.includes('shn355') || m.includes('sm355')) return 'steel_355';
  if (m.includes('shn275')) return 'steel_275';
  if (m.includes('ss400') || m.includes('grade b')) return 'steel_400';
  if (m.includes('ss275') || m.includes('ss400') || m.includes('grade a') || m.includes('steel')) return 'steel_235';
  if (m.includes('stainless')) return 'steel_400';
  if (m.includes('glulam') || m.includes('clt') || m.includes('oak')) return 'timber_glulam';
  if (m.includes('timber') || m.includes('pine') || m.includes('lvl')) return 'timber_pine';
  if (m.includes('carbon') || m.includes('frp')) return 'composite_frp';
  if (m.includes('composite')) return 'composite_src';
  return fallbackId;
}

const SEISMIC_ZONES = [
  { value: 1, label: 'Zone I  — Low Risk (0.08g)', Sa: 0.08 },
  { value: 2, label: 'Zone II — Moderate (0.154g)', Sa: 0.154 },
  { value: 3, label: 'Zone III — High Risk (0.22g)', Sa: 0.22 },
  { value: 4, label: 'Zone IV — Very High Risk (0.32g)', Sa: 0.32 },
];

const ELEMENT_LABELS = {
  IfcColumn: 'Column',
  IfcBeam: 'Beam',
  IfcMember: 'Member',
  IfcWall: 'Wall',
  IfcSlab: 'Slab',
  IfcPier: 'Pier',
};

// DSM 백엔드 dominantStressType → 프론트 frStress* 키 매핑
const DOM_MAP = {
  AXIAL:          'Axial',
  BENDING_STRONG: 'Bending',
  BENDING_WEAK:   'Bending',
  SHEAR:          'Shear',
};

const STATUS_CFG = {
  safe: { label: 'Safe', color: '#22c55e', bg: 'bg-green-900/40', text: 'text-green-300', border: 'border-green-600/40' },
  warning: { label: 'Warning', color: '#f59e0b', bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-600/40' },
  danger: { label: 'Danger', color: '#ef4444', bg: 'bg-red-900/40', text: 'text-red-300', border: 'border-red-600/40' },
};

// FORMULA_HELP is built inside the component via useFormulaHelp(t)

// ──────────────────────────────────────────────────────────────────────────────
// DSM 결과 정규화 — 백엔드 MemberResult를 display 형태로 변환
// ──────────────────────────────────────────────────────────────────────────────

function normalizeDsmMember(r, modelData, idx) {
  const el        = modelData.find(e => e.elementId === r.elementId);
  const matId     = resolveMaterialFromBim(el?.material, 'concrete_24');
  const status    = (r.status ?? 'safe').toLowerCase();
  const utilPct   = +((r.utilization ?? 0) * 100).toFixed(1);
  const domType   = DOM_MAP[r.dominantStressType] ?? null;

  // 지배 응력·허용값·여유율 계산 (렌더 시 t() 조합용)
  const isShear        = r.dominantStressType === 'SHEAR';
  const stressVal      = isShear ? (r.shearStress ?? 0) : (r.normalStress ?? 0);
  const allowNormal    = r.allowStress ?? 12.0;
  const effectiveAllow = isShear ? +(allowNormal * 0.6).toFixed(1) : allowNormal;
  const marginVal      = effectiveAllow > 0
    ? +((effectiveAllow - stressVal) / effectiveAllow * 100).toFixed(1)
    : 0;

  return {
    elementId:         r.elementId,
    elementName:       el?.elementName || `${ELEMENT_LABELS[r.elementType] ?? r.elementType}-${idx + 1}`,
    elementType:       r.elementType,
    materialId:        matId,
    materialLabel:     MATERIALS[matId]?.label ?? (el?.material ?? 'BIM Material'),
    materialFromBim:   !!el?.material,
    bimMaterialRaw:    el?.material ?? '',
    selfWeight:        null,
    axialLoad:         +(r.axialForce    ?? 0).toFixed(2),
    windLoad:          null,
    seismicLoad:       null,
    bendingMoment:     +(r.bendingMoment ?? 0).toFixed(2),
    shearForce:        +(r.shearForce    ?? 0).toFixed(2),
    axialStress:       +(r.normalStress  ?? 0).toFixed(3),
    bendingStress:     null,
    shearStress:       +(r.shearStress   ?? 0).toFixed(3),
    maxStress:         +(r.normalStress  ?? 0).toFixed(3),
    allowStress:       +allowNormal.toFixed(1),
    safetyFactor:      +(r.safetyFactor  ?? 999).toFixed(2),
    utilization:       utilPct,
    status,
    dominantStressType: status !== 'safe' ? domType : null,
    stressVal:          status !== 'safe' ? +(stressVal).toFixed(3) : null,
    allowVal:           status !== 'safe' ? effectiveAllow           : null,
    marginVal:          status !== 'safe' ? marginVal                : null,
  };
}


// ──────────────────────────────────────────────────────────────────────────────
// 3D Stress Viewer
// ──────────────────────────────────────────────────────────────────────────────

function StressBox({ element, result, isSelected, onSelect }) {
  // 메인 에디터와 동일하게 1로 기본값 세팅
  const sX = Math.max(Number(element.sizeX) || 1, 0.01);
  const sY = Math.max(Number(element.sizeY) || 1, 0.01);
  const sZ = Math.max(Number(element.sizeZ) || 1, 0.01);

  const pX = Number(element.positionX) || 0;
  const pY = Number(element.positionY) || 0;
  const pZ = Number(element.positionZ) || 0;

  // 메인 뷰어와 동일한 회전값 가져오기
  const rX = Number(element.rotationX) || 0;
  const rY = Number(element.rotationY) || 0;
  const rZ = Number(element.rotationZ) || 0;

  // Z-up 직접 매핑: posX→X, posY→Y, posZ→Z(높이)
  const renderX = pX;
  const renderY = pY;
  const renderZ = pZ + sZ / 2;

  const color = result ? STATUS_CFG[result.status].color : '#374151';
  const emissI = isSelected ? 0.4 : 0;

  return (
      <mesh
          position={[renderX, renderY, renderZ]}
          rotation={[rX, rY, rZ]}
          onClick={e => { e.stopPropagation(); onSelect(element.elementId); }}
      >
        <boxGeometry args={[sX, sY, sZ]} />
        <meshStandardMaterial
            color={color}
            transparent
            opacity={0.88}
            emissive={color}
            emissiveIntensity={emissI}
        />
      </mesh>
  );
}

const EMPTY_SET = new Set();

function StressViewer3D({ modelData, resultMap, selectedId, onSelect, glbUrl }) {
  const [glbLoaded, setGlbLoaded] = useState(false);
  useEffect(() => { if (glbUrl) setGlbLoaded(false); }, [glbUrl]);

  // 분석 결과 색상을 resolvedColor로 주입 — GltfBimViewerSuspense가 이 색으로 메쉬를 칠함
  const coloredModelData = useMemo(() => modelData.map(el => ({
    ...el,
    resolvedColor: resultMap[el.elementId]
      ? STATUS_CFG[resultMap[el.elementId].status].color
      : '#374151',
  })), [modelData, resultMap]);

  const selectedElementForGlb = selectedId ? { data: { elementId: selectedId } } : null;

  return (
      <Canvas
          camera={{ position: [15, -15, 12], up: [0, 0, 1], fov: 55 }}
          style={{ background: '#0b0f1a', width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[10, 15, 5]} intensity={0.85} castShadow />
        <directionalLight position={[-5, 8, -5]} intensity={0.25} />

        <gridHelper args={[100, 100, '#1a3a5c', '#1a3a5c']}
                    position={[0, 0, -0.01]}
                    rotation={[Math.PI / 2, 0, 0]}
        />

        {glbUrl ? (
          <>
            <GltfBimViewerSuspense
                glbUrl={glbUrl}
                modelData={coloredModelData}
                selectedElement={selectedElementForGlb}
                selectedElements={EMPTY_SET}
                onElementSelect={(element) => onSelect(element.elementId)}
                onMeshMount={null}
                onLoad={() => setGlbLoaded(true)}
            />
            {!glbLoaded && coloredModelData.map(el => (
                <StressBox
                    key={el.elementId}
                    element={el}
                    result={resultMap[el.elementId]}
                    isSelected={el.elementId === selectedId}
                    onSelect={onSelect}
                />
            ))}
          </>
        ) : (
          coloredModelData.map(el => (
              <StressBox
                  key={el.elementId}
                  element={el}
                  result={resultMap[el.elementId]}
                  isSelected={el.elementId === selectedId}
                  onSelect={onSelect}
              />
          ))
        )}

        <OrbitControls makeDefault />
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ff4060', '#80ff80', '#2080ff']} labelColor="white" />
        </GizmoHelper>
      </Canvas>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// UI components
// ──────────────────────────────────────────────────────────────────────────────

function FormulaTooltip({ data }) {
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned]   = useState(false);
  const [rect, setRect]       = useState(null);
  const btnRef = useRef(null);
  const tipRef = useRef(null);
  const show   = visible || pinned;

  const openAt = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setVisible(true);
  };

  useEffect(() => {
    if (!pinned) return;
    const close = e => {
      if (btnRef.current?.contains(e.target)) return;
      if (tipRef.current?.contains(e.target)) return;
      setPinned(false);
      setVisible(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pinned]);

  const tipStyle = rect ? {
    position: 'fixed',
    top: rect.bottom + 6,
    left: Math.min(rect.left - 4, window.innerWidth - 284),
    zIndex: 9999,
    width: 272,
  } : {};

  return (
      <>
        <button
            ref={btnRef}
            onMouseEnter={openAt}
            onMouseLeave={() => { if (!pinned) setVisible(false); }}
            onClick={() => {
              if (pinned) { setPinned(false); setVisible(false); }
              else        { openAt(); setPinned(true); }
            }}
            title="Formula info"
            className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full
                   text-[9px] font-bold leading-none select-none transition-colors
                   bg-[#1b2236] border border-[#2a3a5a] text-gray-500
                   hover:text-blue-400 hover:border-blue-600/60 cursor-pointer"
        >
          ?
        </button>

        {show && rect && (
            <div
                ref={tipRef}
                style={tipStyle}
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => { if (!pinned) setVisible(false); }}
                className="bg-[#080c18] border border-[#1e2d48] rounded-xl shadow-2xl p-3 text-left"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold text-blue-400">{data.title}</span>
                {pinned && (
                    <button
                        onClick={() => { setPinned(false); setVisible(false); }}
                        className="text-gray-600 hover:text-gray-300 text-xs leading-none ml-2"
                    >✕</button>
                )}
              </div>

              {/* Formula box */}
              <div className="bg-[#0d1220] border border-[#1b2a40] rounded-lg px-2.5 py-2 mb-2.5
                          font-mono text-[10px] text-emerald-300 whitespace-pre leading-relaxed">
                {data.formula}
              </div>

              {/* Variable list */}
              <div className="flex flex-col gap-1 mb-2">
                {data.vars.map(({ s, d }) => (
                    <div key={s} className="flex gap-2 text-[10px] leading-snug">
                      <span className="font-mono text-amber-300 shrink-0 w-[88px] truncate">{s}</span>
                      <span className="text-gray-400">{d}</span>
                    </div>
                ))}
              </div>

              {/* Sub note */}
              {data.sub && (
                  <div className="border-t border-[#1b2236] pt-1.5 text-[10px] text-gray-500 leading-snug">
                    {data.sub}
                  </div>
              )}

              {/* Pin hint */}
              {!pinned && (
                  <div className="mt-1.5 text-[9px] text-gray-600 text-right">click to pin</div>
              )}
            </div>
        )}
      </>
  );
}

function Card({ title, children, className = '', help }) {
  return (
      <div className={`bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4 ${className}`}>
        {title && (
            <div className="flex items-center gap-1.5 mb-3">
              <p className="text-xs font-semibold text-gray-400 tracking-wide">{title}</p>
              {help && <FormulaTooltip data={help} />}
            </div>
        )}
        {children}
      </div>
  );
}

const STATUS_LABEL_KEY = { safe: 'structDsmSafe', warning: 'structDsmWarning', danger: 'structDsmDanger' };

function StatusBadge({ status }) {
  const t = useT('bimDashboard');
  const c = STATUS_CFG[status];
  return (
      <span className={`px-2 py-0.5 text-xs font-semibold border rounded-md ${c.bg} ${c.text} ${c.border}`}>
        {t(STATUS_LABEL_KEY[status])}
      </span>
  );
}

function SliderRow({ label, value, min, max, step = 1, unit, onChange, help }) {
  return (
      <div>
        <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400 flex items-center gap-1">
          {label}
          {help && <FormulaTooltip data={help} />}
        </span>
          <span className="text-accent-blue font-medium">{value}{unit}</span>
        </div>
        <input
            type="range" min={min} max={max} step={step} value={value}
            onChange={e => onChange(Number(e.target.value))}
            className="w-full h-1 rounded appearance-none cursor-pointer accent-blue-500 bg-[#1b2236]"
        />
        <div className="flex justify-between text-xs text-gray-600 mt-0.5">
          <span>{min}{unit}</span><span>{max}{unit}</span>
        </div>
      </div>
  );
}

function NumRow({ label, value, unit, min = 0, max = 1000, step = 0.5, onChange, help }) {
  return (
      <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-400 shrink-0 flex items-center gap-1">
        {label}
        {help && <FormulaTooltip data={help} />}
      </span>
        <div className="flex items-center gap-1">
          <input
              type="number" min={min} max={max} step={step} value={value}
              onChange={e => onChange(Number(e.target.value))}
              className="w-20 bg-[#141a2a] border border-[#1b2236] rounded-lg text-xs text-right
                     text-gray-200 px-2 py-1 focus:outline-none focus:border-blue-600"
          />
          <span className="text-xs text-gray-500 w-12">{unit}</span>
        </div>
      </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Formula Panel — DB 저장 공식 표시 + 변수 편집기
// ──────────────────────────────────────────────────────────────────────────────

function FormulaPanel({ codeStandard, structureType, projectId }) {
  const t = useT('bimDashboard');
  const [formulas, setFormulas]     = useState([]);
  const [loading, setLoading]       = useState(false);
  const [expanded, setExpanded]     = useState({});
  const [editing, setEditing]       = useState(null); // { formulaId, varName, value }
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (!codeStandard || !structureType) return;
    setLoading(true);
    const params = new URLSearchParams({ codeStandard, structureType });
    if (projectId) params.set('projectId', projectId);
    AxiosCustom.get(`/api/structural/formulas?${params}`)
      .then(r => setFormulas(r.data ?? []))
      .catch(() => setFormulas([]))
      .finally(() => setLoading(false));
  }, [codeStandard, structureType, projectId]);

  const CATEGORY_LABEL = {
    WIND:     t('structCatWIND'),
    SEISMIC:  t('structCatSEISMIC'),
    DEAD:     t('structCatDEAD'),
    LIVE:     t('structCatLIVE'),
    SNOW:     t('structCatSNOW'),
    TRAFFIC:  t('structCatTRAFFIC'),
    COMBO:    t('structCatCOMBO'),
    BUCKLING: t('structCatBUCKLING'),
    SAFETY:   t('structCatSAFETY'),
  };

  const handleSaveVar = async (formulaId, varName, value) => {
    if (!projectId) return;
    setSaving(true);
    try {
      await AxiosCustom.put('/api/structural/overrides', {
        projectId, formulaId, varName, customValue: Number(value),
      });
      // 반영: effectiveValue 업데이트
      setFormulas(prev => prev.map(f => {
        if (f.formulaId !== formulaId) return f;
        return {
          ...f,
          variables: f.variables.map(v =>
            v.varName === varName ? { ...v, effectiveValue: Number(value) } : v
          ),
        };
      }));
    } catch (_) {}
    setSaving(false);
    setEditing(null);
  };

  const handleResetVar = async (formulaId, varName, defaultValue) => {
    if (!projectId) return;
    try {
      await AxiosCustom.delete(`/api/structural/overrides/${projectId}/${formulaId}/${varName}`);
      setFormulas(prev => prev.map(f => {
        if (f.formulaId !== formulaId) return f;
        return {
          ...f,
          variables: f.variables.map(v =>
            v.varName === varName ? { ...v, effectiveValue: defaultValue } : v
          ),
        };
      }));
    } catch (_) {}
    setEditing(null);
  };

  if (loading) return (
    <div className="flex items-center gap-2 py-4 justify-center">
      <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
      <span className="text-xs text-gray-500">{t('structFormulaLoading')}</span>
    </div>
  );

  if (!formulas.length) return (
    <p className="text-xs text-gray-600 text-center py-3">{t('structFormulaEmpty')}</p>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {formulas.map(f => {
        const isOpen = !!expanded[f.formulaId];
        const isModified = f.variables?.some(v => v.effectiveValue !== v.defaultValue);
        return (
          <div key={f.formulaId} className="border border-[#1b2236] rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(p => ({ ...p, [f.formulaId]: !p[f.formulaId] }))}
              className="w-full flex items-start justify-between gap-2 px-2.5 py-2 text-left hover:bg-[#141a2a] transition-colors"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-blue-500 bg-blue-900/30 px-1.5 py-0.5 rounded shrink-0">
                    {CATEGORY_LABEL[f.category] ?? f.category}
                  </span>
                  {isModified && (
                    <span className="text-[10px] text-amber-400 shrink-0">{t('structFormulaModified')}</span>
                  )}
                </div>
                <span className="text-xs font-semibold text-gray-200 truncate leading-tight">{f.name}</span>
              </div>
              <span className="text-gray-500 text-xs shrink-0 mt-0.5">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="px-2.5 pb-2.5 border-t border-[#1b2236]">
                {/* 수식 */}
                <div className="bg-[#0d1220] border border-[#1b2a40] rounded-lg px-2 py-1.5 mt-2 mb-2
                                font-mono text-[10px] text-emerald-300 whitespace-pre-wrap leading-relaxed">
                  {f.expression}
                </div>
                {f.description && (
                  <p className="text-[10px] text-gray-500 mb-2">{f.description}</p>
                )}

                {/* 변수 목록 */}
                {f.variables?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {f.variables.map(v => {
                      const isEdit = editing?.formulaId === f.formulaId && editing?.varName === v.varName;
                      const changed = v.effectiveValue !== v.defaultValue;
                      return (
                        <div key={v.varName} className="flex items-center gap-1.5 group">
                          <span className="font-mono text-amber-300 text-[10px] w-[70px] shrink-0 truncate">{v.varName}</span>
                          {isEdit ? (
                            <input
                              type="number"
                              defaultValue={v.effectiveValue}
                              step={v.minValue != null ? (v.maxValue - v.minValue) / 100 : 0.1}
                              className="w-16 bg-[#141a2a] border border-blue-600/60 rounded text-[10px]
                                         text-gray-100 px-1 py-0.5 focus:outline-none"
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveVar(f.formulaId, v.varName, e.target.value);
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              autoFocus
                            />
                          ) : (
                            <span className={`text-[10px] font-mono w-14 text-right ${changed ? 'text-amber-300' : 'text-gray-300'}`}>
                              {v.effectiveValue != null ? v.effectiveValue : v.defaultValue}
                            </span>
                          )}
                          <span className="text-[9px] text-gray-600 w-8 shrink-0">{v.unit || ''}</span>

                          {v.isEditable !== false && projectId && !isEdit && (
                            <button
                              onClick={() => setEditing({ formulaId: f.formulaId, varName: v.varName })}
                              className="opacity-0 group-hover:opacity-100 text-[9px] text-blue-400 hover:text-blue-300 transition"
                            >✎</button>
                          )}
                          {isEdit && (
                            <>
                              <button
                                onClick={() => {
                                  const inp = document.activeElement;
                                  handleSaveVar(f.formulaId, v.varName, inp?.value ?? v.effectiveValue);
                                }}
                                disabled={saving}
                                className="text-[9px] text-green-400 hover:text-green-300"
                              >✓</button>
                              <button
                                onClick={() => setEditing(null)}
                                className="text-[9px] text-gray-500 hover:text-gray-300"
                              >✕</button>
                            </>
                          )}
                          {changed && !isEdit && projectId && (
                            <button
                              onClick={() => handleResetVar(f.formulaId, v.varName, v.defaultValue)}
                              className="opacity-0 group-hover:opacity-100 text-[9px] text-gray-500 hover:text-red-400 transition"
                              title="기본값으로 초기화"
                            >↺</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Formula Panel Modal wrapper
// ──────────────────────────────────────────────────────────────────────────────

function FormulaPanelModal({ open, onClose, codeStandard, structureType, projectId }) {
  const t = useT('bimDashboard');
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-[#080c18] border border-[#1e2d48] rounded-2xl shadow-2xl flex flex-col"
        style={{ width: 'min(560px, 96vw)', maxHeight: '88vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#141a2a] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-100">⚙ {t('structFormulaPanel')}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 border border-indigo-600/30">
              {codeStandard}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-[#0f1422] border border-[#141a2a] text-gray-500
                       hover:text-gray-200 hover:bg-[#1b2236] transition text-sm flex items-center justify-center"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-[10px] text-gray-500 mb-3 leading-relaxed">
            {t('structVarModalDesc')}
          </p>
          <FormulaPanel
            codeStandard={codeStandard}
            structureType={structureType}
            projectId={projectId}
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main dashboard
// ──────────────────────────────────────────────────────────────────────────────

function useFormulaHelp(t) {
  return useMemo(() => ({
    windSpeed: {
      title: t('fhWindTitle'),
      formula: 'q = 0.6125 × V² / 1000 × Cf × G',
      vars: [
        { s: 'q',      d: t('fhWindQ') },
        { s: 'V',      d: t('fhWindV') },
        { s: 'Cf=1.3', d: t('fhWindCf') },
        { s: 'G=1.5',  d: t('fhWindG') },
        { s: 'F_wind', d: t('fhWindF') },
      ],
      sub: t('fhWindSub'),
    },
    seismic: {
      title: t('fhSeismicTitle'),
      formula: 'F_seismic = Sa × W',
      vars: [
        { s: 'Sa', d: t('fhSeismicSa') },
        { s: 'W',  d: t('fhSeismicW') },
      ],
      sub: t('fhSeismicSub'),
    },
    snowLoad: {
      title: t('fhSnowTitle'),
      formula: 'q_slab = D + L + S + γ·t',
      vars: [
        { s: 'D',   d: t('fhSnowD') },
        { s: 'L',   d: t('fhSnowL') },
        { s: 'S',   d: t('fhSnowS') },
        { s: 'γ·t', d: t('fhSnowGt') },
      ],
      sub: t('fhSnowSub'),
    },
    tempRange: {
      title: t('fhTempTitle'),
      formula: 'ε_T = α × ΔT',
      vars: [
        { s: 'α',   d: t('fhTempA') },
        { s: 'ΔT',  d: t('fhTempDT') },
        { s: 'σ_T', d: t('fhTempSigma') },
      ],
      sub: t('fhTempSub'),
    },
    deadLoad: {
      title: t('fhDeadTitle'),
      formula: 'N = W_self + D × A_trib × n_floors',
      vars: [
        { s: 'W_self', d: t('fhDeadWself') },
        { s: 'D',      d: t('fhDeadD') },
        { s: 'A_trib', d: t('fhDeadAtrib') },
        { s: 'n',      d: t('fhDeadN') },
      ],
      sub: t('fhDeadSub'),
    },
    liveLoad: {
      title: t('fhLiveTitle'),
      formula: 'w = w_self + (D + L) × √A_trib',
      vars: [
        { s: 'w_self',  d: t('fhLiveWself') },
        { s: 'L',       d: t('fhLiveL') },
        { s: '√A_trib', d: t('fhLiveAtrib') },
      ],
      sub: t('fhLiveSub'),
    },
    tributaryArea: {
      title: t('fhTribTitle'),
      formula: 'A_trib ≈ (column spacing)²',
      vars: [
        { s: 'A_trib', d: t('fhTribAtrib') },
      ],
      sub: t('fhTribSub'),
    },
    material: {
      title: t('fhMatTitle'),
      formula: 'SF = f_allow / σ_max\nη  = σ_max / f_allow × 100 (%)',
      vars: [
        { s: 'f_allow', d: t('fhMatFallow') },
        { s: 'σ_max',   d: t('fhMatSigma') },
      ],
      sub: t('fhMatSub'),
    },
    stressFormulas: {
      title: t('fhStressTitle'),
      formula: 'σ_axial  = N / (A·1000)\nσ_bend   = M·c / (I·1000)\nτ_shear  = 1.5·V / (A·1000)',
      vars: [
        { s: 'N', d: t('fhStressN') },
        { s: 'M', d: t('fhStressM') },
        { s: 'V', d: t('fhStressV') },
        { s: 'c', d: t('fhStressC') },
        { s: 'I', d: t('fhStressI') },
      ],
      sub: t('fhStressSub'),
    },
  }), [t]);
}

// ── 차트 그리드: sfChart/pieData 가 바뀔 때만 리렌더 ─────────────────────────
const SfTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
      <p style={{ color: d.fill, fontWeight: 700, marginBottom: 2 }}>{d.name}</p>
      <p style={{ color: '#9ca3af' }}>SF: <span style={{ color: '#e2e8f0' }}>{Number(d.safetyFactor).toFixed(2)}</span></p>
      <p style={{ color: '#9ca3af' }}>Util.: <span style={{ color: '#e2e8f0' }}>{d.utilization}%</span></p>
    </div>
  );
};

const ChartGrid = React.memo(function ChartGrid({ sfChart, pieData, t }) {
  const sfScatter = sfChart.map((d, i) => ({ ...d, index: i + 1 }));
  const utilChart = sfChart.map((d, i) => ({ ...d, index: i + 1 }));
  const memberNoLabel = t('structMemberNo') || 'No.';
  const utilLabel = t('structUtilLabel') || 'Util.';

  const PieTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
      <div style={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
        <p style={{ color: d.payload.fill, fontWeight: 700, marginBottom: 2 }}>{d.name}</p>
        <p style={{ color: '#e2e8f0' }}>{d.value}</p>
      </div>
    );
  };

  const UtilTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, padding: '8px 12px', fontSize: 11 }}>
        <p style={{ color: '#93c5fd', fontWeight: 700, marginBottom: 2 }}>#{label} {d.name}</p>
        <p style={{ color: '#9ca3af' }}>{utilLabel}: <span style={{ color: d.fill }}>{d.utilization}%</span></p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ① 부재 안전율 — 산점도 */}
      <div className="bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
        <p className="text-xs font-semibold text-gray-400 mb-1">{t('structChartSFTitle')}</p>
        <p className="text-[10px] text-gray-600 mb-3">{t('structChartSFHint')}</p>
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 10, right: 50, left: -15, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1b2236" />
            <XAxis
              type="number" dataKey="index" name={memberNoLabel}
              tick={{ fill: '#6b7280', fontSize: 9 }}
              label={{ value: memberNoLabel, position: 'insideBottom', fill: '#4b5563', fontSize: 9, offset: -10 }}
              domain={[0, sfScatter.length + 1]}
              tickLine={false}
            />
            <YAxis
              type="number" dataKey="safetyFactor" name="SF"
              tick={{ fill: '#6b7280', fontSize: 9 }}
              label={{ value: 'SF', angle: -90, position: 'insideLeft', fill: '#4b5563', fontSize: 9, offset: 10 }}
            />
            <ReferenceLine y={2} stroke="#22c55e" strokeDasharray="5 4" strokeOpacity={0.7}
              label={{ value: 'Safe (2.0)', position: 'right', fill: '#22c55e', fontSize: 9 }} />
            <ReferenceLine y={1} stroke="#f59e0b" strokeDasharray="5 4" strokeOpacity={0.7}
              label={{ value: 'Warn (1.0)', position: 'right', fill: '#f59e0b', fontSize: 9 }} />
            <Tooltip content={<SfTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#374151' }} />
            <Scatter data={sfScatter} isAnimationActive={false}>
              {sfScatter.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* ② 파이 + 이용률 — 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* 상태 분포 파이 */}
        <div className="bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4 flex flex-col">
          <p className="text-xs font-semibold text-gray-400 mb-2">{t('structChartDistTitle')}</p>
          <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-[200px]">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={72}
                     paddingAngle={4} dataKey="value"
                     isAnimationActive={false}
                >
                  {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip content={<PieTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1 w-full">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-[11px] text-gray-400">{d.name}</span>
                  <span className="text-[11px] text-gray-200 ml-auto font-mono">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 이용률 바 차트 (2열 차지) */}
        <div className="sm:col-span-2 bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
          <p className="text-xs font-semibold text-gray-400 mb-3">{t('structChartUtilTitle')}</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={utilChart} margin={{ top: 5, right: 50, left: -25, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1b2236" />
              <XAxis
                dataKey="index" type="number"
                tick={{ fill: '#6b7280', fontSize: 9 }}
                label={{ value: memberNoLabel, position: 'insideBottom', fill: '#4b5563', fontSize: 9, offset: -4 }}
                domain={[0, utilChart.length + 1]}
                tickLine={false} height={36}
              />
              <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} domain={[0, 120]} />
              <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 3" strokeOpacity={0.6}
                label={{ value: '100%', position: 'right', fill: '#ef4444', fontSize: 9 }} />
              <Tooltip content={<UtilTooltip />} />
              <Bar dataKey="utilization" radius={[3, 3, 0, 0]} minPointSize={2} isAnimationActive={false}>
                {utilChart.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
});

export default function StructuralDashboard({ selectedProject, modelData = [], glbUrl }) {
  const t = useT('bimDashboard');
  const FORMULA_HELP = useFormulaHelp(t);

  const [env, setEnv] = useState({
    windSpeed: 20,
    windDir: 'N',
    seismicZone: 2,
    snowLoad: 0.5,
    tempMin: -10,
    tempMax: 35,
  });

  const [loads, setLoads] = useState({
    deadLoad: 5.0,
    liveLoad: 2.5,
    tributaryArea: 16,
    numFloors: 3,
  });

  const [matId, setMatId] = useState('concrete_24');
  const [results, setResults] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // 코드기준 / 구조물 유형
  const resolvedStructureType = useMemo(() => {
    const st = selectedProject?.structureType;
    if (!st) return 'BUILDING';
    if (st.toUpperCase().includes('BRIDGE')) return 'BRIDGE';
    return 'BUILDING';
  }, [selectedProject]);

  const [codeStandard, setCodeStandard]   = useState('KDS');
  const [formulaPanelOpen, setFormulaPanelOpen] = useState(false);
  const [theoryOpen, setTheoryOpen]       = useState(false);
  const [dsmResult, setDsmResult]         = useState(null);
  const [dsmError, setDsmError]           = useState(null);

  const [viewMode, setViewMode] = useState('3d');
  const [selectedId, setSelectedId] = useState(null);
  const [sortCfg, setSortCfg] = useState({ key: 'safetyFactor', asc: true });
  const [droneWarnOpen, setDroneWarnOpen] = useState(false);
  const [specData, setSpecData]       = useState(null);
  const [specLoading, setSpecLoading] = useState(false);
  const [specOpen, setSpecOpen]       = useState(null);
  const [analyzedAt, setAnalyzedAt]   = useState(null);

  const cacheAbortRef = useRef(false);

  // 프로젝트 변경 시 캐시에서 마지막 해석 결과 복원
  useEffect(() => {
    if (!selectedProject?.projectId) return;
    setResults(null);
    setDsmResult(null);
    setDsmError(null);
    setAnalyzedAt(null);
    setSelectedId(null);
    cacheAbortRef.current = false;

    AxiosCustom.get(`/api/structural/results/${selectedProject.projectId}`)
      .then(res => {
        if (cacheAbortRef.current || res.status === 204 || !res.data) return;
        const cache = res.data;
        const raw = JSON.parse(cache.resultJson);
        setDsmResult(raw);
        const normalized = (raw.members ?? []).map((r, idx) => normalizeDsmMember(r, modelData, idx));
        setResults(normalized);
        setAnalyzedAt(cache.analyzedAt);
      })
      .catch(() => {});
  }, [selectedProject?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSpecData = useCallback(async (dsmMembers) => {
    if (!dsmMembers?.length) return;
    setSpecLoading(true);
    setSpecData(null);
    const elementTypes  = [...new Set(dsmMembers.map(r => r.elementType).filter(Boolean))];
    const materialTypes = [...new Set(dsmMembers.map(r => {
      const el = modelData.find(e => e.elementId === r.elementId);
      return resolveMaterialFromBim(el?.material, 'concrete_24');
    }))];
    const hasDanger  = dsmMembers.some(r => r.status === 'Danger');
    const hasWarning = dsmMembers.some(r => r.status === 'Warning');
    try {
      const res = await AxiosCustom.post('/api/chat/structural-spec', {
        materialType: materialTypes[0] ?? 'concrete_24',
        materialTypes,
        elementTypes,
        hasDanger,
        hasWarning,
        seismicZone: env.seismicZone,
      });
      setSpecData(res.data);
    } catch (_) {
      setSpecData({ citations: [], hasData: false, query: '' });
    } finally {
      setSpecLoading(false);
    }
  }, [modelData, env.seismicZone]);

  const structuralAlertedRef = useRef(false);

  // DSM 해석 실행 — 사이드바 값을 서버에 전송하고 결과를 정규화하여 results에 저장
  const runDsmActualAnalysis = useCallback(async () => {
    if (!selectedProject?.projectId) return;
    cacheAbortRef.current = true;
    setIsAnalyzing(true);
    setDsmError(null);
    structuralAlertedRef.current = false;
    try {
      const reqBody = {
        codeStandard,
        structureType:  resolvedStructureType,
        windSpeed:      env.windSpeed,
        seismicZone:    env.seismicZone,
        snowLoad:       env.snowLoad,
        tempMin:        env.tempMin,
        tempMax:        env.tempMax,
        deadLoad:       loads.deadLoad,
        liveLoad:       loads.liveLoad,
        tributaryArea:  loads.tributaryArea,
        numFloors:      loads.numFloors,
      };
      const res = await AxiosCustom.post(
        `/api/structural/analyze/${selectedProject.projectId}`,
        reqBody
      );
      const raw = res.data;
      setDsmResult(raw);
      const normalized = (raw.members ?? []).map((r, idx) => normalizeDsmMember(r, modelData, idx));
      setResults(normalized);
      setAnalyzedAt(new Date().toISOString());
      fetchSpecData(raw.members ?? []);

      const dangerMembers = normalized.filter(r => r.status === 'danger');
      if (dangerMembers.length > 0 && !structuralAlertedRef.current) {
        structuralAlertedRef.current = true;
        const names    = dangerMembers.map(r => r.elementName).join(', ');
        const minSF    = Math.min(...dangerMembers.map(r => r.safetyFactor)).toFixed(2);
        const projName = selectedProject?.projectName ?? t('structCurrentModel');
        const alert = pushAlert({
          source: 'BIM', severity: 'HIGH',
          title:  t('structDangerTitle', { name: projName }),
          detail: t('structDangerDetail', { count: dangerMembers.length, sf: minSF, names }),
          projectId: selectedProject?.projectId ?? '', projectName: projName,
        });
        pushWbsSuggest({
          eventType: 'STRUCTURAL_DANGER', source: 'BIM_STRUCTURAL',
          title:  t('structDangerTitle', { name: projName }),
          detail: `${projName} — ${t('structDangerDetail', { count: dangerMembers.length, sf: minSF, names: names.slice(0, 80) })}`,
          projectId: selectedProject?.projectId ?? '', projectName: projName, alertId: alert.id,
        });
      }
    } catch (e) {
      setDsmError(e.response?.data?.message ?? e.message ?? 'Unknown error');
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedProject, codeStandard, resolvedStructureType, env, loads, modelData, fetchSpecData, t]);

  const handleAnalyze = useCallback(() => {
    if (!modelData.length || !selectedProject?.projectId) return;
    if (selectedProject?.structureType === 'DRONE') {
      setDroneWarnOpen(true);
      return;
    }
    runDsmActualAnalysis();
  }, [modelData, selectedProject, runDsmActualAnalysis]);

  const resultMap = useMemo(() => {
    if (!results) return {};
    return Object.fromEntries(results.map(r => [r.elementId, r]));
  }, [results]);

  const summary = useMemo(() => {
    if (!results?.length) return null;
    const counts = { safe: 0, warning: 0, danger: 0 };
    let maxUtil = 0, minSF = Infinity;
    results.forEach(r => {
      counts[r.status]++;
      if (r.utilization > maxUtil) maxUtil = r.utilization;
      if (r.safetyFactor < minSF) minSF = r.safetyFactor;
    });
    return { counts, maxUtil, minSF, total: results.length };
  }, [results]);

  const sortedResults = useMemo(() => {
    if (!results) return [];
    return [...results].sort((a, b) => {
      const d = a[sortCfg.key] > b[sortCfg.key] ? 1 : -1;
      return sortCfg.asc ? d : -d;
    });
  }, [results, sortCfg]);

  const toggleSort = key =>
      setSortCfg(p => ({ key, asc: p.key === key ? !p.asc : true }));

  const sfChart = useMemo(() =>
          results?.map(r => ({
            name: r.elementName.slice(0, 9),
            safetyFactor: Math.min(isFinite(r.safetyFactor) ? r.safetyFactor : 999, 20),
            utilization: r.utilization,
            fill: STATUS_CFG[r.status]?.color ?? '#6b7280',
          })) ?? [],
      [results]
  );

  const pieData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Safe', value: summary.counts.safe, fill: '#22c55e' },
      { name: 'Warning', value: summary.counts.warning, fill: '#f59e0b' },
      { name: 'Danger', value: summary.counts.danger, fill: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [summary]);

  const selectedResult = selectedId ? resultMap[selectedId] : null;

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [isLg, setIsLg] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  useEffect(() => {
    const h = () => setIsLg(window.innerWidth >= 1024);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  return (
      <div className="w-full bg-space-900 flex flex-col box-border p-3">

        {/* 드론 데이터 경고 모달 */}
        {droneWarnOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
              <div className="bg-[#0f1422] border border-amber-600/40 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-2xl">⚠️</span>
                  <h3 className="text-base font-bold text-amber-300">{t('structDroneWarnTitle')}</h3>
                </div>
                <p className="text-xs text-gray-300 leading-relaxed mb-5">
                  {t('structDroneWarnBody')}
                </p>
                <div className="flex gap-3">
                  <button
                      onClick={() => { setDroneWarnOpen(false); runDsmActualAnalysis(); }}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold
                  bg-amber-900/30 text-amber-300 border border-amber-600/40
                  hover:bg-amber-900/50 transition"
                  >
                    {t('structDroneWarnConfirm')}
                  </button>
                  <button
                      onClick={() => setDroneWarnOpen(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold
                  bg-[#141a2a] text-gray-400 border border-[#1b2236]
                  hover:bg-[#1b2236] transition"
                  >
                    {t('cancel') || 'Cancel'}
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* 이론 가이드 모달 */}
        <TheoryModal
          open={theoryOpen}
          onClose={() => setTheoryOpen(false)}
          codeStandard={codeStandard}
          structureType={resolvedStructureType}
          appliedLoads={dsmResult?.appliedLoads}
        />

        {/* 변수 편집 모달 */}
        <FormulaPanelModal
          open={formulaPanelOpen}
          onClose={() => setFormulaPanelOpen(false)}
          codeStandard={codeStandard}
          structureType={resolvedStructureType}
          projectId={selectedProject?.projectId}
        />

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-100 flex items-center gap-2 flex-wrap">
              <span>🔩</span> {t('structTitle')}
              {selectedProject && (
                  <span className="text-sm font-normal text-gray-400 truncate">
                — {selectedProject.projectName}
              </span>
              )}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 hidden lg:block">
              {t('structSubtitle')}
            </p>
          </div>

          {/* 데스크탑: 기존 버튼 영역 */}
          <div className="hidden lg:flex items-center gap-3">
            {results && (
                <span className="text-xs text-gray-500 flex items-center gap-1.5">
                  {t('structElements', { n: modelData.length })}
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                </span>
            )}
            {selectedProject?.structureType === 'DRONE' && (
                <span className="flex items-center gap-1 text-xs text-amber-400 border border-amber-600/30 bg-amber-900/20 px-2 py-1 rounded-lg">
                  {t('structDroneTag')}
                </span>
            )}

            {/* 코드기준 토글 */}
            <div className="flex items-center gap-0 border border-[#1b2236] rounded-lg overflow-hidden">
              {['KDS', 'EUROCODE2'].map(std => (
                <button key={std}
                  onClick={() => setCodeStandard(std)}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                    codeStandard === std
                      ? 'bg-blue-900/50 text-blue-300 border-r border-[#1b2236]'
                      : 'bg-[#0f1422] text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {std === 'EUROCODE2' ? 'EC2' : std}
                </button>
              ))}
            </div>

            {/* 구조물 유형 표시 */}
            <span className="text-xs text-gray-500 border border-[#1b2236] px-2 py-1 rounded-lg">
              {resolvedStructureType === 'BRIDGE' ? `🌉 ${t('structBridgeType')}` : `🏢 ${t('structBuildingType')}`}
            </span>

            {/* 이론 가이드 모달 */}
            <button
              onClick={() => setTheoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition
                         bg-[#0f1422] text-gray-400 border-[#1b2236] hover:text-indigo-300 hover:border-indigo-600/40"
            >
              {t('structTheoryBtn')}
            </button>

            {/* 변수 편집 패널 토글 */}
            <button
              onClick={() => setFormulaPanelOpen(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition ${
                formulaPanelOpen
                  ? 'bg-indigo-900/40 text-indigo-300 border-indigo-600/40'
                  : 'bg-[#0f1422] text-gray-400 border-[#1b2236] hover:text-gray-200'
              }`}
            >
              {t('structVarBtn')}
            </button>

            <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !modelData.length}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold
                           bg-accent-blue/10 text-accent-blue border border-accent-blue/30
                           hover:bg-accent-blue/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {isAnalyzing ? `⏳ ${t('structAnalyzing')}` : results ? `↺ ${t('structRerunBtn')}` : `▶ ${t('structRunBtn')}`}
            </button>

            {analyzedAt && (
              <span className="hidden lg:inline text-[10px] text-gray-600 whitespace-nowrap">
                {t('structLastAnalyzed') || '마지막 해석'}&nbsp;
                {new Date(analyzedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
              </span>
            )}
          </div>

          {/* 모바일: Settings + Run 한 줄 */}
          <div className="flex lg:hidden items-center gap-2">
            {selectedProject?.structureType === 'DRONE' && (
                <span className="text-xs text-amber-400 border border-amber-600/30 bg-amber-900/20 px-2 py-1 rounded-lg shrink-0">
                  {t('structDroneTagShort')}
                </span>
            )}
            <button
                onClick={() => setSettingsOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-colors shrink-0"
                style={{
                  backgroundColor: settingsOpen ? '#1e3a5f' : '#0f1422',
                  border: settingsOpen ? '1px solid #2a5080' : '1px solid #141a2a',
                  color: settingsOpen ? '#60a5fa' : '#8896a4',
                }}
            >
              ⚙ {t('structSettingsLabel')}
            </button>
            <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !modelData.length}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold
                           bg-accent-blue/10 text-accent-blue border border-accent-blue/30
                           hover:bg-accent-blue/20 disabled:opacity-40 disabled:cursor-not-allowed transition shrink-0"
            >
              {isAnalyzing ? '⏳' : results ? '↺' : '▶'} {isAnalyzing ? t('structAnalyzing') : results ? t('structRerunBtn') : t('structRunBtn')}
            </button>
          </div>
        </div>

        {/* Main layout */}
        <div className="flex flex-col lg:flex-row gap-3 flex-1">

          {/* 모바일: 배경 딤 */}
          {settingsOpen && !isLg && (
              <div
                  onClick={() => setSettingsOpen(false)}
                  style={{
                    position: 'fixed', inset: 0, zIndex: 49,
                    backgroundColor: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(2px)',
                  }}
              />
          )}

          {/* ── Left: Settings panel ────────────────────────────────────── */}
          <div
              className={`lg:w-64 lg:shrink-0 flex flex-col gap-3${(viewMode === 'table' || viewMode === 'chart') ? ' lg:hidden' : ''}`}
              style={!isLg ? {
                position: 'fixed', left: 0, top: 0, bottom: 0,
                width: '82vw', maxWidth: 300,
                zIndex: 50,
                backgroundColor: '#080c14',
                borderRight: '1px solid #141a2a',
                overflowY: 'auto',
                padding: '16px 12px 32px',
                transform: settingsOpen ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 0.26s cubic-bezier(0.4,0,0.2,1)',
                boxShadow: settingsOpen ? '6px 0 32px rgba(0,0,0,0.7)' : 'none',
              } : {}}
          >
          {/* 모바일 헤더 */}
          {!isLg && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 12, paddingBottom: 12,
                borderBottom: '1px solid #141a2a',
              }}>
                <span style={{ color: '#93c5fd', fontSize: 13, fontWeight: 700 }}>⚙ {t('structSettingsLabel')}</span>
                <button
                    onClick={() => setSettingsOpen(false)}
                    style={{
                      width: 28, height: 28, borderRadius: 6,
                      backgroundColor: '#0f1422', border: '1px solid #141a2a',
                      color: '#6b7280', fontSize: 14, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >✕</button>
              </div>
          )}

            {/* Environmental Conditions */}
            <Card title={`🌍 ${t('structEnvTitle')}`}>
              <div className="flex flex-col gap-4">
                <SliderRow
                    label={t('structWindSpeed')} value={env.windSpeed} min={0} max={60} unit=" m/s"
                    onChange={v => setEnv(p => ({ ...p, windSpeed: v }))}
                    help={FORMULA_HELP.windSpeed}
                />
                <div>
                  <p className="text-xs text-gray-400 mb-1.5">{t('structWindDir')}</p>
                  <div className="grid grid-cols-4 gap-1">
                    {['N', 'E', 'S', 'W'].map(d => (
                        <button key={d}
                                onClick={() => setEnv(p => ({ ...p, windDir: d }))}
                                className={`py-1 text-xs font-bold rounded-lg border transition
                        ${env.windDir === d
                                    ? 'bg-blue-900/50 text-accent-blue border-blue-600/50'
                                    : 'bg-[#141a2a] text-gray-400 border-[#1b2236] hover:bg-[#1b2236]'}`}
                        >
                          {d}
                        </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <p className="text-xs text-gray-400">{t('structSeismicZone')}</p>
                    <FormulaTooltip data={FORMULA_HELP.seismic} />
                  </div>
                  <select
                      value={env.seismicZone}
                      onChange={e => setEnv(p => ({ ...p, seismicZone: Number(e.target.value) }))}
                      className="w-full bg-[#141a2a] border border-[#1b2236] rounded-lg
                             text-xs text-gray-200 px-2 py-1.5 focus:outline-none"
                  >
                    {SEISMIC_ZONES.map(z => (
                        <option key={z.value} value={z.value}>{z.label}</option>
                    ))}
                  </select>
                </div>
                <SliderRow
                    label={t('structSnowLoad')} value={env.snowLoad} min={0} max={5} step={0.1} unit=" kN/m²"
                    onChange={v => setEnv(p => ({ ...p, snowLoad: v }))}
                    help={FORMULA_HELP.snowLoad}
                />
                <div>
                  <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400 flex items-center gap-1">
                    {t('structTempRange')}
                    <FormulaTooltip data={FORMULA_HELP.tempRange} />
                  </span>
                    <span className="text-accent-blue">{env.tempMin}°C ~ {env.tempMax}°C</span>
                  </div>
                  <div className="flex gap-2">
                    {[
                      { key: 'tempMin', min: -50, max: 0 },
                      { key: 'tempMax', min: 0, max: 60 },
                    ].map(({ key, min, max }) => (
                        <input key={key} type="number" min={min} max={max} value={env[key]}
                               onChange={e => setEnv(p => ({ ...p, [key]: Number(e.target.value) }))}
                               className="w-full bg-[#141a2a] border border-[#1b2236] rounded-lg
                                 text-xs text-gray-200 text-center px-1 py-1 focus:outline-none"
                        />
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            {/* Load Conditions */}
            <Card title={`⚖️ ${t('structLoadCondTitle')}`} help={FORMULA_HELP.stressFormulas}>
              <div className="flex flex-col gap-2.5">
                <NumRow label={t('structDeadLoad')} value={loads.deadLoad} unit="kN/m²" min={0} max={50} step={0.5} onChange={v => setLoads(p => ({ ...p, deadLoad: v }))} help={FORMULA_HELP.deadLoad} />
                <NumRow label={t('structLiveLoad')} value={loads.liveLoad} unit="kN/m²" min={0} max={30} step={0.5} onChange={v => setLoads(p => ({ ...p, liveLoad: v }))} help={FORMULA_HELP.liveLoad} />
                <NumRow label={t('structTribArea')} value={loads.tributaryArea} unit="m²" min={1} max={100} step={1} onChange={v => setLoads(p => ({ ...p, tributaryArea: v }))} help={FORMULA_HELP.tributaryArea} />
                <NumRow label={t('structFloors')} value={loads.numFloors} unit="fl" min={1} max={100} step={1} onChange={v => setLoads(p => ({ ...p, numFloors: v }))} />
              </div>
            </Card>

          </div>

          {/* ── Center: View panel ──────────────────────────────────────── */}
          <div className="flex-1 flex flex-col gap-3 min-w-0">

            {/* View tabs */}
            <div className="flex items-center gap-1 bg-[#0f1422] border border-[#141a2a] rounded-xl p-1 w-fit">
              {[
                { id: '3d',    label: `🧊 ${t('struct3dView')}` },
                { id: 'table', label: `📋 ${t('structResultsTab')}` },
                { id: 'chart', label: `📊 ${t('structChartTab')}` },
              ].map(({ id, label }) => (
                  <button key={id} onClick={() => setViewMode(id)}
                          className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{
                            backgroundColor: viewMode === id ? '#1e3a5f' : 'transparent',
                            color: viewMode === id ? '#60a5fa' : '#8896a4',
                            border: viewMode === id ? '1px solid #2a5080' : '1px solid transparent',
                          }}
                  >
                    {label}
                  </button>
              ))}
            </div>

            {/* 3D View */}
            {viewMode === '3d' && (
                <div className="rounded-2xl overflow-hidden border border-[#141a2a] relative"
                     style={{ height: 'clamp(300px, 60vh, 700px)' }}>
                  {!modelData.length ? (
                      <div className="flex flex-col items-center justify-center h-full bg-[#0f1422] text-gray-500 gap-3">
                        <div className="text-5xl">🏗</div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-400">{t('structNoBim')}</p>
                          <p className="text-xs text-gray-600 mt-1">{t('structNoBimHint')}</p>
                        </div>
                      </div>
                  ) : (
                      <>
                        <StressViewer3D
                            modelData={modelData}
                            resultMap={resultMap}
                            selectedId={selectedId}
                            onSelect={id => setSelectedId(prev => prev === id ? null : id)}
                            glbUrl={glbUrl}
                        />
                        {/* Legend */}
                        <div className="absolute bottom-4 left-4 bg-[#0b0f1a]/90 backdrop-blur
                    rounded-xl p-3 border border-[#141a2a] flex flex-col gap-1.5">
                          <p className="text-xs text-gray-500 font-semibold mb-0.5">{t('structStatusLegend')}</p>
                          {Object.entries(STATUS_CFG).map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v.color }} />
                                <span className="text-xs text-gray-300">
                          {t(STATUS_LABEL_KEY[k])}
                                  {k === 'safe'    && ` (${t('structSFSafe')})`}
                                  {k === 'warning' && ` (${t('structSFWarn')})`}
                                  {k === 'danger'  && ` (${t('structSFDanger')})`}
                        </span>
                              </div>
                          ))}
                          {!results && (
                              <p className="text-xs text-gray-600 mt-1 italic">▶ {t('structRunToColor')}</p>
                          )}
                        </div>
                        {/* Click hint */}
                        <div className="absolute top-3 right-3 text-xs text-gray-600 bg-[#0b0f1a]/70 px-2 py-1 rounded-lg">
                          {t('structClickHint')}
                        </div>
                      </>
                  )}
                </div>
            )}

            {/* Results table */}
            {viewMode === 'table' && (
                <div className="flex-1 bg-[#0f1422] border border-[#141a2a] rounded-2xl overflow-hidden"
                     style={{ minHeight: 400 }}>
                  {!results ? (
                      <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-2">
                        <div className="text-3xl">📋</div>
                        <p className="text-sm">{t('structRunToTable')}</p>
                      </div>
                  ) : (
                      <div className="overflow-auto h-full">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-[#141a2a] sticky top-0 z-10">
                          <tr>
                            {[
                              { key: 'elementName',  label: t('structColName'),      w: 'w-28' },
                              { key: 'elementType',  label: t('structColType'),      w: 'w-16' },
                              { key: 'materialLabel',label: t('structColMat'),       w: 'w-36' },
                              { key: 'axialLoad',    label: t('structColAxial'),     w: 'w-20' },
                              { key: 'maxStress',    label: t('structColMaxStress'), w: 'w-24' },
                              { key: 'allowStress',  label: t('structColAllow'),     w: 'w-20' },
                              { key: 'safetyFactor', label: t('structColSF'),        w: 'w-20' },
                              { key: 'utilization',  label: t('structColUtil'),      w: 'w-28' },
                              { key: 'status',       label: t('structColStatus'),    w: 'w-16' },
                            ].map(col => (
                                <th key={col.key}
                                    onClick={() => toggleSort(col.key)}
                                    className={`${col.w} px-3 py-2.5 text-gray-400 font-semibold
                              cursor-pointer hover:text-gray-200 whitespace-nowrap select-none`}
                                >
                                  {col.label}
                                  {sortCfg.key === col.key && (
                                      <span className="ml-1 text-accent-blue">
                                {sortCfg.asc ? '↑' : '↓'}
                              </span>
                                  )}
                                </th>
                            ))}
                          </tr>
                          </thead>
                          <tbody>
                          {sortedResults.map((r, i) => (
                              <tr key={r.elementId}
                                  onClick={() => setSelectedId(prev => prev === r.elementId ? null : r.elementId)}
                                  className={`border-t border-[#141a2a] cursor-pointer transition
                            ${r.elementId === selectedId
                                      ? 'bg-blue-900/20'
                                      : i % 2 === 0 ? 'hover:bg-[#141a2a]' : 'bg-[#0d1118] hover:bg-[#141a2a]'}`}
                              >
                                <td className="px-3 py-2 text-gray-200 font-medium">{r.elementName}</td>
                                <td className="px-3 py-2 text-gray-400">{ELEMENT_LABELS[r.elementType] ?? r.elementType}</td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs font-mono ${r.materialFromBim ? 'text-cyan-300' : 'text-gray-500'}`}>
                                    {r.materialLabel}
                                  </span>
                                  {r.materialFromBim && (
                                    <span className="ml-1 text-xs text-cyan-600" title={t('structBimMatTooltip')}>{t('structBimTag')}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-gray-300 font-mono">{r.axialLoad}</td>
                                <td className="px-3 py-2 font-mono font-bold text-gray-100">{r.maxStress}</td>
                                <td className="px-3 py-2 font-mono text-gray-500">{r.allowStress}</td>
                                <td className="px-3 py-2 font-mono font-bold"
                                    style={{ color: STATUS_CFG[r.status].color }}>{r.safetyFactor}</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-[#141a2a] rounded-full h-1.5 w-16 overflow-hidden">
                                      <div className="h-full rounded-full"
                                           style={{
                                             width: `${Math.min(r.utilization, 100)}%`,
                                             backgroundColor: STATUS_CFG[r.status].color,
                                           }} />
                                    </div>
                                    <span className="font-mono text-gray-300 w-10 text-right">{r.utilization}%</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <StatusBadge status={r.status} />
                                    {r.dominantStressType && r.status !== 'safe' && (() => {
                                      const domLbl = t(`frStress${r.dominantStressType}`);
                                      const rKey   = r.status === 'danger' ? 'frDangerReason' : 'frWarningReason';
                                      const reason = t(rKey, { dom: domLbl, val: r.stressVal, allow: r.allowVal, margin: r.marginVal });
                                      const remKey = r.status === 'danger'
                                        ? ({ Bending: 'frRemBending', Axial: 'frRemAxial', Shear: 'frRemShear' }[r.dominantStressType] ?? 'frRemBending')
                                        : 'frRemMonitor';
                                      return (
                                        <span
                                          title={`${reason}\n→ ${t(remKey)}`}
                                          className="cursor-help text-[10px] text-gray-500 hover:text-gray-300 transition"
                                        >ℹ</span>
                                      );
                                    })()}
                                  </div>
                                </td>
                              </tr>
                          ))}
                          </tbody>
                        </table>
                      </div>
                  )}
                </div>
            )}

            {/* Chart */}
            {viewMode === 'chart' && (
                <div className="flex-1 flex flex-col gap-3" style={{ minHeight: 620 }}>
                  {!results ? (
                      <div className="flex flex-col items-center justify-center h-64
                  bg-[#0f1422] border border-[#141a2a] rounded-2xl text-gray-500 gap-2">
                        <div className="text-3xl">📊</div>
                        <p className="text-sm">{t('structRunToChart')}</p>
                      </div>
                  ) : (
                      <ChartGrid sfChart={sfChart} pieData={pieData} t={t} />
                  )}
                </div>
            )}
          </div>

          {/* ── Right: Summary panel ─────────────────────────────────── */}
          <div className={`w-full lg:w-56 lg:shrink-0 flex flex-col gap-3${(viewMode === 'table' || viewMode === 'chart') ? ' hidden' : ''}`}>

            {/* Selected Element Detail — 상단 고정, 선택 시 우선 표시 */}
            {selectedResult && (
                <Card title={`🔍 ${t('structSelectedElTitle')}`}>
                  <div className="flex flex-col gap-1.5 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-gray-200 font-medium truncate">{selectedResult.elementName}</span>
                      <StatusBadge status={selectedResult.status} />
                    </div>
                    <hr className="border-[#1b2236]" />
                    {/* 재료 정보 */}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 shrink-0">{t('structMaterial')}</span>
                      <div className="flex items-center gap-1">
                        <span className={`font-mono truncate max-w-[90px] ${selectedResult.materialFromBim ? 'text-cyan-300' : 'text-gray-400'}`}>
                          {selectedResult.materialLabel}
                        </span>
                        {selectedResult.materialFromBim ? (
                          <span className="px-1 py-0.5 rounded bg-cyan-900/40 text-cyan-400 border border-cyan-700/40 shrink-0">{t('structBimTag')}</span>
                        ) : (
                          <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-600 border border-gray-700 shrink-0">{t('structDefaultTag')}</span>
                        )}
                      </div>
                    </div>
                    <hr className="border-[#1b2236]" />
                    {[
                      { label: t('structType'),        value: ELEMENT_LABELS[selectedResult.elementType] ?? selectedResult.elementType },
                      { label: t('structAxial'),       value: `${selectedResult.axialLoad} kN` },
                      { label: t('structBendMoment'),  value: `${selectedResult.bendingMoment} kN·m` },
                      { label: t('structShearForce'),  value: `${selectedResult.shearForce} kN` },
                      { label: t('structShearStress'), value: `${selectedResult.shearStress} MPa` },
                    ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between gap-1">
                          <span className="text-gray-500 shrink-0">{label}</span>
                          <span className="font-mono text-gray-300 text-right">{value}</span>
                        </div>
                    ))}
                    <hr className="border-[#1b2236]" />
                    <div className="flex justify-between font-bold">
                      <span className="text-gray-400">{t('structMaxStressLabel')}</span>
                      <span className="font-mono text-gray-100">{selectedResult.maxStress} MPa</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span className="text-gray-400">{t('structSFLabel')}</span>
                      <span className="font-mono" style={{ color: STATUS_CFG[selectedResult.status].color }}>
                        {selectedResult.safetyFactor}
                      </span>
                    </div>
                    <div className="mt-1">
                      <div className="flex justify-between text-gray-500 mb-1">
                        <span>{t('structUtilLabel')}</span>
                        <span className="font-mono" style={{ color: STATUS_CFG[selectedResult.status].color }}>
                          {selectedResult.utilization}%
                        </span>
                      </div>
                      <div className="h-2 bg-[#141a2a] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                             style={{
                               width: `${Math.min(selectedResult.utilization, 100)}%`,
                               backgroundColor: STATUS_CFG[selectedResult.status].color,
                             }} />
                      </div>
                    </div>

                    {/* ── 원인 진단 & 보완 권고 (렌더 시 t()로 실시간 조합) ── */}
                    {selectedResult.status !== 'safe' && selectedResult.dominantStressType && (() => {
                      const domKey = `frStress${selectedResult.dominantStressType}`;
                      const domLabel = t(domKey);
                      const reasonKey = selectedResult.status === 'danger' ? 'frDangerReason' : 'frWarningReason';
                      const reasonText = t(reasonKey, {
                        dom:    domLabel,
                        val:    selectedResult.stressVal,
                        allow:  selectedResult.allowVal,
                        margin: selectedResult.marginVal,
                      });
                      const remKey = selectedResult.status === 'danger'
                        ? ({ Bending: 'frRemBending', Axial: 'frRemAxial', Shear: 'frRemShear' }[selectedResult.dominantStressType] ?? 'frRemBending')
                        : 'frRemMonitor';
                      const remText = t(remKey);
                      return (
                        <div className={`mt-2 rounded-xl border p-2.5 ${
                          selectedResult.status === 'danger'
                            ? 'bg-red-900/20 border-red-600/30'
                            : 'bg-amber-900/20 border-amber-600/30'
                        }`}>
                          {/* 지배 응력 배지 */}
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              selectedResult.status === 'danger'
                                ? 'bg-red-900/50 text-red-300'
                                : 'bg-amber-900/50 text-amber-300'
                            }`}>
                              {t('structDominantLabel', { dom: domLabel })}
                            </span>
                          </div>
                          {/* 원인 문장 */}
                          <p className={`text-[11px] font-semibold mb-1 ${
                            selectedResult.status === 'danger' ? 'text-red-300' : 'text-amber-300'
                          }`}>
                            {selectedResult.status === 'danger' ? `⚠ ${t('structFailureReason')}` : `⚠ ${t('structWarningReason')}`}
                          </p>
                          <p className="text-[10px] text-gray-300 leading-relaxed">{reasonText}</p>
                          {/* 보완 방법 */}
                          <p className="text-[11px] font-semibold mt-2 mb-1 text-blue-400">{t('structRemediation')}</p>
                          <p className="text-[10px] text-gray-400 leading-relaxed">{remText}</p>
                        </div>
                      );
                    })()}
                  </div>
                </Card>
            )}

            {/* Analysis Summary */}
            <Card title={`📊 ${t('structSummaryTitle')}`}>
              {!summary ? (
                  <p className="text-xs text-gray-600 text-center py-4">{t('structNotAnalyzed')}</p>
              ) : (
                  <>
                    <div className="grid grid-cols-3 gap-1 mb-3">
                      {Object.entries(STATUS_CFG).map(([k, v]) => (
                          <div key={k}
                               className={`flex flex-col items-center py-2 rounded-xl border ${v.bg} ${v.border}`}>
                            <span className={`text-xl font-bold ${v.text}`}>{summary.counts[k]}</span>
                            <span className={`text-xs ${v.text}`}>{t(STATUS_LABEL_KEY[k])}</span>
                          </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('structTotalLabel')}</span>
                        <span className="text-gray-200 font-medium">{summary.total}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('structMaxUtilLabel')}</span>
                        <span className={`font-mono font-bold ${summary.maxUtil >= 100 ? 'text-red-400' :
                            summary.maxUtil >= 50 ? 'text-amber-400' : 'text-green-400'}`}>
                      {summary.maxUtil.toFixed(1)}%
                    </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">{t('structMinSFLabel')}</span>
                        <span className={`font-mono font-bold ${summary.minSF < 1 ? 'text-red-400' :
                            summary.minSF < 2 ? 'text-amber-400' : 'text-green-400'}`}>
                      {summary.minSF.toFixed(2)}
                    </span>
                      </div>
                    </div>
                  </>
              )}
            </Card>

            {/* Safety Indicators */}
            <Card title={`🚦 ${t('structIndicatorsTitle')}`}>
              {!summary ? (
                  <p className="text-xs text-gray-600 text-center py-4">{t('structAvailAfter')}</p>
              ) : (
                  <div className="flex flex-col gap-2">
                    {[
                      {
                        label: t('structWindRes'),
                        st: env.windSpeed <= 30 ? 'safe' : env.windSpeed <= 50 ? 'warning' : 'danger',
                      },
                      {
                        label: t('structSeismicRes'),
                        st: env.seismicZone <= 2 ? 'safe' : env.seismicZone === 3 ? 'warning' : 'danger',
                      },
                      {
                        label: t('structStructuralSF'),
                        st: summary.counts.danger > 0 ? 'danger' : summary.counts.warning > 0 ? 'warning' : 'safe',
                      },
                      {
                        label: t('structMatSafety'),
                        st: summary.maxUtil < 50 ? 'safe' : summary.maxUtil < 100 ? 'warning' : 'danger',
                      },
                    ].map(({ label, st }) => {
                      const c = STATUS_CFG[st];
                      return (
                          <div key={label} className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">{label}</span>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                              <span className={`text-xs font-semibold ${c.text}`}>{c.label}</span>
                            </div>
                          </div>
                      );
                    })}
                  </div>
              )}
            </Card>

            {/* Current Conditions */}
            <Card title={`📌 ${t('structCondTitle')}`}>
              <div className="flex flex-col gap-1.5 text-xs">
                {[
                  { label: t('structWind'),       value: `${env.windSpeed} m/s`, highlight: true },
                  { label: t('structDir'),         value: env.windDir },
                  { label: t('structSeismicZone'), value: `Zone ${env.seismicZone}`, highlight: true },
                  { label: t('structSnow'),        value: `${env.snowLoad} kN/m²` },
                  { label: t('structTemp'),        value: `${env.tempMin}~${env.tempMax}°C` },
                  { label: t('structDeadLoad'),    value: `${loads.deadLoad} kN/m²` },
                  { label: t('structLiveLoad'),    value: `${loads.liveLoad} kN/m²` },
                  { label: t('structFloors'),      value: `${loads.numFloors} fl` },
                ].map(({ label, value, highlight }) => (
                    <div key={label} className="flex justify-between gap-1">
                      <span className="text-gray-500 shrink-0">{label}</span>
                      <span className={`font-mono text-right truncate ${highlight ? 'text-accent-blue' : 'text-gray-300'}`}>
                        {value}
                      </span>
                    </div>
                ))}
                {/* 재료: 결과가 있으면 실제 적용된 재료 목록, 없으면 기본값 */}
                <div className="border-t border-[#1b2236] pt-1.5 mt-0.5">
                  {results ? (() => {
                    const matGroups = results.reduce((acc, r) => {
                      const key = r.materialId;
                      if (!acc[key]) acc[key] = { label: r.materialLabel, fromBim: r.materialFromBim, count: 0 };
                      acc[key].count++;
                      return acc;
                    }, {});
                    const entries = Object.values(matGroups);
                    return (
                      <>
                        <p className="text-gray-600 mb-1">{t('structAppliedMats', { n: entries.length })}</p>
                        {entries.map(m => (
                          <div key={m.label} className="flex items-center justify-between gap-1 py-0.5">
                            <div className="flex items-center gap-1 min-w-0">
                              {m.fromBim
                                ? <span className="text-cyan-600 shrink-0">{t('structBimTag')}</span>
                                : <span className="text-gray-600 shrink-0">{t('structDefaultTag')}</span>
                              }
                              <span className={`truncate font-mono ${m.fromBim ? 'text-cyan-300' : 'text-gray-400'}`}>
                                {m.label}
                              </span>
                            </div>
                            <span className="text-gray-600 shrink-0">{t('structMemberCount', { n: m.count })}</span>
                          </div>
                        ))}
                      </>
                    );
                  })() : (
                    <div className="flex justify-between gap-1">
                      <span className="text-gray-500 shrink-0">{t('structDefaultMatLabel')}</span>
                      <span className="font-mono text-gray-300 text-right truncate">
                        {MATERIALS[matId]?.label ?? matId}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {/* DSM 해석 오류 */}
            {dsmError && (
              <Card title={t('structDsmError')}>
                <p className="text-xs text-red-400">{dsmError}</p>
              </Card>
            )}

            {/* DSM 적용 하중 요약 (해석 완료 후 표시) */}
            {dsmResult?.appliedLoads && (
              <Card title={`📐 ${t('structDsmAppliedLoads')}`}>
                <div className="bg-[#0d1220] border border-[#1b2a40] rounded-lg p-2 text-[10px] flex flex-col gap-1">
                  {Object.entries(dsmResult.appliedLoads)
                    .filter(([k]) => k !== 'governingCombo')
                    .map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-gray-500">{
                        { deadLoad: t('structLoadDead'), liveLoad: t('structLoadLive'),
                          windLoad: t('structLoadWind'), seismicForce: t('structLoadSeismic') }[k] ?? k
                      }</span>
                      <span className="font-mono text-gray-300">{Number(v).toFixed(1)} kN</span>
                    </div>
                  ))}
                  {dsmResult.appliedLoads.governingCombo && (
                    <div className="flex justify-between mt-1 pt-1 border-t border-[#1b2236]">
                      <span className="text-gray-400">{t('structDsmGovCombo')}</span>
                      <span className="text-blue-400 font-bold">#{dsmResult.appliedLoads.governingCombo}</span>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {/* 시방서 기준 (KCS/KDS) */}
            {(specLoading || specData) && (
                <Card title={t('specPanelTitle')}>
                  {specLoading ? (
                      <div className="flex items-center gap-2 py-3 justify-center">
                        <span className="inline-block w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
                        <span className="text-xs text-gray-500">{t('specSearching')}</span>
                      </div>
                  ) : !specData?.hasData ? (
                      <p className="text-xs text-gray-600 text-center py-3">{t('specNoData')}</p>
                  ) : (
                      <div className="flex flex-col gap-2">
                        {specData.citations.map((c, i) => (
                            <div key={i}
                                 className="border border-[#1b2236] rounded-xl overflow-hidden">
                              <button
                                  onClick={() => setSpecOpen(p => p === i ? null : i)}
                                  className="w-full flex items-start justify-between gap-2 px-2.5 py-2 text-left
                          hover:bg-[#141a2a] transition-colors"
                              >
                                <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-xs font-semibold text-blue-400 truncate leading-tight">
                            {c.source || t('specSourceUnknown')}
                          </span>
                                  <span className="text-xs text-gray-500 truncate leading-tight">
                            {c.series}
                          </span>
                                </div>
                                <span className="text-gray-500 text-xs shrink-0 mt-0.5">
                          {specOpen === i ? '▲' : '▼'}
                        </span>
                              </button>
                              {specOpen === i && (
                                  <div className="px-2.5 pb-2.5 border-t border-[#1b2236]">
                                    <p className="text-xs text-gray-400 leading-relaxed mt-2 whitespace-pre-wrap break-words">
                                      {c.content}
                                    </p>
                                  </div>
                              )}
                            </div>
                        ))}
                      </div>
                  )}
                </Card>
            )}

          </div>
        </div>
      </div>
  );
}