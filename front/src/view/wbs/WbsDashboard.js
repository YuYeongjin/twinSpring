import React, { useState, useCallback, useEffect, useRef } from "react";
import AxiosCustom from "../../axios/AxiosCustom";
import GanttChart from "./component/GanttChart";
import WbsTaskTable from "./component/WbsTaskTable";
import ProjectLinkPanel from "./component/ProjectLinkPanel";
import WbsAlertLogPanel from "./component/WbsAlertLogPanel";
import WbsAgentChat from "../../component/WbsAgentChat";
import BimLinkedPanel from "./component/BimLinkedPanel";
import { useT } from "../../i18n/LanguageContext";
import { unreadCount, ALERT_EVENT } from "../../utils/alertStore";

// ── 디자인 토큰 ─────────────────────────────────────────────────
const TB = {
  text2: "#8896a4",
  sidebar: "#0a1521",
  card: "#1c2a3a",
  border: "#253347",
};

// startDate(YYYY-MM-DD) 오름차순 정렬 — null/undefined 는 맨 뒤
const sortByStartDate = (arr) =>
  [...arr].sort((a, b) => {
    if (!a.startDate && !b.startDate) return 0;
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
  });

const STATUS_META = {
  PLANNED: { tKey: "statusPlanned", color: "#94a3b8", bg: "#1e293b", icon: "📋" },
  IN_PROGRESS: { tKey: "statusInProgress", color: "#60a5fa", bg: "#1e3a5f", icon: "🔨" },
  COMPLETED: { tKey: "statusCompleted", color: "#4ade80", bg: "#14532d", icon: "✅" },
  ON_HOLD: { tKey: "statusOnHold", color: "#f59e0b", bg: "#451a03", icon: "⏸" },
};

// ══════════════════════════════════════════════════════════════════
//  프로젝트 생성/편집 모달
// ══════════════════════════════════════════════════════════════════
function ProjectModal({ initial = null, onClose, onSave }) {
  const t = useT('wbs');
  const isEdit = !!initial;
  const [form, setForm] = useState(
    initial ?? {
      projectName: "", location: "", contractAmount: "",
      status: "PLANNED", description: "",
      startDate: "", endDate: "",
      clientName: "", managerName: "",
    }
  );
  const [saving, setSaving] = useState(false);
  const set = (f) => (e) => setForm(p => ({ ...p, [f]: e.target.value }));

  async function handleSave() {
    if (!form.projectName?.trim()) return;
    setSaving(true);
    try { await onSave(form); onClose(); }
    finally { setSaving(false); }
  }

  const I = "w-full bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        style={{ backgroundColor: "#0f1e2d", border: "1px solid #253347" }}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-white">
            {isEdit ? t('modalEdit') : t('modalCreate')}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-xl">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldProjectName')}</label>
            <input value={form.projectName} onChange={set("projectName")}
              placeholder={t('fieldProjectNamePh')} autoFocus className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldLocation')}</label>
            <input value={form.location} onChange={set("location")} placeholder={t('fieldLocationPh')} className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldContract')}</label>
            <input value={form.contractAmount} onChange={set("contractAmount")} type="number" placeholder="1000000000" className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldClient')}</label>
            <input value={form.clientName} onChange={set("clientName")} placeholder={t('client')} className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldManager')}</label>
            <input value={form.managerName} onChange={set("managerName")} placeholder={t('siteManager')} className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldStartDate')}</label>
            <input value={form.startDate} onChange={set("startDate")} type="date" className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldEndDate')}</label>
            <input value={form.endDate} onChange={set("endDate")} type="date" className={I} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldStatus')}</label>
            <select value={form.status} onChange={set("status")} className={I}>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <option key={k} value={k}>{v.icon} {t(v.tKey)}</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('fieldDescription')}</label>
            <textarea value={form.description} onChange={set("description")}
              rows={2} placeholder={t('fieldDescriptionPh')}
              className={`${I} resize-none`} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm"
            style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}`, color: TB.text2 }}>
            {t('cancel')}
          </button>
          <button onClick={handleSave} disabled={!form.projectName?.trim() || saving}
            className="flex-[2] py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{
              background: form.projectName?.trim() ? "linear-gradient(135deg,#1d4ed8,#1e40af)" : TB.card,
              border: `1px solid ${form.projectName?.trim() ? "#3b82f6" : TB.border}`,
            }}>
            {saving ? t('saving') : (isEdit ? t('saveEdit') : t('createSite'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  사이드바 프로젝트 아이템
// ══════════════════════════════════════════════════════════════════
function SidebarItem({ project, selected, onSelect, onEdit, onDelete }) {
  const t = useT('wbs');
  const meta = STATUS_META[project.status] || STATUS_META.PLANNED;
  return (
    <div
      className="group flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all"
      style={{
        backgroundColor: selected ? "#1e3a5f" : "transparent",
        border: `1px solid ${selected ? "#3b82f6" : "transparent"}`,
      }}
      onClick={() => onSelect(project)}
    >
      <span className="text-sm shrink-0 mt-0.5">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold leading-snug truncate"
          style={{ color: selected ? "#60a5fa" : "#e2e8f0" }}>
          {project.projectName}
        </p>
        {project.location && (
          <p className="text-xs truncate mt-0.5" style={{ color: "#475569" }}>
            📍 {project.location}
          </p>
        )}
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: meta.bg, color: meta.color }}>
            {t(meta.tKey)}
          </span>
          <span className="text-xs" style={{ color: "#475569" }}>
            {t('taskCount', { n: project.taskCount ?? 0 })}
          </span>
        </div>
      </div>
      {/* 호버 액션 */}
      <div className="shrink-0 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={e => e.stopPropagation()}>
        <button onClick={() => onEdit(project)}
          className="p-0.5 rounded text-xs hover:text-blue-400 transition"
          style={{ color: "#475569" }}>✏️</button>
        <button onClick={() => onDelete(project.projectId)}
          className="p-0.5 rounded text-xs hover:text-red-400 transition"
          style={{ color: "#475569" }}>🗑</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 대시보드
// ══════════════════════════════════════════════════════════════════
// ── 날씨 칩 (Weather API) ─────────────────────────────────────────
function WeatherChip() {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchWeather = useCallback(async () => {
    try {
      // 저장된 위치 설정 조회 후 날씨 fetch
      const settingsRes = await AxiosCustom.get('/api/settings');
      const map = {};
      (settingsRes.data || []).forEach(s => { map[s.settingKey] = s.settingValue; });

      const params = map.weather_city
        ? `?city=${encodeURIComponent(map.weather_city)}`
        : `?lat=${map.weather_lat || '37.5665'}&lon=${map.weather_lon || '126.9780'}`;

      const res = await AxiosCustom.get(`/api/weather${params}`);
      const d = res.data;
      setWeather(d && typeof d.temp === 'number' && !d.error ? d : null);
    } catch {
      setWeather(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const id = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchWeather]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg shrink-0"
        style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>
        <span className="text-xs animate-pulse" style={{ color: "#475569" }}>🌡 …</span>
      </div>
    );
  }

  const temp = weather?.temp != null ? Number(weather.temp).toFixed(1) : null;
  const hum  = weather?.humidity != null ? Math.round(Number(weather.humidity)) : null;

  const tempColor = temp == null ? "#64748b"
    : temp > 35 ? "#f87171"
    : temp > 28 ? "#fb923c"
    : temp > 10 ? "#4ade80"
    : "#60a5fa";

  const humColor = hum == null ? "#64748b"
    : hum > 80 ? "#60a5fa"
    : hum < 30 ? "#fb923c"
    : "#94a3b8";

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg shrink-0"
      style={{ backgroundColor: "#0d1b2a", border: "1px solid #1a2a3a" }}
      title={weather?.cityName || ''}>
      <span className="flex items-center gap-1 text-xs font-mono">
        <span>🌡</span>
        <span style={{ color: tempColor }}>{temp != null ? `${temp}°C` : "—"}</span>
      </span>
      <span style={{ color: "#253347" }}>│</span>
      <span className="flex items-center gap-1 text-xs font-mono">
        <span>💧</span>
        <span style={{ color: humColor }}>{hum != null ? `${hum}%` : "—"}</span>
      </span>
      {weather?.mock && (
        <span style={{ fontSize: 9, color: "#d97706", opacity: 0.7 }}>DEMO</span>
      )}
    </div>
  );
}

export default function WbsDashboard({ onNavigateToTab, autoEditRequest, onAutoEditDone }) {
  const t = useT('wbs');

  // ── 데이터 상태 ──────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [tasks, setTasks] = useState([]);   // 선택 프로젝트 태스크
  const [loading, setLoading] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);

  // ── UI 상태 ──────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedProject, setSelected] = useState(null);
  const [detailTab, setDetailTab] = useState("gantt"); // gantt|table|link|log
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" | "IN_PROGRESS" | ...
  const [alertBadge, setAlertBadge] = useState(() => unreadCount());

  const sidebarRef = useRef(null);


  const handleNavigate = useCallback((link) => {
    if (onNavigateToTab) onNavigateToTab(link);
  }, [onNavigateToTab]);

  // ── 로드 ─────────────────────────────────────────────────────
  const loadProjects = useCallback(() =>
    AxiosCustom.get("/api/wbs/projects").then(r => setProjects(r.data)).catch(() => { }),
    []);

  const loadAllTasks = useCallback(() =>
    AxiosCustom.get("/api/wbs/tasks").then(r => setAllTasks(r.data)).catch(() => { }),
    []);

  useEffect(() => {
    Promise.all([loadProjects(), loadAllTasks()]).finally(() => setLoading(false));
  }, [loadProjects, loadAllTasks]);

  // ── 알림 뱃지: alertStore 변경 시 갱신 ─────────────────────────
  useEffect(() => {
    const onAlert = () => setAlertBadge(unreadCount());
    window.addEventListener(ALERT_EVENT, onAlert);
    return () => window.removeEventListener(ALERT_EVENT, onAlert);
  }, []);

  // ── 통합관제 연동 폴링: 선택 프로젝트 있을 때 30초마다 진도 갱신 ──
  // 통합관제에서 UPDATE_TASK_PROGRESS → API 저장 → 여기서 30s 주기로 수신
  useEffect(() => {
    if (!selectedProject) return;
    const poll = async () => {
      try {
        const r = await AxiosCustom.get(`/api/wbs/project/${selectedProject.projectId}/tasks`);
        setTasks(prev => {
          const next = sortByStartDate(r.data);
          // 진도가 실제로 달라졌을 때만 상태 교체 (불필요한 리렌더 방지)
          const changed = next.some((t, i) => prev[i]?.progress !== t.progress || prev[i]?.taskId !== t.taskId);
          return changed ? next : prev;
        });
      } catch { /* 폴링 실패 무시 */ }
    };
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [selectedProject?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agent WBS 자동 수정 ────────────────────────────────────────
  // App.js에서 승인 시 autoEditRequest가 설정되면 아래 로직이 자동 실행된다.
  const [autoEditStatus, setAutoEditStatus] = useState(null); // null|'running'|'done'|'error'
  const [autoEditTargetName, setAutoEditTargetName] = useState('');

  useEffect(() => {
    if (!autoEditRequest) return;

    // 이벤트 유형별 삽입할 태스크 정의
    const TASK_MAP = {
      COLLISION: { taskName: t('autoTaskCollision'), duration: 2, source: 'AGENT_AUTO' },
      CRACK:     { taskName: t('autoTaskCrack'),     duration: 3, source: 'AGENT_CRACK' },
      SAFE_ZONE: { taskName: t('autoTaskSafeZone'),  duration: 1, source: 'AGENT_AUTO' },
      SAFETY:    { taskName: t('autoTaskSafety'),    duration: 1, source: 'AGENT_AUTO' },
    };
    const taskDef = TASK_MAP[autoEditRequest.eventType] ?? {
      taskName: t('autoTaskDefault'), duration: 1, source: 'AGENT_AUTO',
    };

    // 날짜 유틸
    const toStr = (d) => d.toISOString().slice(0, 10);
    const addDays = (dateStr, n) => {
      const d = new Date(dateStr || new Date());
      d.setDate(d.getDate() + n);
      return toStr(d);
    };
    const today = toStr(new Date());

    (async () => {
      setAutoEditStatus('running');
      try {
        // 1. 대상 프로젝트 결정:
        //    - autoEditRequest.targetProjectId가 있으면 (선택 모달 or 링크 자동탐지) 해당 프로젝트 사용
        //    - 없으면 IN_PROGRESS 우선, 이후 PLANNED, 마지막으로 첫 번째 프로젝트
        const projectsRes = await AxiosCustom.get('/api/wbs/projects');
        const allProjs = projectsRes.data || [];
        const target = autoEditRequest.targetProjectId
          ? (allProjs.find(p => p.projectId === autoEditRequest.targetProjectId) || allProjs[0])
          : (allProjs.find(p => p.status === 'IN_PROGRESS') ||
             allProjs.find(p => p.status === 'PLANNED') ||
             allProjs[0]);
        if (!target) { setAutoEditStatus('error'); return; }
        setAutoEditTargetName(target.projectName || '');

        // 2. 대상 프로젝트 태스크 조회
        const tasksRes = await AxiosCustom.get(`/api/wbs/project/${target.projectId}/tasks`);
        const existTasks = tasksRes.data || [];

        // 3. CPM: 마지막 endDate 다음 날을 새 태스크 시작일로 설정
        const endDates = existTasks
          .map(t => t.endDate)
          .filter(Boolean)
          .sort();
        const lastEnd = endDates[endDates.length - 1] || today;
        const newStart = addDays(lastEnd, 1);
        const newEnd = addDays(newStart, taskDef.duration - 1);

        // 4. 새 에이전트 태스크 추가
        // RAG 근거가 있으면 노트에 시방서 출처 포함
        const ragEvidence = autoEditRequest.ragEvidence || [];
        const ragNote = ragEvidence.length > 0
          ? t('ragEvidenceLabel') + ragEvidence
            .map((ev, i) => {
              const header = `${i + 1}. ${ev.source}${ev.series ? ` (${ev.series})` : ''}`;
              const snippet = ev.content ? `\n   → ${ev.content.slice(0, 200).replace(/\n/g, ' ')}` : '';
              return header + snippet;
            })
            .join('\n')
          : '';
        const notes = `${t('agentNotePrefix')} ${autoEditRequest.title || ''} — ${autoEditRequest.detail || ''}${ragNote}`.trim();

        await AxiosCustom.post(`/api/wbs/project/${target.projectId}/agent-tasks`, {
          source: taskDef.source,
          tasks: [{
            taskName: taskDef.taskName,
            startDate: newStart,
            endDate: newEnd,
            duration: taskDef.duration,
            progress: 0,
            status: 'NOT_STARTED',
            notes,
          }],
        });

        // 5. 현재 날짜 이후 endDate를 가진 IN_PROGRESS/NOT_STARTED 태스크 → DELAYED 처리
        const toDelay = existTasks.filter(t =>
          (t.status === 'IN_PROGRESS' || t.status === 'NOT_STARTED') &&
          t.endDate && t.endDate >= today
        );
        await Promise.allSettled(
          toDelay.map(t =>
            AxiosCustom.put(`/api/wbs/task/${t.taskId}`, { ...t, status: 'DELAYED' })
          )
        );

        // 6. WBS 대상 프로젝트 선택 + 태스크 새로고침
        const refreshed = await AxiosCustom.get(`/api/wbs/project/${target.projectId}/tasks`);
        setSelected(target);
        setTasks(sortByStartDate(refreshed.data));
        setDetailTab('gantt');
        await loadProjects();
        await loadAllTasks();

        setAutoEditStatus('done');
        setTimeout(() => setAutoEditStatus(null), 4000);
        if (onAutoEditDone) onAutoEditDone();
      } catch (err) {
        console.error('[AgentWbs] 자동 수정 실패:', err);
        setAutoEditStatus('error');
        setTimeout(() => setAutoEditStatus(null), 4000);
        if (onAutoEditDone) onAutoEditDone();
      }
    })();
    // autoEditRequest.approvedAt으로 동일 이벤트 중복 실행 방지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEditRequest?.approvedAt]);

  // ── 프로젝트 선택 (토글) ─────────────────────────────────────
  const selectProject = useCallback(async (project) => {
    if (selectedProject?.projectId === project.projectId) {
      setSelected(null); setTasks([]); return;
    }
    setSelected(project);
    setDetailTab("gantt");
    setTaskLoading(true);
    try {
      const r = await AxiosCustom.get(`/api/wbs/project/${project.projectId}/tasks`);
      setTasks(sortByStartDate(r.data));
    } finally {
      setTaskLoading(false);
    }
  }, [selectedProject]);
  // 사이드바 아이템 선택 — 모바일이면 자동 닫기
  const handleSidebarSelect = useCallback((proj) => {
    selectProject(proj);
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, [selectProject]);

  // ── CRUD ─────────────────────────────────────────────────────
  const handleCreate = useCallback(async (formData) => {
    const base = formData.projectName;
    const existingNames = new Set((projects || []).map(p => p.projectName));
    let name = base;
    let counter = 1;
    while (existingNames.has(name)) name = `${base} (${counter++})`;
    await AxiosCustom.post("/api/wbs/project", { ...formData, projectName: name });
    await loadProjects(); await loadAllTasks();
  }, [loadProjects, loadAllTasks, projects]);

  const handleUpdate = useCallback(async (formData) => {
    const base = formData.projectName;
    const existingNames = new Set(
      (projects || []).filter(p => p.projectId !== editingProject.projectId).map(p => p.projectName)
    );
    let name = base;
    let counter = 1;
    while (existingNames.has(name)) name = `${base} (${counter++})`;
    const resolved = { ...formData, projectName: name };
    await AxiosCustom.put(`/api/wbs/project/${editingProject.projectId}`, resolved);
    await loadProjects(); setEditingProject(null);
    if (selectedProject?.projectId === editingProject.projectId)
      setSelected(prev => ({ ...prev, ...resolved }));
  }, [editingProject, loadProjects, selectedProject, projects]);

  const handleDelete = useCallback(async (projectId) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    await AxiosCustom.delete(`/api/wbs/project/${projectId}`);
    setProjects(prev => prev.filter(p => p.projectId !== projectId));
    if (selectedProject?.projectId === projectId) { setSelected(null); setTasks([]); }
    await loadAllTasks();
  }, [selectedProject, loadAllTasks, t]);

  // BimLinkedPanel에서 자동 생성 후 목록 갱신용
  const reloadTasks = useCallback(async () => {
    if (!selectedProject) return;
    const r = await AxiosCustom.get(`/api/wbs/project/${selectedProject.projectId}/tasks`);
    setTasks(sortByStartDate(r.data));
    await loadProjects();
    await loadAllTasks();
  }, [selectedProject, loadProjects, loadAllTasks]);

  const handleAddTask = useCallback(async (taskData) => {
    const r = await AxiosCustom.post(`/api/wbs/project/${selectedProject.projectId}/task`, taskData);
    setTasks(prev => sortByStartDate([...prev, r.data]));
    setProjects(prev => prev.map(p =>
      p.projectId === selectedProject.projectId
        ? { ...p, taskCount: (p.taskCount || 0) + 1 } : p
    ));
    await loadAllTasks();
  }, [selectedProject, loadAllTasks]);

  const handleUpdateTask = useCallback(async (taskId, taskData) => {
    await AxiosCustom.put(`/api/wbs/task/${taskId}`, taskData);
    setTasks(prev => sortByStartDate(prev.map(t => t.taskId === taskId ? { ...t, ...taskData } : t)));
    await loadAllTasks();
  }, [loadAllTasks]);

  const handleDeleteTask = useCallback(async (taskId) => {
    // BIM 루트 태스크 삭제 시 project_link도 같이 제거 (통합관제 재로드 시 재추가 방지)
    const task = tasks.find(t => t.taskId === taskId);
    if (task?.source === 'BIM_AUTO' && /^BIM:[^:]+:ROOT:.+$/.test(task.notes || '') && selectedProject?.projectId) {
      try {
        const linksRes = await AxiosCustom.get(`/api/project-link/wbs/${selectedProject.projectId}`);
        const link = (linksRes.data || []).find(l => l.note === task.notes);
        if (link) {
          await AxiosCustom.delete(`/api/project-link/${link.linkId}`);
          // 통합관제 씬에도 즉시 반영 (같은 세션에서 열려있는 경우)
          window.dispatchEvent(new CustomEvent('bim-structure-removed', { detail: { note: task.notes } }));
        }
      } catch { /* 무시 */ }
    }

    await AxiosCustom.delete(`/api/wbs/task/${taskId}`);
    // 삭제된 태스크 + 모든 하위 자식을 state에서 제거
    const collectDescendants = (id, snapshot) => {
      const ids = [id];
      snapshot.filter(t => t.parentTaskId === id).forEach(child => {
        ids.push(...collectDescendants(child.taskId, snapshot));
      });
      return ids;
    };
    setTasks(prev => {
      const toRemove = new Set(collectDescendants(taskId, prev));
      setProjects(ps => ps.map(p =>
        p.projectId === selectedProject?.projectId
          ? { ...p, taskCount: Math.max(0, (p.taskCount || 0) - toRemove.size) } : p
      ));
      return prev.filter(t => !toRemove.has(t.taskId));
    });
    await loadAllTasks();
  }, [tasks, selectedProject, loadAllTasks]);

  // ── 필터 ──────────────────────────────────────────────────────
  const filteredProjects = projects.filter(p => {
    if (statusFilter && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.projectName?.toLowerCase().includes(q) || p.location?.toLowerCase().includes(q);
    }
    return true;
  });

  // 간트에 표시할 작업: BIM 자식(ROOT 아닌 BIM_AUTO) 제외, 프로젝트 선택 → 해당 작업, 없으면 전체
  const hideBimChildren = (arr) =>
    arr.filter(t => t.source !== 'BIM_AUTO' || /^BIM:[^:]+:ROOT(:[^:]+)?$/.test(t.notes || ''));

  const ganttTasks = selectedProject
    ? hideBimChildren(tasks)
    : hideBimChildren(statusFilter
      ? allTasks.filter(t =>
        projects.find(p => p.projectId === t.wbsProjectId)?.status === statusFilter
      )
      : allTasks);

  // 통계
  const stats = {
    total: projects.length,
    inProgress: projects.filter(p => p.status === "IN_PROGRESS").length,
    completed: projects.filter(p => p.status === "COMPLETED").length,
    planned: projects.filter(p => p.status === "PLANNED").length,
    onHold: projects.filter(p => p.status === "ON_HOLD").length,
  };

  // 선택 프로젝트 meta
  const selMeta = selectedProject
    ? STATUS_META[selectedProject.status] || STATUS_META.PLANNED
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="text-center">
          <img src={`${process.env.PUBLIC_URL}/logo512.png`} alt="logo" className="mb-3 mx-auto" style={{ width: 72, height: 72, objectFit: 'contain' }} />
          <div className="text-sm">{t('loadingWbs')}</div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  //  렌더
  // ══════════════════════════════════════════════════════════════

  // 사이드바 아이템 선택 — 모바일이면 자동 닫기
  // const handleSidebarSelect = useCallback((proj) => {
  //   selectProject(proj);
  //   if (window.innerWidth < 768) setSidebarOpen(false);
  // }, [selectProject]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-[#06111c]">

      {/* ── Agent 자동 수정 토스트 ──────────────────────────────── */}
      {autoEditStatus && (
        <div style={{
          position: 'fixed', top: '18px', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9998, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 20px', borderRadius: '12px',
          fontSize: '13px', fontWeight: 600,
          boxShadow: '0 4px 24px #00000060',
          ...(autoEditStatus === 'running' && {
            background: 'rgba(13,27,42,0.97)', border: '1px solid #3b82f6',
            color: '#60a5fa',
          }),
          ...(autoEditStatus === 'done' && {
            background: 'rgba(4,47,30,0.97)', border: '1px solid #4ade80',
            color: '#4ade80',
          }),
          ...(autoEditStatus === 'error' && {
            background: 'rgba(69,10,10,0.97)', border: '1px solid #ef4444',
            color: '#f87171',
          }),
        }}>
          {autoEditStatus === 'running' && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>}
          {autoEditStatus === 'done' && '✅'}
          {autoEditStatus === 'error' && '❌'}
          {autoEditStatus === 'running' && ` ${t('wbsAutoEditing')}`}
          {autoEditStatus === 'done' && ` ${t('wbsAutoEditDone', { target: autoEditTargetName ? t('wbsAutoEditDoneTarget', { name: autoEditTargetName }) : '' })}`}
          {autoEditStatus === 'error' && ` ${t('wbsAutoEditFail')}`}
        </div>
      )}

      {/* ════════════════════════════════
          상단 컨트롤 바
          ════════════════════════════════ */}
      <div className="shrink-0" style={{ borderBottom: "1px solid #1a2a3a" }}>

        {/* 1행: 고정 요소 */}
        <div className="flex items-center gap-2 px-3 h-11 overflow-hidden">

          {/* 사이드바 토글 */}
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition shrink-0"
            style={{
              backgroundColor: sidebarOpen ? "#1e3a5f" : "#1c2a3a",
              border: `1px solid ${sidebarOpen ? "#3b82f6" : "#253347"}`,
            }}>
            <span className="text-sm leading-none select-none"
              style={{ color: sidebarOpen ? "#60a5fa" : "#8896a4" }}>
              {sidebarOpen ? "✕" : "☰"}
            </span>
          </button>

          {/* 타이틀 — 모바일에서 말줄임 허용 */}
          <span className="text-sm font-bold text-white truncate min-w-0">🏗 {t('title')}</span>

          <div className="flex-1 min-w-0" />

          {/* 센서 칩 — 항상 표시 */}
          <div className="shrink-0">
            <WeatherChip />
          </div>

          {/* 새 현장 */}
          <button
            onClick={() => { setEditingProject(null); setShowModal(true); }}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition shrink-0"
            style={{ backgroundColor: "#1e1040", border: "1px solid #8b5cf6" }}>
            <span className="hidden sm:inline">{t('addSite')}</span>
            <span className="sm:hidden">＋</span>
          </button>
        </div>

        {/* 2행: 통계 칩 — 가로 스크롤 (스크롤바 숨김) */}
        <div className="wbs-hscroll flex items-center gap-1.5 px-3 pb-2 overflow-x-auto">
          {[
            { key: "", label: t('allSites', { n: stats.total }), color: "#94a3b8", bg: "#1e293b" },
            { key: "IN_PROGRESS", label: t('activeCount', { n: stats.inProgress }), color: "#60a5fa", bg: "#1e3a5f" },
            { key: "COMPLETED", label: t('completedCount', { n: stats.completed }), color: "#4ade80", bg: "#14532d" },
            { key: "PLANNED", label: t('plannedCount', { n: stats.planned }), color: "#94a3b8", bg: "#1e293b" },
            { key: "ON_HOLD", label: t('onHoldCount', { n: stats.onHold }), color: "#f59e0b", bg: "#451a03" },
          ].map(chip => (
            <button
              key={chip.key}
              onClick={() => setStatusFilter(p => p === chip.key ? "" : chip.key)}
              className="px-2 py-0.5 rounded-full text-xs font-medium transition shrink-0"
              style={{
                backgroundColor: statusFilter === chip.key ? chip.bg : "transparent",
                color: statusFilter === chip.key ? chip.color : "#64748b",
                border: `1px solid ${statusFilter === chip.key ? chip.color + "80" : "#253347"}`,
              }}>
              {chip.label}
            </button>
          ))}
          <span className="text-xs shrink-0" style={{ color: "#475569" }}>
            │ {t('taskCount', { n: allTasks.length })}
          </span>

        </div>
      </div>

      {/* ════════════════════════════════
          본문: 사이드바 + 메인
          ════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">

        {/* 모바일 사이드바 오버레이 배경 */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 md:hidden"
            style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── 사이드바 ── */}
        {sidebarOpen && (
          <div
            ref={sidebarRef}
            className={[
              "flex flex-col overflow-y-auto shrink-0",
              // 모바일: 절대 위치 오버레이 / 데스크탑: 일반 흐름
              "absolute inset-y-0 left-0 z-30",
              "md:static md:z-auto",
            ].join(" ")}
            style={{
              width: 220,
              backgroundColor: TB.sidebar,
              borderRight: "1px solid #1a2a3a",
            }}
          >
            {/* 검색 */}
            <div className="px-2 pt-3 pb-2">
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                  style={{ color: "#475569" }}>🔍</span>
                <input
                  type="text" value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full pl-6 pr-2 py-1.5 rounded-lg text-xs outline-none"
                  style={{ backgroundColor: "#0d1b2a", border: "1px solid #253347", color: "#e2e8f0" }}
                />
              </div>
            </div>

            {/* 목록 헤더 */}
            <div className="flex items-center justify-between px-3 pb-1">
              <span className="text-xs font-semibold" style={{ color: "#475569" }}>{t('sidebarTitle')}</span>
              <span className="text-xs" style={{ color: "#334155" }}>{filteredProjects.length}/{projects.length}</span>
            </div>

            {/* 프로젝트 리스트 */}
            <div className="flex-1 px-2 pb-2 flex flex-col gap-0.5 overflow-y-auto">
              {filteredProjects.length > 0 ? (
                filteredProjects.map(p => (
                  <SidebarItem
                    key={p.projectId}
                    project={p}
                    selected={selectedProject?.projectId === p.projectId}
                    onSelect={handleSidebarSelect}
                    onEdit={proj => { setEditingProject(proj); setShowModal(true); }}
                    onDelete={handleDelete}
                  />
                ))
              ) : (
                <div className="text-center py-8 text-xs" style={{ color: "#334155" }}>
                  {search || statusFilter ? t('noResults') : t('noSites')}
                </div>
              )}
            </div>

            {/* 사이드바 하단: 온습도 + 새 현장 */}
            <div className="px-2 py-2 flex flex-col gap-1.5" style={{ borderTop: "1px solid #1a2a3a" }}>
              {/* 온습도 칩 */}
              <WeatherChip />
              {/* 새 현장 버튼 */}
              <button
                onClick={() => { setEditingProject(null); setShowModal(true); }}
                className="w-full py-1.5 rounded-lg text-xs font-semibold text-blue-400 transition"
                style={{ border: "1px dashed #1d4ed8" }}>
                {t('addSiteBtn')}
              </button>
            </div>
          </div>
        )}

        {/* ── 메인 영역 ── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* 선택 프로젝트 정보 바 */}
          {selectedProject ? (
            <div className="shrink-0" style={{ backgroundColor: "#0a1521", borderBottom: `2px solid ${selMeta?.color}40` }}>

              {/* 프로젝트 이름 · 상태 · 정보 */}
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 flex-wrap">
                <button
                  onClick={() => { setSelected(null); setTasks([]); }}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition shrink-0"
                  style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: "#8896a4" }}>
                  {t('backToAll')}
                </button>
                <span className="text-base shrink-0">{selMeta?.icon}</span>
                <span className="font-bold text-white text-sm truncate" style={{ maxWidth: "min(180px, 40vw)" }}>
                  {selectedProject.projectName}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
                  style={{ backgroundColor: selMeta?.bg, color: selMeta?.color }}>
                  {selMeta ? t(selMeta.tKey) : ''}
                </span>
                <div className="hidden md:flex items-center gap-3 text-xs shrink-0" style={{ color: "#64748b" }}>
                  {selectedProject.location && <span>📍 {selectedProject.location}</span>}
                  {selectedProject.contractAmount && <span>💰 ₩{Number(selectedProject.contractAmount).toLocaleString()}</span>}
                  {selectedProject.managerName && <span>👷 {selectedProject.managerName}</span>}
                </div>
                {/* 통합관제 BIM 연동 배지 */}
                {(() => {
                  const bimCount = tasks.filter(tk => /^BIM:[^:]+:[^:]+/.test(tk.notes || '')).length;
                  if (!bimCount) return null;
                  return (
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{ background: '#0c2a1a', border: '1px solid #22c55e44', color: '#4ade80' }}>
                      BIM {bimCount}
                    </span>
                  );
                })()}
              </div>

              {/* 서브탭 — 가로 스크롤 */}
              <div className="wbs-hscroll flex items-center gap-1 px-3 pb-2 overflow-x-auto">
                {[
                  { key: "gantt", label: t('tabGantt') },
                  { key: "table", label: t('tabWbs') },
                  { key: "link", label: t('tabLink') },
                  { key: "log", label: t('tabLog'), badge: alertBadge },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => { setDetailTab(tab.key); if (tab.key === "log") setAlertBadge(0); }}
                    className="relative px-3 py-1.5 rounded-lg text-xs font-semibold transition shrink-0"
                    style={{
                      backgroundColor: detailTab === tab.key ? "#1e3a5f" : "#1c2a3a",
                      border: `1px solid ${detailTab === tab.key ? "#3b82f6" : "#253347"}`,
                      color: detailTab === tab.key ? "#60a5fa" : "#8896a4",
                    }}>
                    {tab.label}
                    {tab.badge > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center
                                       text-white font-bold rounded-full animate-pulse"
                        style={{ backgroundColor: "#dc2626", fontSize: 9, minWidth: 16, height: 16, padding: "0 3px" }}>
                        {tab.badge > 9 ? "9+" : tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

          ) : (
            /* 전체 보기 상태 표시 */
            <div className="shrink-0 flex items-center gap-2 px-4 py-1.5"
              style={{ backgroundColor: "#06111c", borderBottom: "1px solid #1a2a3a" }}>
              <span className="text-xs" style={{ color: "#334155" }}>
                {t('allGanttLabel')}
                {statusFilter && (
                  <span className="ml-2 px-1.5 rounded"
                    style={{ backgroundColor: STATUS_META[statusFilter]?.bg, color: STATUS_META[statusFilter]?.color }}>
                    {t('filterApplied', { status: t(STATUS_META[statusFilter]?.tKey) })}
                  </span>
                )}
                {" "}&nbsp;·&nbsp; {t('taskCount', { n: ganttTasks.length })}
              </span>
              {allTasks.length === 0 && projects.length > 0 && (
                <span className="text-xs" style={{ color: "#475569" }}>— {t('selectSiteHint')}</span>
              )}
            </div>
          )}

          {/* ── 메인 콘텐츠 (스크롤 영역) ── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4 pb-24 sm:pb-4">

            {/* 태스크 로딩 */}
            {selectedProject && taskLoading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <div className="text-center">
                  <img src={`${process.env.PUBLIC_URL}/logo512.png`} alt="logo" className="mb-2 mx-auto animate-pulse" style={{ width: 56, height: 56, objectFit: 'contain' }} />
                  <div className="text-sm">{t('loadingWbs')}</div>
                </div>
              </div>

              /* 선택 프로젝트 뷰 */
            ) : selectedProject ? (
              <>
                {/* 요약 카드 */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3 sm:mb-4">
                  {[
                    {
                      label: t('contractAmount'), icon: "💰",
                      value: selectedProject.contractAmount
                        ? `₩ ${Number(selectedProject.contractAmount).toLocaleString()}`
                        : "-"
                    },
                    { label: t('client'), icon: "🏢", value: selectedProject.clientName || "-" },
                    { label: t('siteManager'), icon: "👷", value: selectedProject.managerName || "-" },
                    { label: t('wbsTasks'), icon: "📋", value: t('taskCount', { n: tasks.length }) },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-2.5 sm:p-3 min-w-0 overflow-hidden"
                      style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}` }}>
                      <p className="text-xs mb-0.5 truncate" style={{ color: TB.text2 }}>{s.icon} {s.label}</p>
                      <p className="text-sm font-bold text-white truncate">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* 설명 */}
                {selectedProject.description && (
                  <div className="rounded-xl p-3 mb-3 text-xs sm:text-sm leading-relaxed"
                    style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}`, color: TB.text2 }}>
                    {selectedProject.description}
                  </div>
                )}

                {/* 서브탭 콘텐츠 */}
                <div className="rounded-xl p-3 sm:p-4"
                  style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}` }}>

                  {detailTab === "gantt" && (
                    <>
                      <h3 className="text-sm font-semibold text-gray-300 mb-3">
                        {t('ganttOf', { name: selectedProject.projectName })}
                      </h3>
                      {tasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                          <div className="text-4xl mb-3">📊</div>
                          <p className="text-sm">{t('noTasksTitle')}</p>
                          <button onClick={() => setDetailTab("table")}
                            className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold text-blue-400"
                            style={{ border: "1px dashed #1d4ed8" }}>
                            {t('noTasksGanttHint')}
                          </button>
                        </div>
                      ) : (
                        <GanttChart tasks={ganttTasks} groupByProject={false} onTaskClick={() => setDetailTab("table")} />
                      )}
                    </>
                  )}

                  {detailTab === "table" && (
                    <>
                      {/* BIM 연동 패널 — BIM 프로젝트가 링크된 경우 자동 표시 */}
                      <BimLinkedPanel
                        wbsProjectId={selectedProject.projectId}
                        tasks={tasks}
                        onReload={reloadTasks}
                        projectStartDate={selectedProject.startDate}
                        projectEndDate={selectedProject.endDate}
                      />

                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h3 className="text-sm font-semibold text-gray-300">
                          {t('wbsListTitle', { n: tasks.length })}
                        </h3>
                        {tasks.some(tk => tk.source && tk.source !== "MANUAL") && (
                          <span className="text-xs text-gray-400">{t('sourceInfo')}</span>
                        )}
                      </div>
                      <WbsTaskTable tasks={tasks} onAdd={handleAddTask} onUpdate={handleUpdateTask} onDelete={handleDeleteTask} />
                    </>
                  )}

                  {detailTab === "link" && (
                    <ProjectLinkPanel wbsProjectId={selectedProject.projectId} onNavigate={handleNavigate} />
                  )}

                  {detailTab === "log" && <WbsAlertLogPanel />}
                </div>
              </>

              /* 전체 간트 (기본 뷰) */
            ) : ganttTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 sm:py-32 text-center px-4">
                <div className="text-5xl sm:text-6xl mb-4">{projects.length === 0 ? "🏗" : "📊"}</div>
                <p className="text-base sm:text-lg font-semibold text-gray-400 mb-2">
                  {projects.length === 0 ? t('noSitesTitle') : t('noTasksTitle')}
                </p>
                <p className="text-xs sm:text-sm mb-4 max-w-xs" style={{ color: TB.text2 }}>
                  {projects.length === 0 ? t('noSitesHint') : t('selectSiteHint')}
                </p>
                {projects.length === 0 && (
                  <button
                    onClick={() => { setEditingProject(null); setShowModal(true); }}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: "linear-gradient(135deg,#1d4ed8,#1e40af)", border: "1px solid #3b82f6" }}>
                    {t('registerFirstSite')}
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-xl p-3 sm:p-4"
                style={{ backgroundColor: TB.card, border: `1px solid ${TB.border}` }}>
                <GanttChart
                  tasks={ganttTasks}
                  groupByProject
                  onTaskClick={(tk) => {
                    const proj = projects.find(p => p.projectId === tk.wbsProjectId);
                    if (proj) selectProject(proj);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 모달 ── */}
      {showModal && (
        <ProjectModal
          initial={editingProject}
          onClose={() => { setShowModal(false); setEditingProject(null); }}
          onSave={editingProject ? handleUpdate : handleCreate}
        />
      )}

      {/* ── WBS Agent 채팅 (플로팅) ── */}
      <WbsAgentChat
        selectedProject={selectedProject}
        onDataChanged={() => {
          loadProjects();
          loadAllTasks();
        }}
      />
    </div>
  );
}
