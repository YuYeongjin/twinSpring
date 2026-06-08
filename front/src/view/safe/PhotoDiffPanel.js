import { useState, useRef, useEffect, useCallback } from 'react';
import { useT } from '../../i18n/LanguageContext';

// ── 상수 ─────────────────────────────────────────────────────────────
const GRID_COLS = 200;
const GRID_ROWS = 150;
const DIFF_THRESHOLD = 0.08; // 8% 이상 밝기 차이를 유의미한 변화로 판단

// ── 이미지 데이터 → 고정 해상도 그레이스케일 그리드 ─────────────────
function imageDataToGrid(data, W, H) {
  return Array.from({ length: GRID_ROWS }, (_, r) => {
    const row = new Float32Array(GRID_COLS);
    for (let c = 0; c < GRID_COLS; c++) {
      const px = Math.min(W - 1, Math.floor((c / GRID_COLS) * W));
      const py = Math.min(H - 1, Math.floor((r / GRID_ROWS) * H));
      const i = (py * W + px) * 4;
      row[c] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    }
    return row;
  });
}

// ── Gaussian blur (1D 분리 가능 커널) ────────────────────────────────
function gaussianBlur(grid, sigma = 1.5) {
  const R = grid.length, C = grid[0].length;
  const rad = Math.ceil(sigma * 2.5);
  const k = new Float32Array(2 * rad + 1);
  let sum = 0;
  for (let i = 0; i <= 2 * rad; i++) {
    k[i] = Math.exp(-((i - rad) ** 2) / (2 * sigma ** 2));
    sum += k[i];
  }
  for (let i = 0; i <= 2 * rad; i++) k[i] /= sum;

  const tmp = Array.from({ length: R }, () => new Float32Array(C));
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    let v = 0;
    for (let d = -rad; d <= rad; d++) v += grid[y][Math.max(0, Math.min(C - 1, x + d))] * k[d + rad];
    tmp[y][x] = v;
  }
  const out = Array.from({ length: R }, () => new Float32Array(C));
  for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
    let v = 0;
    for (let d = -rad; d <= rad; d++) v += tmp[Math.max(0, Math.min(R - 1, y + d))][x] * k[d + rad];
    out[y][x] = v;
  }
  return out;
}

// ── min-max 정규화 — 조명 차이 보정 ─────────────────────────────────
function normalizeGrid(grid) {
  let min = Infinity, max = -Infinity;
  for (const row of grid) for (const v of row) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const rng = max - min || 1;
  return grid.map(row => new Float32Array(row.map(v => (v - min) / rng)));
}

// ── diff 계산 ─────────────────────────────────────────────────────────
function computeDiff(normA, normB) {
  let changed = 0;
  let maxPos = 0, maxNeg = 0;
  const total = GRID_ROWS * GRID_COLS;
  const diff = Array.from({ length: GRID_ROWS }, (_, r) => {
    const row = new Float32Array(GRID_COLS);
    for (let c = 0; c < GRID_COLS; c++) {
      const d = normB[r][c] - normA[r][c];
      row[c] = d;
      if (Math.abs(d) >= DIFF_THRESHOLD) changed++;
      if (d > maxPos) maxPos = d;
      if (d < maxNeg) maxNeg = d;
    }
    return row;
  });
  const changedPct = Math.round((changed / total) * 100);
  return {
    diff,
    changedPct,
    maxPos: Math.round(maxPos * 100),
    maxNeg: Math.round(Math.abs(maxNeg) * 100),
    riskLevel: changedPct > 10 ? 'HIGH' : changedPct > 4 ? 'MEDIUM' : 'LOW',
  };
}

// ── 파일 → 정규화 그리드 (Promise) ───────────────────────────────────
function fileToNormGrid(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const hc = document.createElement('canvas');
      hc.width = img.naturalWidth;
      hc.height = img.naturalHeight;
      hc.getContext('2d').drawImage(img, 0, 0);
      const data = hc.getContext('2d').getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
      const grid = imageDataToGrid(data, img.naturalWidth, img.naturalHeight);
      const norm = normalizeGrid(gaussianBlur(grid, 1.5));
      URL.revokeObjectURL(url);
      resolve(norm);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')); };
    img.src = url;
  });
}

// ── canvas 렌더링 ─────────────────────────────────────────────────────
function renderGrid(canvas, grid, mode = 'gray') {
  if (!canvas || !grid) return;
  canvas.width = GRID_COLS;
  canvas.height = GRID_ROWS;
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(GRID_COLS, GRID_ROWS);
  for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) {
    const v = grid[r][c];
    const i = (r * GRID_COLS + c) * 4;
    if (mode === 'gray') {
      const g = Math.round(v * 255);
      id.data[i] = g; id.data[i + 1] = g; id.data[i + 2] = g; id.data[i + 3] = 255;
    } else {
      if (v >= DIFF_THRESHOLD) {
        // 밝아짐: 빨간색 (표면 변형·부풀음 가능성)
        const t = Math.min(1, v / 0.4);
        id.data[i]     = Math.round(200 * t + 55);
        id.data[i + 1] = Math.round(20 * (1 - t));
        id.data[i + 2] = Math.round(20 * (1 - t));
        id.data[i + 3] = Math.round(180 * t + 75);
      } else if (v <= -DIFF_THRESHOLD) {
        // 어두워짐: 파란색 (균열·손상·재료 손실 가능성)
        const t = Math.min(1, -v / 0.4);
        id.data[i]     = Math.round(20 * (1 - t));
        id.data[i + 1] = Math.round(80 * (1 - t));
        id.data[i + 2] = Math.round(220 * t + 35);
        id.data[i + 3] = Math.round(180 * t + 75);
      } else {
        // 변화 없음: 어두운 초록
        id.data[i] = 8; id.data[i + 1] = 32; id.data[i + 2] = 14; id.data[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(id, 0, 0);
}

// 그리드 → 썸네일 data URL (위치 목록 미리보기용 — 그리드 없을 때 폴백)
function normToDataUrl(norm) {
  const c = document.createElement('canvas');
  renderGrid(c, norm, 'gray');
  return c.toDataURL();
}

// 원본 이미지 URL → 160×90 JPEG 썸네일 data URL
function generateThumbnail(imgUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const TW = 160, TH = 90;
      const scale = Math.min(TW / img.naturalWidth, TH / img.naturalHeight);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const c = document.createElement('canvas');
      c.width = TW; c.height = TH;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, TW, TH);
      ctx.drawImage(img, (TW - w) / 2, (TH - h) / 2, w, h);
      resolve(c.toDataURL('image/jpeg', 0.65));
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}

// ── localStorage 위치 관리 ────────────────────────────────────────────
function locKey(pid) { return `safe_photo_locs_${pid || 'default'}`; }
function loadLocs(pid) {
  try { return JSON.parse(localStorage.getItem(locKey(pid)) || '{}'); } catch { return {}; }
}
function saveLoc(pid, name, norm, thumbnail = null) {
  const locs = loadLocs(pid);
  locs[name] = {
    norm: norm.map(r => Array.from(r)),
    thumbnail,           // JPEG data URL (~5–10KB) 또는 null
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(locKey(pid), JSON.stringify(locs));
    return true;
  } catch {
    // 썸네일 없이 재시도 (용량 절약)
    locs[name].thumbnail = null;
    try { localStorage.setItem(locKey(pid), JSON.stringify(locs)); return true; } catch { return false; }
  }
}
function delLoc(pid, name) {
  const locs = loadLocs(pid);
  delete locs[name];
  localStorage.setItem(locKey(pid), JSON.stringify(locs));
}

// ── 업로드 카드 컴포넌트 ──────────────────────────────────────────────
function UploadCard({ label, desc, preview, norm, selLoc, fileRef, onFile, onClear, t }) {
  const T2 = '#8896a4';
  return (
    <div style={{ background: '#0a1525', border: '1px solid #253347', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>📷 {label} — {desc}</span>
        {norm && (
          <span style={{ fontSize: 10, color: '#22c55e', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {t('loaded')}
            {onClear && (
              <button onClick={onClear} style={{ color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, lineHeight: 1, marginLeft: 2 }}>✕</button>
            )}
          </span>
        )}
      </div>

      <div
        onClick={() => fileRef.current?.click()}
        style={{
          height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px dashed ${norm ? '#22c55e40' : '#253347'}`, borderRadius: 8,
          cursor: 'pointer', overflow: 'hidden', background: '#0d1b2a', position: 'relative',
          transition: 'border-color 0.2s',
        }}
      >
        {preview
          ? <img src={preview} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 28, opacity: 0.3 }}>📂</span>
              <span style={{ fontSize: 11, color: T2 }}>{t('clickToUpload')}</span>
            </div>
          )
        }
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />

      {label === 'A' && selLoc && (
        <div style={{ fontSize: 10, color: '#60a5fa', textAlign: 'center' }}>📍 {selLoc} {t('savedBaseline')}</div>
      )}
      {!norm && (
        <div style={{ fontSize: 10, color: '#374151', textAlign: 'center' }}>
          {label === 'A' ? t('hintA') : t('hintB')}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────
export default function PhotoDiffPanel({ selectedProject }) {
  const t = useT('photoDiff');
  const pid = selectedProject?.projectId;

  const [locs, setLocs]         = useState({});
  const [selLoc, setSelLoc]     = useState('');
  const [locName, setLocName]   = useState('');

  const [previewA, setPreviewA] = useState(null);
  const [previewB, setPreviewB] = useState(null);
  const [normA, setNormA]       = useState(null);
  const [normB, setNormB]       = useState(null);
  const [diff, setDiff]         = useState(null);
  const [busy, setBusy]         = useState(false);
  const [saveErr, setSaveErr]   = useState('');

  const fileARef   = useRef(null);
  const fileBRef   = useRef(null);
  const cvARef     = useRef(null);
  const cvBRef     = useRef(null);
  const cvDiffRef  = useRef(null);

  // 위치 목록 로드
  useEffect(() => { setLocs(loadLocs(pid)); }, [pid]);

  // diff 결과가 생기면 세 캔버스 렌더링
  useEffect(() => {
    if (!diff) return;
    renderGrid(cvARef.current, normA, 'gray');
    renderGrid(cvBRef.current, normB, 'gray');
    renderGrid(cvDiffRef.current, diff.diff, 'diff');
  }, [diff]); // eslint-disable-line react-hooks/exhaustive-deps

  // 파일 업로드 공통 처리
  const handleFile = useCallback(async (file, setPreview, setNorm, clearLoc = false) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    setNorm(null);
    setDiff(null);
    if (clearLoc) setSelLoc('');
    try {
      const norm = await fileToNormGrid(file);
      setNorm(norm);
    } catch (e) {
      alert(e.message);
    }
  }, []);

  const handleFileA = useCallback(e => {
    const f = e.target.files?.[0]; if (!f) return;
    handleFile(f, setPreviewA, setNormA, true);
    e.target.value = '';
  }, [handleFile]);

  const handleFileB = useCallback(e => {
    const f = e.target.files?.[0]; if (!f) return;
    handleFile(f, setPreviewB, setNormB, false);
    e.target.value = '';
  }, [handleFile]);

  // 저장된 위치 → A로 불러오기
  const handleLoadBaseline = useCallback(name => {
    const all = loadLocs(pid);
    const loc = all[name]; if (!loc) return;
    const norm = loc.norm.map(r => new Float32Array(r));
    setNormA(norm);
    setPreviewA(normToDataUrl(norm));
    setSelLoc(name);
    setDiff(null);
  }, [pid]);

  // A 그리드 → 위치로 저장 (썸네일 포함)
  const handleSave = useCallback(async () => {
    if (!normA || !locName.trim()) return;
    setSaveErr('');
    // previewA가 실제 사진 URL이면 썸네일 생성, 아니면 null
    const thumbnail = previewA ? await generateThumbnail(previewA) : null;
    const ok = saveLoc(pid, locName.trim(), normA, thumbnail);
    if (ok) {
      setLocs(loadLocs(pid));
      setLocName('');
    } else {
      setSaveErr(t('errStorage'));
    }
  }, [normA, locName, pid, previewA]);

  // 위치 삭제
  const handleDelete = useCallback(name => {
    delLoc(pid, name);
    setLocs(loadLocs(pid));
    if (selLoc === name) { setSelLoc(''); setNormA(null); setPreviewA(null); }
  }, [pid, selLoc]);

  // 변화 분석 실행
  const handleAnalyze = useCallback(async () => {
    if (!normA || !normB) return;
    setBusy(true);
    await new Promise(r => setTimeout(r, 0));
    setDiff(computeDiff(normA, normB));
    setBusy(false);
  }, [normA, normB]);

  const locList = Object.entries(locs).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));
  const riskColor = diff?.riskLevel === 'HIGH' ? '#ef4444'
    : diff?.riskLevel === 'MEDIUM' ? '#f97316' : '#22c55e';
  const T2 = '#8896a4';
  const CARD = { background: '#0a1525', border: '1px solid #253347', borderRadius: 12, padding: 16 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── 헤더 설명 ─────────────────────────────────────────────── */}
      <div style={{ ...CARD, display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px' }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>📸</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{t('title')}</div>
          <div style={{ fontSize: 11, color: T2, marginTop: 3, lineHeight: 1.6 }}>
            {t('subtitle')}
          </div>
        </div>
      </div>

      {/* ── 1행: 위치 목록 + 사진 A + 사진 B ─────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 1fr', gap: 12, alignItems: 'start' }}>

        {/* 위치 목록 */}
        <div style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{t('sectionLocations')}</div>

          {/* 현재 A 이미지 → 위치로 저장 */}
          {normA && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 10, color: T2 }}>{t('saveAsLabel')}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={locName}
                  onChange={e => setLocName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  placeholder={t('locNamePlaceholder')}
                  style={{ flex: 1, padding: '5px 8px', fontSize: 11, background: '#0d1b2a', border: '1px solid #253347', borderRadius: 6, color: '#e2e8f0', outline: 'none' }}
                />
                <button
                  onClick={handleSave}
                  disabled={!locName.trim()}
                  style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: locName.trim() ? 'pointer' : 'not-allowed', background: locName.trim() ? '#1e3a5f' : '#1c2a3a', border: `1px solid ${locName.trim() ? '#3b82f6' : '#253347'}`, color: locName.trim() ? '#93c5fd' : '#4b5563', whiteSpace: 'nowrap' }}
                >
                  {t('saveBtn')}
                </button>
              </div>
              {saveErr && <div style={{ fontSize: 10, color: '#f87171' }}>{saveErr}</div>}
            </div>
          )}

          {/* 등록 목록 */}
          {locList.length === 0 ? (
            <div style={{ fontSize: 11, color: '#374151', textAlign: 'center', padding: '20px 0', lineHeight: 1.7 }}>
              {t('locEmptyHint')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
              {locList.map(([name, loc]) => (
                <div
                  key={name}
                  onClick={() => handleLoadBaseline(name)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 8, background: selLoc === name ? '#1e3a5f' : '#0d1b2a', border: `1px solid ${selLoc === name ? '#3b82f6' : '#253347'}`, transition: 'all 0.15s' }}
                >
                  {/* 썸네일 */}
                  <div style={{ width: 44, height: 30, borderRadius: 4, overflow: 'hidden', flexShrink: 0, background: '#060e18' }}>
                    <img
                      src={loc.thumbnail || normToDataUrl(loc.norm.map(r => new Float32Array(r)))}
                      alt={name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                    <div style={{ fontSize: 10, color: T2 }}>{new Date(loc.savedAt).toLocaleDateString('ko-KR')}</div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(name); }}
                    style={{ fontSize: 13, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, lineHeight: 1, padding: '0 2px' }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 사진 A (기준) */}
        <UploadCard
          label="A"
          desc={t('labelA')}
          preview={previewA}
          norm={normA}
          selLoc={selLoc}
          fileRef={fileARef}
          onFile={handleFileA}
          onClear={() => { setNormA(null); setPreviewA(null); setSelLoc(''); setDiff(null); }}
          t={t}
        />

        {/* 사진 B (비교) */}
        <UploadCard
          label="B"
          desc={t('labelB')}
          preview={previewB}
          norm={normB}
          selLoc={null}
          fileRef={fileBRef}
          onFile={handleFileB}
          onClear={() => { setNormB(null); setPreviewB(null); setDiff(null); }}
          t={t}
        />
      </div>

      {/* ── 분석 버튼 ─────────────────────────────────────────────── */}
      <button
        onClick={handleAnalyze}
        disabled={!normA || !normB || busy}
        style={{
          padding: '13px', fontSize: 13, fontWeight: 700, borderRadius: 10, width: '100%',
          cursor: (!normA || !normB || busy) ? 'not-allowed' : 'pointer',
          background: (normA && normB && !busy) ? 'linear-gradient(135deg,#0d2040,#1d4ed8)' : '#1c2a3a',
          border: `1px solid ${(normA && normB) ? '#3b82f6' : '#253347'}`,
          color: (normA && normB) ? '#93c5fd' : '#4b5563',
          boxShadow: (normA && normB && !busy) ? '0 0 16px #3b82f630' : 'none',
          transition: 'all 0.2s',
        }}
      >
        {busy
          ? t('analyzingBtn')
          : !normA
          ? t('needA')
          : !normB
          ? t('needB')
          : t('analyzeBtn')}
      </button>

      {/* ── 분석 결과 ─────────────────────────────────────────────── */}
      {diff && (
        <>
          {/* 위험도 배너 */}
          <div style={{
            padding: '14px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14,
            background: diff.riskLevel === 'HIGH' ? '#2a0a00' : diff.riskLevel === 'MEDIUM' ? '#2a1500' : '#0a2010',
            border: `1px solid ${riskColor}`,
          }}>
            <span style={{ fontSize: 24, flexShrink: 0 }}>
              {diff.riskLevel === 'HIGH' ? '🚨' : diff.riskLevel === 'MEDIUM' ? '⚠️' : '✅'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: riskColor }}>
                {t('riskLabel')} {diff.riskLevel === 'HIGH' ? t('riskHigh') : diff.riskLevel === 'MEDIUM' ? t('riskMedium') : t('riskLow')}
              </div>
              <div style={{ fontSize: 11, color: T2, marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>{t('statChanged').replace('{n}', diff.changedPct)}</span>
                <span>{t('statDark').replace('{n}', diff.maxNeg)}</span>
                <span>{t('statBright').replace('{n}', diff.maxPos)}</span>
              </div>
            </div>
            <button
              onClick={() => setDiff(null)}
              style={{ background: 'none', border: 'none', color: T2, cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
            >✕</button>
          </div>

          {/* 3패널 시각화 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            {[
              { label: t('panelA'), ref: cvARef, hint: t('hintPanelA') },
              { label: t('panelB'), ref: cvBRef, hint: t('hintPanelB') },
              { label: t('panelDiff'), ref: cvDiffRef, hint: t('hintPanelDiff') },
            ].map(({ label, ref, hint }) => (
              <div key={label} style={{ ...CARD, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{label}</div>
                <canvas
                  ref={ref}
                  style={{ width: '100%', aspectRatio: `${GRID_COLS}/${GRID_ROWS}`, imageRendering: 'pixelated', borderRadius: 6, display: 'block' }}
                />
                <div style={{ fontSize: 9, color: T2, lineHeight: 1.5 }}>{hint}</div>
              </div>
            ))}
          </div>

          {/* 범례 */}
          <div style={{ ...CARD, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: T2 }}>{t('legendTitle')}</span>
            {[
              { color: '#3b82f6', label: t('legendDark') },
              { color: '#ef4444', label: t('legendBright') },
              { color: '#22c55e', label: t('legendNone') },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: T2 }}>{label}</span>
              </div>
            ))}
          </div>

          {/* 제약 안내 */}
          <div style={{ ...CARD, padding: '10px 14px', background: '#1e1000', borderColor: '#d97706' }}>
            <div style={{ fontSize: 11, color: '#d97706', fontWeight: 600, marginBottom: 4 }}>{t('accuracyTitle')}</div>
            <div style={{ fontSize: 10, color: '#92400e', lineHeight: 1.7 }}>
              {t('accuracyDesc')}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setNormB(null); setPreviewB(null); setDiff(null); }}
              style={{ padding: '8px 16px', fontSize: 11, borderRadius: 8, background: '#1c2a3a', border: '1px solid #253347', color: T2, cursor: 'pointer' }}
            >
              {t('newComparison')}
            </button>
            <button
              onClick={() => { setNormA(null); setNormB(null); setPreviewA(null); setPreviewB(null); setDiff(null); setSelLoc(''); }}
              style={{ padding: '8px 16px', fontSize: 11, borderRadius: 8, background: '#1c2a3a', border: '1px solid #253347', color: T2, cursor: 'pointer' }}
            >
              {t('reset')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
