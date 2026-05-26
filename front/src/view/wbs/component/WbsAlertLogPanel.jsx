/**
 * WbsAlertLogPanel.jsx
 * ──────────────────────────────────────────────────────────────────
 * WBS 대시보드 우측 "로그" 탭에서 렌더되는 알림 패널.
 * ─ BIM / Safe 탭에서 발생한 균열·안전 알림 목록을 표시한다.
 * ─ "WBS에 반영" 버튼 → Agent(/api/chat/stream)에 컨텍스트를 전달하고
 *   스트리밍 응답을 인라인으로 표시한다.
 * ──────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useT } from '../../../i18n/LanguageContext';
import {
  getAlerts, markAllRead, markApplied, deleteAlert,
  clearAll, ALERT_EVENT,
} from '../../../utils/alertStore';

const SPRING_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : '';

// ── 메타 데이터 ──────────────────────────────────────────────────
const SOURCE_META = {
  CRACK:  { icon: '🔍', color: '#fb923c', bg: '#3a1a00' },
  SAFETY: { icon: '⛑',  color: '#facc15', bg: '#2d2000' },
  BIM:    { icon: '🏗',  color: '#60a5fa', bg: '#1e3a5f' },
};

const SEV_META = {
  HIGH:   { color: '#f87171', bg: '#3f0000', border: '#dc2626' },
  MEDIUM: { color: '#fb923c', bg: '#3a1a00', border: '#ea580c' },
  LOW:    { color: '#a3e635', bg: '#1a2900', border: '#65a30d' },
};

function fmtTs(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString([], {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch {
    return ts;
  }
}

// ── 알림 카드 ────────────────────────────────────────────────────
function AlertCard({ alert, onApply, onDelete, t }) {
  const [agentReply, setAgentReply] = useState('');
  const [applying,   setApplying]   = useState(false);
  const [showReply,  setShowReply]  = useState(false);
  const readerRef = useRef(null);

  const src = SOURCE_META[alert.source] || SOURCE_META.SAFETY;
  const sev = SEV_META[alert.severity]  || SEV_META.MEDIUM;

  // 컴포넌트 언마운트 시 스트리밍 중단
  useEffect(() => () => { readerRef.current?.cancel?.(); }, []);

  const handleApply = async () => {
    setApplying(true);
    setShowReply(true);
    setAgentReply('');

    const prompt =
      `[WBS CPM 일정 조정 요청]\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `• 알림 유형: ${alert.source}\n` +
      `• 심각도: ${alert.severity}\n` +
      `• 제목: ${alert.title}\n` +
      `• 프로젝트: ${alert.projectName || alert.projectId || '(없음)'}\n` +
      `• 상세: ${alert.detail || '-'}\n` +
      `• 발생 시각: ${fmtTs(alert.ts)}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `위 이슈가 현재 WBS 공정에 영향을 줄 수 있습니다.\n` +
      `CPM 네트워크를 분석하여 여유 시간(Float)이 있는 경로를 활용하고, ` +
      `크리티컬 패스에 문제가 없도록 일정 조정 방안을 구체적으로 제안해주세요.`;

    try {
      const resp = await fetch(`${SPRING_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'wbs-alert-' + Date.now(),
          message: prompt,
          history: [],
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      readerRef.current = reader;
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') break;
          try {
            const ev = JSON.parse(raw);
            if (ev.token)   setAgentReply(prev => prev + ev.token);
            else if (ev.content) setAgentReply(ev.content);
          } catch { /* SSE 파싱 오류 무시 */ }
        }
      }

      onApply(alert.id);
    } catch (e) {
      setAgentReply(`${t('agentError')}: ${e.message}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="rounded-xl border p-3 flex flex-col gap-2 text-xs transition-all"
      style={{
        backgroundColor: alert.applied ? '#0a1521' : '#0f1e2d',
        borderColor:     alert.applied ? '#1a2a3a' : sev.border + '80',
        opacity:         alert.applied ? 0.6 : 1,
      }}
    >
      {/* 헤더 */}
      <div className="flex items-start gap-2">
        <span className="text-base shrink-0 leading-none mt-0.5">{src.icon}</span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-snug truncate">
            {alert.title}
          </p>
          <p className="text-xs mt-0.5 truncate" style={{ color: '#8896a4' }}>
            {alert.projectName || alert.projectId || '—'} · {fmtTs(alert.ts)}
          </p>
        </div>

        {/* 뱃지 */}
        <div className="flex gap-1 shrink-0 flex-col items-end">
          <span className="px-1.5 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: src.bg, color: src.color }}>
            {alert.source}
          </span>
          <span className="px-1.5 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: sev.bg, color: sev.color }}>
            {alert.severity}
          </span>
        </div>
      </div>

      {/* 상세 */}
      {alert.detail && (
        <p className="text-xs pl-6 leading-relaxed" style={{ color: '#64748b' }}>
          {alert.detail}
        </p>
      )}

      {/* Agent 응답 */}
      {showReply && (
        <div
          className="mt-1 ml-6 pl-3 border-l-2 text-xs leading-relaxed"
          style={{ borderColor: '#3b82f6', color: '#93c5fd', maxHeight: 200, overflowY: 'auto' }}
        >
          {agentReply
            ? <span style={{ whiteSpace: 'pre-wrap' }}>{agentReply}</span>
            : <span className="animate-pulse text-blue-400">{t('agentThinking')}</span>
          }
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="flex gap-1.5 pl-6 mt-0.5 flex-wrap">
        {alert.applied ? (
          <span
            className="px-2 py-1 rounded-lg text-xs"
            style={{ backgroundColor: '#14532d', color: '#4ade80', border: '1px solid #16a34a' }}
          >
            ✅ {t('appliedDone')}
          </span>
        ) : (
          <button
            onClick={handleApply}
            disabled={applying}
            className="px-3 py-1 rounded-lg font-semibold text-white text-xs transition"
            style={{
              background: applying
                ? '#1c2a3a'
                : 'linear-gradient(135deg,#1d4ed8,#7c3aed)',
              border: '1px solid #3b82f6',
              opacity: applying ? 0.7 : 1,
              cursor: applying ? 'not-allowed' : 'pointer',
            }}
          >
            {applying ? (
              <span className="flex items-center gap-1">
                <span className="animate-spin text-xs">⟳</span>
                {t('agentApplying')}
              </span>
            ) : t('applyToWbs')}
          </button>
        )}

        {/* 닫기 */}
        <button
          onClick={() => onDelete(alert.id)}
          className="px-2 py-1 rounded-lg text-xs transition"
          style={{
            backgroundColor: '#1c2a3a',
            border: '1px solid #253347',
            color: '#64748b',
          }}
        >
          {t('dismiss')}
        </button>

        {/* 아직 reply 없으면 "분석 보기" 토글 */}
        {!showReply && alert.applied && agentReply === '' && (
          <button
            onClick={() => setShowReply(v => !v)}
            className="px-2 py-1 rounded-lg text-xs transition"
            style={{
              backgroundColor: '#1e3a5f',
              border: '1px solid #1d4ed8',
              color: '#60a5fa',
            }}
          >
            {t('showAnalysis')}
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  메인 패널
// ══════════════════════════════════════════════════════════════════
export default function WbsAlertLogPanel() {
  const t = useT('wbsLog');
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState('ALL'); // ALL | CRACK | SAFETY | BIM | HIGH

  const refresh = useCallback(() => {
    setAlerts(getAlerts());
  }, []);

  // 마운트 시 로드 + 모두 읽음 처리 + 실시간 구독
  useEffect(() => {
    refresh();
    markAllRead();
    window.addEventListener(ALERT_EVENT, refresh);
    return () => window.removeEventListener(ALERT_EVENT, refresh);
  }, [refresh]);

  const handleApply = useCallback((id) => {
    markApplied(id);
    setAlerts(getAlerts());
  }, []);

  const handleDelete = useCallback((id) => {
    deleteAlert(id);
    setAlerts(getAlerts());
  }, []);

  const handleClearAll = useCallback(() => {
    if (!window.confirm(t('clearConfirm'))) return;
    clearAll();
    setAlerts([]);
  }, [t]);

  // 필터링
  const displayed = alerts.filter(a => {
    if (filter === 'ALL')  return true;
    if (filter === 'HIGH') return a.severity === 'HIGH';
    return a.source === filter;
  });

  const unread = alerts.filter(a => !a.read).length;
  const high   = alerts.filter(a => a.severity === 'HIGH' && !a.applied).length;

  return (
    <div className="flex flex-col h-full gap-0" style={{ minHeight: 0 }}>

      {/* ── 헤더 ── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap shrink-0">
        <span className="text-sm font-bold text-white">🔔 {t('title')}</span>

        {/* 미읽음 뱃지 */}
        {unread > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-xs font-bold animate-pulse"
                style={{ backgroundColor: '#dc2626', color: '#fff', minWidth: 20, textAlign: 'center' }}>
            {unread}
          </span>
        )}

        {/* 긴급 뱃지 */}
        {high > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: '#7f1d1d', color: '#f87171', border: '1px solid #dc2626' }}>
            ⚠️ {t('highCount', { n: high })}
          </span>
        )}

        <span className="text-xs" style={{ color: '#475569' }}>
          {t('totalAlerts', { n: alerts.length })}
        </span>

        <div className="flex-1" />

        {alerts.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-2 py-1 rounded text-xs transition"
            style={{ color: '#64748b', border: '1px solid #253347', backgroundColor: '#1c2a3a' }}
          >
            {t('clearAll')}
          </button>
        )}
      </div>

      {/* ── 필터 칩 ── */}
      {alerts.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-3 shrink-0">
          {[
            { key: 'ALL',    label: t('filterAll',    { n: alerts.length }) },
            { key: 'HIGH',   label: t('filterHigh',   { n: alerts.filter(a => a.severity === 'HIGH').length }) },
            { key: 'CRACK',  label: t('filterCrack',  { n: alerts.filter(a => a.source === 'CRACK').length  }) },
            { key: 'SAFETY', label: t('filterSafety', { n: alerts.filter(a => a.source === 'SAFETY').length }) },
            { key: 'BIM',    label: t('filterBim',    { n: alerts.filter(a => a.source === 'BIM').length    }) },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-2 py-0.5 rounded-full text-xs transition"
              style={{
                backgroundColor: filter === f.key ? '#1e3a5f' : 'transparent',
                color: filter === f.key ? '#60a5fa' : '#475569',
                border: `1px solid ${filter === f.key ? '#3b82f6' : '#253347'}`,
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* ── 알림 목록 ── */}
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center py-16">
          <span className="text-5xl mb-4" style={{ opacity: 0.15 }}>🔕</span>
          <p className="text-sm font-medium" style={{ color: '#334155' }}>{t('noAlerts')}</p>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: '#253347' }}>
            {t('noAlertsHint')}
          </p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-center py-10">
          <p className="text-sm" style={{ color: '#334155' }}>{t('noFilterResults')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
          {displayed.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onApply={handleApply}
              onDelete={handleDelete}
              t={t}
            />
          ))}
        </div>
      )}

      {/* ── 사용법 힌트 ── */}
      {alerts.length === 0 && (
        <div className="shrink-0 mt-4 px-3 py-2.5 rounded-xl text-xs leading-relaxed"
             style={{ backgroundColor: '#0a1521', border: '1px dashed #1a2a3a', color: '#334155' }}>
          <p className="font-semibold mb-1" style={{ color: '#475569' }}>💡 {t('hintTitle')}</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>{t('hint1')}</li>
            <li>{t('hint2')}</li>
            <li>{t('hint3')}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
