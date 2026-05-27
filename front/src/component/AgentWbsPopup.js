/**
 * AgentWbsPopup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * 우측 하단에 고정 표시되는 Agent 말풍선.
 *
 * BIM 균열 감지 / Test 충돌 / Safe 안전구역·복장 위반 이벤트가 발생하면
 * AGENT_WBS_EVENT를 수신하여 자동으로 팝업을 표시한다.
 *
 * 사용자가 [승인]을 누르면 onApprove(eventItem) 콜백을 호출한다.
 * App.js에서 해당 콜백으로 WBS 탭 전환 + 자동 수정 트리거를 수행한다.
 *
 * 큐 방식: 여러 이벤트가 동시에 발생해도 하나씩 순서대로 표시한다.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AGENT_WBS_EVENT } from '../utils/alertStore';

// ── 이벤트 유형별 메타데이터 ────────────────────────────────────────────────
const EVENT_META = {
  COLLISION: {
    icon:    '⚠️',
    color:   '#ef4444',
    bg:      'rgba(127,29,29,0.95)',
    border:  '#ef4444',
    label:   '부재 충돌 감지',
    wbsMsg:  'CPM 일정에 영향이 없도록 충돌 보정 작업을 WBS에 추가하겠습니까?',
  },
  CRACK: {
    icon:    '🔍',
    color:   '#f59e0b',
    bg:      'rgba(69,26,3,0.95)',
    border:  '#f59e0b',
    label:   '균열 감지',
    wbsMsg:  '구조 균열이 감지되었습니다. 보수 공사 일정을 WBS에 추가하겠습니까?',
  },
  SAFE_ZONE: {
    icon:    '🚨',
    color:   '#ff4444',
    bg:      'rgba(58,0,0,0.96)',
    border:  '#ff4444',
    label:   '안전구역 침범',
    wbsMsg:  '안전구역 침범이 발생했습니다. 안전 점검 일정을 WBS에 추가하겠습니까?',
  },
  SAFETY: {
    icon:    '⛑️',
    color:   '#f59e0b',
    bg:      'rgba(69,26,3,0.95)',
    border:  '#f59e0b',
    label:   '안전복장 위반',
    wbsMsg:  '안전복장 미착용이 감지되었습니다. 안전교육 일정을 WBS에 추가하겠습니까?',
  },
};

const DEFAULT_META = {
  icon: '🤖', color: '#60a5fa', bg: 'rgba(13,27,42,0.96)', border: '#60a5fa',
  label: '이벤트 감지', wbsMsg: 'WBS 일정을 자동으로 수정하겠습니까?',
};

// ── AgentWbsPopup ─────────────────────────────────────────────────────────
export default function AgentWbsPopup({ onApprove }) {
  const [visible,  setVisible]  = useState(false);
  const [current,  setCurrent]  = useState(null);   // 현재 표시 중인 이벤트
  const [entering, setEntering] = useState(false);  // 슬라이드 인 애니메이션
  const [exiting,  setExiting]  = useState(false);  // 슬라이드 아웃 애니메이션

  const queueRef   = useRef([]);   // 대기 큐
  const busyRef    = useRef(false); // 팝업 표시 중 여부
  const autoHideId = useRef(null); // 자동 닫기 타이머

  // ── 큐에서 다음 항목 표시 ─────────────────────────────────────────
  const showNext = useCallback(() => {
    if (busyRef.current || queueRef.current.length === 0) return;
    busyRef.current = true;
    const item = queueRef.current.shift();
    setCurrent(item);
    setExiting(false);
    setEntering(true);
    setVisible(true);

    // 진입 애니메이션 후 entering 해제
    setTimeout(() => setEntering(false), 350);

    // 20초 자동 닫기 (거절 처리)
    clearTimeout(autoHideId.current);
    autoHideId.current = setTimeout(() => handleDismiss(), 20000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 이벤트 수신 ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      queueRef.current.push(e.detail);
      if (!busyRef.current) showNext();
    };
    window.addEventListener(AGENT_WBS_EVENT, handler);
    return () => window.removeEventListener(AGENT_WBS_EVENT, handler);
  }, [showNext]);

  // ── 닫기 (거절 / 자동 만료) ────────────────────────────────────────
  const handleDismiss = useCallback(() => {
    clearTimeout(autoHideId.current);
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setCurrent(null);
      setExiting(false);
      busyRef.current = false;
      // 큐에 다음 항목이 있으면 300ms 후 표시
      if (queueRef.current.length > 0) {
        setTimeout(showNext, 300);
      }
    }, 300);
  }, [showNext]);

  // ── 승인 ───────────────────────────────────────────────────────────
  const handleApprove = useCallback(() => {
    clearTimeout(autoHideId.current);
    if (onApprove && current) onApprove(current);
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setCurrent(null);
      setExiting(false);
      busyRef.current = false;
      if (queueRef.current.length > 0) setTimeout(showNext, 300);
    }, 300);
  }, [current, onApprove, showNext]);

  if (!visible || !current) return null;

  const meta = EVENT_META[current.eventType] ?? DEFAULT_META;

  // ── 슬라이드 애니메이션 ──────────────────────────────────────────
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
      width:        'clamp(280px, 28vw, 360px)',
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
            marginBottom: '12px',
            fontSize:   '12px',
            color:      '#cbd5e1',
            lineHeight: 1.6,
          }}>
            <span style={{ color: meta.color, fontWeight: 700 }}>Agent: </span>
            {meta.wbsMsg}
            <div style={{ marginTop: '6px', fontSize: '10px', color: '#64748b' }}>
              승인 시 WBS 탭으로 이동하여 CPM 일정을 자동으로 조정합니다.
            </div>
          </div>

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
              ✅ 승인 — WBS 수정
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
              거절
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
