import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import SatelliteAPI from "./SatelliteAPI";

// ================================================================
// ThingsBoard 스타일 디자인 토큰
// ================================================================
const TB = {
  card:    "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  header:  "bg-[#162032] border-b border-[#253347]",
  accent:  "#2196f3",
  success: "#4caf50",
  warning: "#ff9800",
  danger:  "#f44336",
  text1:   "#e2e8f0",
  text2:   "#8896a4",
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
    connected:    { color: TB.success, label: "ONLINE",       dot: "animate-pulse" },
    disconnected: { color: TB.danger,  label: "OFFLINE",      dot: "" },
    error:        { color: TB.warning, label: "ERROR",        dot: "" },
    connecting:   { color: TB.warning, label: "CONNECTING…",  dot: "animate-pulse" },
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
    latest, addNewProject,
    bimMenu, setBimMenu,
    wsStatus,
  } = SatelliteAPI();

  const [showCreate, setShowCreate] = useState(false);

  // 히스토리에서 통계값 계산
  const stats = useMemo(() => {
    if (!data.length) return {};
    const temps = data.map(d => Number(d.temperature)).filter(v => !isNaN(v));
    const hums  = data.map(d => Number(d.humidity)).filter(v => !isNaN(v));
    return {
      tempMin: Math.min(...temps), tempMax: Math.max(...temps),
      tempAvg: temps.reduce((a, b) => a + b, 0) / temps.length,
      humMin:  Math.min(...hums),  humMax:  Math.max(...hums),
      humAvg:  hums.reduce((a, b) => a + b, 0) / hums.length,
    };
  }, [data]);

  // 차트용: 최근 50개 포인트만 표시
  const chartData = useMemo(() => data.slice(-50), [data]);

  const lastSeen = latest?.timestamp
    ? latest.timestamp.replace("T", " ").slice(0, 19)
    : "—";

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-4 space-y-4">

      {/* ================================================================
          1. 상단 디바이스 상태 바 (ThingsBoard의 Dashboard Header)
          ================================================================ */}
      <div className={`${TB.card} px-5 py-3 flex items-center justify-between`}>
        {/* 디바이스 정보 */}
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xl"
               style={{ backgroundColor: "#1e3a5f" }}>📡</div>
          <div>
            <div className="text-sm font-bold text-white">IoT Sensor Dashboard</div>
            <div className="text-xs" style={{ color: TB.text2 }}>
              위치: {latest?.location ?? "—"} &nbsp;|&nbsp; 마지막 수신: {lastSeen}
            </div>
          </div>
          <StatusBadge status={wsStatus} />
        </div>

        {/* 우측 컨트롤 */}
        <div className="flex items-center gap-2">
          {/* 운영 모드 토글 */}
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

          {/* EMS 바로가기 */}
          <button
            onClick={() => setViceComponent('ems')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition text-white"
            style={{ backgroundColor: "#1a3a2a", border: `1px solid #2d7a4f` }}
          >
            ⚡ EMS
          </button>

          {/* BIM 바로가기 (프로젝트 선택) */}
          <button
            onClick={() => setShowCreate(v => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-bold transition text-white"
            style={{ backgroundColor: "#1a2a3a", border: `1px solid #2a5080` }}
          >
            🏗 BIM
          </button>
        </div>
      </div>

      {/* ================================================================
          2. KPI 위젯 행 (ThingsBoard의 Digital Gauge)
          ================================================================ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiWidget
          label="온도" icon="🌡"
          value={latest?.temperature ?? null} unit="°C"
          min={stats.tempMin} max={stats.tempMax} avg={stats.tempAvg}
          accent={TB.warning} warnMax={35} warnMin={0}
          subtitle="DHT11 센서"
        />
        <KpiWidget
          label="습도" icon="💧"
          value={latest?.humidity ?? null} unit="%"
          min={stats.humMin} max={stats.humMax} avg={stats.humAvg}
          accent={TB.accent} warnMax={80} warnMin={20}
          subtitle="DHT11 센서"
        />
        <KpiWidget
          label="배터리" icon="🔋"
          value={batt?.v ?? null} unit="V"
          min={6.0} max={8.4} avg={batt?.v}
          accent={TB.success} warnMin={6.5}
          subtitle={`전류: ${batt?.i ?? "—"} A`}
        />
        <KpiWidget
          label="신호 강도" icon="📶"
          value={rssi} unit="dBm"
          min={-110} max={-50} avg={rssi}
          accent={rssi > -92 ? TB.success : TB.warning}
          warnMin={-100}
          subtitle="Link RSSI"
        />
      </div>

      {/* ================================================================
          3. 차트 + 프로젝트 패널
          ================================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">

        {/* 실시간 텔레메트리 차트 */}
        <div className="lg:col-span-8">
          <Widget
            title="실시간 텔레메트리"
            subtitle={`데이터 포인트 ${data.length}개 수신`}
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
                               label={{ value: "경고", fill: TB.danger, fontSize: 10 }} />
                <Line
                  type="monotone" dataKey="temperature" name="온도 (°C)"
                  stroke={TB.warning} dot={false} strokeWidth={2} isAnimationActive={false}
                />
                <Line
                  type="monotone" dataKey="humidity" name="습도 (%)"
                  stroke={TB.accent} dot={false} strokeWidth={2} isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </Widget>
        </div>

        {/* 프로젝트 패널 */}
        <div className="lg:col-span-4 flex flex-col gap-4">

          {/* BIM 프로젝트 목록 */}
          <Widget title="BIM 프로젝트" accent="#7c3aed"
                  action={
                    <button
                      onClick={() => setShowCreate(v => !v)}
                      className="text-xs px-2 py-0.5 rounded text-purple-300 hover:text-white transition"
                      style={{ border: "1px solid #7c3aed" }}
                    >
                      {showCreate ? "목록" : "+ 신규"}
                    </button>
                  }
          >
            {showCreate ? (
              /* 프로젝트 생성 UI */
              <div className="space-y-2">
                <p className="text-xs" style={{ color: TB.text2 }}>프로젝트 유형 선택:</p>
                {["Bridge", "Building"].map(type => (
                  <button
                    key={type}
                    onClick={() => { addNewProject(type); setShowCreate(false); }}
                    className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-white transition flex items-center gap-2"
                    style={{ backgroundColor: "#1e3a5f", border: "1px solid #2a5080" }}
                  >
                    <span>{type === "Bridge" ? "🌉" : "🏢"}</span>
                    {type === "Bridge" ? "교량 (Bridge)" : "건물 (Building)"}
                  </button>
                ))}
              </div>
            ) : (
              /* 프로젝트 목록 */
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {projectList?.length > 0 ? (
                  projectList.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => { onProjectSelect(item); setViceComponent('bim'); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition group"
                      style={{ backgroundColor: "#152030", border: "1px solid #253347" }}
                    >
                      <span>{item.structureType === "Bridge" ? "🌉" : "🏢"}</span>
                      <span className="text-gray-300 group-hover:text-white transition truncate flex-1">
                        {item.projectName}
                      </span>
                      <span className="text-xs opacity-0 group-hover:opacity-100 transition"
                            style={{ color: TB.accent }}>열기 →</span>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-4 text-xs" style={{ color: TB.text2 }}>
                    프로젝트 없음<br />
                    <span className="opacity-60">+ 신규 버튼으로 생성하세요</span>
                  </div>
                )}
              </div>
            )}
          </Widget>

          {/* 빠른 제어 패널 */}
          <Widget title="디바이스 제어" accent="#059669">
            <div className="space-y-2">
              <button
                className="w-full px-3 py-2 rounded-lg text-xs font-medium transition text-white"
                style={{ backgroundColor: "#1a3a2a", border: "1px solid #059669" }}
                onClick={() => alert("Ping sent!")}
              >
                📡 Ping 전송
              </button>
              <button
                className="w-full px-3 py-2 rounded-lg text-xs font-medium transition text-white"
                style={{ backgroundColor: "#1a2a3a", border: "1px solid #2a5080" }}
                onClick={() => alert("Snapshot requested!")}
              >
                📷 스냅샷 요청
              </button>
            </div>
          </Widget>
        </div>
      </div>

      {/* ================================================================
          4. 이벤트 로그 테이블 (ThingsBoard의 Telemetry Table 위젯)
          ================================================================ */}
      <Widget
        title="텔레메트리 로그"
        subtitle={`최근 ${Math.min(data.length, 100)}건`}
        accent={TB.text2}
        action={
          <span className="text-xs" style={{ color: TB.text2 }}>
            총 {data.length}건 수신
          </span>
        }
      >
        {/* 테이블 헤더 */}
        <div className="grid grid-cols-5 gap-2 text-xs font-semibold pb-2 mb-1"
             style={{ color: TB.text2, borderBottom: "1px solid #253347" }}>
          <span>#</span>
          <span>수신 시각</span>
          <span>위치</span>
          <span className="text-center">온도 (°C)</span>
          <span className="text-center">습도 (%)</span>
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
              데이터 수신 대기 중…
            </div>
          )}
        </div>
      </Widget>
    </div>
  );
}
