import { useState, useEffect, useRef } from 'react';
import AxiosCustom from '../../../axios/AxiosCustom';
import { parseIfcFile } from '../../../utils/ifcImporter';
import { useIntegrationDispatch } from '../IntegrationStore';
import { useT } from '../../../i18n/LanguageContext';

const TAB = { BIM: 'bim', IFC: 'ifc' };

// ── 이미지 리사이즈 (드론 지형용) ──────────────────────────────
export async function resizeImageDataUrl(dataUrl, maxPx = 1024, quality = 0.75) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), w, h });
    };
    img.src = dataUrl;
  });
}

// ── BIM 프로젝트 선택 탭 ─────────────────────────────────────────
function BimTab({ onAdd, onClose }) {
  const t = useT('integrationProject');
  const [projects, setProjects]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState(null);
  const [fetching, setFetching]   = useState(false);
  const [name, setName]           = useState('');
  const [offset, setOffset]       = useState([0, 0, 0]);

  useEffect(() => {
    AxiosCustom.get('/api/bim/projects')
      .then(r => setProjects(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (p) => {
    setSelected(p);
    setName(p.projectName);
  };

  const handleAdd = async () => {
    if (!selected) return;
    setFetching(true);
    try {
      const res = await AxiosCustom.get(`/api/bim/project/${selected.projectId}`);
      onAdd({
        id:           `s_${Date.now()}`,
        name:         name.trim() || selected.projectName,
        type:         'bim',
        bimProjectId: selected.projectId,
        elements:     res.data || [],
        offset,
        visible:      true,
      });
      onClose();
    } catch {
      alert(t('bimLoadFailed'));
    } finally {
      setFetching(false);
    }
  };

  const inputStyle = {
    background: '#0a1525', border: '1px solid #253347', color: '#e2e8f0',
    borderRadius: 6, padding: '6px 10px', fontSize: 12, outline: 'none', width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 2 }}>{t('bimSelectLabel')}</div>
      <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {loading && <div style={{ fontSize: 11, color: '#374151', padding: 8 }}>{t('bimLoading')}</div>}
        {!loading && projects.length === 0 && (
          <div style={{ fontSize: 11, color: '#374151', padding: 8 }}>{t('bimEmpty')}</div>
        )}
        {projects.map(p => (
          <button
            key={p.projectId}
            onClick={() => handleSelect(p)}
            style={{
              background: selected?.projectId === p.projectId ? '#1e3a5f' : '#0d1b2a',
              border: `1px solid ${selected?.projectId === p.projectId ? '#2a5080' : '#1e2a3a'}`,
              color: selected?.projectId === p.projectId ? '#60a5fa' : '#8896a4',
              borderRadius: 6, padding: '6px 10px', fontSize: 12,
              textAlign: 'left', cursor: 'pointer',
            }}
          >
            🏗 {p.projectName}
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div>
            <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 4 }}>{t('sceneNameLabel')}</div>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 4 }}>{t('offsetLabel')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['X', 'Y', 'Z'].map((axis, i) => (
                <div key={axis} style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 2 }}>{axis}</div>
                  <input
                    type="number" step="1"
                    style={{ ...inputStyle, width: '100%' }}
                    value={offset[i]}
                    onChange={e => {
                      const next = [...offset];
                      next[i] = parseFloat(e.target.value) || 0;
                      setOffset(next);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button onClick={onClose} style={{
          background: '#1c2a3a', border: '1px solid #253347', color: '#8896a4',
          borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer',
        }}>{t('cancel')}</button>
        <button onClick={handleAdd} disabled={!selected || fetching} style={{
          background: selected && !fetching ? '#1e3a5f' : '#111e2d',
          border: '1px solid #2a5080',
          color: selected && !fetching ? '#60a5fa' : '#374151',
          borderRadius: 7, padding: '7px 18px', fontSize: 12,
          fontWeight: 700, cursor: selected && !fetching ? 'pointer' : 'not-allowed',
        }}>
          {fetching ? t('loadingProgress') : t('addToScene')}
        </button>
      </div>
    </div>
  );
}

// ── IFC 파일 업로드 탭 ───────────────────────────────────────────
function IfcTab({ onAdd, onClose }) {
  const t = useT('integrationProject');
  const [file, setFile]       = useState(null);
  const [name, setName]       = useState('');
  const [offset, setOffset]   = useState([0, 0, 0]);
  const [phase, setPhase]     = useState('idle'); // idle | parsing | done | error
  const [progress, setProgress] = useState(0);
  const [elements, setElements] = useState(null);
  const [scale, setScale]     = useState(1);
  const [errMsg, setErrMsg]   = useState('');
  const fileRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.ifc')) { setErrMsg(t('ifcOnlySupported')); return; }
    setErrMsg('');
    setFile(f);
    if (!name) setName(f.name.replace(/\.ifc$/i, ''));
    setPhase('idle');
    setElements(null);
  };

  const handleParse = async () => {
    if (!file) return;
    setPhase('parsing');
    setProgress(0);
    setErrMsg('');
    try {
      const result = await parseIfcFile(file, setProgress, scale);
      setElements(result.elements || []);
      setPhase('done');
    } catch (e) {
      setErrMsg(t('ifcParseFailed', { msg: e?.message || String(e) }));
      setPhase('error');
    }
  };

  const handleAdd = () => {
    if (!elements) return;
    onAdd({
      id:       `s_${Date.now()}`,
      name:     name.trim() || file?.name || 'IFC',
      type:     'ifc',
      elements,
      offset,
      visible:  true,
    });
    onClose();
  };

  const inputStyle = {
    background: '#0a1525', border: '1px solid #253347', color: '#e2e8f0',
    borderRadius: 6, padding: '6px 10px', fontSize: 12, outline: 'none', width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${file ? '#22c55e' : '#253347'}`,
          borderRadius: 8, padding: '16px', textAlign: 'center',
          cursor: 'pointer', background: '#0a1525', position: 'relative',
        }}
      >
        <input ref={fileRef} type="file" accept=".ifc" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
        {file ? (
          <div style={{ fontSize: 12, color: '#22c55e' }}>✅ {file.name} ({(file.size/1024/1024).toFixed(1)} MB)</div>
        ) : (
          <div style={{ fontSize: 12, color: '#4b5563' }}>{t('ifcDropHint')}</div>
        )}
      </div>

      {file && (
        <>
          <div>
            <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 4 }}>{t('sceneNameLabel')}</div>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 4 }}>Scale Factor</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 10, 100, 1000].map(v => (
                <button key={v} onClick={() => { setScale(v); setPhase('idle'); setElements(null); }}
                  style={{
                    flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                    background: scale === v ? '#1e3a5f' : '#0d1b2a',
                    border: `1px solid ${scale === v ? '#2a5080' : '#253347'}`,
                    color: scale === v ? '#60a5fa' : '#4b5563',
                  }}>×{v}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 4 }}>{t('offsetLabel')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['X','Y','Z'].map((axis, i) => (
                <div key={axis} style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: '#4b5563', marginBottom: 2 }}>{axis}</div>
                  <input type="number" step="1" style={{ ...inputStyle, width: '100%' }}
                    value={offset[i]}
                    onChange={e => { const n=[...offset]; n[i]=parseFloat(e.target.value)||0; setOffset(n); }}
                  />
                </div>
              ))}
            </div>
          </div>

          {phase === 'parsing' && (
            <div>
              <div style={{ fontSize: 11, color: '#8896a4', marginBottom: 4 }}>
                {t('ifcParseProgress', { n: progress })}
              </div>
              <div style={{ height: 6, background: '#0d1b2a', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: '#3b82f6', transition: 'width 0.2s' }} />
              </div>
            </div>
          )}

          {phase === 'done' && elements && (
            <div style={{ fontSize: 11, color: '#22c55e', background: '#0c2a1a', padding: '6px 10px', borderRadius: 6, border: '1px solid #22c55e40' }}>
              {t('ifcDone', { n: elements.length })}
            </div>
          )}

          {errMsg && (
            <div style={{ fontSize: 11, color: '#ef4444', background: '#1a0a0a', padding: '6px 10px', borderRadius: 6 }}>
              ⚠ {errMsg}
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button onClick={onClose} style={{
          background: '#1c2a3a', border: '1px solid #253347', color: '#8896a4',
          borderRadius: 7, padding: '7px 16px', fontSize: 12, cursor: 'pointer',
        }}>{t('cancel')}</button>
        {phase !== 'done' ? (
          <button onClick={handleParse} disabled={!file || phase === 'parsing'} style={{
            background: file && phase === 'idle' ? '#0c2233' : '#111e2d',
            border: '1px solid #0ea5e9',
            color: file && phase === 'idle' ? '#38bdf8' : '#374151',
            borderRadius: 7, padding: '7px 18px', fontSize: 12, fontWeight: 700,
            cursor: file && phase === 'idle' ? 'pointer' : 'not-allowed',
          }}>
            {phase === 'parsing' ? t('ifcAnalyzing') : t('ifcAnalyze')}
          </button>
        ) : (
          <button onClick={handleAdd} style={{
            background: '#1e3a5f', border: '1px solid #2a5080', color: '#60a5fa',
            borderRadius: 7, padding: '7px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}>
            {t('addToScene')}
          </button>
        )}
      </div>
    </div>
  );
}

// ── 메인 모달 ────────────────────────────────────────────────────
export default function AddStructureModal({ onClose }) {
  const t = useT('integrationProject');
  const dispatch = useIntegrationDispatch();
  const [tab, setTab] = useState(TAB.BIM);

  const handleAdd = (structure) => {
    dispatch({ type: 'ADD_STRUCTURE', structure });
  };

  const tabBtn = (tabKey, label) => (
    <button
      onClick={() => setTab(tabKey)}
      style={{
        flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer',
        background: tab === tabKey ? '#1e3a5f' : '#0a1525',
        border: `1px solid ${tab === tabKey ? '#2a5080' : '#1e2a3a'}`,
        color: tab === tabKey ? '#60a5fa' : '#4b5563',
        borderRadius: 6,
      }}
    >{label}</button>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 14,
        padding: 24, width: 420, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', marginBottom: 16 }}>
          {t('addStructTitle')}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {tabBtn(TAB.BIM, t('tabBimProject'))}
          {tabBtn(TAB.IFC, t('tabIfcFile'))}
        </div>

        {tab === TAB.BIM
          ? <BimTab onAdd={handleAdd} onClose={onClose} />
          : <IfcTab onAdd={handleAdd} onClose={onClose} />
        }
      </div>
    </div>
  );
}
