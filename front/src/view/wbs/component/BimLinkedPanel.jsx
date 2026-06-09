import { useState, useEffect, useCallback } from 'react';
import AxiosCustom from '../../../axios/AxiosCustom';

// ── BIM 공종 메타 ─────────────────────────────────────────────────
const ELEMENT_META = {
  IfcSlab:   { name: '슬래브/기초 공사', icon: '⬛', color: '#22c55e', daysPerUnit: 2.0 },
  IfcColumn: { name: '기둥 공사',        icon: '🏛',  color: '#8b5cf6', daysPerUnit: 1.0 },
  IfcBeam:   { name: '보 공사',          icon: '📏',  color: '#3b82f6', daysPerUnit: 0.5 },
  IfcWall:   { name: '벽체 공사',        icon: '🧱',  color: '#f59e0b', daysPerUnit: 0.4 },
  IfcPier:   { name: '교각 공사',        icon: '🗼',  color: '#ef4444', daysPerUnit: 5.0 },
};
// 시공 순서 기준 정렬 (기초 → 기둥 → 보 → 벽 → 교각 → 기타)
const ELEMENT_ORDER = ['IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcWall', 'IfcPier'];

// notes 필드에 저장하는 연결 마커: "BIM:{bimProjectId}:{elementType}"
const makeMarker = (bimProjectId, elementType) =>
  `BIM:${bimProjectId}:${elementType}`;

// ── 공정률 바 ────────────────────────────────────────────────────
function ProgressBar({ value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1, height: 4, background: '#0d1b2a',
        borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, value || 0)}%`, height: '100%',
          background: color, borderRadius: 2,
          transition: 'width 0.6s ease',
        }} />
      </div>
      <span style={{
        fontSize: 9, color, fontWeight: 700,
        minWidth: 28, textAlign: 'right',
      }}>
        {Math.round(value || 0)}%
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
//  메인 컴포넌트
//  props:
//    wbsProjectId   : string
//    tasks          : WBS 태스크 배열 (진행률 표시에 사용)
//    onReload       : () => void — 태스크 자동생성 후 호출해 목록 갱신
//    projectStartDate : string (YYYY-MM-DD) — 일정 계산 기준일
// ════════════════════════════════════════════════════════════════
export default function BimLinkedPanel({ wbsProjectId, tasks, onReload, projectStartDate }) {
  const [links,       setLinks]       = useState([]);   // BIM 링크 목록
  const [bimData,     setBimData]     = useState({});   // { bimProjectId: { name, elements[] } }
  const [expandedBim, setExpandedBim] = useState({});   // { bimProjectId: bool }
  const [expandedType,setExpandedType]= useState({});   // { 'bimId_type': bool }
  const [loading,     setLoading]     = useState(true);
  const [generating,  setGenerating]  = useState(null); // 생성 중인 bimProjectId

  // ── BIM 링크 + 요소 로드 ─────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!wbsProjectId) return;
    setLoading(true);
    try {
      const res = await AxiosCustom.get(`/api/project-link/wbs/${wbsProjectId}`);
      const bimLinks = (res.data || []).filter(l => l.linkedType === 'BIM');
      setLinks(bimLinks);

      // 처음 로드 시 펼침 상태 초기화 (기존 상태 유지)
      setExpandedBim(prev => {
        const next = { ...prev };
        bimLinks.forEach(l => {
          if (next[l.linkedProjectId] === undefined) next[l.linkedProjectId] = true;
        });
        return next;
      });

      // 각 BIM 프로젝트 요소 병렬 조회
      const data = {};
      await Promise.all(bimLinks.map(async link => {
        try {
          const elRes = await AxiosCustom.get(`/api/bim/project/${link.linkedProjectId}`);
          data[link.linkedProjectId] = {
            name:     link.linkedProjectName || link.linkedProjectId,
            elements: Array.isArray(elRes.data) ? elRes.data : [],
          };
        } catch {
          data[link.linkedProjectId] = {
            name: link.linkedProjectName || link.linkedProjectId,
            elements: [],
          };
        }
      }));
      setBimData(data);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [wbsProjectId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── notes 마커로 연결된 WBS 태스크 탐색 ─────────────────────
  const findLinkedTask = (bimProjectId, elementType) => {
    const marker = makeMarker(bimProjectId, elementType);
    return tasks.find(t => t.notes?.includes(marker));
  };

  // ── 일정 자동 생성 ──────────────────────────────────────────
  const handleAutoGenerate = async (bimProjectId) => {
    const data = bimData[bimProjectId];
    if (!data || generating) return;
    setGenerating(bimProjectId);

    try {
      const elements = data.elements;

      // elementType 별 그룹화
      const byType = {};
      elements.forEach(el => {
        if (!byType[el.elementType]) byType[el.elementType] = [];
        byType[el.elementType].push(el);
      });

      // 시공 순서 정렬 + 나머지 타입 추가
      const orderedTypes = [
        ...ELEMENT_ORDER.filter(t => byType[t]),
        ...Object.keys(byType).filter(t => !ELEMENT_ORDER.includes(t)),
      ];

      // 날짜 유틸
      const addDays = (dateStr, n) => {
        const d = new Date((dateStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
        d.setDate(d.getDate() + n);
        return d.toISOString().slice(0, 10);
      };

      // 기존 태스크 중 가장 늦은 endDate 이후부터 시작 (CPM 연속)
      const latestEnd = tasks.reduce((acc, t) => (
        !t.endDate ? acc : (!acc || t.endDate > acc ? t.endDate : acc)
      ), null);
      let cursor = latestEnd
        ? addDays(latestEnd, 1)
        : (projectStartDate || new Date().toISOString().slice(0, 10));
      let sortOrder = Math.max(0, ...tasks.map(t => t.sortOrder || 0)) + 1;

      let addedCount = 0;
      for (const elementType of orderedTypes) {
        const marker = makeMarker(bimProjectId, elementType);

        // 이미 생성된 타입이면 cursor 진행 후 건너뜀
        const existing = tasks.find(t => t.notes?.includes(marker));
        if (existing) {
          if (existing.endDate && existing.endDate >= cursor)
            cursor = addDays(existing.endDate, 1);
          continue;
        }

        const count    = byType[elementType].length;
        const meta     = ELEMENT_META[elementType] || { name: elementType, daysPerUnit: 1 };
        const duration = Math.max(1, Math.ceil(count * meta.daysPerUnit));
        const startDate = cursor;
        const endDate   = addDays(startDate, duration - 1);
        cursor = addDays(endDate, 1);

        await AxiosCustom.post(`/api/wbs/project/${wbsProjectId}/task`, {
          taskName:       `${meta.name} (×${count})`,
          startDate,
          endDate,
          duration,
          progress:       0,
          status:         'NOT_STARTED',
          responsible:    '',
          notes:          marker,
          source:         'BIM_AUTO',
          wbsCode:        '',
          sortOrder:      sortOrder++,
          predecessorIds: '',
        });
        addedCount++;
      }

      onReload();
    } catch (err) {
      console.error('BIM 일정 자동 생성 실패:', err);
    } finally {
      setGenerating(null);
    }
  };

  // ── 로딩 / BIM 링크 없으면 null ─────────────────────────────
  if (loading || links.length === 0) return null;

  // ════════════════════════════════════════════════════════════════
  //  렌더
  // ════════════════════════════════════════════════════════════════
  return (
    <div style={{ marginBottom: 18 }}>
      {links.map(link => {
        const data     = bimData[link.linkedProjectId] || { name: link.linkedProjectId, elements: [] };
        const elements = data.elements;
        const isOpen   = expandedBim[link.linkedProjectId] !== false;

        // 공종 분류
        const byType = {};
        elements.forEach(el => {
          if (!byType[el.elementType]) byType[el.elementType] = [];
          byType[el.elementType].push(el);
        });
        const orderedTypes = [
          ...ELEMENT_ORDER.filter(t => byType[t]),
          ...Object.keys(byType).filter(t => !ELEMENT_ORDER.includes(t)),
        ];

        const totalTypes  = orderedTypes.length;
        const linkedCount = orderedTypes.filter(t => findLinkedTask(link.linkedProjectId, t)).length;

        // 전체 평균 공정률 (연결된 태스크 기준)
        const avgProgress = linkedCount > 0
          ? Math.round(
              orderedTypes.reduce((sum, t) => {
                const tk = findLinkedTask(link.linkedProjectId, t);
                return sum + (tk?.progress || 0);
              }, 0) / totalTypes
            )
          : null;

        return (
          <div key={link.linkedProjectId} style={{
            background:    '#08131e',
            border:        '1px solid #1e3a5f',
            borderRadius:  10,
            marginBottom:  12,
            overflow:      'hidden',
          }}>

            {/* ── BIM 프로젝트 헤더 ── */}
            <div
              style={{
                display:       'flex',
                alignItems:    'center',
                gap:           10,
                padding:       '10px 14px',
                background:    '#0a1625',
                borderBottom:  isOpen ? '1px solid #1a2a3a' : 'none',
                cursor:        'pointer',
                userSelect:    'none',
              }}
              onClick={() =>
                setExpandedBim(prev => ({ ...prev, [link.linkedProjectId]: !prev[link.linkedProjectId] }))
              }
            >
              <span style={{ fontSize: 16 }}>🏗</span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', marginBottom: 1 }}>
                  {data.name}
                </div>
                <div style={{ fontSize: 9, color: '#4b5563' }}>
                  BIM 연동 · 요소 {elements.length}개 · {totalTypes}개 공종
                  {avgProgress !== null && ` · 평균 공정률 ${avgProgress}%`}
                </div>
              </div>

              {/* 우측 뱃지 + 버튼 — 부모 클릭 전파 차단 */}
              <div
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
                onClick={e => e.stopPropagation()}
              >
                <span style={{
                  fontSize:   10,
                  padding:    '2px 8px',
                  borderRadius: 10,
                  background: linkedCount === totalTypes && totalTypes > 0 ? '#14532d' : '#1e293b',
                  color:      linkedCount === totalTypes && totalTypes > 0 ? '#4ade80' : '#64748b',
                  border:     `1px solid ${linkedCount === totalTypes && totalTypes > 0 ? '#166534' : '#253347'}`,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>
                  WBS {linkedCount}/{totalTypes}
                </span>

                <button
                  onClick={() => handleAutoGenerate(link.linkedProjectId)}
                  disabled={!!generating}
                  style={{
                    background:   generating === link.linkedProjectId ? '#111e2d' : '#1e3a5f',
                    border:       '1px solid #3b82f6',
                    borderRadius: 6,
                    padding:      '4px 11px',
                    color:        generating === link.linkedProjectId ? '#4b5563' : '#60a5fa',
                    fontSize:     10,
                    fontWeight:   700,
                    cursor:       generating ? 'not-allowed' : 'pointer',
                    whiteSpace:   'nowrap',
                    transition:   'all 0.15s',
                  }}
                >
                  {generating === link.linkedProjectId ? '⏳ 생성 중…' : '⚡ 일정 자동 생성'}
                </button>
              </div>

              <span style={{ fontSize: 10, color: '#374151', marginLeft: 2, flexShrink: 0 }}>
                {isOpen ? '▲' : '▼'}
              </span>
            </div>

            {/* ── 공종별 아코디언 ── */}
            {isOpen && (
              <div>
                {orderedTypes.length === 0 ? (
                  <div style={{ padding: '18px 14px', fontSize: 11, color: '#374151', textAlign: 'center' }}>
                    BIM 요소가 없습니다. BIM 프로젝트에 요소를 추가해주세요.
                  </div>
                ) : (
                  orderedTypes.map((elementType, idx) => {
                    const count       = byType[elementType].length;
                    const meta        = ELEMENT_META[elementType] || { name: elementType, icon: '📦', color: '#94a3b8', daysPerUnit: 1 };
                    const typeKey     = `${link.linkedProjectId}_${elementType}`;
                    const isTypeOpen  = !!expandedType[typeKey];
                    const linkedTask  = findLinkedTask(link.linkedProjectId, elementType);
                    const progress    = linkedTask?.progress ?? null;
                    const estDays     = Math.max(1, Math.ceil(count * meta.daysPerUnit));

                    return (
                      <div
                        key={elementType}
                        style={{ borderBottom: idx < orderedTypes.length - 1 ? '1px solid #0d1525' : 'none' }}
                      >
                        {/* 공종 요약 행 */}
                        <div
                          style={{
                            display:    'flex',
                            alignItems: 'center',
                            gap:        10,
                            padding:    '9px 14px',
                            cursor:     'pointer',
                            background: isTypeOpen ? '#071018' : 'transparent',
                            transition: 'background 0.12s',
                          }}
                          onClick={() =>
                            setExpandedType(prev => ({ ...prev, [typeKey]: !prev[typeKey] }))
                          }
                        >
                          <span style={{ fontSize: 14, color: meta.color, minWidth: 20, textAlign: 'center' }}>
                            {meta.icon}
                          </span>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: progress !== null ? 4 : 0 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>
                                {meta.name}
                              </span>
                              <span style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                                background: '#111e2d', color: '#475569',
                              }}>
                                {elementType} × {count}
                              </span>
                              <span style={{ fontSize: 9, color: '#374151' }}>~{estDays}일</span>
                            </div>
                            {progress !== null && <ProgressBar value={progress} color={meta.color} />}
                          </div>

                          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                            {linkedTask ? (
                              <span style={{
                                fontSize: 9, padding: '2px 7px', borderRadius: 5,
                                background: '#0c2a1a', color: '#4ade80',
                                border: '1px solid #166534', fontWeight: 700,
                              }}>✓ WBS</span>
                            ) : (
                              <span style={{
                                fontSize: 9, padding: '2px 7px', borderRadius: 5,
                                background: '#111e2d', color: '#374151',
                                border: '1px solid #1e293b',
                              }}>미연결</span>
                            )}
                            <span style={{ fontSize: 9, color: '#253347' }}>{isTypeOpen ? '▲' : '▼'}</span>
                          </div>
                        </div>

                        {/* 세부 요소 목록 */}
                        {isTypeOpen && (
                          <div style={{ background: '#050d17', padding: '6px 14px 10px 42px' }}>
                            {/* 연결된 태스크 정보 */}
                            {linkedTask && (
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '5px 8px', marginBottom: 6,
                                background: '#0a1e10', borderRadius: 5,
                                border: '1px solid #166534',
                              }}>
                                <span style={{ fontSize: 9, color: '#4ade80', fontWeight: 700 }}>WBS 태스크</span>
                                <span style={{ fontSize: 10, color: '#d1d5db', flex: 1 }}>{linkedTask.taskName}</span>
                                <span style={{ fontSize: 9, color: '#4b5563' }}>
                                  {linkedTask.startDate} ~ {linkedTask.endDate}
                                </span>
                                <span style={{ fontSize: 10, color: '#4ade80', fontWeight: 700 }}>
                                  {linkedTask.progress}%
                                </span>
                              </div>
                            )}

                            {/* 요소 목록 헤더 */}
                            <div style={{
                              display: 'grid', gridTemplateColumns: '28px 1fr 90px 110px',
                              gap: 4, padding: '2px 0 4px',
                              borderBottom: '1px solid #0d1b2a',
                            }}>
                              {['#', '요소 ID', '재료', '크기 (m)'].map(h => (
                                <span key={h} style={{ fontSize: 9, color: '#253347', fontWeight: 700 }}>{h}</span>
                              ))}
                            </div>

                            {/* 요소 행 */}
                            {byType[elementType].map((el, i) => (
                              <div
                                key={el.elementId}
                                style={{
                                  display: 'grid', gridTemplateColumns: '28px 1fr 90px 110px',
                                  gap: 4, padding: '3px 0',
                                  borderBottom: i < byType[elementType].length - 1 ? '1px solid #080f18' : 'none',
                                }}
                              >
                                <span style={{ fontSize: 9, color: '#253347' }}>{i + 1}</span>
                                <span style={{ fontSize: 9, color: '#4b5563', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  …{el.elementId?.slice(-10)}
                                </span>
                                <span style={{ fontSize: 9, color: '#374151' }}>{el.material || '—'}</span>
                                <span style={{ fontSize: 9, color: '#374151' }}>
                                  {el.sizeX != null
                                    ? `${Number(el.sizeX).toFixed(2)}×${Number(el.sizeY).toFixed(2)}×${Number(el.sizeZ).toFixed(2)}`
                                    : '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
