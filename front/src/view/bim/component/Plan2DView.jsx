import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';

// 다크 테마 요소 타입별 2D 도면 스타일
const TYPE_CFG = {
  IfcColumn: { fill: '#3c3c3c', stroke: '#c8c8c8', label: '기둥', lw: 1.5, dash: [] },
  IfcBeam:   { fill: '#2e2e2e', stroke: '#909090', label: '보',   lw: 1.0, dash: [5, 3] },
  IfcWall:   { fill: '#363636', stroke: '#aaaaaa', label: '벽',   lw: 1.5, dash: [] },
  IfcSlab:   { fill: '#262626', stroke: '#686868', label: '슬래브', lw: 0.8, dash: [3, 3] },
  IfcPier:   { fill: '#404040', stroke: '#b8b8b8', label: '교각', lw: 1.5, dash: [] },
};
const DEFAULT_CFG = { fill: '#2a2a2a', stroke: '#808080', label: '?', lw: 1.0, dash: [] };

const SNAP_THRESHOLD_PX = 18;

function toCanvas(wx, wz, vp) {
  return [vp.x + wx * vp.scale, vp.y - wz * vp.scale];
}
function fromCanvas(cx, cy, vp) {
  return [(cx - vp.x) / vp.scale, -(cy - vp.y) / vp.scale];
}

function fitViewport(modelData, canvasW, canvasH) {
  if (!modelData.length) return { x: canvasW / 2, y: canvasH / 2, scale: 20 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const el of modelData) {
    const px = Number(el.positionX) || 0;
    const pz = Number(el.positionZ) || 0;
    const hx = (Number(el.sizeX) || 1) / 2;
    const hz = (Number(el.sizeZ) || 1) / 2;
    minX = Math.min(minX, px - hx); maxX = Math.max(maxX, px + hx);
    minZ = Math.min(minZ, pz - hz); maxZ = Math.max(maxZ, pz + hz);
  }
  const spanX = (maxX - minX) || 10;
  const spanZ = (maxZ - minZ) || 10;
  const pad = 0.12;
  const scale = Math.max(4, Math.min(80,
    Math.min(canvasW * (1 - pad * 2) / spanX, canvasH * (1 - pad * 2) / spanZ)
  ));
  return {
    x: canvasW / 2 - ((minX + maxX) / 2) * scale,
    y: canvasH / 2 + ((minZ + maxZ) / 2) * scale,
    scale,
  };
}

// 요소의 꼭짓점 4개 + 중간점 4개 + 중심 1개 (세계 XZ 좌표)
function getElementSnapPoints(el) {
  const px  = Number(el.positionX) || 0;
  const pz  = Number(el.positionZ) || 0;
  const hx  = (Number(el.sizeX) || 0.1) / 2;
  const hz  = (Number(el.sizeZ) || 0.1) / 2;
  const ry  = Number(el.rotationY) || 0;
  const cos = Math.cos(-ry), sin = Math.sin(-ry);
  const rot = (x, z) => [px + x * cos - z * sin, pz + x * sin + z * cos];
  return [
    rot(-hx, -hz), rot(hx, -hz), rot(hx, hz), rot(-hx, hz), // corners
    rot(0, -hz),   rot(hx, 0),   rot(0, hz),  rot(-hx, 0),  // midpoints
    [px, pz],                                                  // center
  ];
}

function findNearestSnap(wx, wz, snapPoints, thresholdPx, scale) {
  const thr = thresholdPx / scale;
  let nearest = null, minDist = thr;
  for (const pt of snapPoints) {
    const d = Math.hypot(wx - pt[0], wz - pt[1]);
    if (d < minDist) { minDist = d; nearest = pt; }
  }
  return nearest;
}

export default function Plan2DView({
  modelData, lines = [], selectedElement, onElementSelect,
  lineDrawMode = 'off', lineStart = null,
  pendingElement = null, onLineClick, onPlacementConfirm,
  snapEnabled = true,
}) {
  const canvasRef = useRef(null);
  const vpRef     = useRef({ x: 0, y: 0, scale: 20 });
  const dragRef   = useRef({ active: false, lx: 0, ly: 0, moved: false });
  const fittedRef = useRef(false);
  const mouseRef  = useRef({ cx: -9999, cy: -9999 });
  const snapRef   = useRef(null);

  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick(t => t + 1), []);

  // 전체 스냅 포인트 목록
  const allSnapPoints = useMemo(
    () => modelData.flatMap(getElementSnapPoints),
    [modelData]
  );

  // ── 그리기 ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const vp = vpRef.current;
    const { cx: mx, cy: my } = mouseRef.current;
    const si = snapRef.current; // 현재 스냅 포인트

    // ── 배경 ──────────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, W, H);

    // ── 격자 ──────────────────────────────────────────────────────
    const gs = vp.scale;
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let gx = ((vp.x % gs) + gs) % gs; gx < W; gx += gs) {
      ctx.moveTo(gx, 0); ctx.lineTo(gx, H);
    }
    for (let gy = ((vp.y % gs) + gs) % gs; gy < H; gy += gs) {
      ctx.moveTo(0, gy); ctx.lineTo(W, gy);
    }
    ctx.stroke();

    // ── 원점 축 ──────────────────────────────────────────────────
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(vp.x, 0); ctx.lineTo(vp.x, H);
    ctx.moveTo(0, vp.y); ctx.lineTo(W, vp.y);
    ctx.stroke();
    ctx.fillStyle = '#444';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';  ctx.fillText('+X', vp.x + 6, H - 6);
    ctx.textAlign = 'right'; ctx.fillText('-Z', W - 4, vp.y - 4);

    // ── 선 (lines) ────────────────────────────────────────────────
    for (const line of lines) {
      let pts = [];
      if (line.pointsJson) {
        try { pts = typeof line.pointsJson === 'string' ? JSON.parse(line.pointsJson) : line.pointsJson; }
        catch (_) { pts = [line.start, line.end]; }
      } else { pts = [line.start, line.end]; }
      if (!pts.length) continue;
      ctx.save();
      ctx.strokeStyle = line.color ?? '#60a5fa';
      ctx.lineWidth = Math.max(0.5, (line.lineWidth ?? 2) * 0.5);
      ctx.setLineDash([]);
      ctx.beginPath();
      const [s0x, s0y] = toCanvas(pts[0][0], pts[0][2], vp);
      ctx.moveTo(s0x, s0y);
      for (let i = 1; i < pts.length; i++) {
        const [ex, ey] = toCanvas(pts[i][0], pts[i][2], vp);
        ctx.lineTo(ex, ey);
      }
      if (line.closed) ctx.closePath();
      ctx.stroke();
      for (const pt of pts) {
        const [ppx, ppy] = toCanvas(pt[0], pt[2], vp);
        ctx.beginPath(); ctx.arc(ppx, ppy, 3, 0, Math.PI * 2);
        ctx.fillStyle = line.color ?? '#60a5fa'; ctx.fill();
      }
      ctx.restore();
    }

    // ── 부재 ─────────────────────────────────────────────────────
    const selId = selectedElement?.data?.elementId;
    for (const el of modelData) {
      const cfg   = TYPE_CFG[el.elementType] ?? DEFAULT_CFG;
      const isSel = el.elementId === selId;
      const epx   = Number(el.positionX) || 0;
      const epz   = Number(el.positionZ) || 0;
      const esx   = Math.max(0.05, Number(el.sizeX) || 0.1);
      const esz   = Math.max(0.05, Number(el.sizeZ) || 0.1);
      const ry    = Number(el.rotationY) || 0;
      const [cx2, cy2] = toCanvas(epx, epz, vp);
      const w = esx * vp.scale, h = esz * vp.scale;

      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.rotate(-ry);

      if (el.elementType === 'IfcSlab') {
        ctx.fillStyle = isSel ? '#0e2840' : cfg.fill;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 0.5; ctx.setLineDash([4, 4]);
        ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = isSel ? '#0c2238' : cfg.fill;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }

      ctx.strokeStyle = isSel ? '#00d4ff' : cfg.stroke;
      ctx.lineWidth   = isSel ? 2.5 : cfg.lw;
      ctx.setLineDash(isSel ? [] : cfg.dash);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.setLineDash([]);

      if (el.elementType === 'IfcColumn' && w > 6 && h > 6) {
        ctx.strokeStyle = isSel ? '#00d4ff' : '#555';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2);
        ctx.moveTo(w / 2, -h / 2);  ctx.lineTo(-w / 2, h / 2);
        ctx.stroke();
      }
      if (w > 24 && h > 12) {
        ctx.fillStyle = isSel ? '#7ecfff' : '#777';
        ctx.font = `${Math.min(11, w * 0.25, h * 0.4)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.label, 0, 0);
      }
      ctx.restore();

      // ── 선택된 부재: 꼭짓점(■) + 중간점(●) + 중심(+) ────────────
      if (isSel) {
        const spts    = getElementSnapPoints(el);
        const corners = spts.slice(0, 4);
        const mids    = spts.slice(4, 8);
        const center  = spts[8];

        for (const [wx2, wz2] of corners) {
          const [cpx, cpy] = toCanvas(wx2, wz2, vp);
          const s = 5;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1.2;
          ctx.fillRect(cpx - s / 2, cpy - s / 2, s, s);
          ctx.strokeRect(cpx - s / 2, cpy - s / 2, s, s);
        }
        for (const [wx2, wz2] of mids) {
          const [cpx, cpy] = toCanvas(wx2, wz2, vp);
          ctx.beginPath(); ctx.arc(cpx, cpy, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#00d4ff'; ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
        }
        const [cpx, cpy] = toCanvas(center[0], center[1], vp);
        ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cpx - 5, cpy); ctx.lineTo(cpx + 5, cpy);
        ctx.moveTo(cpx, cpy - 5); ctx.lineTo(cpx, cpy + 5);
        ctx.stroke();
      }
    }

    // ── 선 작도 미리보기 ─────────────────────────────────────────
    if (lineDrawMode === 'click' && lineStart && mx > -9000) {
      const [s0, s1] = toCanvas(lineStart[0], lineStart[2], vp);
      let tx = mx, ty = my;
      if (snapEnabled && si) { [tx, ty] = toCanvas(si.wx, si.wz, vp); }
      ctx.save();
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(s0, s1); ctx.lineTo(tx, ty);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(s0, s1, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#60a5fa'; ctx.fill();
      ctx.restore();
    }

    // ── 배치 고스트 ─────────────────────────────────────────────
    if (pendingElement && mx > -9000) {
      let gwx = (mx - vp.x) / vp.scale;
      let gwz = -(my - vp.y) / vp.scale;
      if (snapEnabled && si) { gwx = si.wx; gwz = si.wz; }
      const [gx, gy] = toCanvas(gwx, gwz, vp);
      const gw = (Number(pendingElement.sizeX) || 1) * vp.scale;
      const gh = (Number(pendingElement.sizeZ) || 1) * vp.scale;
      ctx.save();
      ctx.translate(gx, gy);
      ctx.fillStyle = 'rgba(0,212,255,0.12)';
      ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.fillRect(-gw / 2, -gh / 2, gw, gh);
      ctx.strokeRect(-gw / 2, -gh / 2, gw, gh);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── 스냅 인디케이터 ──────────────────────────────────────────
    if (si && snapEnabled) {
      const [cpx, cpy] = toCanvas(si.wx, si.wz, vp);
      ctx.save();
      ctx.beginPath(); ctx.arc(cpx, cpy, 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.beginPath(); ctx.arc(cpx, cpy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd700'; ctx.fill();
      ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cpx - 15, cpy); ctx.lineTo(cpx + 15, cpy);
      ctx.moveTo(cpx, cpy - 15); ctx.lineTo(cpx, cpy + 15);
      ctx.stroke();
      ctx.restore();
    }

    // ── 스케일 바 ─────────────────────────────────────────────────
    const barM  = vp.scale >= 10 ? 10 : vp.scale >= 4 ? 5 : 1;
    const barPx = barM * vp.scale;
    const bx = 20, by = H - 28;
    ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(bx, by);              ctx.lineTo(bx + barPx, by);
    ctx.moveTo(bx, by - 5);         ctx.lineTo(bx, by + 5);
    ctx.moveTo(bx + barPx, by - 5); ctx.lineTo(bx + barPx, by + 5);
    ctx.stroke();
    ctx.fillStyle = '#aaa'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${barM}m`, bx + barPx / 2, by - 9);

    // ── 범례 ──────────────────────────────────────────────────────
    let lx = 20, ly = H - 14;
    for (const [, cfg] of Object.entries(TYPE_CFG)) {
      ctx.fillStyle = cfg.fill; ctx.strokeStyle = cfg.stroke; ctx.lineWidth = 1;
      ctx.fillRect(lx, ly, 12, 12); ctx.strokeRect(lx, ly, 12, 12);
      ctx.fillStyle = '#aaa'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(cfg.label, lx + 14, ly + 9);
      lx += 42;
    }
  }, [modelData, lines, selectedElement, lineDrawMode, lineStart, pendingElement, snapEnabled]);

  // ── 초기 fit ──────────────────────────────────────────────────────
  // 데이터가 완전히 비워질 때(프로젝트 전환)만 재fit 허용.
  // 부재 추가/수정 시에는 fittedRef를 유지해 뷰가 점프하지 않도록 함.
  useEffect(() => {
    if (modelData.length === 0) fittedRef.current = false;
  }, [modelData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !modelData.length || fittedRef.current) return;
    vpRef.current = fitViewport(modelData, canvas.width || canvas.offsetWidth, canvas.height || canvas.offsetHeight);
    fittedRef.current = true;
    redraw();
  }, [modelData, redraw]);

  // ── 캔버스 크기 동기화 ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      draw();
    });
    ro.observe(canvas);
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // ── 휠 줌 ─────────────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const vp = vpRef.current;
    const newScale = Math.max(2, Math.min(200, vp.scale * factor));
    const ratio = newScale / vp.scale;
    vpRef.current = { scale: newScale, x: mx + (vp.x - mx) * ratio, y: my + (vp.y - my) * ratio };
    // 줌 후 스냅 재계산
    if (snapEnabled) {
      const [wx, wz] = fromCanvas(mx, my, vpRef.current);
      const snap = findNearestSnap(wx, wz, allSnapPoints, SNAP_THRESHOLD_PX, vpRef.current.scale);
      snapRef.current = snap ? { wx: snap[0], wz: snap[1] } : null;
    }
    draw();
  }, [draw, snapEnabled, allSnapPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── 포인터 이벤트 ─────────────────────────────────────────────────
  const handlePointerDown = useCallback((e) => {
    // 부재 배치 · 선 작도 모드에서는 드래그(패닝) 비활성화
    if (pendingElement || lineDrawMode === 'click') {
      dragRef.current = { active: false, lx: e.clientX, ly: e.clientY, moved: false };
      return;
    }
    dragRef.current = { active: true, lx: e.clientX, ly: e.clientY, moved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
  }, [pendingElement, lineDrawMode]);

  const handlePointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    mouseRef.current = { cx, cy };

    // 패닝
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lx;
      const dy = e.clientY - dragRef.current.ly;
      dragRef.current.lx = e.clientX;
      dragRef.current.ly = e.clientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      vpRef.current = { ...vpRef.current, x: vpRef.current.x + dx, y: vpRef.current.y + dy };
    }

    // 스냅 인디케이터 갱신
    if (snapEnabled) {
      const [wx, wz] = fromCanvas(cx, cy, vpRef.current);
      const snap = findNearestSnap(wx, wz, allSnapPoints, SNAP_THRESHOLD_PX, vpRef.current.scale);
      snapRef.current = snap ? { wx: snap[0], wz: snap[1] } : null;
    } else {
      snapRef.current = null;
    }

    draw();
  }, [draw, snapEnabled, allSnapPoints]);

  const handlePointerUp = useCallback(() => {
    dragRef.current.active = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
  }, []);

  const handlePointerLeave = useCallback(() => {
    dragRef.current.active = false;
    mouseRef.current = { cx: -9999, cy: -9999 };
    snapRef.current = null;
    draw();
  }, [draw]);

  // ── 클릭: 선 작도 / 배치 / 선택 ──────────────────────────────────
  const handleClick = useCallback((e) => {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const vp = vpRef.current;
    let [wx, wz] = fromCanvas(cx, cy, vp);

    // 스냅 적용
    if (snapEnabled && snapRef.current) {
      wx = snapRef.current.wx;
      wz = snapRef.current.wz;
    }

    // 선 작도 모드
    if (lineDrawMode === 'click' && onLineClick) {
      onLineClick({ x: wx, z: wz });
      return;
    }

    // 부재 배치 모드
    if (pendingElement && onPlacementConfirm) {
      onPlacementConfirm({ x: wx, z: wz });
      return;
    }

    // 일반 선택
    if (!onElementSelect) return;
    for (const el of [...modelData].reverse()) {
      const px = Number(el.positionX) || 0;
      const pz = Number(el.positionZ) || 0;
      const hx = (Number(el.sizeX) || 0.1) / 2;
      const hz = (Number(el.sizeZ) || 0.1) / 2;
      if (wx >= px - hx && wx <= px + hx && wz >= pz - hz && wz <= pz + hz) {
        onElementSelect(el, null, false);
        return;
      }
    }
    onElementSelect(null, null, false);
  }, [modelData, onElementSelect, lineDrawMode, onLineClick, pendingElement, onPlacementConfirm, snapEnabled]);

  // ── 전체보기 ──────────────────────────────────────────────────────
  const handleFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    vpRef.current = fitViewport(modelData, canvas.width, canvas.height);
    draw();
  }, [modelData, draw]);

  const isActionMode = lineDrawMode === 'click' || !!pendingElement;

  const hintText = isActionMode
    ? lineDrawMode === 'click'
      ? `선 작도 — ${lineStart ? '두 번째 점 클릭' : '첫 번째 점 클릭'}${snapEnabled ? '  🧲 스냅 ON' : ''}`
      : `부재 배치 — 클릭하여 배치${snapEnabled ? '  🧲 스냅 ON' : ''}`
    : '2D 평면도 — 휠: 확대/축소  |  드래그: 이동  |  클릭: 선택';

  return (
    <div className="relative w-full h-full select-none" style={{ background: '#0f0f0f' }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ cursor: 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      />

      <div className="absolute top-3 left-3 bg-black/75 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-400 shadow pointer-events-none">
        {hintText}
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-2">
        <div className="bg-black/75 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-400 shadow">
          부재 {modelData.length}개
        </div>
        <button
          onClick={handleFit}
          className="bg-black/75 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 shadow transition"
          title="전체 뷰로 맞추기"
        >
          ⊞ 전체보기
        </button>
      </div>

      {selectedElement?.data && (
        <div className="absolute bottom-14 left-3 bg-black/80 border border-cyan-900/60 rounded-lg px-3 py-1.5 text-xs text-gray-300 shadow">
          <span className="text-cyan-400 font-semibold">{selectedElement.data.elementType?.replace('Ifc', '')}</span>
          <span className="ml-2 text-gray-500">{selectedElement.data.elementId}</span>
          {selectedElement.data.material && (
            <span className="ml-2 text-gray-500">{selectedElement.data.material}</span>
          )}
          <span className="ml-2 text-gray-600 text-xs">■ 꼭짓점  ● 중간점  + 중심</span>
        </div>
      )}
    </div>
  );
}
