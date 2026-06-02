import React, { useState, useEffect, useCallback } from 'react';
import { useT } from '../../i18n/useT';

// CRACK 모드 전용 촬영 주기 (버튼 선택)
const CRACK_INTERVALS = [
  { sec: 1800,  label: '30분' },
  { sec: 3600,  label: '1시간' },
  { sec: 10800, label: '3시간' },
];

// SAFETY 모드 슬라이더 범위
const SAFETY_MIN_SEC = 5;
const SAFETY_MAX_SEC = 30;

const RETENTION_OPTIONS = [
  { sec: 3600,   label: '1시간' },
  { sec: 86400,  label: '1일' },
  { sec: 604800, label: '1주일' },
];

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

// ── 공통 버튼 스타일 ────────────────────────────────────────────────
function chipStyle(active) {
  return {
    background: active ? '#1e3a5f' : '#0d1b2a',
    border: `1px solid ${active ? '#3b82f6' : '#253347'}`,
    color: active ? '#93c5fd' : '#8896a4',
  };
}

export default function MonitoringGallery({ selectedProject }) {
  const t = useT('safe');
  const projectId   = selectedProject?.projectId;
  const isCrackMode = (selectedProject?.mode || 'SAFETY') === 'CRACK';

  // ── 카메라 상태 ────────────────────────────────────────────────────
  const [cameras, setCameras]       = useState([]);
  const [editingCam, setEditingCam] = useState(null); // null | 'new' | cameraId
  const [camForm, setCamForm]       = useState({ cameraName: '', cameraUrl: '', enabled: true });
  const [camSaving, setCamSaving]   = useState(false);

  // ── 스케줄 상태 ────────────────────────────────────────────────────
  const [schedule, setSchedule]         = useState(null);
  const [enabled, setEnabled]           = useState(false);
  // SAFETY 기본 10초, CRACK 기본 1800초(30분)
  const [captureInterval, setCaptureInterval] = useState(isCrackMode ? 1800 : 10);
  const [retentionSec, setRetentionSec] = useState(3600);
  const [schSaving, setSchSaving]       = useState(false);
  const [schSaved, setSchSaved]         = useState(false);

  // ── 갤러리 상태 ────────────────────────────────────────────────────
  const [snapshots, setSnapshots]       = useState([]);
  const [loading, setLoading]           = useState(false);
  const [filterCam, setFilterCam]       = useState('all');
  const [selectedSnap, setSelectedSnap] = useState(null);

  // ── 로드 ──────────────────────────────────────────────────────────

  const loadCameras = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/monitoring/cameras/${projectId}`);
    if (res.ok) setCameras(await res.json());
  }, [projectId]);

  const loadSchedule = useCallback(async () => {
    if (!projectId) return;
    const res = await fetch(`/api/monitoring/schedule/${projectId}`);
    if (res.ok) {
      const d = await res.json();
      setSchedule(d);
      setEnabled(d.enabled);
      // 저장된 주기가 있으면 사용, 없으면 모드별 기본값
      setCaptureInterval(d.captureIntervalSec || (isCrackMode ? 1800 : 10));
      setRetentionSec(d.retentionSec || 3600);
    }
  }, [projectId, isCrackMode]);

  const loadSnapshots = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/monitoring/snapshots/${projectId}`);
      if (res.ok) setSnapshots(await res.json());
    } finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => {
    loadCameras();
    loadSchedule();
    loadSnapshots();
  }, [loadCameras, loadSchedule, loadSnapshots]);

  // ── 카메라 저장 ────────────────────────────────────────────────────

  const saveCamera = async () => {
    if (!camForm.cameraUrl.trim()) return;
    setCamSaving(true);
    try {
      if (editingCam === 'new') {
        await fetch(`/api/monitoring/cameras/${projectId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...camForm, sortOrder: cameras.length }),
        });
      } else {
        await fetch(`/api/monitoring/camera/${editingCam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(camForm),
        });
      }
      setEditingCam(null);
      loadCameras();
    } finally { setCamSaving(false); }
  };

  const deleteCamera = async (cameraId) => {
    await fetch(`/api/monitoring/camera/${cameraId}`, { method: 'DELETE' });
    loadCameras();
  };

  const startEdit = (cam) => {
    setEditingCam(cam.cameraId);
    setCamForm({ cameraName: cam.cameraName, cameraUrl: cam.cameraUrl, enabled: cam.enabled });
  };

  const startNew = () => {
    setEditingCam('new');
    setCamForm({ cameraName: '', cameraUrl: '', enabled: true });
  };

  // ── 스케줄 저장 ────────────────────────────────────────────────────

  const saveSchedule = async () => {
    setSchSaving(true);
    try {
      await fetch(`/api/monitoring/schedule/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: schedule?.scheduleId || '',
          enabled, captureIntervalSec: captureInterval, retentionSec,
        }),
      });
      setSchSaved(true);
      setTimeout(() => setSchSaved(false), 2000);
      loadSchedule();
    } finally { setSchSaving(false); }
  };

  // ── 스냅샷 삭제 ────────────────────────────────────────────────────

  const deleteSnapshot = async (snapshotId) => {
    await fetch(`/api/monitoring/snapshot/${snapshotId}`, { method: 'DELETE' });
    setSnapshots(p => p.filter(s => s.snapshotId !== snapshotId));
    if (selectedSnap?.snapshotId === snapshotId) setSelectedSnap(null);
  };

  if (!selectedProject) return null;

  // 갤러리 필터링
  const visibleSnaps = filterCam === 'all'
    ? snapshots
    : snapshots.filter(s => s.cameraId === filterCam || s.cameraName === filterCam);

  return (
    <div className="flex flex-col gap-4">

      {/* ── 카메라 관리 패널 ── */}
      <div className="rounded-xl border p-4 flex flex-col gap-3"
        style={{ borderColor: '#253347', background: '#0a1525' }}>

        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-300">📷 카메라 목록</p>
          <span className="text-xs text-gray-500">({cameras.length}대)</span>
          <button onClick={startNew}
            className="ml-auto text-xs px-3 py-1 rounded-lg"
            style={{ background: '#0d2a1a', border: '1px solid #22c55e', color: '#22c55e' }}>
            + 카메라 추가
          </button>
        </div>

        <p className="text-xs text-gray-500">
          {isCrackMode
            ? '균열 모드: 설정한 주기마다 모든 카메라를 캡처하여 저장합니다.'
            : '안전 모드: 위험 감지 시에만 사진을 저장합니다 (프로젝트당 최대 10장).'}
        </p>

        {/* 카메라 목록 */}
        {cameras.length === 0 && editingCam !== 'new' && (
          <p className="text-xs text-gray-600 text-center py-2">
            등록된 카메라가 없습니다. safe_project의 cameraUrl을 폴백으로 사용합니다.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {cameras.map(cam => (
            editingCam === cam.cameraId
              ? <CameraForm key={cam.cameraId} form={camForm} setForm={setCamForm}
                  saving={camSaving} onSave={saveCamera} onCancel={() => setEditingCam(null)} />
              : <CameraRow key={cam.cameraId} cam={cam}
                  onEdit={() => startEdit(cam)} onDelete={() => deleteCamera(cam.cameraId)} />
          ))}
          {editingCam === 'new' && (
            <CameraForm form={camForm} setForm={setCamForm}
              saving={camSaving} onSave={saveCamera} onCancel={() => setEditingCam(null)} />
          )}
        </div>
      </div>

      {/* ── 스케줄 설정 패널 ── */}
      <div className="rounded-xl border p-4 flex flex-col gap-3"
        style={{ borderColor: '#253347', background: '#0a1525' }}>
        <p className="text-sm font-semibold text-gray-300">⚙ 스케줄 설정</p>

        {/* 상시 촬영 토글 */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400 w-24 shrink-0">상시 촬영</span>
          <button onClick={() => setEnabled(v => !v)}
            className="w-10 h-5 rounded-full relative transition-colors"
            style={{ background: enabled ? '#22c55e' : '#374151' }}>
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
              style={{ left: enabled ? '22px' : '2px' }} />
          </button>
          <span className="text-xs" style={{ color: enabled ? '#22c55e' : '#6b7280' }}>
            {enabled ? 'ON' : 'OFF'}
          </span>
        </div>

        {/* 촬영 주기 — SAFETY: 슬라이더(5~30초) / CRACK: 버튼 */}
        {isCrackMode ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-400 w-24 shrink-0">촬영 주기</span>
            <div className="flex gap-2 flex-wrap">
              {CRACK_INTERVALS.map(({ sec, label }) => (
                <button key={sec} onClick={() => setCaptureInterval(sec)}
                  className="text-xs px-3 py-1 rounded-lg"
                  style={chipStyle(captureInterval === sec)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-24 shrink-0">촬영 주기</span>
              <span className="text-sm font-bold tabular-nums"
                style={{ color: '#60a5fa', minWidth: '44px' }}>
                {captureInterval}초
              </span>
              <span className="text-xs text-gray-500">
                ({captureInterval < 60
                  ? `${captureInterval}초마다`
                  : `${Math.round(captureInterval / 60)}분마다`} 감지)
              </span>
            </div>
            <div className="flex items-center gap-3 pl-0">
              <span className="text-xs text-gray-600 w-24 shrink-0" />
              <span className="text-xs text-gray-600">{SAFETY_MIN_SEC}초</span>
              <input
                type="range"
                min={SAFETY_MIN_SEC}
                max={SAFETY_MAX_SEC}
                step={1}
                value={captureInterval}
                onChange={e => setCaptureInterval(Number(e.target.value))}
                className="flex-1"
                style={{ accentColor: '#3b82f6', cursor: 'pointer' }}
              />
              <span className="text-xs text-gray-600">{SAFETY_MAX_SEC}초</span>
            </div>
            {/* 5초 간격 눈금 */}
            <div className="flex pl-[6.5rem] pr-12">
              {[5, 10, 15, 20, 25, 30].map(v => (
                <button key={v}
                  onClick={() => setCaptureInterval(v)}
                  className="flex-1 text-center text-xs"
                  style={{ color: captureInterval === v ? '#60a5fa' : '#374151' }}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 보관 기간 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-gray-400 w-24 shrink-0">보관 기간</span>
          <div className="flex gap-2 flex-wrap">
            {RETENTION_OPTIONS.map(({ sec, label }) => (
              <button key={sec} onClick={() => setRetentionSec(sec)}
                className="text-xs px-3 py-1 rounded-lg"
                style={chipStyle(retentionSec === sec)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 저장 */}
        <div className="flex items-center gap-3 mt-1">
          <button onClick={saveSchedule} disabled={schSaving}
            className="text-xs px-4 py-1.5 rounded-lg"
            style={{ background: '#1e3a5f', border: '1px solid #3b82f6', color: '#93c5fd' }}>
            {schSaving ? '저장 중…' : '저장'}
          </button>
          {schSaved && <span className="text-xs text-green-400">저장됨 ✓</span>}
          {schedule?.lastCapturedAt && (
            <span className="text-xs text-gray-500 ml-auto">
              마지막 촬영: {fmtDate(schedule.lastCapturedAt)}
            </span>
          )}
        </div>
      </div>

      {/* ── 갤러리 ── */}
      <div className="rounded-xl border p-4 flex flex-col gap-3"
        style={{ borderColor: '#253347', background: '#0a1525' }}>

        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-gray-300">🖼 스냅샷 갤러리</p>
          <span className="text-xs text-gray-500">({visibleSnaps.length}장)</span>
          <button onClick={loadSnapshots}
            className="text-xs px-2 py-1 rounded ml-auto"
            style={{ background: '#0d1b2a', border: '1px solid #253347', color: '#6b7280' }}>↻</button>
        </div>

        {/* 카메라 필터 */}
        {cameras.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setFilterCam('all')}
              className="text-xs px-3 py-1 rounded-lg"
              style={chipStyle(filterCam === 'all')}>전체</button>
            {cameras.map(cam => (
              <button key={cam.cameraId} onClick={() => setFilterCam(cam.cameraId)}
                className="text-xs px-3 py-1 rounded-lg"
                style={chipStyle(filterCam === cam.cameraId)}>
                {cam.cameraName}
              </button>
            ))}
          </div>
        )}

        {loading && <p className="text-xs text-gray-500 text-center py-4">불러오는 중…</p>}

        {!loading && visibleSnaps.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-8">저장된 스냅샷이 없습니다</p>
        )}

        {visibleSnaps.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {visibleSnaps.map(snap => (
              <SnapshotCard key={snap.snapshotId} snap={snap}
                onClick={() => setSelectedSnap(snap)}
                onDelete={() => deleteSnapshot(snap.snapshotId)} />
            ))}
          </div>
        )}
      </div>

      {/* ── 전체화면 모달 ── */}
      {selectedSnap && (
        <SnapshotModal snap={selectedSnap}
          onClose={() => setSelectedSnap(null)}
          onDelete={() => deleteSnapshot(selectedSnap.snapshotId)} />
      )}
    </div>
  );
}

// ── 카메라 한 줄 ────────────────────────────────────────────────────
function CameraRow({ cam, onEdit, onDelete }) {
  const isRtsp = cam.cameraUrl?.toLowerCase().startsWith('rtsp://');
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
      style={{ background: '#060f1c', border: '1px solid #1e2d40' }}>
      <span className="text-xs px-1.5 py-0.5 rounded shrink-0"
        style={{ background: isRtsp ? '#1e1a3a' : '#0d2233',
                 border: `1px solid ${isRtsp ? '#818cf8' : '#0ea5e9'}`,
                 color:  isRtsp ? '#c4b5fd' : '#7dd3fc', fontSize: '10px' }}>
        {isRtsp ? 'RTSP' : 'HTTP'}
      </span>
      <span className="text-xs font-medium text-gray-300 shrink-0 w-24 truncate"
        title={cam.cameraName}>{cam.cameraName}</span>
      <span className="text-xs text-gray-500 flex-1 truncate font-mono"
        title={cam.cameraUrl}>{cam.cameraUrl}</span>
      <span className="text-xs shrink-0"
        style={{ color: cam.enabled ? '#22c55e' : '#6b7280' }}>
        {cam.enabled ? '●' : '○'}
      </span>
      <button onClick={onEdit}
        className="text-xs px-2 py-0.5 rounded shrink-0"
        style={{ background: '#0d1b2a', border: '1px solid #253347', color: '#8896a4' }}>
        수정
      </button>
      <button onClick={onDelete}
        className="text-xs px-2 py-0.5 rounded shrink-0"
        style={{ background: '#2a0a0a', border: '1px solid #7f1d1d', color: '#fca5a5' }}>
        삭제
      </button>
    </div>
  );
}

// ── 카메라 추가/수정 폼 ─────────────────────────────────────────────
function CameraForm({ form, setForm, saving, onSave, onCancel }) {
  return (
    <div className="flex flex-col gap-2 px-3 py-3 rounded-lg"
      style={{ background: '#060f1c', border: '1px solid #3b82f6' }}>
      <div className="flex gap-2 flex-wrap">
        <input
          className="flex-1 min-w-32 text-xs px-2 py-1.5 rounded"
          style={{ background: '#0d1b2a', border: '1px solid #253347', color: '#e2e8f0' }}
          placeholder="카메라 이름 (예: 현장 정문)"
          value={form.cameraName}
          onChange={e => setForm(f => ({ ...f, cameraName: e.target.value }))} />
        <input
          className="flex-[2] min-w-48 text-xs px-2 py-1.5 rounded font-mono"
          style={{ background: '#0d1b2a', border: '1px solid #253347', color: '#e2e8f0' }}
          placeholder="rtsp://192.168.1.100:554/stream  또는  http://IP/snapshot.jpg"
          value={form.cameraUrl}
          onChange={e => setForm(f => ({ ...f, cameraUrl: e.target.value }))} />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={form.enabled}
            onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
          활성화
        </label>
        <div className="ml-auto flex gap-2">
          <button onClick={onSave} disabled={saving || !form.cameraUrl.trim()}
            className="text-xs px-3 py-1 rounded-lg"
            style={{ background: '#0d2a1a', border: '1px solid #22c55e', color: '#22c55e' }}>
            {saving ? '저장 중…' : '저장'}
          </button>
          <button onClick={onCancel}
            className="text-xs px-3 py-1 rounded-lg"
            style={{ background: '#1c2a3a', border: '1px solid #253347', color: '#6b7280' }}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스냅샷 썸네일 카드 ──────────────────────────────────────────────
function SnapshotCard({ snap, onClick, onDelete }) {
  const imgUrl = `/api/monitoring/snapshot/${snap.snapshotId}/image`;
  return (
    <div className="rounded-lg border overflow-hidden flex flex-col cursor-pointer group"
      style={{ borderColor: snap.isProblem ? '#ef4444' : '#253347', background: '#060f1c' }}>
      <div className="relative" onClick={onClick}>
        <img src={imgUrl} alt="snap"
          className="w-full object-cover" style={{ height: '100px' }}
          onError={e => { e.target.style.display = 'none'; }} />
        {snap.isProblem && (
          <span className="absolute top-1 left-1 text-xs px-1 py-0.5 rounded"
            style={{ background: '#7f1d1d', color: '#fca5a5', fontSize: '10px' }}>
            ⚠ 위험
          </span>
        )}
        {snap.cameraName && (
          <span className="absolute bottom-1 right-1 text-xs px-1 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,0.7)', color: '#94a3b8', fontSize: '10px' }}>
            {snap.cameraName}
          </span>
        )}
      </div>
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <span className="text-xs text-gray-400">{fmtDate(snap.capturedAt)}</span>
        {snap.expiresAt && (
          <span className="text-xs text-gray-600">만료: {fmtDate(snap.expiresAt)}</span>
        )}
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          className="text-xs mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: '#ef4444' }}>
          삭제
        </button>
      </div>
    </div>
  );
}

// ── 전체화면 모달 ───────────────────────────────────────────────────
function SnapshotModal({ snap, onClose, onDelete }) {
  const imgUrl = `/api/monitoring/snapshot/${snap.snapshotId}/image`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div className="relative flex flex-col gap-3 p-4 rounded-xl max-w-2xl w-full mx-4"
        style={{ background: '#0a1525', border: '1px solid #253347' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center gap-2 flex-wrap">
          {snap.cameraName && (
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ background: '#0d1b2a', border: '1px solid #3b82f6', color: '#93c5fd' }}>
              📷 {snap.cameraName}
            </span>
          )}
          <span className="text-sm font-semibold text-gray-300">{fmtDate(snap.capturedAt)}</span>
          {snap.isProblem && (
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ background: '#7f1d1d', color: '#fca5a5' }}>⚠ 위험 감지</span>
          )}
          <button onClick={onClose}
            className="ml-auto text-gray-500 hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <img src={imgUrl} alt="full"
          className="w-full rounded-lg object-contain" style={{ maxHeight: '60vh' }} />

        {snap.detectionJson && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer hover:text-gray-400">감지 결과 JSON</summary>
            <pre className="mt-1 p-2 rounded overflow-auto"
              style={{ background: '#060f1c', maxHeight: '120px' }}>
              {(() => { try { return JSON.stringify(JSON.parse(snap.detectionJson), null, 2); }
                        catch { return snap.detectionJson; } })()}
            </pre>
          </details>
        )}

        <div className="flex items-center gap-3">
          {snap.expiresAt && (
            <span className="text-xs text-gray-500">만료: {fmtDate(snap.expiresAt)}</span>
          )}
          <button onClick={() => { onDelete(); onClose(); }}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg"
            style={{ background: '#3a0f0f', border: '1px solid #ef4444', color: '#fca5a5' }}>
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
