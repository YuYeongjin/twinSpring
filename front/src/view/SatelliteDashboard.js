import React, { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import SatelliteAPI from "./SatelliteAPI";

// ================================================================
// ThingsBoard 스타일 디자인 토큰
// ================================================================
const TB = {
  card: "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  header: "bg-[#162032] border-b border-[#253347]",
  accent: "#2196f3",
  success: "#4caf50",
  warning: "#ff9800",
  danger: "#f44336",
  text1: "#e2e8f0",
  text2: "#8896a4",
};

// ================================================================
// 공통 위젯 컴포넌트
// ================================================================

/**
 * ThingsBoard 스타일 위젯 카드
 * 좌측 컬러 보더로 위젯 유형을 구분 (ThingsBoard의 widget 테두리와 동일)
 */
function Widget({ title, subtitle, accent = TB.accent, children, action, className = "" }) {
  return (
    <div className={`${TB.card} overflow-hidden flex flex-col ${className}`}
      style={{ borderLeft: `3px solid ${accent}` }}>
      {/* 위젯 헤더 */}
      <div className={`${TB.header} px-4 py-2.5 flex items-center justify-between`}>
        <div>
          <div className="text-xs font-semibold text-gray-300 tracking-wider uppercase">{title}</div>
          {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}

/**
 * 연결 상태 배지 (ThingsBoard의 device online/offline indicator)
 */
function StatusBadge({ status }) {
  const cfg = {
    connected: { color: TB.success, label: "ONLINE", dot: "animate-pulse" },
    disconnected: { color: TB.danger, label: "OFFLINE", dot: "" },
    error: { color: TB.warning, label: "ERROR", dot: "" },
    connecting: { color: TB.warning, label: "CONNECTING…", dot: "animate-pulse" },
  }[status] ?? { color: TB.text2, label: "UNKNOWN", dot: "" };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`}
        style={{ backgroundColor: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }} />
      <span className="text-xs font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
    </div>
  );
}

/**
 * 대형 KPI 값 표시 위젯 (ThingsBoard의 Digital Gauge 위젯과 유사)
 * - 현재값 크게 표시
 * - 최소/최대/평균 서브 지표
 * - 하단 컬러바로 임계값 범위 시각화
 */
function KpiWidget({ label, icon, value, unit, min, max, avg, accent, warnMin, warnMax, subtitle }) {
  // 값이 경고 범위에 있는지 판단
  const isWarn = value !== null && value !== undefined &&
    ((warnMin !== undefined && value < warnMin) || (warnMax !== undefined && value > warnMax));

  // 0~100% 범위로 정규화 (게이지 바 표시용)
  const pct = value !== null && value !== undefined && max !== undefined
    ? Math.min(100, Math.max(0, ((value - (min ?? 0)) / ((max ?? 100) - (min ?? 0))) * 100))
    : 0;

  return (
    <Widget title={label} subtitle={subtitle} accent={isWarn ? TB.danger : accent}>
      <div className="flex flex-col gap-3">
        {/* 아이콘 + 현재값 */}
        <div className="flex items-end gap-3">
          <span className="text-3xl">{icon}</span>
          <div>
            <span className="text-4xl font-bold" style={{ color: isWarn ? TB.danger : accent }}>
              {value ?? "—"}
            </span>
            <span className="text-sm ml-1" style={{ color: TB.text2 }}>{unit}</span>
          </div>
        </div>

        {/* 게이지 바 */}
        <div className="w-full h-1.5 rounded-full bg-[#253347] overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: isWarn ? TB.danger : accent }} />
        </div>

        {/* 통계 서브라인 */}
        <div className="grid grid-cols-3 gap-1 text-center">
          {[["MIN", min], ["AVG", avg], ["MAX", max]].map(([lbl, val]) => (
            <div key={lbl} className="bg-[#152030] rounded-lg py-1.5">
              <div className="text-xs" style={{ color: TB.text2 }}>{lbl}</div>
              <div className="text-sm font-semibold" style={{ color: TB.text1 }}>
                {val !== undefined ? Number(val).toFixed(1) : "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Widget>
  );
}

/**
 * Tooltip 커스텀 스타일 (ThingsBoard 차트 tooltip과 유사)
 */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d1b2a] border border-[#2a3f5f] rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{label?.replace("T", " ")?.slice(0, 19)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-semibold">
          {p.name}: {Number(p.value).toFixed(1)}
        </p>
      ))}
    </div>
  );
}

// ================================================================
// 메인 대시보드
// ================================================================

/**
 * SatelliteDashboard — ThingsBoard 스타일 IoT 대시보드
 *
 * 레이아웃:
 * 1. 상단 디바이스 상태 바 (연결 상태, 마지막 수신 시각, 모드)
 * 2. KPI 위젯 행 (온도, 습도, 배터리, 신호)
 * 3. 실시간 텔레메트리 차트 + 프로젝트 패널
 * 4. 이벤트 로그 테이블
 */
export default function SatelliteDashboard({ setViceComponent, onProjectSelect, projectList }) {
  const {
    data, mode, setMode, batt, rssi,
    latest,
    wsStatus,
    activeAlert, setActiveAlert,
  } = SatelliteAPI();

  // 히스토리에서 통계값 계산
  const stats = useMemo(() => {
    if (!data.length) return {};
    const temps = data.map(d => Number(d.temperature)).filter(v => !isNaN(v));
    const hums = data.map(d => Number(d.humidity)).filter(v => !isNaN(v));
    return {
      tempMin: Math.min(...temps), tempMax: Math.max(...temps),
      tempAvg: temps.reduce((a, b) => a + b, 0) / temps.length,
      humMin: Math.min(...hums), humMax: Math.max(...hums),
      humAvg: hums.reduce((a, b) => a + b, 0) / hums.length,
    };
  }, [data]);

  // 차트용: 최근 50개 포인트만 표시
  const chartData = useMemo(() => data.slice(-50), [data]);

  const lastSeen = latest?.timestamp
    ? latest.timestamp.replace("T", " ").slice(0, 19)
    : "—";

  return (
    <div className="min-h-90 bg-[#0d1b2a] text-gray-200 p-4 flex flex-col gap-4">

      {/* ================================================================
          Alert Banner — 임계값 초과 시 표시 (항상 최상단)
          ================================================================ */}
      {activeAlert && (
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-pulse"
          style={{ backgroundColor: "#3a0f0f", borderColor: TB.danger, color: TB.danger }}
        >
          <span className="text-xl shrink-0">🚨</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">Warning: Sensor threshold exceeded — Raspberry Pi LED on</p>
            {activeAlert.reason && (
              <p className="text-xs mt-0.5" style={{ color: "#f87171" }}>{activeAlert.reason}</p>
            )}
            <p className="text-xs mt-0.5 opacity-60">{activeAlert.timestamp}</p>
          </div>
          <button
            onClick={() => setActiveAlert(null)}
            className="shrink-0 text-sm opacity-60 hover:opacity-100 transition-opacity"
          >✕</button>
        </div>
      )}

      {/* ================================================================
          0. Quick Access — tab shortcut cards
          모바일: KPI 카드 아래 (order-3), 데스크탑: 최상단 (order-1)
          ================================================================ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 order-3 sm:order-1">
        {[
          {
            id: 'bim-projects',
            icon: '🏗',
            label: 'BIM',
            color: '#7c3aed',
            desc: '3D building model editor — create structures, layers, and run structural analysis.',
          },
          {
            id: 'simulation-projects',
            icon: '🚜',
            label: 'Simulation',
            color: '#f5a623',
            desc: 'Excavator physics simulation with terrain deformation and real-time kinematics.',
          },
          {
            id: 'safe',
            icon: '🦺',
            label: 'Safe',
            color: '#22c55e',
            desc: 'Safety monitoring — helmet detection and restricted area intrusion alerts.',
          },
          {
            id: 'test',
            icon: '🧪',
            label: 'Collision Test',
            color: '#38bdf8',
            desc: 'BIM + Simulation combined — validate equipment clearance against building models.',
          },
        ].map(({ id, icon, label, color, desc }) => (
          <button
            key={id}
            onClick={() => setViceComponent(id)}
            className="flex flex-col gap-2 p-4 rounded-xl text-left transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: '#131f2e',
              border: `1px solid ${color}44`,
              boxShadow: `0 0 0 0 ${color}`,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 0 14px ${color}28`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}44`; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{icon}</span>
              <span className="text-sm font-bold text-white">{label}</span>
              <span className="ml-auto text-xs opacity-50" style={{ color }}>→</span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: TB.text2 }}>{desc}</p>
          </button>
        ))}
      </div>

      {/* ================================================================
          1. 상단 디바이스 상태 바
          모바일: order-1 (최상단), 데스크탑: order-2
          ================================================================ */}
      <div className={`${TB.card} px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 order-1 sm:order-2`}>
        {/* 디바이스 정보 */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xl"
            style={{ backgroundColor: "#1e3a5f" }}>📡</div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">IoT Sensor Dashboard</div>
            <div className="text-xs truncate" style={{ color: TB.text2 }}>
              Location: {latest?.location ?? "—"} &nbsp;|&nbsp; {lastSeen}
            </div>
          </div>
          <StatusBadge status={wsStatus} />
        </div>

        {/* 우측 컨트롤 */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            onClick={() => setMode(prev => prev === "NORMAL" ? "SAFE" : "NORMAL")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition"
            style={{
              backgroundColor: mode === "SAFE" ? "#3a1a1a" : "#1a2f1a",
              border: `1px solid ${mode === "SAFE" ? TB.danger : TB.success}`,
              color: mode === "SAFE" ? TB.danger : TB.success,
            }}
          >
            <span>{mode === "SAFE" ? "🔴" : "🟢"}</span>
            {mode} MODE
          </button>
        </div>
      </div>

      {/* ================================================================
          2. KPI 위젯 행 (ThingsBoard의 Digital Gauge)
          모바일: order-2, 데스크탑: order-3
          ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-2 gap-2 order-2 sm:order-3">
        <KpiWidget
          label="Temperature" icon="🌡"
          value={latest?.temperature ?? null} unit="°C"
          min={stats.tempMin} max={stats.tempMax} avg={stats.tempAvg}
          accent={TB.warning} warnMax={35} warnMin={0}
          subtitle="DHT11 Sensor"
        />
        <KpiWidget
          label="Humidity" icon="💧"
          value={latest?.humidity ?? null} unit="%"
          min={stats.humMin} max={stats.humMax} avg={stats.humAvg}
          accent={TB.accent} warnMax={80} warnMin={20}
          subtitle="DHT11 Sensor"
        />
       
      </div>

      {/* ================================================================
          3. 차트 + 프로젝트 패널
          ================================================================ */}
      <div className="flex flex-col gap-4 order-4">

        {/* 실시간 텔레메트리 차트 */}
        <div className="w-full">
          <Widget
            title="Real-time Telemetry"
            subtitle={`${data.length} data points received`}
            accent={TB.accent}
            action={
              <span className="flex items-center gap-1 text-xs"
                style={{ color: TB.success }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </span>
            }
            className="h-80"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e3a5a" />
                <XAxis
                  dataKey="timestamp"
                  tick={{ fontSize: 10, fill: TB.text2 }}
                  tickFormatter={v => v?.slice(11, 19) ?? ""}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10, fill: TB.text2 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  formatter={v => <span style={{ color: TB.text1 }}>{v}</span>}
                />
                {/* 온도 경고선 */}
                <ReferenceLine y={35} stroke={TB.danger} strokeDasharray="4 4"
                  label={{ value: "Warning", fill: TB.danger, fontSize: 10 }} />
                <Line
                  type="monotone" dataKey="temperature" name="Temperature (°C)"
                  stroke={TB.warning} dot={false} strokeWidth={2} isAnimationActive={false}
                />
                <Line
                  type="monotone" dataKey="humidity" name="Humidity (%)"
                  stroke={TB.accent} dot={false} strokeWidth={2} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Widget>
        </div>


      </div>

      {/* ================================================================
          4. 이벤트 로그 테이블 (ThingsBoard의 Telemetry Table 위젯)
          ================================================================ */}
      <Widget className="order-5"
        title="Telemetry Log"
        subtitle={`Latest ${Math.min(data.length, 100)} entries`}
        accent={TB.text2}
        action={
          <span className="text-xs" style={{ color: TB.text2 }}>
            {data.length} total received
          </span>
        }
      >
        {/* 모바일 가로 스크롤 래퍼 */}
        <div className="overflow-x-auto -mx-4 px-4">
          <div className="min-w-[440px]">
            {/* 테이블 헤더 */}
            <div className="grid grid-cols-5 gap-2 text-xs font-semibold pb-2 mb-1"
              style={{ color: TB.text2, borderBottom: "1px solid #253347" }}>
              <span>#</span>
              <span>Received At</span>
              <span>Location</span>
              <span className="text-center">Temperature (°C)</span>
              <span className="text-center">Humidity (%)</span>
            </div>

            {/* 테이블 바디 — 최근 15건, 최신이 위 */}
            <div className="space-y-0.5 max-h-52 overflow-y-auto">
              {[...data].reverse().slice(0, 15).map((d, i) => {
                const tempVal = Number(d.temperature);
                const tempHigh = tempVal > 35;
                const humVal = Number(d.humidity);
                const humHigh = humVal > 80;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-5 gap-2 text-xs py-1.5 px-1 rounded transition"
                    style={{
                      backgroundColor: i % 2 === 0 ? "#152030" : "transparent",
                      color: TB.text1,
                    }}
                  >
                    <span style={{ color: TB.text2 }}>{data.length - i}</span>
                    <span style={{ color: TB.text2 }}>
                      {d.timestamp?.replace("T", " ")?.slice(0, 19) ?? "—"}
                    </span>
                    <span className="truncate">{d.location ?? "—"}</span>
                    <span className="text-center font-semibold"
                      style={{ color: tempHigh ? TB.danger : TB.warning }}>
                      {tempHigh && "⚠ "}{tempVal.toFixed(1)}
                    </span>
                    <span className="text-center font-semibold"
                      style={{ color: humHigh ? TB.danger : TB.accent }}>
                      {humHigh && "⚠ "}{humVal.toFixed(1)}
                    </span>
                  </div>
                );
              })}
              {!data.length && (
                <div className="text-center py-8 text-xs" style={{ color: TB.text2 }}>
                  Waiting for data…
                </div>
              )}
            </div>
          </div>
        </div>
      </Widget>
    </div>
  );
}
