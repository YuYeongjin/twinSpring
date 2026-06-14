import { useState, useEffect, useCallback } from 'react';
import AxiosCustom from '../../../axios/AxiosCustom';
import {
  ELEMENT_META, ELEMENT_ORDER, SUB_TASKS,
  calcTotalVolume, calcSubDays,
  generateBimWbsTasks,
} from '../bimTaskGenerator';

// 일수 차이 계산 (두 날짜 문자열 'YYYY-MM-DD')
const daysBetween = (a, b) => {
  if (!a || !b) return null;
  const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
  return Math.max(1, Math.round(ms / 86400000));
};



// ════════════════════════════════════════════════════════════════
//  메인 컴포넌트
//  props:
//    wbsProjectId   : string
//    tasks          : WBS 태스크 배열 (진행률 표시에 사용)
//    onReload       : () => void — 태스크 자동생성 후 호출해 목록 갱신
//    projectStartDate : string (YYYY-MM-DD) — 일정 계산 기준일
// ════════════════════════════════════════════════════════════════
export default function BimLinkedPanel({ wbsProjectId, tasks, onReload, projectStartDate, projectEndDate }) {
  const [links,       setLinks]       = useState([]);   // BIM 링크 목록
  const [bimData,     setBimData]     = useState({});   // { bimProjectId: { name, elements[] } }
  const [expandedBim, setExpandedBim] = useState({});   // { bimProjectId: bool }
  const [expandedType,setExpandedType]= useState({});   // { 'bimId_type': bool }
  const [loading,     setLoading]     = useState(true);
  const [generating,  setGenerating]  = useState(null); // 생성 중인 bimProjectId
  const [targetDays,  setTargetDays]  = useState({});   // { bimProjectId: number } 목표 공기(일)

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

  // ── WBS root 태스크 존재 여부 확인 (공사 단계별 WBS 생성 완료 여부) ──
  const hasWbsRoot = (bimProjectId) =>
    !!tasks.find(t => t.notes === `BIM:${bimProjectId}:ROOT`);

  // ── BIM 프로젝트의 총 man-days 및 인원 추산 (데이터 확인용) ──
  const calcProjectStats = (bimProjectId) => {
    const data = bimData[bimProjectId];
    if (!data?.elements?.length) return { totalManDays: 0, seqDays1: 0, workers: 1, actualDays: 0, tgt: 90 };

    const byType = {};
    data.elements.forEach(el => {
      if (!byType[el.elementType]) byType[el.elementType] = [];
      byType[el.elementType].push(el);
    });

    // 1인 기준 순차 공기 계산
    let totalManDays = 0; // 가속 가능한 작업만의 man-days (양생 제외)
    let seqDays1    = 0;  // 1인 기준 전체 순차 공기

    const byTypeStats = {}; // { elementType: { vol, subDefs } }
    Object.entries(byType).forEach(([elementType, els]) => {
      const vol     = calcTotalVolume(els);
      const subDefs = SUB_TASKS[elementType];
      byTypeStats[elementType] = { vol, subDefs };

      if (subDefs) {
        subDefs.forEach(sub => {
          const d = Math.max(sub.minDays, Math.ceil(vol * sub.daysPerM3));
          seqDays1 += d;
          if (sub.daysPerM3 > 0) totalManDays += Math.ceil(vol * sub.daysPerM3); // 양생 제외
        });
      } else {
        const meta = ELEMENT_META[elementType];
        const d = Math.max(1, Math.ceil(vol * (meta?.daysPerM3 || 0.3)));
        seqDays1    += d;
        totalManDays += d;
      }
    });

    // 목표 공기 결정 (우선순위: 사용자 입력 > 프로젝트 기간 > 1인 기준의 60%)
    const projDays = daysBetween(projectStartDate, projectEndDate);
    const tgt      = Math.max(1, targetDays[bimProjectId] || projDays || Math.ceil(seqDays1 * 0.6));
    const workers  = Math.max(1, Math.ceil(totalManDays / tgt));

    // 인원 적용 후 실제 달력 공기 계산
    // (양생 같은 고정 공정의 minDays로 인해 단순 나눗셈보다 길어짐)
    let actualDays = 0;
    Object.entries(byTypeStats).forEach(([elementType, { vol, subDefs }]) => {
      if (subDefs) {
        subDefs.forEach(sub => { actualDays += calcSubDays(sub, vol, workers); });
      } else {
        const meta = ELEMENT_META[elementType];
        actualDays += Math.max(1, Math.ceil((vol * (meta?.daysPerM3 || 0.3)) / workers));
      }
    });

    return {
      totalManDays: Math.round(totalManDays),
      seqDays1:     Math.round(seqDays1),
      workers,
      actualDays:   Math.round(actualDays), // 인원 적용 후 실제 공기 (minDays 제약 반영)
      tgt,
    };
  };

  // ── 일정 자동 생성 (작업계획 차트와 동일한 공사 단계별 구조) ──
  const handleAutoGenerate = async (bimProjectId) => {
    const data = bimData[bimProjectId];
    if (!data || generating) return;
    setGenerating(bimProjectId);
    try {
      await generateBimWbsTasks({
        wbsProjectId,
        bimProjectId,
        bimProjectName: data.name || null,
        elements:      data.elements,
        existingTasks: tasks,
        startDate:     projectStartDate || null,
      });
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
        const wbsGenerated = hasWbsRoot(link.linkedProjectId);

        // WBS root 태스크 공정률 (생성된 경우)
        const rootTask = tasks.find(t => t.notes === `BIM:${link.linkedProjectId}:ROOT`);
        const rootProgress = rootTask ? rootTask.progress : null;

        // 인원 추산 (데이터 확인용)
        const stats = calcProjectStats(link.linkedProjectId);

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
                  {rootProgress !== null && ` · 전체 공정률 ${rootProgress}%`}
                </div>
              </div>

              {/* 우측 뱃지 + 인원 추산 + 버튼 — 부모 클릭 전파 차단 */}
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}
                onClick={e => e.stopPropagation()}
              >
                {/* WBS 생성 여부 뱃지 */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{
                    fontSize:   10,
                    padding:    '2px 8px',
                    borderRadius: 10,
                    background: wbsGenerated ? '#14532d' : '#1e293b',
                    color:      wbsGenerated ? '#4ade80' : '#64748b',
                    border:     `1px solid ${wbsGenerated ? '#166534' : '#253347'}`,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}>
                    {wbsGenerated ? 'WBS 생성됨' : 'WBS 미생성'}
                  </span>
                </div>

                {/* 인원 추산 행 */}
                {elements.length > 0 && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 3,
                    background: '#071018', borderRadius: 6,
                    border: '1px solid #1a2a3a', padding: '5px 8px',
                    fontSize: 9,
                  }}>
                    {/* 1행: 공사량 + 목표 공기 입력 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: '#475569' }}>공사량</span>
                      <span style={{ color: '#60a5fa', fontWeight: 700 }}>{stats.totalManDays}m-d</span>
                      <span style={{ color: '#1e3a5f' }}>|</span>
                      <span style={{ color: '#475569' }}>1인공기</span>
                      <span style={{ color: '#64748b' }}>{stats.seqDays1}일</span>
                      <span style={{ color: '#1e3a5f' }}>|</span>
                      <span style={{ color: '#475569' }}>목표</span>
                      <input
                        type="number" min={1}
                        value={targetDays[link.linkedProjectId] ?? stats.tgt}
                        onChange={e => setTargetDays(prev => ({
                          ...prev, [link.linkedProjectId]: Math.max(1, Number(e.target.value) || 1),
                        }))}
                        style={{
                          width: 40, background: '#0d1b2a', border: '1px solid #253347',
                          borderRadius: 4, color: '#e2e8f0', fontSize: 9,
                          padding: '1px 4px', textAlign: 'center', outline: 'none',
                        }}
                      />
                      <span style={{ color: '#475569' }}>일</span>
                    </div>
                    {/* 2행: 추산 인원 + 실제 달력 공기 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ color: '#fbbf24', fontWeight: 700 }}>👷 {stats.workers}명 균일 투입</span>
                      <span style={{ color: '#1e3a5f' }}>→</span>
                      <span style={{ color: '#475569' }}>실제 공기</span>
                      <span style={{
                        color: stats.actualDays <= stats.tgt ? '#4ade80' : '#f87171',
                        fontWeight: 700,
                      }}>
                        {stats.actualDays}일
                      </span>
                      {stats.actualDays > stats.tgt && (
                        <span style={{ color: '#f87171', fontSize: 8 }}>
                          (양생 등 고정 공정으로 목표 초과)
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* 생성 버튼 */}
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
                    const totalVol    = calcTotalVolume(byType[elementType]);
                    const meta        = ELEMENT_META[elementType] || { name: elementType, icon: '📦', color: '#94a3b8', daysPerM3: 0.3 };
                    const typeKey     = `${link.linkedProjectId}_${elementType}`;
                    const isTypeOpen  = !!expandedType[typeKey];
                    const subDefs     = SUB_TASKS[elementType];
                    const estDays     = subDefs
                      ? subDefs.reduce((s, sub) => s + calcSubDays(sub, totalVol, stats.workers), 0)
                      : Math.max(1, Math.ceil(totalVol * (meta.daysPerM3 || 0.3)));

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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#d1d5db' }}>
                                {meta.name}
                              </span>
                              <span style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                                background: '#111e2d', color: '#475569',
                              }}>
                                {elementType} × {count}
                              </span>
                              <span style={{ fontSize: 9, color: '#374151' }}>
                                ~{estDays}일
                              </span>
                              <span style={{ fontSize: 9, color: '#253347' }}>
                                ({totalVol.toFixed(1)}m³)
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                            <span style={{ fontSize: 9, color: '#253347' }}>{isTypeOpen ? '▲' : '▼'}</span>
                          </div>
                        </div>

                        {/* 세부 요소 목록 */}
                        {isTypeOpen && (
                          <div style={{ background: '#050d17', padding: '6px 14px 10px 42px' }}>
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
