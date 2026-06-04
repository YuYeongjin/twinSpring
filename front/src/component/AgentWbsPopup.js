/**
 * AgentWbsPopup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 우측 하단에 고정 표시되는 Agent 말풍선.
 *
 * BIM 균열 감지 / Test 충돌 / Safe 안전구역·복장 위반 이벤트가 발생하면
 * AGENT_WBS_EVENT를 수신하여 자동으로 팝업을 표시한다.
 *
 * [RAG 기능 추가]
 *  이벤트 수신 시 /api/chat/wbs-rag-suggest 를 호출하여
 *  관련 건설 시방서(KCS/KDS) 근거를 가져와 표시한다.
 *  사용자는 시방서 근거를 확인한 후 승인 여부를 결정할 수 있다.
 *
 * 사용자가 [승인]을 누르면 onApprove(eventItem) 콜백을 호출한다.
 * App.js에서 해당 콜백으로 WBS 탭 전환 + 자동 수정 트리거를 수행한다.
 *
 * 큐 방식: 여러 이벤트가 동시에 발생해도 하나씩 순서대로 표시한다.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import AxiosCustom from '../axios/AxiosCustom';
import { AGENT_WBS_EVENT, markApplied } from '../utils/alertStore';
import { useT } from '../i18n/LanguageContext';

const EVENT_META_STYLE = {
  COLLISION:         { icon: '⚠️', color: '#ef4444', bg: 'rgba(127,29,29,0.95)', border: '#ef4444', labelKey: 'eventCollision', msgKey: 'msgCollision' },
  CRACK:             { icon: '🔍', color: '#f59e0b', bg: 'rgba(69,26,3,0.95)',   border: '#f59e0b', labelKey: 'eventCrack',     msgKey: 'msgCrack' },
  SAFE_ZONE:         { icon: '🚨', color: '#ff4444', bg: 'rgba(58,0,0,0.96)',    border: '#ff4444', labelKey: 'eventSafeZone',  msgKey: 'msgSafeZone' },
  SAFETY:            { icon: '⛑️', color: '#f59e0b', bg: 'rgba(69,26,3,0.95)',   border: '#f59e0b', labelKey: 'eventSafety',    msgKey: 'msgSafety' },
  STRUCTURAL_DANGER: { icon: '🏗',  color: '#ef4444', bg: 'rgba(100,20,20,0.97)', border: '#ef4444', labelKey: 'eventStructural',msgKey: 'msgStructural' },
  SIM_DANGER:        { icon: '🦾', color: '#ef4444', bg: 'rgba(100,20,20,0.97)', border: '#ef4444', labelKey: 'eventSimDanger', msgKey: 'msgSimDanger' },
};
const DEFAULT_META_STYLE = { icon: '🤖', color: '#60a5fa', bg: 'rgba(13,27,42,0.96)', border: '#60a5fa', labelKey: 'eventDefault', msgKey: 'msgDefault' };

// ── RAG 증거 패널 ──────────────────────────────────────────────────────────
function RagEvidencePanel({ ragState, borderColor }) {
  const t = useT('agentWbs');
  const [expanded, setExpanded] = useState(false);

  if (ragState === 'loading') {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${borderColor}22`,
        borderRadius: '8px',
        padding: '8px 12px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ fontSize: '11px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
        <span style={{ fontSize: '11px', color: '#64748b' }}>{t('ragSearching')}</span>
      </div>
    );
  }

  if (ragState === 'no-data') {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: `1px solid rgba(255,255,255,0.06)`,
        borderRadius: '8px',
        padding: '6px 12px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span style={{ fontSize: '11px' }}>📋</span>
        <span style={{ fontSize: '10px', color: '#475569' }}>{t('ragNoData')}</span>
      </div>
    );
  }

  if (ragState === 'error') {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: `1px solid rgba(255,255,255,0.06)`,
        borderRadius: '8px',
        padding: '6px 12px',
        marginBottom: '10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span style={{ fontSize: '11px' }}>⚠️</span>
        <span style={{ fontSize: '10px', color: '#475569' }}>{t('ragError')}</span>
      </div>
    );
  }

  if (!ragState || !ragState.evidence || ragState.evidence.length === 0) {
    return null;
  }

  const evidenceList = ragState.evidence;

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${borderColor}33`,
      borderRadius: '8px',
      marginBottom: '10px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          gap: '6px',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px' }}>📋</span>
          <span style={{ fontSize: '11px', color: borderColor, fontWeight: 700 }}>
            {t('ragTitle', { n: evidenceList.length })}
          </span>
        </span>
        <span style={{ fontSize: '10px', color: '#475569' }}>
          {expanded ? t('ragCollapse') : t('ragExpand')}
        </span>
      </button>

      {/* 증거 목록 */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${borderColor}22`, maxHeight: '180px', overflowY: 'auto' }}>
          {evidenceList.map((ev, i) => (
            <div
              key={i}
              style={{
                padding: '8px 12px',
                borderBottom: i < evidenceList.length - 1 ? `1px solid rgba(255,255,255,0.05)` : 'none',
              }}
            >
              {/* 출처 배지 */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px',
                marginBottom: '4px',
                alignItems: 'center',
              }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: borderColor,
                  background: `${borderColor}18`,
                  border: `1px solid ${borderColor}44`,
                  borderRadius: '4px',
                  padding: '1px 6px',
                }}>
                  {ev.source}
                </span>
                {ev.series && (
                  <span style={{ fontSize: '10px', color: '#475569' }}>
                    {ev.series}
                  </span>
                )}
              </div>
              {/* 본문 */}
              <p style={{
                fontSize: '10px',
                color: '#94a3b8',
                lineHeight: 1.5,
                margin: 0,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {ev.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AgentWbsPopup ─────────────────────────────────────────────────────────
export default function AgentWbsPopup({ onApprove }) {
  const t = useT('agentWbs');
  const [visible,  setVisible]  = useState(false);
  const [current,  setCurrent]  = useState(null);   // 현재 표시 중인 이벤트
  const [entering, setEntering] = useState(false);  // 슬라이드 인 애니메이션
  const [exiting,  setExiting]  = useState(false);  // 슬라이드 아웃 애니메이션

  // RAG 상태: null | 'loading' | 'no-data' | 'error' | { evidence: [...] }
  const [ragState, setRagState] = useState(null);

  const queueRef   = useRef([]);   // 대기 큐
  const busyRef    = useRef(false); // 팝업 표시 중 여부
  const autoHideId = useRef(null); // 자동 닫기 타이머
  const ragAbortRef = useRef(null); // RAG 요청 취소용

  // ── RAG 검색 ──────────────────────────────────────────────────────────
  const fetchRagEvidence = useCallback((item) => {
    setRagState('loading');

    // 이전 요청 취소
    if (ragAbortRef.current) {
      ragAbortRef.current = true;
    }
    const abortFlag = { cancelled: false };
    ragAbortRef.current = abortFlag;

    AxiosCustom.post('/api/chat/wbs-rag-suggest', {
      eventType: item.eventType,
      title:     item.title  || '',
      detail:    item.detail || '',
    }, { timeout: 15000 })
      .then(res => {
        if (abortFlag.cancelled) return;
        const data = res.data;
        if (data && data.hasData && data.evidence && data.evidence.length > 0) {
          setRagState(data);
        } else {
          setRagState('no-data');
        }
      })
      .catch(() => {
        if (abortFlag.cancelled) return;
        setRagState('error');
      });

    return abortFlag;
  }, []);

  // ── 큐에서 다음 항목 표시 ─────────────────────────────────────────
  const showNext = useCallback(() => {
    if (busyRef.current || queueRef.current.length === 0) return;
    busyRef.current = true;
    const item = queueRef.current.shift();
    setCurrent(item);
    setExiting(false);
    setEntering(true);
    setVisible(true);
    setRagState(null);

    // 진입 애니메이션 후 entering 해제 + RAG 검색 시작
    setTimeout(() => {
      setEntering(false);
      fetchRagEvidence(item);
    }, 350);

    // 20초 자동 닫기 (거절 처리)
    clearTimeout(autoHideId.current);
    autoHideId.current = setTimeout(() => handleDismiss(), 20000);
  }, [fetchRagEvidence]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 이벤트 수신 ───────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      console.log('[AgentWBS] 이벤트 수신 — 팝업 큐 추가', e.detail);
      queueRef.current.push(e.detail);
      if (!busyRef.current) showNext();
    };
    window.addEventListener(AGENT_WBS_EVENT, handler);
    return () => window.removeEventListener(AGENT_WBS_EVENT, handler);
  }, [showNext]);

  // ── 닫기 (거절 / 자동 만료) ────────────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    clearTimeout(autoHideId.current);
    // 진행 중인 RAG 요청 취소
    if (ragAbortRef.current) ragAbortRef.current.cancelled = true;
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setCurrent(null);
      setRagState(null);
      setExiting(false);
      busyRef.current = false;
      // 큐에 다음 항목이 있으면 300ms 후 표시
      if (queueRef.current.length > 0) {
        setTimeout(showNext, 300);
      }
    }, 300);
  }, [showNext]);

  // ── 승인 ───────────────────────────────────────────────────────────────────
  const handleApprove = useCallback(() => {
    clearTimeout(autoHideId.current);
    if (ragAbortRef.current) ragAbortRef.current.cancelled = true;

    // 연결된 alertStore 항목을 applied 처리 → WBS 로그 패널 버튼 비활성화
    if (current?.alertId) markApplied(current.alertId);

    // ragEvidence 포함하여 콜백 호출
    const ragEvidence = (ragState && ragState.evidence) ? ragState.evidence : [];
    if (onApprove && current) onApprove({ ...current, ragEvidence });

    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setCurrent(null);
      setRagState(null);
      setExiting(false);
      busyRef.current = false;
      if (queueRef.current.length > 0) setTimeout(showNext, 300);
    }, 300);
  }, [current, onApprove, ragState, showNext]);

  if (!visible || !current) return null;

  const metaStyle = EVENT_META_STYLE[current.eventType] ?? DEFAULT_META_STYLE;
  const meta = {
    ...metaStyle,
    label: t(metaStyle.labelKey),
    wbsMsg: t(metaStyle.msgKey),
  };

  // ── 슬라이드 애니메이션 ──────────────────────────────────────────────────
  const transform = entering
    ? 'translateY(20px)'
    : exiting
      ? 'translateY(20px)'
      : 'translateY(0)';
  const opacity = entering || exiting ? 0 : 1;

  return (
    <div style={{
      position:     'fixed',
      right:        '20px',
      bottom:       '82px',     // ChatView 버튼 위
      zIndex:       9999,
      width:        'clamp(300px, 30vw, 400px)',
      transform,
      opacity,
      transition:   'transform 0.32s cubic-bezier(0.34,1.56,0.64,1), opacity 0.28s',
      pointerEvents: entering || exiting ? 'none' : 'auto',
    }}>
      {/* 카드 */}
      <div style={{
        background:   meta.bg,
        border:       `1.5px solid ${meta.border}`,
        borderRadius: '16px',
        boxShadow:    `0 8px 40px ${meta.border}30, 0 2px 12px #00000060`,
        overflow:     'hidden',
      }}>

        {/* 상단 헤더 바 */}
        <div style={{
          background:  `${meta.border}22`,
          borderBottom: `1px solid ${meta.border}33`,
          padding:     '10px 14px',
          display:     'flex', alignItems: 'center', gap: '8px',
        }}>
          {/* Agent 아바타 */}
          <div style={{
            width: '34px', height: '34px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #1e3a5f 0%, #0d1b2a 100%)',
            border: `1.5px solid ${meta.border}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '16px', flexShrink: 0,
          }}>
            🤖
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: meta.color, fontWeight: 700, fontSize: '12px' }}>
              {meta.icon} {meta.label}
            </div>
            <div style={{ color: '#8896a4', fontSize: '10px' }}>
              Agent · {new Date(current.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          {/* 닫기 버튼 */}
          <button
            onClick={handleDismiss}
            style={{
              background: 'none', border: 'none', color: '#4a5568',
              cursor: 'pointer', fontSize: '16px', padding: '2px 4px',
              lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>

        {/* 메시지 본문 */}
        <div style={{ padding: '14px 16px' }}>
          {/* 이벤트 상세 */}
          {current.title && (
            <div style={{
              fontSize: '12px', color: '#e2e8f0', fontWeight: 600,
              marginBottom: '6px', lineHeight: 1.4,
            }}>
              {current.title}
            </div>
          )}
          {current.detail && (
            <div style={{
              fontSize: '11px', color: '#94a3b8', marginBottom: '10px', lineHeight: 1.5,
            }}>
              {current.detail}
            </div>
          )}

          {/* WBS 수정 제안 말풍선 */}
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border:     `1px solid ${meta.border}30`,
            borderRadius: '10px',
            padding:    '10px 12px',
            marginBottom: '10px',
            fontSize:   '12px',
            color:      '#cbd5e1',
            lineHeight: 1.6,
          }}>
            <span style={{ color: meta.color, fontWeight: 700 }}>Agent: </span>
            {meta.wbsMsg}
            <div style={{ marginTop: '6px', fontSize: '10px', color: '#64748b' }}>
              {t('approveHint')}
            </div>
          </div>

          {/* ── RAG 증거 패널 (KCS/KDS 시방서 근거) ── */}
          <RagEvidencePanel ragState={ragState} borderColor={meta.border} />

          {/* 승인 / 거절 버튼 */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleApprove}
              style={{
                flex: 1,
                background: `linear-gradient(135deg, ${meta.border}cc, ${meta.border}88)`,
                border: `1px solid ${meta.border}`,
                borderRadius: '10px',
                padding: '9px 0',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '12px',
                cursor: 'pointer',
                letterSpacing: '0.03em',
                boxShadow: `0 2px 10px ${meta.border}40`,
              }}
            >
              {t('approveBtn')}
            </button>
            <button
              onClick={handleDismiss}
              style={{
                flex: 0.6,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid #2d3748',
                borderRadius: '10px',
                padding: '9px 0',
                color: '#94a3b8',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              {t('dismissBtn')}
            </button>
          </div>

          {/* 자동 닫힘 진행 바 */}
          <AutoDismissBar duration={20000} color={meta.border} />
        </div>
      </div>

      {/* 큐에 더 있으면 뱃지 표시 */}
      {queueRef.current.length > 0 && (
        <div style={{
          position: 'absolute', top: '-8px', right: '-8px',
          background: '#ef4444', color: '#fff',
          borderRadius: '50%', width: '20px', height: '20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 700, border: '2px solid #0d1b2a',
        }}>
          {queueRef.current.length}
        </div>
      )}
    </div>
  );
}

// ── 자동 닫힘 진행 바 ───────────────────────────────────────────────────────
function AutoDismissBar({ duration, color }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setPct(remaining);
      if (remaining === 0) clearInterval(id);
    }, 80);
    return () => clearInterval(id);
  }, [duration]);

  return (
    <div style={{
      marginTop: '10px', height: '2px', background: '#1e293b',
      borderRadius: '1px', overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', width: `${pct}%`,
        background: color, borderRadius: '1px',
        transition: 'width 0.08s linear',
      }} />
    </div>
  );
}
