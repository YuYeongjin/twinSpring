import React, { useState, useMemo, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  PieChart, Pie, Legend, ResponsiveContainer,
} from 'recharts';

// ──────────────────────────────────────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────────────────────────────────────

const MATERIALS = {
  concrete_24: {
    id: 'concrete_24', label: '콘크리트 C24', density: 24,
    allowCompressive: 16, allowShear: 1.4,
  },
  concrete_30: {
    id: 'concrete_30', label: '콘크리트 C30', density: 24,
    allowCompressive: 20, allowShear: 1.7,
  },
  concrete_40: {
    id: 'concrete_40', label: '콘크리트 C40', density: 24,
    allowCompressive: 26.7, allowShear: 2.1,
  },
  steel_235: {
    id: 'steel_235', label: '강재 SS275', density: 78.5,
    allowCompressive: 157, allowShear: 91,
  },
  steel_355: {
    id: 'steel_355', label: '강재 SM355', density: 78.5,
    allowCompressive: 237, allowShear: 137,
  },
};

const SEISMIC_ZONES = [
  { value: 1, label: '구역 I  — 저위험 (0.08g)', Sa: 0.08 },
  { value: 2, label: '구역 II — 보통  (0.154g)', Sa: 0.154 },
  { value: 3, label: '구역 III— 고위험 (0.22g)', Sa: 0.22 },
  { value: 4, label: '구역 IV — 극위험 (0.32g)', Sa: 0.32 },
];

const ELEMENT_LABELS = {
  IfcColumn: '기둥',
  IfcBeam:   '보',
  IfcMember: '부재',
  IfcWall:   '벽',
  IfcSlab:   '슬래브',
  IfcPier:   '교각',
};

const STATUS_CFG = {
  safe:    { label: '안전', color: '#22c55e', bg: 'bg-green-900/40', text: 'text-green-300', border: 'border-green-600/40' },
  warning: { label: '주의', color: '#f59e0b', bg: 'bg-amber-900/40',  text: 'text-amber-300',  border: 'border-amber-600/40' },
  danger:  { label: '위험', color: '#ef4444', bg: 'bg-red-900/40',   text: 'text-red-300',   border: 'border-red-600/40' },
};

// ──────────────────────────────────────────────────────────────────────────────
// 구조해석 엔진
// σ(MPa) = Force(kN) / Area(m²) / 1000
// σ(MPa) = M(kN·m) × c(m)  / I(m⁴) / 1000
// τ(MPa) = 1.5 × V(kN)     / A(m²) / 1000  (직사각형 단면)
// ──────────────────────────────────────────────────────────────────────────────

function runAnalysis(modelData, env, loads, matId) {
  const mat     = MATERIALS[matId];
  const seismic = SEISMIC_ZONES.find(z => z.value === env.seismicZone) ?? SEISMIC_ZONES[1];

  // 설계 풍압 (kN/m²): q = 0.6125 × V²/1000 × Cf(1.3) × gust(1.5)
  const qDesign = 0.6125 * (env.windSpeed ** 2) / 1000 * 1.3 * 1.5;

  return modelData.map((el, idx) => {
    const sX = Math.max(Number(el.sizeX) || 0.3, 0.01);
    const sY = Math.max(Number(el.sizeY) || 3.0,  0.01);
    const sZ = Math.max(Number(el.sizeZ) || 0.3,  0.01);
    const pY = Number(el.positionY) || 0;
    const type = el.elementType || 'IfcColumn';

    const selfWt = sX * sY * sZ * mat.density; // kN (전체 자중)

    let A, I, c, L;
    let axialLoad = 0, bendingMoment = 0, shearForce = 0;

    if (type === 'IfcColumn' || type === 'IfcPier') {
      // 단면 sX×sZ, 높이 sY
      A = sX * sZ;
      I = sX * sZ ** 3 / 12;
      c = sZ / 2;
      L = sY;

      // 축력 = 자중 + 영향면적 × 적층 하중
      axialLoad = selfWt + (loads.deadLoad + loads.liveLoad) * loads.tributaryArea * loads.numFloors;

      // 횡력: 풍하중 vs 지진하중 중 큰 값
      const hFactor   = Math.pow((pY + sY) / 10 + 1, 0.25);
      const Fwind     = qDesign * hFactor * sX * L;      // kN
      const Fseismic  = seismic.Sa * axialLoad;           // kN (Sa × 하중≈중량)
      const Flateral  = Math.max(Fwind, Fseismic);

      bendingMoment = Flateral * L / 2;  // kN·m (중간 단면)
      shearForce    = Flateral;          // kN

    } else if (type === 'IfcBeam' || type === 'IfcMember') {
      // 단면 sX(폭)×sY(높이), 스팬 sZ
      A = sX * sY;
      I = sX * sY ** 3 / 12;
      c = sY / 2;
      L = Math.max(sZ, 0.1);

      // 등분포 하중(kN/m) = 자중/m + 상재하중×영향폭
      const wSelf  = sX * sY * mat.density;                         // kN/m
      const wFloor = (loads.deadLoad + loads.liveLoad) * Math.sqrt(loads.tributaryArea);
      const w      = wSelf + wFloor;

      bendingMoment = w * L ** 2 / 8; // kN·m
      shearForce    = w * L / 2;       // kN
      axialLoad     = 0;

    } else if (type === 'IfcWall') {
      // 길이 sX, 높이 sY, 두께 sZ
      A = sX * sZ;           // 수직 단면적
      I = sZ * sX ** 3 / 12; // 면내 관성모멘트
      c = sX / 2;
      L = sY;

      axialLoad  = selfWt + loads.deadLoad * sX * sZ * loads.numFloors;
      const Fw   = qDesign * sX * sY;
      const Fs   = seismic.Sa * axialLoad;
      shearForce = Math.max(Fw, Fs);
      bendingMoment = 0; // 전단벽 — 면내 전단 지배

    } else if (type === 'IfcSlab') {
      // 두께 sY, 스팬 min(sX,sZ) — 단위폭 1m 기준
      const span = Math.min(sX, sZ);
      A = 1.0 * sY;
      I = sY ** 3 / 12;
      c = sY / 2;
      L = Math.max(span, 0.1);

      const q       = loads.deadLoad + loads.liveLoad + env.snowLoad + sY * mat.density;
      bendingMoment = q * L ** 2 / 10; // kN·m/m (연속 슬래브)
      shearForce    = q * L / 2;
      axialLoad     = 0;

    } else {
      A = sX * sZ;
      I = sX * sZ ** 3 / 12;
      c = sZ / 2;
      L = sY;
      axialLoad = selfWt;
    }

    const eps = 1e-9;
    const sigmaAxial   = axialLoad      / (Math.max(A, eps) * 1000); // MPa
    const sigmaBending = (bendingMoment * c) / (Math.max(I, eps) * 1000); // MPa
    const sigmaShear   = 1.5 * shearForce / (Math.max(A, eps) * 1000);    // MPa

    const maxStress   = Math.max(sigmaAxial + sigmaBending, sigmaShear, 0.001);
    const allowStress = mat.allowCompressive;
    const sf          = allowStress / maxStress;
    const util        = (maxStress / allowStress) * 100;
    const status      = sf >= 2.0 ? 'safe' : sf >= 1.0 ? 'warning' : 'danger';

    return {
      elementId:     el.elementId ?? idx,
      elementName:   el.elementName || `${ELEMENT_LABELS[type] ?? type}-${idx + 1}`,
      elementType:   type,
      selfWeight:    +selfWt.toFixed(2),
      axialLoad:     +axialLoad.toFixed(2),
      windLoad:      +(qDesign * sX * sY).toFixed(2),
      seismicLoad:   +(seismic.Sa * Math.max(axialLoad, selfWt)).toFixed(2),
      bendingMoment: +bendingMoment.toFixed(2),
      shearForce:    +shearForce.toFixed(2),
      axialStress:   +sigmaAxial.toFixed(3),
      bendingStress: +sigmaBending.toFixed(3),
      shearStress:   +sigmaShear.toFixed(3),
      maxStress:     +maxStress.toFixed(3),
      allowStress:   +allowStress.toFixed(1),
      safetyFactor:  +Math.min(sf, 99.9).toFixed(2),
      utilization:   +Math.min(util, 999).toFixed(1),
      status,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 3D 스트레스 뷰어
// ──────────────────────────────────────────────────────────────────────────────

function StressBox({ element, result, isSelected, onSelect }) {
  const sX = Math.max(Number(element.sizeX) || 0.3, 0.05);
  const sY = Math.max(Number(element.sizeY) || 3.0,  0.05);
  const sZ = Math.max(Number(element.sizeZ) || 0.3,  0.05);
  const pX = Number(element.positionX) || 0;
  const pY = (Number(element.positionY) || 0) + sY / 2;
  const pZ = Number(element.positionZ) || 0;

  const color  = result ? STATUS_CFG[result.status].color : '#374151';
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
    <Canvas camera={{ position: [15, 15, 15], fov: 50 }} style={{ background: '#0b0f1a' }}>
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
// UI 공통 컴포넌트
// ──────────────────────────────────────────────────────────────────────────────

function Card({ title, children, className = '' }) {
  return (
    <div className={`bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4 ${className}`}>
      {title && <p className="text-xs font-semibold text-gray-400 mb-3 tracking-wide">{title}</p>}
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

function SliderRow({ label, value, min, max, step = 1, unit, onChange }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
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

function NumRow({ label, value, unit, min = 0, max = 1000, step = 0.5, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-gray-400 shrink-0">{label}</span>
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
// 메인 대시보드
// ──────────────────────────────────────────────────────────────────────────────

export default function StructuralDashboard({ selectedProject, modelData = [] }) {

  // 환경 조건
  const [env, setEnv] = useState({
    windSpeed:   20,    // m/s
    windDir:     'N',
    seismicZone: 2,
    snowLoad:    0.5,  // kN/m²
    tempMin:     -10,
    tempMax:     35,
  });

  // 하중 조건
  const [loads, setLoads] = useState({
    deadLoad:      5.0,  // kN/m²
    liveLoad:      2.5,  // kN/m²
    tributaryArea: 16,   // m² (기둥 영향면적)
    numFloors:     3,
  });

  // 재료
  const [matId, setMatId] = useState('concrete_24');

  // 분석 결과
  const [results, setResults]         = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // UI
  const [viewMode, setViewMode]     = useState('3d');
  const [selectedId, setSelectedId] = useState(null);
  const [sortCfg, setSortCfg]       = useState({ key: 'safetyFactor', asc: true });

  // ── 분석 실행 ─────────────────────────────────────────────────
  const handleAnalyze = useCallback(() => {
    if (!modelData.length) return;
    setIsAnalyzing(true);
    setTimeout(() => {
      setResults(runAnalysis(modelData, env, loads, matId));
      setIsAnalyzing(false);
    }, 500);
  }, [modelData, env, loads, matId]);

  // ── 결과 맵 ───────────────────────────────────────────────────
  const resultMap = useMemo(() => {
    if (!results) return {};
    return Object.fromEntries(results.map(r => [r.elementId, r]));
  }, [results]);

  // ── 요약 ─────────────────────────────────────────────────────
  const summary = useMemo(() => {
    if (!results?.length) return null;
    const counts = { safe: 0, warning: 0, danger: 0 };
    let maxUtil = 0, minSF = Infinity;
    results.forEach(r => {
      counts[r.status]++;
      if (r.utilization > maxUtil)   maxUtil = r.utilization;
      if (r.safetyFactor < minSF) minSF = r.safetyFactor;
    });
    return { counts, maxUtil, minSF, total: results.length };
  }, [results]);

  // ── 정렬된 테이블 ────────────────────────────────────────────
  const sortedResults = useMemo(() => {
    if (!results) return [];
    return [...results].sort((a, b) => {
      const d = a[sortCfg.key] > b[sortCfg.key] ? 1 : -1;
      return sortCfg.asc ? d : -d;
    });
  }, [results, sortCfg]);

  const toggleSort = key =>
    setSortCfg(p => ({ key, asc: p.key === key ? !p.asc : true }));

  // ── 차트 데이터 ──────────────────────────────────────────────
  const sfChart = useMemo(() =>
    results?.map(r => ({
      name:         r.elementName.slice(0, 9),
      safetyFactor: r.safetyFactor,
      utilization:  r.utilization,
      fill:         STATUS_CFG[r.status].color,
    })) ?? [],
    [results]
  );

  const pieData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: '안전', value: summary.counts.safe,    fill: '#22c55e' },
      { name: '주의', value: summary.counts.warning, fill: '#f59e0b' },
      { name: '위험', value: summary.counts.danger,  fill: '#ef4444' },
    ].filter(d => d.value > 0);
  }, [summary]);

  const selectedResult = selectedId ? resultMap[selectedId] : null;

  // ── 렌더 ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 'calc(100vh - 120px)' }}>

      {/* 상단 바 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
            <span>🔩</span> 구조해석
            {selectedProject && (
              <span className="text-sm font-normal text-gray-400">
                — {selectedProject.projectName}
              </span>
            )}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            환경 조건·하중 설정 후 분석 실행 → BIM 모델에 안전/위험 구역 시각화
          </p>
        </div>
        <div className="flex items-center gap-3">
          {results && (
            <span className="text-xs text-gray-500">요소 {modelData.length}개 분석 완료</span>
          )}
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !modelData.length}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold
              bg-accent-blue/10 text-accent-blue border border-accent-blue/30
              hover:bg-accent-blue/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {isAnalyzing ? '⏳ 분석 중…' : '▶ 구조해석 실행'}
          </button>
        </div>
      </div>

      {/* 메인 레이아웃 */}
      <div className="flex gap-3 flex-1">

        {/* ── 왼쪽: 설정 패널 ────────────────────────────────────── */}
        <div className="w-64 shrink-0 flex flex-col gap-3">

          {/* 환경 조건 */}
          <Card title="🌍 환경 조건">
            <div className="flex flex-col gap-4">
              <SliderRow
                label="풍속" value={env.windSpeed} min={0} max={60} unit=" m/s"
                onChange={v => setEnv(p => ({ ...p, windSpeed: v }))}
              />
              <div>
                <p className="text-xs text-gray-400 mb-1.5">풍향</p>
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
                <p className="text-xs text-gray-400 mb-1.5">지진 구역</p>
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
                label="적설 하중" value={env.snowLoad} min={0} max={5} step={0.1} unit=" kN/m²"
                onChange={v => setEnv(p => ({ ...p, snowLoad: v }))}
              />
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-400">온도 범위</span>
                  <span className="text-accent-blue">{env.tempMin}°C ~ {env.tempMax}°C</span>
                </div>
                <div className="flex gap-2">
                  {[
                    { key: 'tempMin', min: -50, max: 0 },
                    { key: 'tempMax', min: 0,   max: 60 },
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

          {/* 하중 조건 */}
          <Card title="⚖️ 하중 조건">
            <div className="flex flex-col gap-2.5">
              <NumRow label="고정 하중"    value={loads.deadLoad}      unit="kN/m²" min={0} max={50}  step={0.5} onChange={v => setLoads(p => ({ ...p, deadLoad: v }))} />
              <NumRow label="활 하중"      value={loads.liveLoad}      unit="kN/m²" min={0} max={30}  step={0.5} onChange={v => setLoads(p => ({ ...p, liveLoad: v }))} />
              <NumRow label="기둥 영향면적" value={loads.tributaryArea} unit="m²"   min={1} max={100} step={1}   onChange={v => setLoads(p => ({ ...p, tributaryArea: v }))} />
              <NumRow label="층 수"        value={loads.numFloors}     unit="층"    min={1} max={100} step={1}   onChange={v => setLoads(p => ({ ...p, numFloors: v }))} />
            </div>
          </Card>

          {/* 재료 선택 */}
          <Card title="🏗 재료 선택">
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
                    <div className="text-xs text-gray-500">허용압축 {m.allowCompressive} MPa</div>
                  </div>
                </label>
              ))}
            </div>
          </Card>
        </div>

        {/* ── 중앙: 뷰 패널 ──────────────────────────────────────── */}
        <div className="flex-1 flex flex-col gap-3 min-w-0">

          {/* 뷰 탭 선택 */}
          <div className="flex items-center gap-1 bg-[#0f1422] border border-[#141a2a] rounded-xl p-1 w-fit">
            {[
              { id: '3d',    label: '🧊 3D 뷰' },
              { id: 'table', label: '📋 결과표' },
              { id: 'chart', label: '📊 차트' },
            ].map(({ id, label }) => (
              <button key={id} onClick={() => setViewMode(id)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  backgroundColor: viewMode === id ? '#1e3a5f' : 'transparent',
                  color:           viewMode === id ? '#60a5fa' : '#8896a4',
                  border:          viewMode === id ? '1px solid #2a5080' : '1px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 3D 뷰 */}
          {viewMode === '3d' && (
            <div className="flex-1 rounded-2xl overflow-hidden border border-[#141a2a] relative"
              style={{ minHeight: 480 }}>
              {!modelData.length ? (
                <div className="flex flex-col items-center justify-center h-full bg-[#0f1422] text-gray-500 gap-3">
                  <div className="text-5xl">🏗</div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-400">BIM 프로젝트를 먼저 선택하세요</p>
                    <p className="text-xs text-gray-600 mt-1">BIM 탭 → 프로젝트 선택 후 이 탭으로 돌아오세요</p>
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
                  {/* 범례 */}
                  <div className="absolute bottom-4 left-4 bg-[#0b0f1a]/90 backdrop-blur
                    rounded-xl p-3 border border-[#141a2a] flex flex-col gap-1.5">
                    <p className="text-xs text-gray-500 font-semibold mb-0.5">안전 상태</p>
                    {Object.entries(STATUS_CFG).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: v.color }} />
                        <span className="text-xs text-gray-300">
                          {v.label}
                          {k === 'safe'    && ' (SF ≥ 2.0)'}
                          {k === 'warning' && ' (1.0 ≤ SF < 2.0)'}
                          {k === 'danger'  && ' (SF < 1.0)'}
                        </span>
                      </div>
                    ))}
                    {!results && (
                      <p className="text-xs text-gray-600 mt-1 italic">▶ 분석 실행 후 색상 표시</p>
                    )}
                  </div>
                  {/* 클릭 힌트 */}
                  <div className="absolute top-3 right-3 text-xs text-gray-600 bg-[#0b0f1a]/70 px-2 py-1 rounded-lg">
                    부재 클릭 → 상세 정보
                  </div>
                </>
              )}
            </div>
          )}

          {/* 결과 테이블 */}
          {viewMode === 'table' && (
            <div className="flex-1 bg-[#0f1422] border border-[#141a2a] rounded-2xl overflow-hidden"
              style={{ minHeight: 480 }}>
              {!results ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500 gap-2">
                  <div className="text-3xl">📋</div>
                  <p className="text-sm">구조해석을 실행하면 결과가 표시됩니다</p>
                </div>
              ) : (
                <div className="overflow-auto h-full">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-[#141a2a] sticky top-0 z-10">
                      <tr>
                        {[
                          { key: 'elementName',  label: '부재명',       w: 'w-28' },
                          { key: 'elementType',  label: '유형',         w: 'w-16' },
                          { key: 'axialLoad',    label: '축력(kN)',      w: 'w-20' },
                          { key: 'windLoad',     label: '풍하중(kN)',    w: 'w-20' },
                          { key: 'seismicLoad',  label: '지진(kN)',      w: 'w-16' },
                          { key: 'maxStress',    label: '최대응력(MPa)', w: 'w-24' },
                          { key: 'allowStress',  label: '허용(MPa)',     w: 'w-20' },
                          { key: 'safetyFactor', label: '안전율(SF)',    w: 'w-20' },
                          { key: 'utilization',  label: '이용률(%)',     w: 'w-28' },
                          { key: 'status',       label: '판정',         w: 'w-16' },
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

          {/* 차트 */}
          {viewMode === 'chart' && (
            <div className="flex-1 flex flex-col gap-3" style={{ minHeight: 480 }}>
              {!results ? (
                <div className="flex flex-col items-center justify-center h-64
                  bg-[#0f1422] border border-[#141a2a] rounded-2xl text-gray-500 gap-2">
                  <div className="text-3xl">📊</div>
                  <p className="text-sm">구조해석을 실행하면 차트가 표시됩니다</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {/* 안전율 막대 */}
                  <div className="bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">부재별 안전율 (SF)</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={sfChart} margin={{ top: 5, right: 5, left: -25, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1b2236" />
                        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9 }} angle={-30} textAnchor="end" />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, fontSize: 11 }}
                          labelStyle={{ color: '#e2e8f0' }}
                          formatter={v => [v, '안전율']}
                        />
                        <Bar dataKey="safetyFactor" radius={[4, 4, 0, 0]}>
                          {sfChart.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* 상태 분포 파이 */}
                  <div className="bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">안전 상태 분포</p>
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

                  {/* 이용률 막대 (full width) */}
                  <div className="col-span-2 bg-[#0f1422] border border-[#141a2a] rounded-2xl p-4">
                    <p className="text-xs font-semibold text-gray-400 mb-3">부재별 이용률 (%)</p>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={sfChart} margin={{ top: 5, right: 5, left: -25, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1b2236" />
                        <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 9 }} angle={-30} textAnchor="end" />
                        <YAxis tick={{ fill: '#6b7280', fontSize: 9 }} domain={[0, 120]} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f1422', border: '1px solid #1b2236', borderRadius: 8, fontSize: 11 }}
                          formatter={v => [`${v}%`, '이용률']}
                        />
                        {/* 100% 허용한계 기준선은 referenceArea로 */}
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

        {/* ── 오른쪽: 요약 패널 ─────────────────────────────────── */}
        <div className="w-56 shrink-0 flex flex-col gap-3">

          {/* 분석 요약 */}
          <Card title="📊 분석 요약">
            {!summary ? (
              <p className="text-xs text-gray-600 text-center py-4">분석 실행 전</p>
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
                    <span className="text-gray-500">총 부재</span>
                    <span className="text-gray-200 font-medium">{summary.total}개</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">최대 이용률</span>
                    <span className={`font-mono font-bold ${
                      summary.maxUtil >= 100 ? 'text-red-400' :
                      summary.maxUtil >= 50  ? 'text-amber-400' : 'text-green-400'}`}>
                      {summary.maxUtil.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">최소 안전율</span>
                    <span className={`font-mono font-bold ${
                      summary.minSF < 1  ? 'text-red-400' :
                      summary.minSF < 2  ? 'text-amber-400' : 'text-green-400'}`}>
                      {summary.minSF.toFixed(2)}
                    </span>
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* 안전 지표 */}
          <Card title="🚦 안전 지표">
            {!summary ? (
              <p className="text-xs text-gray-600 text-center py-4">분석 후 표시</p>
            ) : (
              <div className="flex flex-col gap-2">
                {[
                  {
                    label: '내풍 안전성',
                    st: env.windSpeed <= 30 ? 'safe' : env.windSpeed <= 50 ? 'warning' : 'danger',
                  },
                  {
                    label: '내진 안전성',
                    st: env.seismicZone <= 2 ? 'safe' : env.seismicZone === 3 ? 'warning' : 'danger',
                  },
                  {
                    label: '구조 안전율',
                    st: summary.counts.danger > 0 ? 'danger' : summary.counts.warning > 0 ? 'warning' : 'safe',
                  },
                  {
                    label: '재료 안전성',
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

          {/* 현재 조건 요약 */}
          <Card title="📌 현재 조건">
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                { label: '풍속',       value: `${env.windSpeed} m/s`,        highlight: true },
                { label: '풍향',       value: env.windDir },
                { label: '지진 구역',   value: `구역 ${env.seismicZone}`,      highlight: true },
                { label: '적설 하중',   value: `${env.snowLoad} kN/m²` },
                { label: '온도',        value: `${env.tempMin}~${env.tempMax}°C` },
                { label: '고정 하중',   value: `${loads.deadLoad} kN/m²` },
                { label: '활 하중',     value: `${loads.liveLoad} kN/m²` },
                { label: '층 수',       value: `${loads.numFloors}층` },
                { label: '재료',        value: MATERIALS[matId].label },
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

          {/* 선택 부재 상세 */}
          {selectedResult && (
            <Card title="🔍 선택 부재">
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-gray-200 font-medium truncate">{selectedResult.elementName}</span>
                  <StatusBadge status={selectedResult.status} />
                </div>
                <hr className="border-[#1b2236]" />
                {[
                  { label: '유형',      value: ELEMENT_LABELS[selectedResult.elementType] ?? selectedResult.elementType },
                  { label: '자중',      value: `${selectedResult.selfWeight} kN` },
                  { label: '축력',      value: `${selectedResult.axialLoad} kN` },
                  { label: '풍하중',    value: `${selectedResult.windLoad} kN` },
                  { label: '지진하중',  value: `${selectedResult.seismicLoad} kN` },
                  { label: '휨 모멘트', value: `${selectedResult.bendingMoment} kN·m` },
                  { label: '전단력',    value: `${selectedResult.shearForce} kN` },
                  { label: '축 응력',   value: `${selectedResult.axialStress} MPa` },
                  { label: '휨 응력',   value: `${selectedResult.bendingStress} MPa` },
                  { label: '전단 응력', value: `${selectedResult.shearStress} MPa` },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-1">
                    <span className="text-gray-500 shrink-0">{label}</span>
                    <span className="font-mono text-gray-300 text-right">{value}</span>
                  </div>
                ))}
                <hr className="border-[#1b2236]" />
                <div className="flex justify-between font-bold">
                  <span className="text-gray-400">최대 응력</span>
                  <span className="font-mono text-gray-100">{selectedResult.maxStress} MPa</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-gray-400">안전율(SF)</span>
                  <span className="font-mono" style={{ color: STATUS_CFG[selectedResult.status].color }}>
                    {selectedResult.safetyFactor}
                  </span>
                </div>
                {/* 이용률 게이지 */}
                <div className="mt-1">
                  <div className="flex justify-between text-gray-500 mb-1">
                    <span>이용률</span>
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
