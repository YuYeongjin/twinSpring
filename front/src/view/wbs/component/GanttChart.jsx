import React, { useMemo, useRef, useState } from "react";
import { useT } from "../../../i18n/LanguageContext";

// ══════════════════════════════════════════════════════════════════
//  설정 상수
// ══════════════════════════════════════════════════════════════════
const ROW_H  = 38;
const HDR_H  = 56;
const LEFT_W = 270;
const DAY_W  = 26;
const PAD    = 8;

const STATUS_COLOR = {
  NOT_STARTED: { bar: "#334155", text: "#94a3b8" },
  IN_PROGRESS:  { bar: "#1d4ed8", text: "#93c5fd" },
  COMPLETED:    { bar: "#15803d", text: "#86efac" },
  DELAYED:      { bar: "#b91c1c", text: "#fca5a5" },
};

const SOURCE_BADGE = {
  MANUAL:      { label: "✏️", tKey: "sourceManual"   },
  AGENT_CPM:   { label: "🔗", tKey: "sourceAgentCpm" },
  AGENT_CRACK: { label: "🔍", tKey: "sourceCrack"    },
  AGENT_AUTO:  { label: "🤖", tKey: "sourceAuto"     },
};

// ── 날짜 유틸 ────────────────────────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function diffDays(a, b) {
  return Math.round((b - a) / 86400000);
}

// ── CPM 헬퍼 ─────────────────────────────────────────────────────
function getPredIds(t) {
  if (!t?.predecessorIds) return [];
  return t.predecessorIds.split(",").map(s => s.trim()).filter(Boolean);
}

/**
 * CPM (Critical Path Method) 분석
 *  - 순방향 패스: ES(최조착수), EF(최조완료)
 *  - 역방향 패스: LS(최지착수), LF(최지완료)
 *  - 여유공기(TF) = LS - ES  (0이면 주공정)
 *
 * 반환: { [taskId]: { ES, EF, LS, LF, totalFloat, isCritical } }
 */
function computeCPM(tasks) {
  if (!tasks || tasks.length === 0) return {};

  const taskMap = Object.fromEntries(tasks.map(t => [t.taskId, t]));

  // ── successor 맵 ─────────────────────────────────────────────
  const succ = Object.fromEntries(tasks.map(t => [t.taskId, []]));
  tasks.forEach(t => {
    getPredIds(t).forEach(pid => {
      if (succ[pid]) succ[pid].push(t.taskId);
    });
  });

  // ── 공기 산출 (duration 우선, 없으면 날짜 차이) ───────────────
  const getDur = (t) => {
    const d = Number(t.duration);
    if (d > 0) return d;
    const s = parseDate(t.startDate), e = parseDate(t.endDate);
    if (s && e) return Math.max(1, diffDays(s, e));
    return 1;
  };

  // ── Kahn BFS 위상정렬 ─────────────────────────────────────────
  const inDeg = Object.fromEntries(tasks.map(t => [t.taskId, 0]));
  tasks.forEach(t => {
    getPredIds(t).forEach(pid => {
      if (inDeg[t.taskId] !== undefined) inDeg[t.taskId]++;
    });
  });
  const q = tasks.filter(t => inDeg[t.taskId] === 0).map(t => t.taskId);
  const order = [];
  const deg = { ...inDeg };
  while (q.length) {
    const id = q.shift();
    order.push(id);
    (succ[id] || []).forEach(s => { if (--deg[s] === 0) q.push(s); });
  }
  // 사이클 존재 시 누락된 노드 추가
  tasks.forEach(t => { if (!order.includes(t.taskId)) order.push(t.taskId); });

  // ── 순방향 패스 ───────────────────────────────────────────────
  const ES = {}, EF = {};
  order.forEach(id => {
    const t = taskMap[id];
    if (!t) return;
    const preds = getPredIds(t);
    ES[id] = preds.length ? Math.max(...preds.map(p => EF[p] ?? 0)) : 0;
    EF[id] = ES[id] + getDur(t);
  });

  const projEnd = tasks.length > 0
    ? Math.max(...tasks.map(t => EF[t.taskId] ?? 0))
    : 0;

  // ── 역방향 패스 ───────────────────────────────────────────────
  const LF = {}, LS = {};
  [...order].reverse().forEach(id => {
    const t = taskMap[id];
    if (!t) return;
    const sIds = succ[id] || [];
    LF[id] = sIds.length ? Math.min(...sIds.map(s => LS[s] ?? projEnd)) : projEnd;
    LS[id] = LF[id] - getDur(t);
  });

  // ── 결과 조합 ─────────────────────────────────────────────────
  const result = {};
  tasks.forEach(t => {
    const id = t.taskId;
    const tf = Math.round((LS[id] ?? 0) - (ES[id] ?? 0));
    result[id] = {
      ES:          ES[id] ?? 0,
      EF:          EF[id] ?? 0,
      LS:          LS[id] ?? 0,
      LF:          LF[id] ?? 0,
      totalFloat:  tf,
      isCritical:  tf <= 0,
    };
  });
  return result;
}

// ══════════════════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════════════════
/**
 * props:
 *   tasks          : WbsTaskDTO[]
 *   groupByProject : boolean   — 프로젝트별 그룹 헤더 표시
 *   onTaskClick    : (task) => void
 */
export default function GanttChart({ tasks = [], groupByProject = false, onTaskClick }) {
  const t = useT('wbs');

  const [tooltip, setTooltip] = useState(null); // { x, y, task, cpm }
  const svgRef = useRef(null);

  // ── CPM 계산 ──────────────────────────────────────────────────
  const cpmResult = useMemo(() => computeCPM(tasks), [tasks]);

  // ── 날짜 범위 및 행 구성 ──────────────────────────────────────
  const { minDate, maxDate, totalDays, rows } = useMemo(() => {
    let min = null, max = null;
    const valid = tasks.filter(t => t.startDate && t.endDate);
    valid.forEach(t => {
      const s = parseDate(t.startDate), e = parseDate(t.endDate);
      if (!min || s < min) min = s;
      if (!max || e > max) max = e;
    });
    if (!min) {
      const today = new Date();
      min = today; max = addDays(today, 30);
    } else {
      min = addDays(min, -3);
      // 여유공기 표시 여유를 위해 끝에 +10일 여백
      const maxFloat = tasks.length > 0
        ? Math.max(...tasks.map(t => cpmResult[t.taskId]?.totalFloat ?? 0), 0)
        : 0;
      max = addDays(max, Math.max(5, maxFloat + 5));
    }
    const total = diffDays(min, max);

    let rows = [];
    if (groupByProject) {
      const groups = {};
      tasks.forEach(t => {
        const key = t.wbsProjectId || "?";
        if (!groups[key]) groups[key] = { projectId: key, projectName: t.projectName || key, tasks: [] };
        groups[key].tasks.push(t);
      });
      Object.values(groups).forEach(g => {
        rows.push({ type: "header", label: g.projectName, projectId: g.projectId });
        g.tasks.forEach(t => rows.push({ type: "task", task: t }));
      });
    } else {
      tasks.forEach(t => rows.push({ type: "task", task: t }));
    }
    return { minDate: min, maxDate: max, totalDays: total, rows };
  }, [tasks, groupByProject, cpmResult]);

  // ── 헤더 눈금 ─────────────────────────────────────────────────
  const headerMonths = useMemo(() => {
    const months = [];
    let cur = new Date(minDate);
    cur.setDate(1);
    while (cur <= maxDate) {
      const offset = diffDays(minDate, cur);
      months.push({
        label: `${cur.getFullYear()}.${String(cur.getMonth() + 1).padStart(2, "0")}`,
        offset,
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }, [minDate, maxDate]);

  const headerWeeks = useMemo(() => {
    const weeks = [];
    let cur = new Date(minDate);
    while (cur.getDay() !== 1) cur = addDays(cur, 1);
    while (cur <= maxDate) {
      const offset = diffDays(minDate, cur);
      if (offset >= 0) weeks.push({ offset, label: `${cur.getMonth() + 1}/${cur.getDate()}` });
      cur = addDays(cur, 7);
    }
    return weeks;
  }, [minDate, maxDate]);

  const todayOffset = diffDays(minDate, new Date());
  const svgW = LEFT_W + totalDays * DAY_W;
  const svgH = HDR_H + rows.length * ROW_H;

  // ── CPM 요약 ──────────────────────────────────────────────────
  const criticalCount = tasks.filter(t => cpmResult[t.taskId]?.isCritical).length;
  const projectDuration = tasks.length > 0
    ? Math.max(...tasks.map(t => cpmResult[t.taskId]?.EF ?? 0))
    : 0;
  const hasFloat = tasks.some(t => (cpmResult[t.taskId]?.totalFloat ?? 0) > 0);

  // ── 간트 바 렌더 ──────────────────────────────────────────────
  function renderBar(task, rowIdx) {
    const s = parseDate(task.startDate);
    const e = parseDate(task.endDate);
    if (!s || !e) return null;

    const cpm        = cpmResult[task.taskId];
    const isCritical = cpm?.isCritical ?? false;
    const floatDays  = Math.max(0, cpm?.totalFloat ?? 0);

    const x0   = LEFT_W + diffDays(minDate, s) * DAY_W;
    const barW = Math.max(diffDays(s, e) * DAY_W, 4);
    const y    = HDR_H + rowIdx * ROW_H + 7;
    const barH = ROW_H - 14;
    const pct  = Math.min(100, Math.max(0, task.progress || 0));

    const barColor  = isCritical ? "#7f1d1d" : (STATUS_COLOR[task.status] || STATUS_COLOR.NOT_STARTED).bar;
    const fillColor = isCritical ? "#ef4444" : (STATUS_COLOR[task.status] || STATUS_COLOR.NOT_STARTED).text;

    return (
      <g key={task.taskId}
         style={{ cursor: "pointer" }}
         onClick={() => onTaskClick && onTaskClick(task)}
         onMouseEnter={() => setTooltip({ task, cpm })}
         onMouseLeave={() => setTooltip(null)}
      >
        {/* 여유공기 바 (Float) */}
        {floatDays > 0 && (
          <rect
            x={x0 + barW} y={y + barH / 3}
            width={floatDays * DAY_W} height={barH / 3}
            rx={2} fill="#60a5fa" opacity={0.18}
          />
        )}

        {/* 주공정 글로우 테두리 */}
        {isCritical && (
          <rect
            x={x0 - 2} y={y - 2} width={barW + 4} height={barH + 4}
            rx={6} fill="none"
            stroke="#ef4444" strokeWidth={1.5} opacity={0.5}
          />
        )}

        {/* 메인 바 */}
        <rect x={x0} y={y} width={barW} height={barH} rx={4}
              fill={barColor} opacity={0.92}
              stroke={isCritical ? "#ef4444" : "none"} strokeWidth={1}
        />

        {/* 진행률 오버레이 */}
        {pct > 0 && (
          <rect x={x0} y={y} width={barW * pct / 100} height={barH} rx={4}
                fill={fillColor} opacity={0.45}
          />
        )}

        {/* 진행률 텍스트 */}
        {barW > 32 && (
          <text x={x0 + 5} y={y + barH / 2 + 4}
                fontSize={9} fill="#fff" fontWeight="600">
            {pct}%
          </text>
        )}

        {/* 주공정 마커 */}
        {isCritical && barW > 18 && (
          <text x={x0 + barW - 14} y={y + barH / 2 + 4} fontSize={9}>🔴</text>
        )}

        {/* 소스 배지 */}
        {SOURCE_BADGE[task.source] && task.source !== "MANUAL" && (
          <text
            x={x0 + barW + (floatDays > 0 ? floatDays * DAY_W : 0) + 4}
            y={y + barH / 2 + 4}
            fontSize={11} fill="#94a3b8"
          >
            {SOURCE_BADGE[task.source].label}
          </text>
        )}
      </g>
    );
  }

  // ── CPM 연결선 ────────────────────────────────────────────────
  function renderDependencies() {
    const taskMap = {};
    rows.forEach((r, i) => {
      if (r.type === "task") taskMap[r.task.taskId] = { row: i, task: r.task };
    });

    const lines = [];
    rows.forEach((r, i) => {
      if (r.type !== "task" || !r.task.predecessorIds) return;
      getPredIds(r.task).forEach((pid, li) => {
        const pred = taskMap[pid];
        if (!pred) return;
        const predEnd  = parseDate(pred.task.endDate);
        const thisStart = parseDate(r.task.startDate);
        if (!predEnd || !thisStart) return;

        // 양쪽 모두 주공정이면 빨간 실선, 아니면 황색 점선
        const isCritEdge =
          (cpmResult[r.task.taskId]?.isCritical) &&
          (cpmResult[pid]?.isCritical);

        const x1 = LEFT_W + diffDays(minDate, predEnd) * DAY_W + 2;
        const y1 = HDR_H + pred.row * ROW_H + ROW_H / 2;
        const x2 = LEFT_W + diffDays(minDate, thisStart) * DAY_W;
        const y2 = HDR_H + i * ROW_H + ROW_H / 2;
        const mx = (x1 + x2) / 2;

        lines.push(
          <path
            key={`dep-${r.task.taskId}-${li}`}
            d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
            stroke={isCritEdge ? "#ef4444" : "#f59e0b"}
            strokeWidth={isCritEdge ? 2.2 : 1.5}
            fill="none"
            opacity={isCritEdge ? 0.9 : 0.6}
            strokeDasharray={isCritEdge ? undefined : "4 2"}
            markerEnd={isCritEdge ? "url(#arrowRed)" : "url(#arrow)"}
          />
        );
      });
    });
    return lines;
  }

  return (
    <div>
      {/* ── CPM 요약 바 ── */}
      {tasks.length > 0 && (
        <div className="flex items-center gap-3 mb-3 px-1 flex-wrap text-xs">
          <span className="font-semibold" style={{ color: "#94a3b8" }}>{t('cpmAnalysis')}</span>

          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg"
                style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
            <span className="w-2 h-2 rounded-sm inline-block"
                  style={{ backgroundColor: "#ef4444" }} />
            <span style={{ color: "#fca5a5" }}>
              {t('criticalCount', { n: criticalCount })}
            </span>
          </span>

          <span className="flex items-center gap-1" style={{ color: "#60a5fa" }}>
            {t('cpmAnalysis')} <strong className="ml-1">{t('cpmDays', { n: projectDuration })}</strong>
          </span>

          {hasFloat && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-8 h-2 rounded"
                    style={{ backgroundColor: "#60a5fa", opacity: 0.3 }} />
              <span style={{ color: "#60a5fa" }}>{t('floatLabel')}</span>
            </span>
          )}

          <span className="flex items-center gap-1" style={{ color: "#94a3b8" }}>
            <span style={{ color: "#f59e0b" }}>{t('nonCriticalArrow')}</span>
          </span>
          <span className="flex items-center gap-1" style={{ color: "#94a3b8" }}>
            <span style={{ color: "#ef4444" }}>{t('criticalArrow')}</span>
          </span>
        </div>
      )}

      {/* ── SVG 간트 차트 ── */}
      <div className="relative overflow-x-auto">
        <svg
          ref={svgRef}
          width={svgW}
          height={svgH}
          style={{ display: "block", fontFamily: "inherit" }}
        >
          <defs>
            <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 Z" fill="#f59e0b" />
            </marker>
            <marker id="arrowRed" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 Z" fill="#ef4444" />
            </marker>
          </defs>

          {/* 배경 줄무늬 */}
          {rows.map((_, i) => (
            <rect key={i}
                  x={0} y={HDR_H + i * ROW_H} width={svgW} height={ROW_H}
                  fill={i % 2 === 0 ? "#0d1b2a" : "#0a1521"}
            />
          ))}

          {/* 주 격자선 */}
          {headerWeeks.map((w, i) => (
            <line key={i}
                  x1={LEFT_W + w.offset * DAY_W} y1={0}
                  x2={LEFT_W + w.offset * DAY_W} y2={svgH}
                  stroke="#1e3a5f" strokeWidth={0.5}
            />
          ))}

          {/* 오늘 선 */}
          {todayOffset >= 0 && todayOffset <= totalDays && (
            <line
              x1={LEFT_W + todayOffset * DAY_W} y1={0}
              x2={LEFT_W + todayOffset * DAY_W} y2={svgH}
              stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 2"
            />
          )}

          {/* 월 헤더 */}
          <rect x={0} y={0} width={svgW} height={26} fill="#0d1b2a" />
          {headerMonths.map((m, i) => (
            <text key={i}
                  x={LEFT_W + m.offset * DAY_W + 4} y={17}
                  fontSize={11} fontWeight="700" fill="#60a5fa">
              {m.label}
            </text>
          ))}

          {/* 주 헤더 */}
          <rect x={0} y={26} width={svgW} height={30} fill="#0a1521" />
          {headerWeeks.map((w, i) => (
            <text key={i}
                  x={LEFT_W + w.offset * DAY_W + 2} y={44}
                  fontSize={10} fill="#64748b">
              {w.label}
            </text>
          ))}

          {/* 좌측 고정 패널 */}
          <rect x={0} y={0} width={LEFT_W} height={svgH} fill="#0a1521" />
          <rect x={0} y={0} width={LEFT_W} height={HDR_H} fill="#0d1b2a" />
          <line x1={LEFT_W} y1={0} x2={LEFT_W} y2={svgH}
                stroke="#1e3a5f" strokeWidth={1} />
          <text x={PAD} y={34} fontSize={11} fontWeight="700" fill="#60a5fa">{t('ganttWbs')}</text>
          <text x={PAD + 50} y={34} fontSize={11} fontWeight="700" fill="#60a5fa">{t('ganttTask')}</text>
          <text x={LEFT_W - 60} y={34} fontSize={10} fill="#475569">{t('ganttFloat')}</text>

          {/* 행 렌더 */}
          {rows.map((r, i) => {
            const y = HDR_H + i * ROW_H;
            if (r.type === "header") {
              return (
                <g key={i}>
                  <rect x={0} y={y} width={LEFT_W} height={ROW_H} fill="#1e2d3d" />
                  <text x={PAD} y={y + ROW_H / 2 + 4}
                        fontSize={11} fontWeight="700" fill="#60a5fa">
                    📁 {r.label}
                  </text>
                  <rect x={LEFT_W} y={y} width={svgW - LEFT_W} height={ROW_H}
                        fill="#1e2d3d" opacity={0.5} />
                </g>
              );
            }

            const task = r.task;
            const cpm  = cpmResult[task.taskId];
            const isCritical = cpm?.isCritical;
            const floatDays  = cpm?.totalFloat ?? "";
            const textColor  = isCritical
              ? "#fca5a5"
              : (STATUS_COLOR[task.status] || STATUS_COLOR.NOT_STARTED).text;

            return (
              <g key={task.taskId}>
                {/* WBS 코드 */}
                <text x={PAD} y={y + ROW_H / 2 + 4} fontSize={9} fill="#475569">
                  {task.wbsCode || ""}
                </text>
                {/* 작업명 */}
                <text x={PAD + 50} y={y + ROW_H / 2 + 4}
                      fontSize={11} fill={textColor}
                      fontWeight={isCritical ? "700" : "400"}
                      style={{ cursor: "pointer" }}
                      onClick={() => onTaskClick && onTaskClick(task)}>
                  {task.taskName?.length > 17 ? task.taskName.slice(0, 16) + "…" : task.taskName}
                </text>
                {/* 여유공기 숫자 */}
                <text x={LEFT_W - 55} y={y + ROW_H / 2 + 4} fontSize={9}
                      fill={isCritical ? "#ef4444" : "#4ade80"}
                      fontWeight={isCritical ? "700" : "400"}>
                  {isCritical ? "🔴주" : floatDays !== "" ? `+${floatDays}d` : ""}
                </text>
                {/* 간트 바 */}
                {renderBar(task, i)}
                {/* 행 구분선 */}
                <line x1={0} y1={y + ROW_H} x2={svgW} y2={y + ROW_H}
                      stroke="#1e3a5f" strokeWidth={0.5} />
              </g>
            );
          })}

          {/* CPM 연결선 */}
          {renderDependencies()}

          {/* 오늘 라벨 */}
          {todayOffset >= 0 && todayOffset <= totalDays && (
            <text x={LEFT_W + todayOffset * DAY_W + 2} y={22}
                  fontSize={9} fill="#f59e0b" fontWeight="700">
              {t('today')}
            </text>
          )}
        </svg>

        {/* ── 툴팁 ── */}
        {tooltip && (
          <div
            className="pointer-events-none rounded-xl shadow-2xl p-3"
            style={{
              position: 'fixed',
              top: 60,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 9990,
              backgroundColor: "#0d1b2a",
              border: `1px solid ${tooltip.cpm?.isCritical ? "#ef4444" : "#253347"}`,
              minWidth: 230,
              maxWidth: 300,
              color: "#e2e8f0",
              fontSize: 12,
            }}
          >
            {/* 제목 */}
            <div className="flex items-center gap-2 mb-2">
              <p className="font-bold text-white text-sm leading-tight flex-1">
                {tooltip.task.taskName}
              </p>
              {tooltip.cpm?.isCritical && (
                <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{ backgroundColor: "#450a0a", color: "#ef4444", border: "1px solid #7f1d1d" }}>
                  {t('criticalTag')}
                </span>
              )}
            </div>

            {tooltip.task.wbsCode && (
              <p className="text-gray-500 text-xs mb-2">{tooltip.task.wbsCode}</p>
            )}

            {/* 기본 정보 */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs mb-2">
              <span className="text-gray-500">{t('ttStart')}</span>
              <span>{tooltip.task.startDate}</span>
              <span className="text-gray-500">{t('ttEnd')}</span>
              <span>{tooltip.task.endDate}</span>
              <span className="text-gray-500">{t('ttProgress')}</span>
              <span>{tooltip.task.progress ?? 0}%</span>
              {tooltip.task.responsible && (
                <>
                  <span className="text-gray-500">{t('ttResponsible')}</span>
                  <span>{tooltip.task.responsible}</span>
                </>
              )}
            </div>

            {/* CPM 분석 */}
            {tooltip.cpm && (
              <>
                <div className="border-t border-gray-700 my-2" />
                <p className="text-xs font-semibold text-gray-400 mb-1.5">{t('ttCpmTitle')}</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-gray-500">{t('ttES')}</span>
                  <span className="text-blue-300">{tooltip.cpm.ES}</span>
                  <span className="text-gray-500">{t('ttEF')}</span>
                  <span className="text-blue-300">{tooltip.cpm.EF}</span>
                  <span className="text-gray-500">{t('ttLS')}</span>
                  <span className="text-purple-300">{tooltip.cpm.LS}</span>
                  <span className="text-gray-500">{t('ttLF')}</span>
                  <span className="text-purple-300">{tooltip.cpm.LF}</span>
                  <span className="text-gray-500 font-semibold">{t('ttFloat')}</span>
                  <span className={`font-bold ${tooltip.cpm.isCritical ? "text-red-400" : "text-green-400"}`}>
                    {t('cpmDays', { n: tooltip.cpm.totalFloat })}
                    {tooltip.cpm.isCritical ? ` ${t('ttCriticalTag')}` : ` ${t('ttHasFloat')}`}
                  </span>
                </div>
              </>
            )}

            {tooltip.task.notes && (
              <p className="mt-2 text-gray-400 text-xs border-t border-gray-700 pt-2 leading-snug">
                {tooltip.task.notes}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
