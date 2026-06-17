import { useState, useEffect, useRef } from 'react';
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps';
import AxiosCustom from '../../axios/AxiosCustom';

const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

const FLAG_BASE = 'https://flagcdn.com/16x12/';

function dotRadius(count) {
  return Math.min(4 + Math.log2(Math.max(count, 1)) * 2.5, 16);
}

export default function WorldAccessMap() {
  const [visitors, setVisitors]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [hovered, setHovered]     = useState(null);
  const [mousePos, setMousePos]   = useState({ x: 0, y: 0 });
  const wrapperRef                = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await AxiosCustom.get('/api/system/geo-visitors');
        setVisitors(res.data || []);
        setError(null);
      } catch (e) {
        setError('지오 데이터 로드 실패: ' + (e.message || ''));
      } finally {
        setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const handleMouseMove = (e) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8 });
  };

  const plotted  = visitors.filter(v => v.lat != null && v.lon != null && v.countryCode !== '--');
  const localIps = visitors.filter(v => v.countryCode === '--');
  const unknowns = visitors.filter(v => v.lat == null || v.lon == null);
  const topList  = [...visitors].sort((a, b) => (b.count || 0) - (a.count || 0));

  return (
    <div>
      {/* 지도 */}
      <div
        ref={wrapperRef}
        style={{ position: 'relative', borderRadius: 10, overflow: 'hidden',
                 border: '1px solid #1e3a5f', background: '#060e1a' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                        justifyContent: 'center', color: '#4b5563', fontSize: 12, zIndex: 1 }}>
            IP 위치 조회 중...
          </div>
        )}

        <ComposableMap
          projection="geoNaturalEarth1"
          projectionConfig={{ scale: 145, center: [10, 15] }}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map(geo => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#0d1b2a"
                  stroke="#1a3050"
                  strokeWidth={0.4}
                  style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                />
              ))
            }
          </Geographies>

          {plotted.map((v, i) => (
            <Marker key={i} coordinates={[v.lon, v.lat]}>
              <circle
                r={dotRadius(v.count)}
                fill={hovered?.ip === v.ip ? '#f59e0b' : '#3b82f6'}
                fillOpacity={0.8}
                stroke={hovered?.ip === v.ip ? '#fbbf24' : '#60a5fa'}
                strokeWidth={1}
                style={{ cursor: 'pointer', transition: 'fill 0.15s' }}
                onMouseEnter={() => setHovered(v)}
                onMouseLeave={() => setHovered(null)}
              />
            </Marker>
          ))}
        </ComposableMap>

        {/* 플로팅 툴팁 */}
        {hovered && (
          <div style={{
            position: 'absolute',
            left: Math.min(mousePos.x, (wrapperRef.current?.clientWidth ?? 600) - 180),
            top: mousePos.y,
            pointerEvents: 'none',
            background: '#0a1525', border: '1px solid #2a5080',
            borderRadius: 8, padding: '8px 12px', fontSize: 11,
            color: '#e2e8f0', zIndex: 10, minWidth: 160,
            boxShadow: '0 4px 12px #000a',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              {hovered.countryCode && hovered.countryCode !== '--' && (
                <img
                  src={`${FLAG_BASE}${hovered.countryCode.toLowerCase()}.png`}
                  alt=""
                  style={{ width: 16, height: 12, borderRadius: 2 }}
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 12 }}>{hovered.ip}</span>
            </div>
            {hovered.city && (
              <div style={{ color: '#93c5fd' }}>{hovered.city}{hovered.regionName ? `, ${hovered.regionName}` : ''}</div>
            )}
            {hovered.country && <div style={{ color: '#6b7280', fontSize: 10 }}>{hovered.country}</div>}
            <div style={{ marginTop: 5, color: '#4b5563' }}>
              요청 <span style={{ color: '#fbbf24', fontWeight: 700 }}>{hovered.count}</span>회
            </div>
          </div>
        )}

        {/* 요약 배지 */}
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          display: 'flex', gap: 6, flexWrap: 'wrap',
        }}>
          <span style={badgeStyle('#1a3a5c', '#60a5fa')}>위치 특정 {plotted.length}개</span>
          {localIps.length > 0 && <span style={badgeStyle('#1a2a1a', '#4ade80')}>로컬 {localIps.length}개</span>}
          {unknowns.length > 0 && <span style={badgeStyle('#2a1a1a', '#ef4444')}>미확인 {unknowns.length}개</span>}
        </div>
      </div>

      {/* 접속자 목록 */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, color: '#4b5563', marginBottom: 8 }}>
          전체 {visitors.length}개 IP — 최근 접속 순
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {topList.map((v, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#0a1525', borderRadius: 7, padding: '7px 12px',
              border: '1px solid #111f30', fontSize: 11,
            }}>
              {/* 국기 */}
              <div style={{ width: 20, flexShrink: 0 }}>
                {v.countryCode && v.countryCode !== '--' ? (
                  <img
                    src={`${FLAG_BASE}${v.countryCode.toLowerCase()}.png`}
                    alt={v.country || ''}
                    style={{ width: 16, height: 12, borderRadius: 2 }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <span style={{ color: '#374151', fontSize: 13 }}>🖥</span>
                )}
              </div>

              {/* IP */}
              <span style={{ color: '#60a5fa', fontFamily: 'monospace', minWidth: 110 }}>{v.ip}</span>

              {/* 위치 */}
              <span style={{ color: '#6b7280', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.city ? `${v.city}, ${v.country}` : (v.country || '위치 미확인')}
              </span>

              {/* 요청 수 */}
              <span style={{
                color: '#fbbf24', fontWeight: 700,
                background: '#1a150a', borderRadius: 4, padding: '2px 7px',
              }}>{v.count}회</span>

              {/* 마지막 URI */}
              <span style={{
                color: v.lastStatus >= 400 ? '#ef4444' : '#374151',
                fontSize: 10, maxWidth: 130, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {v.lastStatus && <span style={{ marginRight: 3 }}>{v.lastStatus}</span>}
                {v.lastUri}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function badgeStyle(bg, color) {
  return {
    fontSize: 10, color, background: bg,
    borderRadius: 5, padding: '2px 7px',
    border: `1px solid ${color}33`,
  };
}
