/**
 * WbsProjectSelectModal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Agent WBS 수정 승인 후 연결된 WBS 현장이 없을 때 표시되는 프로젝트 선택 모달.
 *
 * 사용자는 WBS 일정을 업데이트할 현장 프로젝트를 선택하고 확인한다.
 */

import React, { useEffect, useState } from 'react';
import AxiosCustom from '../axios/AxiosCustom';

const EVENT_META = {
  COLLISION: { icon: '⚠️', color: '#ef4444', label: '부재 충돌 감지' },
  CRACK:     { icon: '🔍', color: '#f59e0b', label: '균열 감지' },
  SAFE_ZONE: { icon: '🚨', color: '#ff4444', label: '안전구역 침범' },
  SAFETY:    { icon: '⛑️', color: '#f59e0b', label: '안전복장 위반' },
};

const STATUS_META = {
  PLANNED:     { icon: '📋', color: '#94a3b8', bg: '#1e293b', label: '계획' },
  IN_PROGRESS: { icon: '🔨', color: '#60a5fa', bg: '#1e3a5f', label: '진행 중' },
  COMPLETED:   { icon: '✅', color: '#4ade80', bg: '#14532d', label: '완료' },
  ON_HOLD:     { icon: '⏸', color: '#f59e0b', bg: '#451a03', label: '보류' },
};

export default function WbsProjectSelectModal({ eventItem, onSelect, onClose }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    AxiosCustom.get('/api/wbs/projects')
      .then(r => {
        const list = r.data || [];
        setProjects(list);
        // 기본 선택: IN_PROGRESS 우선, 없으면 첫 번째
        const def = list.find(p => p.status === 'IN_PROGRESS') || list[0] || null;
        setSelected(def);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const meta = EVENT_META[eventItem?.eventType] ?? { icon: '🤖', color: '#60a5fa', label: '이벤트 감지' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: 'min(440px, 94vw)',
        background: '#0f1e2d',
        border: '1px solid #253347',
        borderRadius: '20px',
        boxShadow: '0 8px 48px rgba(0,0,0,0.65)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* 헤더 */}
        <div style={{
          background: '#0a1521', padding: '16px 20px',
          borderBottom: '1px solid #1a2a3a',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #1e3a5f, #0d1b2a)',
            border: `1.5px solid ${meta.color}66`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px',
          }}>
            {meta.icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: meta.color }}>{meta.label}</div>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>
              WBS에 반영할 현장 프로젝트를 선택하세요
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#4a5568', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '0 2px' }}
          >×</button>
        </div>

        {/* 이벤트 요약 */}
        {(eventItem?.title || eventItem?.detail) && (
          <div style={{
            padding: '10px 20px',
            background: `${meta.color}08`,
            borderBottom: '1px solid #1a2a3a',
          }}>
            {eventItem.title && (
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0', marginBottom: '3px' }}>
                {eventItem.title}
              </div>
            )}
            {eventItem.detail && (
              <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
                {eventItem.detail}
              </div>
            )}
          </div>
        )}

        {/* 안내 문구 */}
        <div style={{ padding: '10px 20px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: '#475569' }}>🔗</span>
          <span style={{ fontSize: '11px', color: '#475569' }}>
            연결된 WBS 현장이 없습니다 — 업데이트할 현장을 선택해 주세요
          </span>
        </div>

        {/* 프로젝트 목록 */}
        <div style={{ padding: '8px 20px 6px', maxHeight: '46vh', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '28px', color: '#475569', fontSize: '13px' }}>
              ⏳ 현장 로드 중…
            </div>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px', color: '#475569', fontSize: '13px' }}>
              등록된 WBS 현장이 없습니다
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {projects.map(p => {
                const sm = STATUS_META[p.status] || STATUS_META.PLANNED;
                const isSel = selected?.projectId === p.projectId;
                return (
                  <button
                    key={p.projectId}
                    onClick={() => setSelected(p)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
                      background: isSel ? '#1e3a5f' : '#1c2a3a',
                      border: `1.5px solid ${isSel ? '#3b82f6' : '#253347'}`,
                      textAlign: 'left', transition: 'background 0.15s, border-color 0.15s',
                    }}
                  >
                    {/* 라디오 */}
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', marginTop: '2px', flexShrink: 0,
                      border: `2px solid ${isSel ? '#3b82f6' : '#334155'}`,
                      background: isSel ? '#3b82f6' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSel && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
                    </div>

                    {/* 정보 */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '13px', fontWeight: 600,
                        color: isSel ? '#93c5fd' : '#e2e8f0',
                        marginBottom: '4px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {sm.icon} {p.projectName}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{
                          fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                          background: sm.bg, color: sm.color,
                        }}>
                          {sm.label}
                        </span>
                        {p.location && (
                          <span style={{ fontSize: '10px', color: '#475569' }}>📍 {p.location}</span>
                        )}
                        <span style={{ fontSize: '10px', color: '#334155' }}>
                          작업 {p.taskCount ?? 0}개
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 액션 버튼 */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid #1a2a3a',
          display: 'flex', gap: '10px',
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: '10px', fontSize: '13px',
              background: '#1c2a3a', border: '1px solid #253347', color: '#8896a4', cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            disabled={!selected || loading}
            onClick={() => selected && onSelect(selected)}
            style={{
              flex: 2, padding: '10px 0', borderRadius: '10px', fontSize: '13px', fontWeight: 700,
              background: selected ? 'linear-gradient(135deg, #1d4ed8, #1e40af)' : '#1c2a3a',
              border: `1px solid ${selected ? '#3b82f6' : '#253347'}`,
              color: selected ? '#fff' : '#475569',
              cursor: selected ? 'pointer' : 'not-allowed',
              boxShadow: selected ? '0 2px 12px rgba(59,130,246,0.25)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            {selected
              ? `✅ ${selected.projectName}에 반영`
              : '현장을 선택하세요'}
          </button>
        </div>
      </div>
    </div>
  );
}
