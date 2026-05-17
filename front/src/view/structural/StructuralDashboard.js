import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, ResponsiveContainer,
} from 'recharts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const MATERIALS = {
  concrete_24: {
    id: 'concrete_24', label: 'Concrete C24', density: 24,
    allowCompressive: 16, allowShear: 1.4,
  },
  concrete_30: {
    id: 'concrete_30', label: 'Concrete C30', density: 24,
    allowCompressive: 20, allowShear: 1.7,
  },
  concrete_40: {
    id: 'concrete_40', label: 'Concrete C40', density: 24,
    allowCompressive: 26.7, allowShear: 2.1,
  },
  steel_235: {
    id: 'steel_235', label: 'Steel SS275', density: 78.5,
    allowCompressive: 157, allowShear: 91,
  },
  steel_355: {
    id: 'steel_355', label: 'Steel SM355', density: 78.5,
    allowCompressive: 237, allowShear: 137,
  },
};

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

const STATUS_CFG = {
  safe: { label: 'Safe', color: '#22c55e', bg: 'bg-green-900/40', text: 'text-green-300', border: 'border-green-600/40' },
  warning: { label: 'Warning', color: '#f59e0b', bg: 'bg-amber-900/40', text: 'text-amber-300', border: 'border-amber-600/40' },
  danger: { label: 'Danger', color: '#ef4444', bg: 'bg-red-900/40', text: 'text-red-300', border: 'border-red-600/40' },
};

const FORMULA_HELP = {
  windSpeed: {
    title: 'Wind Load',
    formula: 'q = 0.6125 × V² / 1000 × Cf × G',
    vars: [
      { s: 'q',       d: 'Design wind pressure (kN/m²)' },
      { s: 'V',       d: 'Wind speed (m/s)' },
      { s: 'Cf=1.3',  d: 'Force coefficient' },
      { s: 'G=1.5',   d: 'Gust factor' },
      { s: 'F_wind',  d: 'q × h_factor × width × height' },
    ],
    sub: 'h_factor = ((y+H)/10 + 1)^0.25  (height amplification)',
  },
  seismic: {
    title: 'Seismic Force',
    formula: 'F_seismic = Sa × W',
    vars: [
      { s: 'Sa',      d: 'Spectral acceleration (0.08g–0.32g by zone)' },
      { s: 'W',       d: 'Seismic weight ≈ axial load (kN)' },
    ],
    sub: 'Lateral design: max(F_wind, F_seismic)',
  },
  snowLoad: {
    title: 'Snow Load — Slab',
    formula: 'q_slab = D + L + S + γ·t',
    vars: [
      { s: 'D',       d: 'Dead load (kN/m²)' },
      { s: 'L',       d: 'Live load (kN/m²)' },
      { s: 'S',       d: 'Snow load (kN/m²)' },
      { s: 'γ·t',     d: 'Slab self-weight (density × thickness)' },
    ],
    sub: 'M = q·L²/10  (continuous slab)  |  V = q·L/2',
  },
  tempRange: {
    title: 'Thermal Effect',
    formula: 'ε_T = α × ΔT',
    vars: [
      { s: 'α',       d: '1.0×10⁻⁵/°C (concrete) / 1.2×10⁻⁵/°C (steel)' },
      { s: 'ΔT',      d: 'T_max − T_min (°C)' },
      { s: 'σ_T',     d: 'E × α × ΔT  — informational only' },
    ],
    sub: 'Thermal stress is shown as reference; not included in current SF',
  },
  deadLoad: {
    title: 'Dead Load — Column Axial',
    formula: 'N = W_self + D × A_trib × n_floors',
    vars: [
      { s: 'W_self',  d: 'Element self-weight (kN)' },
      { s: 'D',       d: 'Dead load per floor (kN/m²)' },
      { s: 'A_trib',  d: 'Tributary area (m²)' },
      { s: 'n',       d: 'Number of floors' },
    ],
    sub: 'σ_axial = N / (A × 1000)  [MPa]',
  },
  liveLoad: {
    title: 'Live Load — Beam UDL',
    formula: 'w = w_self + (D + L) × √A_trib',
    vars: [
      { s: 'w_self',  d: 'Beam self-weight per metre (kN/m)' },
      { s: 'L',       d: 'Live load intensity (kN/m²)' },
      { s: '√A_trib', d: 'Influence width (m)' },
    ],
    sub: 'M = w·L²/8  |  V = w·L/2  (simply-supported)',
  },
  tributaryArea: {
    title: 'Tributary Area',
    formula: 'A_trib ≈ (column spacing)²',
    vars: [
      { s: 'A_trib',  d: 'Floor area supported per column (m²)' },
    ],
    sub: 'Used in axial load (column) and UDL width (beam)',
  },
  material: {
    title: 'Safety Factor & Utilization',
    formula: 'SF = f_allow / σ_max\nη  = σ_max / f_allow × 100 (%)',
    vars: [
      { s: 'f_allow', d: 'Allowable compressive stress (MPa)' },
      { s: 'σ_max',   d: 'max(σ_axial + σ_bending, τ_shear)' },
    ],
    sub: 'Safe: SF ≥ 2.0  |  Warning: 1.0–2.0  |  Danger: < 1.0',
  },
  stressFormulas: {
    title: 'Element Stress Formulas',
    formula: 'σ_axial  = N / (A·1000)\nσ_bend   = M·c / (I·1000)\nτ_shear  = 1.5·V / (A·1000)',
    vars: [
      { s: 'N',  d: 'Axial force (kN)' },
      { s: 'M',  d: 'Bending moment (kN·m)' },
      { s: 'V',  d: 'Shear force (kN)' },
      { s: 'c',  d: 'Distance to extreme fibre (m)' },
      { s: 'I',  d: 'Second moment of area (m⁴)' },
    ],
    sub: 'All stresses in MPa  (÷1000 converts kN/m² → MPa)',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Structural analysis engine
// σ(MPa) = Force(kN) / Area(m²) / 1000
// σ(MPa) = M(kN·m) × c(m)  / I(m⁴) / 1000
// τ(MPa) = 1.5 × V(kN)     / A(m²) / 1000  (rectangular section)
// ──────────────────────────────────────────────────────────────────────────────

function runAnalysis(modelData, env, loads, matId) {
  const mat = MATERIALS[matId];
  const seismic = SEISMIC_ZONES.find(z => z.value === env.seismicZone) ?? SEISMIC_ZONES[1];

  // Design wind pressure (kN/m²): q = 0.6125 × V²/1000 × Cf(1.3) × gust(1.5)
  const qDesign = 0.6125 * (env.windSpeed ** 2) / 1000 * 1.3 * 1.5;

  return modelData.map((el, idx) => {
    const sX = Math.max(Number(el.sizeX) || 0.3, 0.01);
    const sY = Math.max(Number(el.sizeY) || 3.0, 0.01);
    const sZ = Math.max(Number(el.sizeZ) || 0.3, 0.01);
    const pY = Number(el.positionY) || 0;
    const type = el.elementType || 'IfcColumn';

    const selfWt = sX * sY * sZ * mat.density; // kN (total self weight)

    let A, I, c, L;
    let axialLoad = 0, bendingMoment = 0, shearForce = 0;

    if (type === 'IfcColumn' || type === 'IfcPier') {
      // Section sX×sZ, height sY
      A = sX * sZ;
      I = sX * sZ ** 3 / 12;
      c = sZ / 2;
      L = sY;

      // Axial = self weight + tributary area × floor loads
      axialLoad = selfWt + (loads.deadLoad + loads.liveLoad) * loads.tributaryArea * loads.numFloors;

      // Lateral: larger of wind vs seismic
      const hFactor = Math.pow((pY + sY) / 10 + 1, 0.25);
      const Fwind = qDesign * hFactor * sX * L;      // kN
      const Fseismic = seismic.Sa * axialLoad;           // kN
      const Flateral = Math.max(Fwind, Fseismic);

      bendingMoment = Flateral * L / 2;  // kN·m (mid section)
      shearForce = Flateral;          // kN

    } else if (type === 'IfcBeam' || type === 'IfcMember') {
      // Section sX(width)×sY(height), span sZ
      A = sX * sY;
      I = sX * sY ** 3 / 12;
      c = sY / 2;
      L = Math.max(sZ, 0.1);

      // UDL (kN/m) = self weight/m + floor load × influence width
      const wSelf = sX * sY * mat.density;
      const wFloor = (loads.deadLoad + loads.liveLoad) * Math.sqrt(loads.tributaryArea);
      const w = wSelf + wFloor;

      bendingMoment = w * L ** 2 / 8; // kN·m
      shearForce = w * L / 2;       // kN
      axialLoad = 0;

    } else if (type === 'IfcWall') {
      // Length sX, height sY, thickness sZ
      A = sX * sZ;           // vertical cross-section
      I = sZ * sX ** 3 / 12; // in-plane moment of inertia
      c = sX / 2;
      L = sY;

      axialLoad = selfWt + loads.deadLoad * sX * sZ * loads.numFloors;
      const Fw = qDesign * sX * sY;
      const Fs = seismic.Sa * axialLoad;
      shearForce = Math.max(Fw, Fs);
      bendingMoment = 0; // shear wall — in-plane shear governs

    } else if (type === 'IfcSlab') {
      // Thickness sY, span min(sX,sZ) — unit width 1m
      const span = Math.min(sX, sZ);
      A = 1.0 * sY;
      I = sY ** 3 / 12;
      c = sY / 2;
      L = Math.max(span, 0.1);

      const q = loads.deadLoad + loads.liveLoad + env.snowLoad + sY * mat.density;
      bendingMoment = q * L ** 2 / 10; // kN·m/m (continuous slab)
      shearForce = q * L / 2;
      axialLoad = 0;

    } else {
      A = sX * sZ;
      I = sX * sZ ** 3 / 12;
      c = sZ / 2;
      L = sY;
      axialLoad = selfWt;
    }

    const eps = 1e-9;
    const sigmaAxial = axialLoad / (Math.max(A, eps) * 1000); // MPa
    const sigmaBending = (bendingMoment * c) / (Math.max(I, eps) * 1000); // MPa
    const sigmaShear = 1.5 * shearForce / (Math.max(A, eps) * 1000);    // MPa

    const maxStress = Math.max(sigmaAxial + sigmaBending, sigmaShear, 0.001);
    const allowStress = mat.allowCompressive;
    const sf = allowStress / maxStress;
    const util = (maxStress / allowStress) * 100;
    const status = sf >= 2.0 ? 'safe' : sf >= 1.0 ? 'warning' : 'danger';

    return {
      elementId: el.elementId ?? idx,
      elementName: el.elementName || `${ELEMENT_LABELS[type] ?? type}-${idx + 1}`,
      elementType: type,
      selfWeight: +selfWt.toFixed(2),
      axialLoad: +axialLoad.toFixed(2),
      windLoad: +(qDesign * sX * sY).toFixed(2),
      seismicLoad: +(seismic.Sa * Math.max(axialLoad, selfWt)).toFixed(2),
      bendingMoment: +bendingMoment.toFixed(2),
      shearForce: +shearForce.toFixed(2),
      axialStress: +sigmaAxial.toFixed(3),
      bendingStress: +sigmaBending.toFixed(3),
      shearStress: +sigmaShear.toFixed(3),
      maxStress: +maxStress.toFixed(3),
      allowStress: +allowStress.toFixed(1),
      safetyFactor: +Math.min(sf, 99.9).toFixed(2),
      utilization: +Math.min(util, 999).toFixed(1),
      status,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 3D Stress Viewer
// ──────────────────────────────────────────────────────────────────────────────

function StressBox({ element, result, isSelected, onSelect }) {
  const sX = Math.max(Number(element.sizeX) || 0.3, 0.05);
  const sY = Math.max(Number(element.sizeY) || 3.0, 0.05);
  const sZ = Math.max(Number(element.sizeZ) || 0.3, 0.05);
  const pX = Number(element.positionX) || 0;
  const pY = (Number(element.positionY) || 0) + sY / 2;
  const pZ = Number(element.positionZ) || 0;

  const color = result ? STATUS_CFG[result.status].color : '#374151';
  const emissI = isSelected ? 0.4 : 0;

  return (
    <mesh
      position={[pX, pY, pZ]}
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

function StressViewer3D({ modelData, resultMap, selectedId, onSelect }) {
  return (
    <Canvas camera={{ position: [15, 15, 15], fov: 50 }} style={{ background: '#0b0f1a', height: 'clamp(300px, 70vh, 1000px)' }}>
      <ambientLight intensity={0.55} />
      <directionalLight position={[10, 15, 5]} intensity={0.85} castShadow />
      <directionalLight position={[-5, 8, -5]} intensity={0.25} />
      <gridHelper args={[60, 60, '#1a3a5c', '#1a3a5c']} />

      {modelData.map(el => (
        <StressBox
          key={el.elementId}
          element={el}
          result={resultMap[el.elementId]}
          isSelected={el.elementId === selectedId}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls makeDefault />
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport
          axisColors={['#ef4444', '#22c55e', '#60a5fa']}
          labelColor="#e2e8f0"
        />
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

function StatusBadge({ status }) {
  const c = STATUS_CFG[status];
  return (
    <span className={`px-2 py-0.5 text-xs font-semibold border rounded-md ${c.bg} ${c.text} ${c.border}`}>
      {c.label}
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
// Main dashboard
// ──────────────────────────────────────────────────────────────────────────────

export default function StructuralDashboard({ selectedProject, modelData = [] }) {

  // Environmental conditions
  const [env, setEnv] = useState({
    windSpeed: 20,    // m/s
    windDir: 'N',
    seismicZone: 2,
    snowLoad: 0.5,  // kN/m²
    tempMin: -10,
    tempMax: 35,
  });

  // Load conditions
  const [loads, setLoads] = useState({
    deadLoad: 5.0,  // kN/m²
    liveLoad: 2.5,  // kN/m²
    tributaryArea: 16,   // m²
    numFloors: 3,
  });

  // Material
  const [matId, setMatId] = useState('concrete_24');

  // Analysis results
  const [results, setResults] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // UI
  const [viewMode, setViewMode] = useState('3d');
  const [selectedId, setSelectedId] = useState(null);
  const [sortCfg, setSortCfg] = useState({ key: 'safetyFactor', asc: true });

  const handleAnalyze = useCallback(() => {
    if (!modelData.length) return;
    setIsAnalyzing(true);
    setTimeout(() => {
      setResults(runAnalysis(modelData, env, loads, matId));
      setIsAnalyzing(false);
    }, 500);
  }, [modelData, env, loads, matId]);

  // 입력값 변경 시 자동 재계산 (Run Analysis 최초 1회 이후만)
  useEffect(() => {
    if (!results || !modelData.length) return;
    const id = setTimeout(() => {
      setResults(runAnalysis(modelData, env, loads, matId));
    }, 250);
    return () => clearTimeout(id);
  }, [env, loads, matId, modelData]); // eslint-disable-line react-hooks/exhaustive-deps

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
      safetyFactor: r.safetyFactor,
      utilization: r.utilization,
      fill: STATUS_CFG[r.status].color,
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

  return (
    <div className="w-full bg-space-900 flex flex-col overflow-hidden box-border p-3">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <span>🔩</span> Structural Analysis
            {selectedProject && (
              <span className="text-sm font-normal text-gray-400">
                — {selectedProject.projectName}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Set environmental conditions &amp; loads, then run analysis → Visualize safe/danger zones on BIM model
          </p>
        </div>
        <div className="flex items-center gap-3">
          {results && (
            <span className="text-xs text-gray-500 flex items-center gap-1.5">
              {modelData.length} elements
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="Live — auto-recalculates on input change" />
            </span>
          )}
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !modelData.length}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold
              bg-accent-blue/10 text-accent-blue border border-accent-blue/30
              hover:bg-accent-blue/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {isAnalyzing ? '⏳ Analyzing…' : results ? '↺ Re-run' : '▶ Run Analysis'}
          </button>
        </div>
      </div>

      {/* Mobile settings toggle */}
      <button
        onClick={() => setSettingsOpen(v => !v)}
        className="lg:hidden flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-colors self-start"
        style={{
          backgroundColor: settingsOpen ? "#1e3a5f" : "#0f1422",
          border: settingsOpen ? "1px solid #2a5080" : "1px solid #141a2a",
          color: settingsOpen ? "#60a5fa" : "#8896a4",
        }}
      >
        <span>{settingsOpen ? "▲" : "▼"}</span>
        {settingsOpen ? "Collapse Settings" : "⚙ Env · Load · Material"}
      </button>

      {/* Main layout */}
      <div className="flex flex-col lg:flex-row gap-3 flex-1">

        {/* ── Left: Settings panel ────────────────────────────────────── */}
        <div className={`lg:w-64 lg:shrink-0 flex flex-col gap-3 ${settingsOpen ? 'flex' : 'hidden lg:flex'}`}>

          {/* Environmental Conditions */}
          <Card title="🌍 Environmental Conditions">
            <div className="flex flex-col gap-4">
              <SliderRow
                label="Wind Speed" value={env.windSpeed} min={0} max={60} unit=" m/s"
                onChange={v => setEnv(p => ({ ...p, windSpeed: v }))}
                help={FORMULA_HELP.windSpeed}
              />
              <div>
                <p className="text-xs text-gray-400 mb-1.5">Wind Dir</p>
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
                  <p className="text-xs text-gray-400">Seismic Zone</p>
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
                label="Snow Load" value={env.snowLoad} min={0} max={5} step={0.1} unit=" kN/m²"
                onChange={v => setEnv(p => ({ ...p, snowLoad: v }))}
                help={FORMULA_HELP.snowLoad}
              />
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400 flex items-center gap-1">
                    Temp Range
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
          <Card title="⚖️ Load Conditions" help={FORMULA_HELP.stressFormulas}>
            <div className="flex flex-col gap-2.5">
              <NumRow label="Dead Load" value={loads.deadLoad} unit="kN/m²" min={0} max={50} step={0.5} onChange={v => setLoads(p => ({ ...p, deadLoad: v }))} help={FORMULA_HELP.deadLoad} />
              <NumRow label="Live Load" value={loads.liveLoad} unit="kN/m²" min={0} max={30} step={0.5} onChange={v => setLoads(p => ({ ...p, liveLoad: v }))} help={FORMULA_HELP.liveLoad} />
              <NumRow label="Tributary Area" value={loads.tributaryArea} unit="m²" min={1} max={100} step={1} onChange={v => setLoads(p => ({ ...p, tributaryArea: v }))} help={FORMULA_HELP.tributaryArea} />
              <NumRow label="Floors" value={loads.numFloors} unit="fl" min={1} max={100} step={1} onChange={v => setLoads(p => ({ ...p, numFloors: v }))} />
            </div>
          </Card>

          {/* Material */}
          <Card title="🏗 Material" help={FORMULA_HELP.material}>
            <div className="flex flex-col gap-1.5">
              {Object.values(MATERIALS).map(m => (
                <label key={m.id}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border transition
                    ${matId === m.id
                      ? 'bg-blue-900/30 border-blue-600/40 text-gray-100'
                      : 'bg-[#141a2a] border-[#1b2236] text-gray-400 hover:bg-[#1b2236]'}`}
                >
                  <input type="radio" name="mat" value={m.id} checked={matId === m.id}
                    onChange={() => setMatId(m.id)} className="accent-blue-500" />
                  <div>
                    <div className="text-xs font-medium">{m.label}</div>
                    <div className="text-xs text-gray-500">Allow. Comp. {m.allowCompressive} MPa</div>
                  </div>
                </label>
              ))}
            </div>
          </Card>
        </div>

        {/* ── Center: View panel ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col gap-3 min-w-0" style={{height : 'clamp(300px, 75vh, 1000px)'}}>

          {/* View tabs */}
          <div className="flex items-center gap-1 bg-[#0f1422] border border-[#141a2a] rounded-xl p-1 w-fit">
            {[
              { id: '3d', label: '🧊 3D View' },
              { id: 'table', label: '📋 Results' },
              { id: 'chart', label: '📊 Chart' },
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
            <div className="flex-1 rounded-2xl overflow-hidden border border-[#141a2a] relative"
              style={{ height: 'clamp(300px, 40vh, 600px)' }}>
              {!modelData.length ? (
                <div className="flex flex-col items-center justify-center h-full bg-[#0f1422] text-gray-500 gap-3">
                  <div className="text-5xl">🏗</div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-400">Please select a BIM project first</p>
                    <p className="text-xs text-gray-600 mt-1">Go to BIM tab → select a project, then come back here</p>
                  </div>
                </div>
              ) : (
                <>
                  <StressViewer3D
                    modelData={modelData}
                    resultMap={resultMap}
                    selectedId={selectedId}
                    onSelect={id => setSelectedId(prev => prev === id ? null : id)}
                  />
                  {/* Legend */}
                  <div className="absolute bottom-4 left-4 bg-[#0b0f1a]/90 backdrop-blur
                    rounded-xl p-3 border border-[#141a2a] flex flex-col gap-1.5">
                    <p className="text-xs text-gray-500 font-semibold mb-0.5">Status</p>
                    {Object.entries(STATUS_CFG).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v.color }} />
                        <span className="text-xs text-gray-300">
                          {v.label}
                          {k === 'safe' && ' (SF ≥ 2.0)'}
                          {k === 'warning' && ' (1.0 ≤ SF < 2.0)'}
                          {k === 'danger' && ' (SF < 1.0)'}
                        </span>
                      </div>
                    ))}
                    {!results && (
                      <p className="text-xs text-gray-600 mt-1 italic">▶ Run analysis to show colors</p>
                    )}
                  </div>
                  {/* Click hint */}
                  <div className="absolute top-3 right-3 text-xs text-gray-600 bg-[#0b0f1a]/70 px-2 py-1 rounded-lg">
                    Click element → Details
                  </div>
                </>
              )}
            </div>
          )}

          {/* Results table */}
          {viewMode === 'table' && (
            <div className="flex-1 bg-[#0f1422] border border-[#141a2a] rounded-2xl overflow-hidden"
              style={{ minHeight: 'clamp(300px, 55vh, 700px)' }}>
              {!results ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-2">
                  <div className="text-3xl">📋</div>
                  <p className="text-sm">Run structural analysis to see results</p>
                </div>
              ) : (
                <div className="overflow-auto h-full">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#141a2a] sticky top-0 z-10">
                      <tr>
                        {[
                          { key: 'elementName', label: 'Name', w: 'w-28' },
                          { key: 'elementType', label: 'Type', w: 'w-16' },
                          { key: 'axialLoad', label: 'Axial(kN)', w: 'w-20' },
                          { key: 'windLoad', label: 'Wind(kN)', w: 'w-20' },
                          { key: 'seismicLoad', label: 'Seismic(kN)', w: 'w-16' },
                          { key: 'maxStress', label: 'Max Stress(MPa)', w: 'w-24' },
                          { key: 'allowStress', label: 'Allow.(MPa)', w: 'w-20' },
                          { key: 'safetyFactor', label: 'SF', w: 'w-20' },
                          { key: 'utilization', label: 'Util.(%)', w: 'w-28' },
                          { key: 'status', label: 'Status', w: 'w-16' },
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
                          <td className="px-3 py-2 text-gray-300 font-mono">{r.axialLoad}</td>
                          <td className="px-3 py-2 text-gray-300 font-mono">{r.windLoad}</td>
                          <td className="px-3 py-2 text-gray-300 font-mono">{r.seismicLoad}</td>
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
                          <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
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
            <div className="flex-1 flex flex-col gap-3" style={{ minHeight: 480 }}>
              {!results ? (
                <div className="flex flex-col items-center justify-center h-64
                  bg-[#0f1422] border border-[#141a2a] rounded-2xl text-gray-500 gap-2">
                  <div className="text-3xl">📊</div>
                  <p className="text-sm">Run structural analysis to see charts</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {/* Safety Factor bar */}
                  <div className="bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">Safety Factor by Element (SF)</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={sfChart} margin={{ top: 5, right: 5, left: -25, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1b2236" />
                        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9 }} angle={-30} textAnchor="end" />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, fontSize: 11 }}
                          labelStyle={{ color: '#e2e8f0' }}
                          formatter={v => [v, 'Safety Factor']}
                        />
                        <Bar dataKey="safetyFactor" radius={[4, 4, 0, 0]}>
                          {sfChart.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Status distribution pie */}
                  <div className="bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">Status Distribution</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={75}
                          paddingAngle={4} dataKey="value"
                          label={({ name, value }) => `${name} ${value}`}
                          labelLine={{ stroke: '#374151' }}
                        >
                          {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Pie>
                        <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, fontSize: 11 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Utilization bar (full width) */}
                  <div className="col-span-2 bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">Utilization by Element (%)</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={sfChart} margin={{ top: 5, right: 5, left: -25, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1b2236" />
                        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9 }} angle={-30} textAnchor="end" />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} domain={[0, 120]} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, fontSize: 11 }}
                          formatter={v => [`${v}%`, 'Utilization']}
                        />
                        <Bar dataKey="utilization" radius={[3, 3, 0, 0]}>
                          {sfChart.map((d, i) => <Cell key={i} fill={d.fill} opacity={0.85} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Summary panel ─────────────────────────────────── */}
        <div className="w-56 shrink-0 flex flex-col gap-3">

          {/* Analysis Summary */}
          <Card title="📊 Analysis Summary">
            {!summary ? (
              <p className="text-xs text-gray-600 text-center py-4">Not analyzed yet</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1 mb-3">
                  {Object.entries(STATUS_CFG).map(([k, v]) => (
                    <div key={k}
                      className={`flex flex-col items-center py-2 rounded-xl border ${v.bg} ${v.border}`}>
                      <span className={`text-xl font-bold ${v.text}`}>{summary.counts[k]}</span>
                      <span className={`text-xs ${v.text}`}>{v.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total</span>
                    <span className="text-gray-200 font-medium">{summary.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max Utilization</span>
                    <span className={`font-mono font-bold ${summary.maxUtil >= 100 ? 'text-red-400' :
                        summary.maxUtil >= 50 ? 'text-amber-400' : 'text-green-400'}`}>
                      {summary.maxUtil.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Min Safety Factor</span>
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
          <Card title="🚦 Safety Indicators">
            {!summary ? (
              <p className="text-xs text-gray-600 text-center py-4">Available after analysis</p>
            ) : (
              <div className="flex flex-col gap-2">
                {[
                  {
                    label: 'Wind Resistance',
                    st: env.windSpeed <= 30 ? 'safe' : env.windSpeed <= 50 ? 'warning' : 'danger',
                  },
                  {
                    label: 'Seismic Resistance',
                    st: env.seismicZone <= 2 ? 'safe' : env.seismicZone === 3 ? 'warning' : 'danger',
                  },
                  {
                    label: 'Structural SF',
                    st: summary.counts.danger > 0 ? 'danger' : summary.counts.warning > 0 ? 'warning' : 'safe',
                  },
                  {
                    label: 'Material Safety',
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
          <Card title="📌 Current Conditions">
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                { label: 'Wind', value: `${env.windSpeed} m/s`, highlight: true },
                { label: 'Dir', value: env.windDir },
                { label: 'Seismic Zone', value: `Zone ${env.seismicZone}`, highlight: true },
                { label: 'Snow Load', value: `${env.snowLoad} kN/m²` },
                { label: 'Temp', value: `${env.tempMin}~${env.tempMax}°C` },
                { label: 'Dead Load', value: `${loads.deadLoad} kN/m²` },
                { label: 'Live Load', value: `${loads.liveLoad} kN/m²` },
                { label: 'Floors', value: `${loads.numFloors} fl` },
                { label: 'Material', value: MATERIALS[matId].label },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="flex justify-between gap-1">
                  <span className="text-gray-500 shrink-0">{label}</span>
                  <span className={`font-mono text-right truncate ${highlight ? 'text-accent-blue' : 'text-gray-300'}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          {/* Selected Element Detail */}
          {selectedResult && (
            <Card title="🔍 Selected Element">
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-gray-200 font-medium truncate">{selectedResult.elementName}</span>
                  <StatusBadge status={selectedResult.status} />
                </div>
                <hr className="border-[#1b2236]" />
                {[
                  { label: 'Type', value: ELEMENT_LABELS[selectedResult.elementType] ?? selectedResult.elementType },
                  { label: 'Self Weight', value: `${selectedResult.selfWeight} kN` },
                  { label: 'Axial', value: `${selectedResult.axialLoad} kN` },
                  { label: 'Wind Load', value: `${selectedResult.windLoad} kN` },
                  { label: 'Seismic Load', value: `${selectedResult.seismicLoad} kN` },
                  { label: 'Bending Moment', value: `${selectedResult.bendingMoment} kN·m` },
                  { label: 'Shear Force', value: `${selectedResult.shearForce} kN` },
                  { label: 'Axial Stress', value: `${selectedResult.axialStress} MPa` },
                  { label: 'Bending Stress', value: `${selectedResult.bendingStress} MPa` },
                  { label: 'Shear Stress', value: `${selectedResult.shearStress} MPa` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-1">
                    <span className="text-gray-500 shrink-0">{label}</span>
                    <span className="font-mono text-gray-300 text-right">{value}</span>
                  </div>
                ))}
                <hr className="border-[#1b2236]" />
                <div className="flex justify-between font-bold">
                  <span className="text-gray-400">Max Stress</span>
                  <span className="font-mono text-gray-100">{selectedResult.maxStress} MPa</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-gray-400">Safety Factor (SF)</span>
                  <span className="font-mono" style={{ color: STATUS_CFG[selectedResult.status].color }}>
                    {selectedResult.safetyFactor}
                  </span>
                </div>
                {/* Utilization gauge */}
                <div className="mt-1">
                  <div className="flex justify-between text-gray-500 mb-1">
                    <span>Utilization</span>
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
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
