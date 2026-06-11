import { useState, useRef, useEffect } from 'react';

// ── 기본 블록 목록 & 설정 ────────────────────────────────────────────
const DEFAULT_BLOCKS = [
  { id: 'info',      label: '기본 정보',   icon: '📋', enabled: true },
  { id: 'tasks',     label: '작업 현황',   icon: '📊', enabled: true },
  { id: 'equipment', label: '장비 현황',   icon: '🚜', enabled: true },
  { id: 'workers',   label: '작업자 현황', icon: '👷', enabled: true },
  { id: 'dangers',   label: '위험 작업',   icon: '⚠️', enabled: true },
  { id: 'summary',   label: '종합',        icon: '📈', enabled: true },
  { id: 'signature', label: '서명란',      icon: '✍️', enabled: true },
];
const DEFAULT_SETTINGS = {
  accentColor: '#3a6ea5',
  companyName: '',
  reportTitle: '일일 작업일보',
  fontSize:    'medium',
  logoDataUrl: '',
};
export const DEFAULT_BLOCK_CONFIG = { blocks: DEFAULT_BLOCKS, settings: DEFAULT_SETTINGS };

// ── LocalStorage ────────────────────────────────────────────────────
const LS_KEY = (pid) => `reportBlockConfig_${pid || 'default'}`;
export const loadBlockConfig  = (pid) => {
  try { const s = localStorage.getItem(LS_KEY(pid)); return s ? JSON.parse(s) : DEFAULT_BLOCK_CONFIG; }
  catch { return DEFAULT_BLOCK_CONFIG; }
};
export const saveBlockConfig  = (pid, cfg) => localStorage.setItem(LS_KEY(pid), JSON.stringify(cfg));
export const resetBlockConfig = (pid)      => localStorage.removeItem(LS_KEY(pid));

// ── 유틸 ────────────────────────────────────────────────────────────
const hexLighten = (hex, a = 0.82) => {
  try {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgb(${Math.round(r+(255-r)*a)},${Math.round(g+(255-g)*a)},${Math.round(b+(255-b)*a)})`;
  } catch { return '#eef2f7'; }
};

// ── 정적 레이블 ─────────────────────────────────────────────────────
const STATUS_LBL = { NOT_STARTED:'Not Started', IN_PROGRESS:'In Progress', COMPLETED:'Completed', DELAYED:'Delayed' };
const EQUIP_LBL  = { excavator:'Excavator', dump:'Dump Truck', crane:'Crane', vehicle:'Vehicle', other:'Other' };
const MODE_LBL   = { auto:'Active', standby:'Standby', gps:'GPS' };
const ZONE_LBL   = { excavation:'Excavation', restricted:'Restricted', hazard:'Hazard' };

// ── 섹션별 HTML 조각 ────────────────────────────────────────────────
function makeTasksHtml(tasks, prevMap) {
  if (!tasks?.length) return '<p class="empty">등록된 작업 없음</p>';
  const rows = tasks.map((tk, i) => {
    const prev  = prevMap[tk.taskId], curr = Math.round(tk.progress || 0);
    const delta = prev != null ? Math.round((curr - prev) * 10) / 10 : null;
    const dStr  = delta == null ? '—'
      : delta >= 0 ? `<span class="up">▲+${delta}%</span>`
      : `<span class="dn">▼${delta}%</span>`;
    return `<tr><td class="c">${i+1}</td><td>${tk.taskName||'—'}</td>
      <td class="c">${prev!=null?`${Math.round(prev)}%`:'—'}</td>
      <td class="c"><b>${curr}%</b></td><td class="c">${dStr}</td>
      <td class="c">${STATUS_LBL[tk.status]||'—'}</td></tr>`;
  }).join('');
  return `<table class="dt"><thead><tr>
    <th>No</th><th>작업명</th><th>전일</th><th>진척도</th><th>증감</th><th>상태</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}
function makeEquipHtml(equip) {
  if (!equip?.length) return '<p class="empty">등록된 장비 없음</p>';
  const rows = equip.map((e,i) =>
    `<tr><td class="c">${i+1}</td><td>${e.name||'—'}</td>
    <td class="c">${EQUIP_LBL[e.type]||e.type}</td><td class="c">${MODE_LBL[e.mode]||e.mode}</td>
    <td class="c">${e.hours?`${e.hours}시간`:'—'}</td><td>${e.taskDesc||'—'}</td></tr>`
  ).join('');
  return `<table class="dt"><thead><tr>
    <th>No</th><th>장비명</th><th>종류</th><th>상태</th><th>업무시간</th><th>담당업무</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}
function makeWorkersHtml(workers) {
  if (!workers?.length) return '<p class="empty">등록된 작업자 없음</p>';
  const rows = workers.map((w,i) =>
    `<tr><td class="c">${i+1}</td><td>${w.name||'—'}</td>
    <td class="c" style="color:${w.gear?'#15803d':'#dc2626'}">${w.gear?'✓ 착용':'✗ 미착용'}</td></tr>`
  ).join('');
  return `<table class="dt"><thead><tr>
    <th>No</th><th>작업자명</th><th>안전장비</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}
function makeDangersHtml(dangers) {
  if (!dangers?.length) return '<p class="empty">위험 작업 없음</p>';
  const rows = dangers.map((z,i) =>
    `<tr><td class="c">${i+1}</td><td><span style="color:#dc2626">⚠</span> ${z.name||'—'}</td>
    <td class="c">${ZONE_LBL[z.type]||z.type}</td>
    <td class="c">${((z.halfSize||[4])[0])*2}m</td>
    <td>구역 내 출입 통제 · 안전 표지판 설치</td></tr>`
  ).join('');
  return `<table class="dt"><thead><tr>
    <th>No</th><th>위험구역명</th><th>구분</th><th>반경</th><th>조치사항</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

// ── 블록 렌더러 ─────────────────────────────────────────────────────
const BLOCK_RENDER = {
  info: ({ data }) => `
    <table class="info-grid">
      <tr><td class="lbl">현장명</td><td class="val">${data.siteName||'—'}</td>
          <td class="lbl">보고 일자</td><td class="val">${data.date||'—'}</td></tr>
      <tr><td class="lbl">위&nbsp;치</td><td class="val">${data.locationStr||'—'}</td>
          <td class="lbl">날&nbsp;씨</td><td class="val">—</td></tr>
    </table>`,
  tasks:     ({ tasks, prevMap })  => makeTasksHtml(tasks, prevMap),
  equipment: ({ equip })           => makeEquipHtml(equip),
  workers:   ({ workers })         => makeWorkersHtml(workers),
  dangers:   ({ dangers })         => makeDangersHtml(dangers),
  summary: ({ data }) => {
    const delta = data.prevOverallProgress != null
      ? Math.round(((data.overallProgress||0) - data.prevOverallProgress)*10)/10 : null;
    const dStr = delta==null ? ''
      : delta>=0 ? `▲ +${delta}% (전일 ${data.prevDate||'—'})`
      : `▼ ${delta}% (전일 ${data.prevDate||'—'})`;
    return `<div class="summary">
      <div class="sum-item"><div class="sum-lbl">총 작업자</div><div class="sum-val">${data.workerCount}명</div></div>
      <div class="sum-item"><div class="sum-lbl">총 장비</div><div class="sum-val">${data.equipCount}대</div></div>
      <div class="sum-item"><div class="sum-lbl">전체 진척도</div><div class="sum-val">${Math.round(data.overallProgress||0)}%</div>${dStr?`<div class="sum-delta">${dStr}</div>`:''}</div>
    </div>`;
  },
  signature: () => `<div class="sig-row">
    <div class="sig-box"><div class="sig-lbl">작&nbsp;성&nbsp;자</div></div>
    <div class="sig-box"><div class="sig-lbl">현장관리자</div></div>
    <div class="sig-box"><div class="sig-lbl">승&nbsp;인&nbsp;자</div></div>
  </div>`,
};

// ── CSS 생성 ────────────────────────────────────────────────────────
function generateCss(settings) {
  const ac  = settings.accentColor || '#3a6ea5';
  const acL = hexLighten(ac, 0.82);
  const acLL= hexLighten(ac, 0.94);
  const FS  = { small:'9px',  medium:'10px', large:'12px' }[settings.fontSize||'medium'];
  const FSH = { small:'10px', medium:'11px', large:'14px' }[settings.fontSize||'medium'];
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:${FS};color:#111;padding:12mm 15mm}
    .rh{display:flex;align-items:center;gap:12px;margin-bottom:14px;padding-bottom:10px;border-bottom:3px solid ${ac}}
    .logo{height:40px;object-fit:contain}
    .cn{font-size:${FSH};font-weight:bold;color:${ac};letter-spacing:1px}
    .rt{font-size:20px;font-weight:800;letter-spacing:5px;text-align:center;flex:1}
    .sec{font-size:${FSH};font-weight:bold;background:${acLL};padding:4px 10px;margin:14px 0 6px;border-left:5px solid ${ac}}
    .info-grid{width:100%;border-collapse:collapse;margin-bottom:4px;border:1px solid #aaa}
    .info-grid td{border:1px solid #ccc;padding:5px 10px}
    .info-grid .lbl{background:${acL};font-weight:bold;width:13%;font-size:calc(${FS} - 1px);text-align:center}
    .info-grid .val{width:37%}
    .dt{width:100%;border-collapse:collapse;margin-bottom:4px}
    .dt th{background:${acL};border:1px solid #999;padding:4px 6px;text-align:center;font-size:calc(${FS} - 1px)}
    .dt td{border:1px solid #bbb;padding:3px 6px}
    .dt td.c{text-align:center}
    .dt tr:nth-child(even) td{background:${acLL}}
    .up{color:#16a34a;font-weight:bold} .dn{color:#dc2626;font-weight:bold}
    .empty{color:#aaa;padding:6px;font-style:italic}
    .summary{display:flex;border:1px solid #aaa;margin:4px 0}
    .sum-item{flex:1;border-right:1px solid #ccc;padding:10px;text-align:center}
    .sum-item:last-child{border-right:none}
    .sum-lbl{font-size:8px;color:#666;margin-bottom:3px}
    .sum-val{font-size:22px;font-weight:800;color:${ac}}
    .sum-delta{font-size:8px;color:#555;margin-top:2px}
    .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:16px}
    .sig-box{border:1px solid #999;padding:10px;min-height:70px}
    .sig-lbl{font-size:10px;font-weight:bold;border-bottom:1px solid #ddd;padding-bottom:5px;margin-bottom:8px;text-align:center;letter-spacing:2px}
    @media print{@page{margin:8mm;size:A4}body{padding:0}}
  `;
}

// ── HTML 최종 생성 (DailyReport.jsx에서 인쇄 시 호출) ───────────────
export function generateHtml(config, renderData) {
  const { blocks = DEFAULT_BLOCKS, settings = DEFAULT_SETTINGS } = config || {};
  const { date, data, tasks=[], equip=[], workers=[], dangers=[], prevTasks=[] } = renderData || {};
  const prevMap = {};
  prevTasks.forEach(pt => { prevMap[pt.taskId] = pt.progress || 0; });
  const rd = { data: { ...data, date }, tasks, equip, workers, dangers, prevMap };

  const headerHtml = `<div class="rh">
    ${settings.logoDataUrl ? `<img class="logo" src="${settings.logoDataUrl}" alt=""/>` : ''}
    ${settings.companyName ? `<div class="cn">${settings.companyName}</div>` : ''}
    <div class="rt">${settings.reportTitle || '일일 작업일보'}</div>
  </div>`;

  const bodyHtml = blocks.filter(b => b.enabled).map(b => {
    const renderer = BLOCK_RENDER[b.id];
    if (!renderer) return '';
    const secHeader = b.id !== 'info' ? `<div class="sec">${b.label}</div>` : '';
    return `${secHeader}${renderer(rd)}`;
  }).join('\n');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${settings.reportTitle||'일일 작업일보'}</title>
<style>${generateCss(settings)}</style>
</head><body>${headerHtml}${bodyHtml}</body></html>`;
}

// ── 블록 아이템 컴포넌트 ─────────────────────────────────────────────
function BlockItem({ block, index, total, onChange, onMove, isDragOver, dragHandlers }) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      {...dragHandlers}
      style={{
        display: 'flex', alignItems: 'center', gap: 7,
        background: block.enabled ? '#0d1b2a' : '#060f18',
        border: `1px solid ${isDragOver ? '#3b82f6' : block.enabled ? '#1e3a5f' : '#0d1b2a'}`,
        borderRadius: 8, padding: '7px 9px', marginBottom: 5,
        opacity: block.enabled ? 1 : 0.45,
        cursor: 'grab', userSelect: 'none',
        transition: 'border-color 0.15s',
        outline: isDragOver ? '2px solid #3b82f680' : 'none',
      }}>
      {/* 드래그 핸들 */}
      <span style={{ fontSize: 15, color: '#374151', lineHeight: 1 }}>⠿</span>
      {/* 아이콘 */}
      <span style={{ fontSize: 14, lineHeight: 1 }}>{block.icon}</span>
      {/* 레이블 (클릭하면 편집) */}
      {editing
        ? <input autoFocus value={block.label}
            onChange={e => onChange({ ...block, label: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={e => e.key === 'Enter' && setEditing(false)}
            style={{ flex:1, background:'#040c17', border:'1px solid #3b82f6', borderRadius:4, color:'#93c5fd', fontSize:11, padding:'2px 6px', outline:'none' }} />
        : <span onClick={() => setEditing(true)} title="클릭하여 이름 수정"
            style={{ flex:1, fontSize:11, color: block.enabled ? '#c8d8e8' : '#374151', cursor:'text' }}>
            {block.label}
          </span>}
      {/* 순서 이동 */}
      <button onClick={() => onMove(index, -1)} disabled={index === 0}
        style={{ background:'none', border:'none', color: index===0 ? '#1e3a5f' : '#6b7280', fontSize:12, padding:'0 2px', cursor: index===0 ? 'default' : 'pointer' }}>▲</button>
      <button onClick={() => onMove(index, 1)} disabled={index === total-1}
        style={{ background:'none', border:'none', color: index===total-1 ? '#1e3a5f' : '#6b7280', fontSize:12, padding:'0 2px', cursor: index===total-1 ? 'default' : 'pointer' }}>▼</button>
      {/* ON/OFF 토글 */}
      <button onClick={() => onChange({ ...block, enabled: !block.enabled })}
        style={{
          background: block.enabled ? '#166534' : '#1f2937',
          border: `1px solid ${block.enabled ? '#22c55e' : '#374151'}`,
          borderRadius: 12, color: block.enabled ? '#4ade80' : '#6b7280',
          fontSize: 9, fontWeight: 700, padding: '2px 9px', cursor: 'pointer', minWidth: 38,
        }}>
        {block.enabled ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

// ── 메인 편집기 컴포넌트 ─────────────────────────────────────────────
export default function TemplateEditor({ projectId, sampleData, onClose }) {
  const [config,      setConfig]      = useState(() => loadBlockConfig(projectId));
  const [saved,       setSaved]       = useState(false);
  const [dragIdx,     setDragIdx]     = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [previewHtml, setPreviewHtml] = useState('');
  const fileRef = useRef(null);

  const { blocks, settings } = config;

  const patchBlocks   = (fn) => setConfig(c => ({ ...c, blocks:   fn(c.blocks) }));
  const patchSettings = (patch) => setConfig(c => ({ ...c, settings: { ...c.settings, ...patch } }));

  const updateBlock = (i, updated) => patchBlocks(bs => bs.map((b,idx) => idx===i ? updated : b));
  const moveBlock   = (i, dir) => patchBlocks(bs => {
    const next = [...bs], j = i + dir;
    if (j < 0 || j >= next.length) return next;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  // 드래그 앤 드롭 핸들러
  const dragHandlers = (i) => ({
    draggable: true,
    onDragStart: ()    => setDragIdx(i),
    onDragOver:  (e)   => { e.preventDefault(); setDragOverIdx(i); },
    onDrop:      ()    => {
      if (dragIdx === null || dragIdx === i) { setDragIdx(null); setDragOverIdx(null); return; }
      patchBlocks(bs => {
        const next = [...bs];
        const [moved] = next.splice(dragIdx, 1);
        next.splice(i, 0, moved);
        return next;
      });
      setDragIdx(null); setDragOverIdx(null);
    },
    onDragEnd: () => { setDragIdx(null); setDragOverIdx(null); },
  });

  // 로고 업로드
  const handleLogo = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => patchSettings({ logoDataUrl: ev.target.result });
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    saveBlockConfig(projectId, config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const handleReset = () => {
    if (!window.confirm('기본 설정으로 초기화하시겠습니까?')) return;
    resetBlockConfig(projectId);
    setConfig(DEFAULT_BLOCK_CONFIG);
  };

  // 미리보기 — config 바뀔 때마다 300ms 디바운스
  useEffect(() => {
    if (!sampleData) return;
    const id = setTimeout(() => {
      try { setPreviewHtml(generateHtml(config, sampleData)); } catch {}
    }, 300);
    return () => clearTimeout(id);
  }, [config, sampleData]);

  // 최초 미리보기
  useEffect(() => {
    if (sampleData) { try { setPreviewHtml(generateHtml(config, sampleData)); } catch {} }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 공통 인풋 스타일
  const inp = { width:'100%', background:'#040c17', border:'1px solid #1e3a5f', borderRadius:5, color:'#c8d8e8', fontSize:11, padding:'5px 8px', outline:'none', marginBottom:10 };
  const lbl = { display:'block', fontSize:9, color:'#4b5563', marginBottom:3 };
  const sep = { fontSize:10, fontWeight:700, color:'#60a5fa', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8, paddingBottom:4, borderBottom:'1px solid #1e3a5f' };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* 툴바 */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 16px', borderBottom:'1px solid #1e3a5f', background:'#060f18', flexShrink:0 }}>
        <span style={{ fontSize:11, color:'#4b5563', flex:1 }}>섹션을 드래그하거나 ▲▼로 순서 변경 · 이름 클릭으로 수정 · ON/OFF로 표시 여부 설정</span>
        <button onClick={handleReset} style={{ background:'none', border:'1px solid #374151', borderRadius:6, color:'#6b7280', fontSize:11, padding:'5px 12px', cursor:'pointer' }}>초기화</button>
        <button onClick={handleSave} style={{ background: saved?'#14532d':'#1e3a5f', border:`1px solid ${saved?'#22c55e':'#3b82f6'}`, borderRadius:6, color:saved?'#4ade80':'#93c5fd', fontSize:11, fontWeight:700, padding:'5px 14px', cursor:'pointer' }}>
          {saved ? '✓ 저장됨' : '💾 저장'}
        </button>
        <button onClick={onClose} style={{ background:'none', border:'1px solid #374151', borderRadius:6, color:'#6b7280', fontSize:11, padding:'5px 12px', cursor:'pointer' }}>닫기</button>
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>

        {/* 좌: 설정 패널 */}
        <div style={{ width:272, flexShrink:0, borderRight:'2px solid #1e3a5f', overflowY:'auto', padding:'14px', background:'#07111e' }}>

          {/* ── 글로벌 설정 ── */}
          <div style={{ marginBottom:20 }}>
            <div style={sep}>글로벌 설정</div>

            <label style={lbl}>보고서 제목</label>
            <input value={settings.reportTitle||''} onChange={e => patchSettings({ reportTitle: e.target.value })} style={inp} />

            <label style={lbl}>회사명 / 현장명 (헤더 표시)</label>
            <input value={settings.companyName||''} onChange={e => patchSettings({ companyName: e.target.value })}
              placeholder="(선택) 로고 옆에 표시됩니다" style={inp} />

            <label style={lbl}>브랜드 색상</label>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <input type="color" value={settings.accentColor||'#3a6ea5'}
                onChange={e => patchSettings({ accentColor: e.target.value })}
                style={{ width:34, height:28, border:'none', borderRadius:4, cursor:'pointer', padding:0, background:'none' }} />
              <input value={settings.accentColor||'#3a6ea5'}
                onChange={e => patchSettings({ accentColor: e.target.value })}
                style={{ ...inp, marginBottom:0, flex:1, fontFamily:'monospace' }} />
            </div>

            <label style={lbl}>폰트 크기</label>
            <div style={{ display:'flex', gap:5, marginBottom:10 }}>
              {[['small','작게'],['medium','보통'],['large','크게']].map(([sz,name]) => (
                <button key={sz} onClick={() => patchSettings({ fontSize: sz })}
                  style={{ flex:1, background: settings.fontSize===sz ? '#1e3a5f':'#040c17', border:`1px solid ${settings.fontSize===sz ? '#3b82f6':'#1e3a5f'}`, borderRadius:5, color: settings.fontSize===sz ? '#93c5fd':'#374151', fontSize:10, padding:'4px 0', cursor:'pointer' }}>
                  {name}
                </button>
              ))}
            </div>

            <label style={lbl}>로고 이미지</label>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
              <button onClick={() => fileRef.current?.click()}
                style={{ flex:1, background:'#040c17', border:'1px solid #1e3a5f', borderRadius:5, color:'#6b7280', fontSize:10, padding:'5px 0', cursor:'pointer' }}>
                📂 파일 선택
              </button>
              {settings.logoDataUrl && (
                <button onClick={() => patchSettings({ logoDataUrl:'' })}
                  style={{ background:'none', border:'1px solid #374151', borderRadius:5, color:'#ef4444', fontSize:10, padding:'5px 8px', cursor:'pointer' }}>✕</button>
              )}
            </div>
            {settings.logoDataUrl && (
              <img src={settings.logoDataUrl} alt="logo preview"
                style={{ maxHeight:36, maxWidth:'100%', borderRadius:4, background:'#fff', padding:2, display:'block' }} />
            )}
            <input ref={fileRef} type="file" accept="image/*" onChange={handleLogo} style={{ display:'none' }} />
          </div>

          {/* ── 섹션 구성 ── */}
          <div>
            <div style={sep}>섹션 구성</div>
            <div style={{ fontSize:9, color:'#374151', marginBottom:10, lineHeight:1.5 }}>
              드래그하거나 ▲▼로 순서 변경<br/>이름을 클릭하면 수정할 수 있습니다
            </div>
            {blocks.map((block, i) => (
              <BlockItem
                key={block.id}
                block={block} index={i} total={blocks.length}
                isDragOver={dragOverIdx === i && dragIdx !== i}
                dragHandlers={dragHandlers(i)}
                onChange={updated => updateBlock(i, updated)}
                onMove={moveBlock}
              />
            ))}
          </div>
        </div>

        {/* 우: 미리보기 */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
          <div style={{ fontSize:9, color:'#374151', padding:'5px 14px', background:'#060f18', borderBottom:'1px solid #0d1b2a' }}>
            미리보기 — 실제 저장된 데이터가 적용됩니다
          </div>
          {previewHtml
            ? <iframe title="block-preview" srcDoc={previewHtml} sandbox="allow-same-origin"
                style={{ flex:1, border:'none', background:'#fff' }} />
            : <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#374151', fontSize:12 }}>
                저장된 일보 데이터가 있으면 여기에 미리보기가 표시됩니다
              </div>
          }
        </div>
      </div>

      {/* 하단 안내 */}
      <div style={{ padding:'5px 16px', borderTop:'1px solid #0d1b2a', background:'#060f18', fontSize:9, color:'#374151', flexShrink:0 }}>
        💡 설정은 프로젝트별로 저장됩니다. 인쇄 및 미리보기 시 이 레이아웃이 사용됩니다.
      </div>
    </div>
  );
}
