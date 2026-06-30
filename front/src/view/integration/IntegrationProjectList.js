import { useEffect, useState } from 'react';
import AxiosCustom from '../../axios/AxiosCustom';
import { useT } from '../../i18n/LanguageContext';

// ── 생성 모달 ────────────────────────────────────────────────────
function CreateModal({ onClose, onCreate }) {
  const t = useT('integrationProject');
  const [name, setName]           = useState('');
  const [wbsId, setWbsId]         = useState('');
  const [desc, setDesc]           = useState('');
  const [wbsProjects, setWbsProjects] = useState([]);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    AxiosCustom.get('/api/wbs/projects').then(r => setWbsProjects(r.data || [])).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({ projectName: name.trim(), wbsProjectId: wbsId || null, bimProjectId: null, description: desc || null });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    width: '100%', background: '#0a1525', border: '1px solid #253347',
    color: '#e2e8f0', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none',
  };
  const labelStyle = { fontSize: 11, color: '#8896a4', marginBottom: 4, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#0d1b2a', border: '1px solid #253347', borderRadius: 14,
        padding: 28, width: 480, maxWidth: '95vw',
      }} onClick={e => e.stopPropagation()}>

        <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', marginBottom: 20 }}>
          {t('modalTitle')}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>{t('fieldName')}</label>
            <input style={inputStyle} autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder={t('namePlaceholder')} />
          </div>
          <div>
            <label style={labelStyle}>{t('fieldWbs')}</label>
            <select style={inputStyle} value={wbsId} onChange={e => setWbsId(e.target.value)}>
              <option value="">{t('linkNone')}</option>
              {wbsProjects.map(p => (
                <option key={p.projectId} value={p.projectId}>{p.projectName}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>{t('fieldDesc')}</label>
            <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
              value={desc} onChange={e => setDesc(e.target.value)}
              placeholder={t('descPlaceholder')} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: '#1c2a3a', border: '1px solid #253347', color: '#8896a4',
            borderRadius: 8, padding: '8px 18px', fontSize: 13, cursor: 'pointer',
          }}>{t('cancel')}</button>
          <button onClick={handleSubmit} disabled={!name.trim() || saving} style={{
            background: name.trim() && !saving ? '#1e3a5f' : '#111e2d',
            border: '1px solid #2a5080', color: name.trim() ? '#60a5fa' : '#374151',
            borderRadius: 8, padding: '8px 22px', fontSize: 13, fontWeight: 700,
            cursor: !name.trim() || saving ? 'not-allowed' : 'pointer',
          }}>
            {saving ? t('creating') : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 프로젝트 카드 ────────────────────────────────────────────────
function ProjectCard({ project, onSelect, onDelete }) {
  const t = useT('integrationProject');
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      background: '#0d1b2a', border: '1px solid #1e3a5f', borderRadius: 12,
      padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'border-color 0.15s',
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = '#3b82f6'}
    onMouseLeave={e => e.currentTarget.style.borderColor = '#1e3a5f'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>🔗</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: '#e2e8f0',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {project.projectName}
          </div>
          {project.description && (
            <div style={{
              fontSize: 11, color: '#4b5563', marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {project.description}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {project.wbsProjectId ? (
          <span style={{ fontSize: 10, color: '#a78bfa', background: '#1a1a3a', borderRadius: 4, padding: '2px 8px', border: '1px solid #2a2a5f' }}>
            {t('wbsLinked')}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#374151', background: 'none', borderRadius: 4, padding: '2px 8px', border: '1px solid #1e2a3a' }}>
            {t('wbsNone')}
          </span>
        )}
      </div>

      {project.createdAt && (
        <div style={{ fontSize: 10, color: '#374151' }}>
          {project.createdAt?.slice(0, 10)}
        </div>
      )}

      {confirmDelete ? (
        <div>
          <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 6 }}>{t('deleteConfirm')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => onDelete(project.projectId)} style={{
              flex: 1, background: '#7f1d1d', border: '1px solid #ef4444',
              color: '#fff', borderRadius: 7, padding: '6px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>{t('delete')}</button>
            <button onClick={() => setConfirmDelete(false)} style={{
              flex: 1, background: '#1c2a3a', border: '1px solid #253347',
              color: '#8896a4', borderRadius: 7, padding: '6px 0', fontSize: 12, cursor: 'pointer',
            }}>{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button onClick={() => onSelect(project)} style={{
            flex: 1, background: '#1e3a5f', border: '1px solid #2a5080',
            color: '#60a5fa', borderRadius: 8, padding: '8px 0', fontSize: 12,
            fontWeight: 700, cursor: 'pointer',
          }}>
            {t('open')}
          </button>
          <button onClick={() => setConfirmDelete(true)} style={{
            width: 34, background: '#1a0f0f', border: '1px solid #3d1515',
            color: '#ef4444', borderRadius: 8, fontSize: 14, cursor: 'pointer',
          }}>✕</button>
        </div>
      )}
    </div>
  );
}

// ── 메인 ────────────────────────────────────────────────────────
export default function IntegrationProjectList({ setViceComponent, onProjectSelect }) {
  const t = useT('integrationProject');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch]     = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await AxiosCustom.get('/api/integration/projects');
      setProjects(res.data || []);
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  const handleCreate = async (body) => {
    await AxiosCustom.post('/api/integration/project', body);
    await loadProjects();
  };

  const handleDelete = async (projectId) => {
    await AxiosCustom.delete(`/api/integration/project/${projectId}`);
    setProjects(prev => prev.filter(p => p.projectId !== projectId));
  };

  const handleSelect = (project) => {
    onProjectSelect(project);
    setViceComponent('integration');
  };

  const filtered = projects.filter(p =>
    p.projectName?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '32px 24px', maxWidth: 1020, margin: '0 auto' }}>

      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'stretch' : 'flex-start',
        justifyContent: 'space-between',
        gap: isMobile ? 10 : 16,
        marginBottom: 20,
      }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#e2e8f0', marginBottom: 0 }}>
            {t('pageTitle')}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: isMobile ? 1 : 0 }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            style={{
              background: '#1c2a3a', border: '1px solid #253347', color: '#e2e8f0',
              borderRadius: 8, padding: '7px 12px', fontSize: 13, outline: 'none',
              flex: isMobile ? 1 : 'none',
              width: isMobile ? '100%' : 140,
            }}
          />
          <button onClick={() => setShowCreate(true)} style={{
            background: '#1e3a5f', border: '1px solid #2a5080', color: '#60a5fa',
            borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}>
            {t('newProject')}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#1a1010', border: '1px solid #3d1515', borderRadius: 10,
          padding: '10px 16px', marginBottom: 20,
        }}>
          <span style={{ fontSize: 14 }}>⚠</span>
          <span style={{ flex: 1, fontSize: 12, color: '#f87171' }}>{error}</span>
          <button onClick={loadProjects} style={{
            background: 'none', border: '1px solid #374151', color: '#9ca3af',
            borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
          }}>{t('retry')}</button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#4b5563' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔗</div>
          <div style={{ fontSize: 13 }}>{t('loading')}</div>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          textAlign: 'center', color: '#4b5563', padding: '60px 0',
          border: '1px dashed #1e3a5f', borderRadius: 12,
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
          <div style={{ fontSize: 14 }}>
            {search ? t('noResults', { search }) : t('empty')}
          </div>
          {!search && (
            <button onClick={() => setShowCreate(true)} style={{
              marginTop: 16, background: '#1e3a5f', border: '1px solid #2a5080',
              color: '#60a5fa', borderRadius: 8, padding: '8px 20px', fontSize: 13,
              fontWeight: 700, cursor: 'pointer',
            }}>
              {t('createFirst')}
            </button>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {filtered.map(p => (
            <ProjectCard key={p.projectId} project={p} onSelect={handleSelect} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />
      )}
    </div>
  );
}
