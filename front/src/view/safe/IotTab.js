import React, { useState, useEffect, useCallback } from "react";
import AxiosCustom from "../../axios/AxiosCustom";
import { useT } from "../../i18n/LanguageContext";

const TB = {
  card:  "bg-[#1c2a3a] border border-[#253347] rounded-xl shadow-lg",
  text1: "#e2e8f0",
  text2: "#8896a4",
};

// ── 프로젝트 선택 드롭다운 (센서 카드에서 프로젝트를 연결할 때) ──
function ProjectPicker({ projectList, mappedProjectIds, onAdd, onRemove, t }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition"
        style={{ backgroundColor: "#0d2040", border: "1px solid #3b82f6", color: "#93c5fd" }}
      >
        <span>＋</span> {t('addProjectLink')}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-2xl p-3 flex flex-col gap-1"
          style={{ backgroundColor: "#0a1521", border: "1px solid #1e3a5f", minWidth: "220px" }}
          onClick={e => e.stopPropagation()}
        >
          <div className="text-xs font-semibold mb-1" style={{ color: TB.text2 }}>
            {t('projectPickerTitle')}
          </div>
          {projectList.length === 0 ? (
            <div className="text-xs py-2 text-center" style={{ color: "#4b5563" }}>
              {t('noProjects')}
            </div>
          ) : (
            projectList.map(proj => {
              const linked = mappedProjectIds.includes(proj.projectId);
              return (
                <button
                  key={proj.projectId}
                  type="button"
                  onClick={() => linked ? onRemove(proj.projectId) : onAdd(proj.projectId)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition text-left"
                  style={{
                    backgroundColor: linked ? "#1e3a5f" : "#0d1b2a",
                    border: `1px solid ${linked ? "#3b82f6" : "#253347"}`,
                    color: linked ? "#93c5fd" : TB.text1,
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <span>🛡</span>
                    <span className="truncate max-w-[140px]">{proj.projectName}</span>
                  </span>
                  <span className="shrink-0 ml-2"
                        style={{ color: linked ? "#f87171" : "#4ade80" }}>
                    {linked ? t('unlink') : t('link')}
                  </span>
                </button>
              );
            })
          )}
          <button type="button" onClick={() => setOpen(false)}
                  className="mt-1 w-full py-1.5 rounded-lg text-xs"
                  style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
            {t('close')}
          </button>
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
}

// ── 전체 센서 카드 ────────────────────────────────────────────
function SensorStatusCard({ location, data, mappedProjects, projectList, onAddMapping, onRemoveMapping, t }) {
  const hasData = !!data;

  const isOnline = hasData && (() => {
    return Date.now() - new Date(data.timestamp).getTime() < 5 * 60 * 1000;
  })();

  const tempColor = hasData
    ? data.temperature > 35 ? "#f87171"
    : data.temperature < 0  ? "#60a5fa"
    : "#4ade80"
    : TB.text2;

  const mappedProjectIds = mappedProjects.map(p => p.projectId);

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        backgroundColor: "#0d1b2a",
        border: `1px solid ${isOnline ? "#253347" : "#1a2a3a"}`,
        opacity: isOnline ? 1 : 0.75,
      }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{isOnline ? "🟢" : "⚫"}</span>
          <div>
            <div className="text-sm font-bold" style={{ color: TB.text1 }}>{location}</div>
            <div className="text-xs" style={{ color: TB.text2 }}>
              {isOnline ? t('online') : hasData ? t('offline') : t('noData')}
            </div>
          </div>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: isOnline ? "#14532d" : "#1c2a3a",
                color: isOnline ? "#4ade80" : "#4b5563",
                border: `1px solid ${isOnline ? "#4ade80" : "#374151"}`,
              }}>
          MQTT
        </span>
      </div>

      {/* 온도/습도 */}
      {hasData ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg p-2 text-center"
               style={{ backgroundColor: "#0a1521", border: "1px solid #1a2a3a" }}>
            <div className="text-xs mb-0.5" style={{ color: TB.text2 }}>{t('tempLabel')}</div>
            <div className="text-xl font-bold" style={{ color: tempColor }}>
              {data.temperature?.toFixed(1)}°C
            </div>
          </div>
          <div className="rounded-lg p-2 text-center"
               style={{ backgroundColor: "#0a1521", border: "1px solid #1a2a3a" }}>
            <div className="text-xs mb-0.5" style={{ color: TB.text2 }}>{t('humLabel')}</div>
            <div className="text-xl font-bold" style={{ color: "#60a5fa" }}>
              {data.humidity?.toFixed(1)}%
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-center py-3 rounded-lg"
             style={{ backgroundColor: "#0a1521", color: "#4b5563" }}>
          {t('noData')}
        </div>
      )}

      {data?.timestamp && (
        <div className="text-xs" style={{ color: "#374151" }}>
          {t('lastReceived')} {new Date(data.timestamp).toLocaleString()}
        </div>
      )}

      {/* 연결된 프로젝트 목록 + 추가 버튼 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold" style={{ color: TB.text2 }}>
            {t('connectedProjects')} ({mappedProjects.length})
          </span>
          <ProjectPicker
            projectList={projectList}
            mappedProjectIds={mappedProjectIds}
            onAdd={projectId => onAddMapping(projectId, location)}
            onRemove={projectId => onRemoveMapping(projectId, location)}
            t={t}
          />
        </div>
        {mappedProjects.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {mappedProjects.map(p => (
              <span key={p.projectId}
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: "#1e3a5f", color: "#93c5fd", border: "1px solid #1d4ed8" }}>
                🛡 {p.projectName}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs" style={{ color: "#374151" }}>{t('noProjectLinked')}</div>
        )}
      </div>
    </div>
  );
}

// ── 센서 선택 드롭다운 (프로젝트 섹션에서 센서를 연결할 때) ──
function SensorLocationPicker({ locations, mappedLocations, onAdd, t }) {
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [selectedLoc, setSelectedLoc] = useState("");

  const available = locations.filter(loc => !mappedLocations.includes(loc));

  function handleConfirm() {
    if (!selectedLoc) return;
    onAdd(selectedLoc, alias.trim());
    setSelectedLoc("");
    setAlias("");
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition"
        style={{ backgroundColor: "#0d2040", border: "1px solid #3b82f6", color: "#93c5fd" }}
      >
        <span>＋</span> {t('addSensorLink')}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 rounded-xl shadow-2xl p-4 flex flex-col gap-3"
          style={{ backgroundColor: "#0a1521", border: "1px solid #1e3a5f", minWidth: "260px" }}
          onClick={e => e.stopPropagation()}
        >
          <div className="text-xs font-semibold" style={{ color: TB.text2 }}>{t('pickSensorTitle')}</div>
          {available.length === 0 ? (
            <div className="text-xs text-center py-2" style={{ color: "#4b5563" }}>
              {t('noAvailableSensors')}
            </div>
          ) : (
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {available.map(loc => (
                <button key={loc} type="button" onClick={() => setSelectedLoc(loc)}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm transition"
                        style={{
                          backgroundColor: selectedLoc === loc ? "#1e3a5f" : "#0d1b2a",
                          border: `1px solid ${selectedLoc === loc ? "#3b82f6" : "#253347"}`,
                          color: selectedLoc === loc ? "#93c5fd" : TB.text1,
                        }}>
                  📡 {loc}
                </button>
              ))}
            </div>
          )}

          {selectedLoc && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: TB.text2 }}>{t('aliasLabel')}</label>
              <input value={alias} onChange={e => setAlias(e.target.value)}
                     placeholder={t('aliasPlaceholder')}
                     className="w-full bg-[#0d1b2a] border border-[#253347] rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-500" />
            </div>
          )}

          <div className="flex gap-2">
            <button type="button"
                    onClick={() => { setOpen(false); setSelectedLoc(""); setAlias(""); }}
                    className="flex-1 py-2 rounded-lg text-xs"
                    style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
              {t('cancel')}
            </button>
            <button type="button" disabled={!selectedLoc} onClick={handleConfirm}
                    className="flex-[2] py-2 rounded-lg text-xs font-semibold text-white"
                    style={{
                      background: selectedLoc ? "linear-gradient(135deg,#1d4ed8,#2563eb)" : "#1c2a3a",
                      border: `1px solid ${selectedLoc ? "#3b82f6" : "#253347"}`,
                    }}>
              {t('confirm')}
            </button>
          </div>
        </div>
      )}

      {open && <div className="fixed inset-0 z-40"
                    onClick={() => { setOpen(false); setSelectedLoc(""); setAlias(""); }} />}
    </div>
  );
}

// ── 프로젝트별 매핑 행 ────────────────────────────────────────
function SensorMappingChip({ mapping, onRemove, latestData, t }) {
  const data = latestData[mapping.sensorLocation];
  const displayName = mapping.sensorAlias || mapping.sensorLocation;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
         style={{ backgroundColor: "#0d1b2a", border: "1px solid #253347" }}>
      <span className="text-xs">📡</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold truncate" style={{ color: TB.text1 }}>{displayName}</div>
        {data && (
          <div className="text-xs" style={{ color: TB.text2 }}>
            {data.temperature?.toFixed(1)}°C / {data.humidity?.toFixed(1)}%
          </div>
        )}
      </div>
      <button onClick={() => onRemove(mapping.mappingId)}
              className="text-xs px-2 py-0.5 rounded shrink-0"
              style={{ color: "#f87171", border: "1px solid #450a0a" }}>
        {t('unlink')}
      </button>
    </div>
  );
}

// ── 프로젝트별 IoT 매핑 섹션 ─────────────────────────────────
function ProjectIotSection({ project, allLocations, mappings, latestData, onAdd, onRemove, t }) {
  const [collapsed, setCollapsed] = useState(false);
  const mappedLocations = mappings.map(m => m.sensorLocation);

  return (
    <div className={TB.card + " p-4"}>
      <div className="flex items-center justify-between cursor-pointer"
           onClick={() => setCollapsed(v => !v)}>
        <div className="flex items-center gap-2">
          <span>🛡</span>
          <div>
            <div className="text-sm font-bold" style={{ color: TB.text1 }}>{project.projectName}</div>
            <div className="text-xs" style={{ color: TB.text2 }}>
              📍 {project.location || t('locationUnset')} · {t('sensorCount', { n: mappings.length })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SensorLocationPicker
            locations={allLocations}
            mappedLocations={mappedLocations}
            onAdd={(loc, alias) => onAdd(project.projectId, loc, alias)}
            t={t}
          />
          <span className="text-sm" style={{ color: TB.text2 }}>{collapsed ? "▶" : "▼"}</span>
        </div>
      </div>

      {!collapsed && (
        <div className="mt-3">
          {mappings.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {mappings.map(m => (
                <SensorMappingChip key={m.mappingId} mapping={m}
                                   onRemove={onRemove} latestData={latestData} t={t} />
              ))}
            </div>
          ) : (
            <div className="text-xs text-center py-3" style={{ color: "#4b5563" }}>
              {t('noSensorLinked')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 IoT 탭 ──────────────────────────────────────────────
export default function IotTab({ projectList }) {
  const t = useT('iotTab');
  const [allMappings,  setAllMappings]  = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [latestData,   setLatestData]   = useState({});
  const [loading,      setLoading]      = useState(true);

  const loadMappings = useCallback(() =>
    AxiosCustom.get("/api/safe/iot/mappings")
      .then(r => setAllMappings(r.data || []))
      .catch(() => setAllMappings([])),
  []);

  const loadLocations = useCallback(() =>
    AxiosCustom.get("/api/sensor/locations")
      .then(r => setAllLocations(r.data || []))
      .catch(() => setAllLocations([])),
  []);

  const loadLatestData = useCallback(async (locations) => {
    if (!locations.length) return;
    const results = await Promise.allSettled(
      locations.map(loc =>
        AxiosCustom.get(`/api/sensor/logs?location=${encodeURIComponent(loc)}&limit=1`)
          .then(r => ({ loc, data: r.data?.[0] ?? null }))
      )
    );
    const map = {};
    results.forEach(res => {
      if (res.status === "fulfilled" && res.value.data) {
        map[res.value.loc] = res.value.data;
      }
    });
    setLatestData(map);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadMappings(), loadLocations()]).finally(() => setLoading(false));
  }, [loadMappings, loadLocations]);

  useEffect(() => {
    if (allLocations.length) loadLatestData(allLocations);
  }, [allLocations, loadLatestData]);

  useEffect(() => {
    if (!allLocations.length) return;
    const id = setInterval(() => loadLatestData(allLocations), 30_000);
    return () => clearInterval(id);
  }, [allLocations, loadLatestData]);

  // ── 매핑 인덱스 ──────────────────────────────────────────
  const mappingsByProject = {};
  allMappings.forEach(m => {
    if (!mappingsByProject[m.projectId]) mappingsByProject[m.projectId] = [];
    mappingsByProject[m.projectId].push(m);
  });

  const projectsByLocation = {};
  allMappings.forEach(m => {
    if (!projectsByLocation[m.sensorLocation]) projectsByLocation[m.sensorLocation] = [];
    const proj = projectList.find(p => p.projectId === m.projectId);
    if (proj) projectsByLocation[m.sensorLocation].push(proj);
  });

  // ── 액션 ─────────────────────────────────────────────────
  async function handleAdd(projectId, sensorLocation, sensorAlias = "") {
    try {
      await AxiosCustom.post("/api/safe/iot/mapping", { projectId, sensorLocation, sensorAlias });
      await loadMappings();
    } catch {
      alert(t('noAvailableSensors'));
    }
  }

  async function handleRemoveById(mappingId) {
    if (!window.confirm(t('confirmUnlink'))) return;
    await AxiosCustom.delete(`/api/safe/iot/mapping/${mappingId}`);
    setAllMappings(prev => prev.filter(m => m.mappingId !== mappingId));
  }

  async function handleRemoveByPair(projectId, sensorLocation) {
    const mapping = allMappings.find(
      m => m.projectId === projectId && m.sensorLocation === sensorLocation
    );
    if (!mapping) return;
    if (!window.confirm(t('confirmUnlink'))) return;
    await AxiosCustom.delete(`/api/safe/iot/mapping/${mapping.mappingId}`);
    setAllMappings(prev => prev.filter(m => m.mappingId !== mapping.mappingId));
  }

  const onlineCount = allLocations.filter(loc => {
    const d = latestData[loc];
    return d && Date.now() - new Date(d.timestamp).getTime() < 5 * 60 * 1000;
  }).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: TB.text2 }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d1b2a] text-gray-200 p-6">

      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{t('title')}</h2>
          <p className="text-sm mt-0.5" style={{ color: TB.text2 }}>{t('subtitle')}</p>
        </div>
        <button onClick={() => { loadMappings(); loadLatestData(allLocations); }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347", color: TB.text2 }}>
          {t('refresh')}
        </button>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: t('statSensors'), value: allLocations.length, color: "#60a5fa", icon: "📡" },
          { label: t('statOnline'),  value: onlineCount,         color: "#4ade80", icon: "🟢" },
          { label: t('statMappings'),value: allMappings.length,  color: "#c4b5fd", icon: "🔗" },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3 text-center"
               style={{ backgroundColor: "#1c2a3a", border: "1px solid #253347" }}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs mt-0.5" style={{ color: TB.text2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ══ 섹션 1: 전체 IoT 센서 ══ */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold" style={{ color: TB.text1 }}>{t('sectionSensors')}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#1c2a3a", color: TB.text2, border: "1px solid #253347" }}>
            {t('sectionSensorsBadge')}
          </span>
        </div>

        {allLocations.length === 0 ? (
          <div className="rounded-xl p-10 text-center"
               style={{ backgroundColor: "#1c2a3a", border: "1px dashed #253347" }}>
            <div className="text-4xl mb-3">📡</div>
            <div className="text-sm font-semibold mb-1" style={{ color: TB.text1 }}>
              {t('noSensors')}
            </div>
            <div className="text-xs" style={{ color: TB.text2 }}>{t('noSensorsHint')}</div>
            <div className="text-xs mt-2 font-mono px-3 py-1 rounded inline-block"
                 style={{ backgroundColor: "#0d1b2a", color: "#60a5fa", border: "1px solid #1e3a5f" }}>
              &#123; "location": "bridgeA", "temperature": 25.0, ... &#125;
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {allLocations.map(loc => (
              <SensorStatusCard
                key={loc}
                location={loc}
                data={latestData[loc] ?? null}
                mappedProjects={projectsByLocation[loc] ?? []}
                projectList={projectList}
                onAddMapping={(projectId, sensorLocation) => handleAdd(projectId, sensorLocation)}
                onRemoveMapping={(projectId, sensorLocation) => handleRemoveByPair(projectId, sensorLocation)}
                t={t}
              />
            ))}
          </div>
        )}
      </div>

      {/* ══ 섹션 2: 프로젝트별 센서 매핑 ══ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold" style={{ color: TB.text1 }}>{t('sectionMappings')}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#1c2a3a", color: TB.text2, border: "1px solid #253347" }}>
            {t('sectionMappingsBadge')}
          </span>
        </div>

        {projectList.length === 0 ? (
          <div className="rounded-xl p-8 text-center"
               style={{ backgroundColor: "#1c2a3a", border: "1px dashed #253347" }}>
            <div className="text-4xl mb-3">🛡</div>
            <div className="text-sm" style={{ color: TB.text2 }}>{t('noProjectsForMapping')}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {projectList.map(proj => (
              <ProjectIotSection
                key={proj.projectId}
                project={proj}
                allLocations={allLocations}
                mappings={mappingsByProject[proj.projectId] || []}
                latestData={latestData}
                onAdd={handleAdd}
                onRemove={handleRemoveById}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
