import { useEffect, useState, useCallback } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';
import { useT } from '../../i18n/LanguageContext';

function ConfidenceBar({ value }) {
  const pct  = Math.round((value || 0) * 100);
  const color = pct >= 75 ? '#4ade80' : pct >= 50 ? '#facc15' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: '#1a2a3a', borderRadius: 2 }}>
        <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: 2,
          transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: 10, color, minWidth: 30 }}>{pct}%</span>
    </div>
  );
}

function ProgressDelta({ before, after }) {
  const tp = useT('progress');
  const delta = after - before;
  const color = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#6b7280';
  return (
    <span style={{ fontSize: 11, color }}>
      {before}% → {after}% {delta > 0 ? `(+${delta})` : delta < 0 ? `(${delta})` : tp('noChange')}
    </span>
  );
}

export default function ProgressMonitoringPanel({ selectedProject }) {
  const tp = useT('progress');
  const [analyses, setAnalyses]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);
  const [wbsLinks, setWbsLinks]       = useState([]);
  const [triggerLoading, setTrigger]  = useState(false);

  const projectId = selectedProject?.projectId;

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);

    // WBS 연결 조회
    AxiosCustom.get(`/api/project-link/linked?type=SAFE&id=${projectId}`)
      .then(r => setWbsLinks(r.data || []))
      .catch(() => setWbsLinks([]));

    // 분석 로그 조회 (연결된 WBS 프로젝트에서)
    AxiosCustom.get(`/api/progress-analysis?safeProjectId=${projectId}`)
      .then(r => setAnalyses(r.data || []))
      .catch(() => setAnalyses([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const handleManualTrigger = useCallback(async () => {
    if (!projectId) return;
    setTrigger(true);
    try {
      await AxiosCustom.post(`/api/progress-analysis/trigger`, { safeProjectId: projectId });
      setTimeout(() => { load(); setTrigger(false); }, 3000);
    } catch {
      setTrigger(false);
    }
  }, [projectId, load]);

  const wbsProjectId = wbsLinks[0]?.wbsProjectId;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── 헤더 ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 700, margin: 0 }}>
            {tp('title')}
          </h3>
          <p style={{ color: '#6b7280', fontSize: 11, marginTop: 3 }}>
            {tp('subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load}
            style={{
              fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'transparent', border: '1px solid #253347', color: '#6b7280',
            }}>
            {tp('refresh')}
          </button>
          <button onClick={handleManualTrigger} disabled={triggerLoading}
            style={{
              fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: triggerLoading ? 'wait' : 'pointer',
              background: triggerLoading ? '#1a2a3a' : '#1e3a5f',
              border: '1px solid ' + (triggerLoading ? '#253347' : '#2a5080'),
              color: triggerLoading ? '#6b7280' : '#60a5fa',
            }}>
            {triggerLoading ? tp('analyzing') : tp('analyzeNow')}
          </button>
        </div>
      </div>

      {/* ── WBS 연결 상태 ── */}
      {wbsLinks.length > 0 ? (
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: '#0d2211', border: '1px solid #166534',
          fontSize: 12, color: '#4ade80',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>✓</span>
          <span>{tp('wbsLinked', { name: wbsLinks[0]?.wbsProjectName || wbsProjectId })}</span>
          <span style={{ color: '#6b7280', fontSize: 10 }}>{tp('wbsLinkedDesc')}</span>
        </div>
      ) : (
        <div style={{
          padding: '8px 12px', borderRadius: 8,
          background: '#1a1000', border: '1px solid #d97706',
          fontSize: 12, color: '#d97706',
        }}>
          {tp('wbsNotLinked')}
        </div>
      )}

      {/* ── 분석 로그 ── */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#4b5563', padding: '24px 0', fontSize: 13 }}>
          {tp('loading')}
        </div>
      ) : analyses.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '32px 0',
          border: '1px dashed #253347', borderRadius: 10, color: '#4b5563', fontSize: 13,
        }}>
          <p>{tp('noAnalyses')}</p>
          <p style={{ fontSize: 11, marginTop: 6 }}>
            {tp('noAnalysesHint', { mode: <strong style={{ color: '#60a5fa' }}>{tp('progressMode')}</strong> })}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {analyses.map((a) => (
            <div key={a.analysisId}
              style={{
                background: '#0a1525', border: '1px solid #1e3a5f',
                borderRadius: 10, padding: '12px 14px',
                cursor: 'pointer',
              }}
              onClick={() => setExpanded(expanded === a.analysisId ? null : a.analysisId)}>

              {/* 요약 행 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 20 }}>
                  {(a.afterProgress ?? 0) >= 100 ? '✅'
                    : (a.afterProgress ?? 0) > (a.beforeProgress ?? 0) ? '📈' : '📊'}
                </span>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>
                    {a.wbsTaskId || '태스크'}
                  </div>
                  <ProgressDelta before={a.beforeProgress ?? 0} after={a.afterProgress ?? 0} />
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', whiteSpace: 'nowrap' }}>
                  {a.analyzedAt ? new Date(a.analyzedAt).toLocaleString('ko-KR', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  }) : ''}
                </div>
                <span style={{
                  fontSize: 10, color: expanded === a.analysisId ? '#60a5fa' : '#4b5563',
                  marginLeft: 4,
                }}>
                  {expanded === a.analysisId ? '▲' : '▼'}
                </span>
              </div>

              {/* 신뢰도 바 */}
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 10, color: '#4b5563', marginBottom: 4 }}>{tp('aiConfidence')}</p>
                <ConfidenceBar value={a.confidence} />
              </div>

              {/* 상세 펼침 */}
              {expanded === a.analysisId && (
                <div style={{ marginTop: 12, borderTop: '1px solid #1a2a3a', paddingTop: 12 }}>
                  {/* 분석 메모 */}
                  {a.analysisNotes && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 11, color: '#60a5fa', fontWeight: 600, marginBottom: 4 }}>
                        {tp('aiAnalysis')}
                      </p>
                      <p style={{ fontSize: 11, color: '#93c5fd', lineHeight: 1.6 }}>
                        {a.analysisNotes}
                      </p>
                    </div>
                  )}

                  {/* RAG 시방서 증빙 */}
                  {a.ragEvidence && (() => {
                    try {
                      const docs = JSON.parse(a.ragEvidence);
                      if (!docs || docs.length === 0) return null;
                      return (
                        <div>
                          <p style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>
                            {tp('specEvidence', { n: docs.length })}
                          </p>
                          {docs.map((doc, i) => (
                            <div key={i} style={{
                              background: '#0d1b2a', border: '1px solid #253347',
                              borderRadius: 6, padding: '8px 10px', marginBottom: 6,
                            }}>
                              <p style={{ fontSize: 10, color: '#f59e0b', marginBottom: 4 }}>
                                📌 {doc.source}
                              </p>
                              <p style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5 }}>
                                {doc.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  {/* 스냅샷 링크 */}
                  {a.snapshotId && (
                    <div style={{ marginTop: 8 }}>
                      <a href={`/api/monitoring/snapshot/${a.snapshotId}/image`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'underline' }}
                        onClick={e => e.stopPropagation()}>
                        {tp('viewSnapshot')}
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
