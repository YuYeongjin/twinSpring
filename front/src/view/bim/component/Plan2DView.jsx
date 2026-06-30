import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useT } from '../../../i18n/LanguageContext';

// 다크 테마 요소 타입별 2D 도면 스타일
const TYPE_CFG = {
  IfcColumn: { fill: '#3c3c3c', stroke: '#c8c8c8', label: 'column', lw: 1.5, dash: [] },
  IfcBeam:   { fill: '#2e2e2e', stroke: '#909090', label: 'beam',   lw: 1.0, dash: [5, 3] },
  IfcWall:   { fill: '#363636', stroke: '#aaaaaa', label: 'wall',   lw: 1.5, dash: [] },
  IfcSlab:   { fill: '#262626', stroke: '#686868', label: 'slab', lw: 0.8, dash: [3, 3] },
  IfcPier:   { fill: '#404040', stroke: '#b8b8b8', label: 'pier', lw: 1.5, dash: [] },
};
const DEFAULT_CFG = { fill: '#2a2a2a', stroke: '#808080', label: '?', lw: 1.0, dash: [] };

const SNAP_THRESHOLD_PX = 18;
const LINE_HIT_PX = 7;    // 선 클릭 허용 반경 (픽셀)
const VERTEX_HIT_PX = 14; // 꼭짓점 드래그 감지 반경 (픽셀)

/** 점 (px,pz) → 선분 (ax,az)-(bx,bz) 최단 거리 (세계 좌표) */
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** line 데이터에서 꼭짓점 배열 추출 */
function getLinePoints2D(line) {
  if (line.pointsJson) {
    try {
      const p = typeof line.pointsJson === 'string' ? JSON.parse(line.pointsJson) : line.pointsJson;
      if (Array.isArray(p) && p.length >= 2) return p;
    } catch (_) {}
  }
  return [line.start, line.end];
}

function toCanvas(wx, wz, vp) {
  return [vp.x + wx * vp.scale, vp.y - wz * vp.scale];
}
function fromCanvas(cx, cy, vp) {
  return [(cx - vp.x) / vp.scale, -(cy - vp.y) / vp.scale];
}

// 좌표 규칙: positionX/Y = 평면(2D), positionZ = 높이(3D)
// 2D 캔버스: 가로=dataX, 세로=dataY
function fitViewport(modelData, canvasW, canvasH) {
  if (!modelData.length) return { x: canvasW / 2, y: canvasH / 2, scale: 20 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const el of modelData) {
    const px = Number(el.positionX) || 0;
    const pz = Number(el.positionY) || 0;   // floor Y → canvas vertical
    const hx = (Number(el.sizeX) || 1) / 2;
    const hz = (Number(el.sizeY) || 1) / 2; // floor Y size
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

// 요소의 꼭짓점 4개 + 중간점 4개 + 중심 1개 (세계 XY 좌표, 2D floor plane)
function getElementSnapPoints(el) {
  const px  = Number(el.positionX) || 0;
  const pz  = Number(el.positionY) || 0;   // floor Y → canvas vertical
  const hx  = (Number(el.sizeX) || 0.1) / 2;
  const hz  = (Number(el.sizeY) || 0.1) / 2;  // floor Y size
  const ry  = Number(el.rotationY) || 0;   // plan rotation (around height axis)
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
  isSelectMode = false, onRubberBandSelect,
  selectedElements = new Set(),
  selectedLineId = null, onLineSelect = null,
  onLineVertexUpdate = null, onLineVertexSave = null,
  onHoverPosition = null,
  placementLockedAxes = null,
  lineLockedAxes = null,
}) {
  const t = useT('bimDashboard');
  const canvasRef  = useRef(null);
  const vpRef      = useRef({ x: 0, y: 0, scale: 20 });
  const dragRef    = useRef({ active: false, lx: 0, ly: 0, moved: false });
  const rubberRef  = useRef({ active: false, startX: 0, startY: 0, endX: 0, endY: 0 });
  const fittedRef  = useRef(false);
  const mouseRef   = useRef({ cx: -9999, cy: -9999 });
  const snapRef    = useRef(null);
  // { active, lineId, vtxIdx, pts } — 꼭짓점 드래그 상태
  const vertexDragRef = useRef({ active: false, lineId: null, vtxIdx: -1, pts: null });

  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick(t => t + 1), []);

  // 전체 스냅 포인트 목록 (부재 꼭짓점 + 선 끝점) — 2D canvas XY 좌표
  const allSnapPoints = useMemo(() => {
    const pts = modelData.flatMap(getElementSnapPoints);
    for (const line of lines) {
      const lpts = getLinePoints2D(line);
      lpts.forEach(p => pts.push([p[0], p[1] ?? 0]));  // dataX, dataY(floor)
    }
    return pts;
  }, [modelData, lines]);

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
    ctx.textAlign = 'right'; ctx.fillText('-Y', W - 4, vp.y - 4);

    // ── 선 (lines) — 데이터: [dataX, dataY(floor), dataZ(height)]
    for (const line of lines) {
      const pts = getLinePoints2D(line);
      if (!pts.length) continue;
      const isSel = line.lineId === selectedLineId;
      ctx.save();
      ctx.strokeStyle = isSel ? '#00e5ff' : (line.color ?? '#60a5fa');
      ctx.lineWidth = Math.max(0.5, (line.lineWidth ?? 2) * 0.5) + (isSel ? 1.5 : 0);
      ctx.setLineDash([]);
      ctx.beginPath();
      const [s0x, s0y] = toCanvas(pts[0][0], pts[0][1] ?? 0, vp);  // dataX, dataY
      ctx.moveTo(s0x, s0y);
      for (let i = 1; i < pts.length; i++) {
        const [ex, ey] = toCanvas(pts[i][0], pts[i][1] ?? 0, vp);   // dataX, dataY
        ctx.lineTo(ex, ey);
      }
      if (line.closed) ctx.closePath();
      ctx.stroke();
      const vtxR = isSel ? 5 : 3;
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const [ppx, ppy] = toCanvas(pt[0], pt[1] ?? 0, vp);  // dataX, dataY
        ctx.beginPath(); ctx.arc(ppx, ppy, vtxR, 0, Math.PI * 2);
        if (isSel) {
          const vtxColor = i === 0 ? '#4ade80'
            : i === pts.length - 1 ? '#f87171'
            : '#00e5ff';
          ctx.fillStyle = vtxColor; ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
        } else {
          ctx.fillStyle = line.color ?? '#60a5fa'; ctx.fill();
        }
      }
      ctx.restore();
    }

    // ── 부재 ─────────────────────────────────────────────────────
    const selId = selectedElement?.data?.elementId;
    for (const el of modelData) {
      const cfg        = TYPE_CFG[el.elementType] ?? DEFAULT_CFG;
      const isSel      = el.elementId === selId;
      const isMultiSel = !isSel && selectedElements.has(el.elementId);
      const epx   = Number(el.positionX) || 0;
      const epz   = Number(el.positionY) || 0;   // floor Y → canvas vertical
      const esx   = Math.max(0.05, Number(el.sizeX) || 0.1);
      const esz   = Math.max(0.05, Number(el.sizeY) || 0.1);  // floor Y size
      const ry    = Number(el.rotationY) || 0;   // plan rotation
      const [cx2, cy2] = toCanvas(epx, epz, vp);
      const w = esx * vp.scale, h = esz * vp.scale;

      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.rotate(-ry);

      // ── fill / stroke ─────────────────────────────────────────
      if (el.elementType === 'IfcSlab') {
        // Slab: resolvedColor(절토/성토 레이어 색상) 우선, 없으면 기본 fill
        const slabColor = el.resolvedColor || cfg.fill;
        if (isSel) {
          ctx.fillStyle = '#0e2840';
        } else if (isMultiSel) {
          ctx.fillStyle = '#1a0b36';
        } else {
          // 절토/성토 색상은 반투명하게 채움
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = slabColor;
        }
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.globalAlpha = 1;
        // 외곽선
        ctx.strokeStyle = isSel ? '#00d4ff' : isMultiSel ? '#7c3aed' : slabColor;
        ctx.lineWidth = isSel ? 2 : isMultiSel ? 1 : 1.2;
        ctx.setLineDash(isMultiSel ? [] : []);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);
      } else {
        // 비-Slab: 외곽선(line) 형태만 — 채움 없음
        if (isMultiSel) {
          ctx.fillStyle = 'rgba(124,58,237,0.12)';
          ctx.fillRect(-w / 2, -h / 2, w, h);
        }
        // 외곽선 전용 (fill 없음)
        ctx.strokeStyle = isSel ? '#00d4ff' : isMultiSel ? '#a78bfa' : cfg.stroke;
        ctx.lineWidth   = isSel ? 2.5 : isMultiSel ? 2 : cfg.lw;
        ctx.setLineDash(cfg.dash);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);

        if (el.elementType === 'IfcColumn' && w > 6 && h > 6) {
          ctx.strokeStyle = isSel ? '#00d4ff' : isMultiSel ? '#a78bfa' : '#555';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, h / 2);
          ctx.moveTo(w / 2, -h / 2);  ctx.lineTo(-w / 2, h / 2);
          ctx.stroke();
        }
      }

      if (w > 24 && h > 12) {
        ctx.fillStyle = isSel ? '#7ecfff' : isMultiSel ? '#c4b5fd' : '#777';
        ctx.font = `${Math.min(11, w * 0.25, h * 0.4)}px monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg.label, 0, 0);
      }
      ctx.restore();

      // ── 단일 선택: 꼭짓점(■) + 중간점(●) + 중심(+) ──────────
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

      // ── 다중 선택: 꼭짓점(◆) 마커 ───────────────────────────
      if (isMultiSel) {
        const corners = getElementSnapPoints(el).slice(0, 4);
        for (const [wx2, wz2] of corners) {
          const [cpx, cpy] = toCanvas(wx2, wz2, vp);
          const s = 4;
          ctx.fillStyle = '#a78bfa';
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8;
          ctx.fillRect(cpx - s / 2, cpy - s / 2, s, s);
          ctx.strokeRect(cpx - s / 2, cpy - s / 2, s, s);
        }
      }
    }

    // ── locked 축 가이드라인 ──────────────────────────────────────
    const activeLocked = lineDrawMode === 'click' ? lineLockedAxes
                       : pendingElement ? placementLockedAxes : null;
    if (activeLocked) {
      ctx.save();
      ctx.strokeStyle = 'rgba(251,191,36,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      if (activeLocked.x != null) {
        const [gx] = toCanvas(activeLocked.x, 0, vp);
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
      if (activeLocked.z != null) {
        const [, gz] = toCanvas(0, activeLocked.z, vp);
        ctx.beginPath(); ctx.moveTo(0, gz); ctx.lineTo(W, gz); ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ── 선 작도 미리보기 ─────────────────────────────────────────
    if (lineDrawMode === 'click' && lineStart && mx > -9000) {
      const [s0, s1] = toCanvas(lineStart[0], lineStart[1] ?? 0, vp);  // dataX, dataY
      let ewx = si ? si.wx : (mx - vp.x) / vp.scale;
      let ewz = si ? si.wz : -(my - vp.y) / vp.scale;
      if (lineLockedAxes?.x != null) ewx = lineLockedAxes.x;
      if (lineLockedAxes?.z != null) ewz = lineLockedAxes.z;
      const [tx, ty] = toCanvas(ewx, ewz, vp);
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
      let gwx = si ? si.wx : (mx - vp.x) / vp.scale;
      let gwz = si ? si.wz : -(my - vp.y) / vp.scale;
      if (placementLockedAxes?.x != null) gwx = placementLockedAxes.x;
      if (placementLockedAxes?.z != null) gwz = placementLockedAxes.z;
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

    // ── 러버밴드 선택 박스 (선택 모드) ───────────────────────────
    if (isSelectMode && rubberRef.current.active) {
      const { startX, startY, endX, endY } = rubberRef.current;
      const rx = Math.min(startX, endX);
      const ry2 = Math.min(startY, endY);
      const rw = Math.abs(endX - startX);
      const rh = Math.abs(endY - startY);
      ctx.save();
      ctx.fillStyle = 'rgba(139,92,246,0.12)';
      ctx.fillRect(rx, ry2, rw, rh);
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(rx, ry2, rw, rh);
      ctx.setLineDash([]);
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
    for (const [type, cfg] of Object.entries(TYPE_CFG)) {
      if (type === 'IfcSlab') {
        // Slab: 반투명 채움 + 외곽선
        ctx.fillStyle = cfg.fill; ctx.globalAlpha = 0.35;
        ctx.fillRect(lx, ly, 12, 12); ctx.globalAlpha = 1;
        ctx.strokeStyle = cfg.stroke; ctx.lineWidth = 1.2;
        ctx.strokeRect(lx, ly, 12, 12);
      } else {
        // 비-Slab: 외곽선만
        ctx.strokeStyle = cfg.stroke; ctx.lineWidth = 1.2;
        ctx.setLineDash(cfg.dash);
        ctx.strokeRect(lx, ly, 12, 12);
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#aaa'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(cfg.label, lx + 14, ly + 9);
      lx += 42;
    }
  }, [modelData, lines, selectedElement, selectedElements, lineDrawMode, lineStart, pendingElement, snapEnabled, isSelectMode, selectedLineId, placementLockedAxes, lineLockedAxes]);

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
    // 줌 후 스냅 재계산 (배치 / 선 작도 모드에서만)
    if (snapEnabled && (lineDrawMode === 'click' || !!pendingElement)) {
      const [wx, wz] = fromCanvas(mx, my, vpRef.current);
      const snap = findNearestSnap(wx, wz, allSnapPoints, SNAP_THRESHOLD_PX, vpRef.current.scale);
      snapRef.current = snap ? { wx: snap[0], wz: snap[1] } : null;
    } else {
      snapRef.current = null;
    }
    draw();
  }, [draw, snapEnabled, allSnapPoints, lineDrawMode, pendingElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // ── 포인터 이벤트 ─────────────────────────────────────────────────
  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    // 선택 모드: rubber band 시작 (패닝 비활성화)
    if (isSelectMode) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // 캔버스 밖으로 드래그해도 이벤트 유지
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      rubberRef.current = { active: true, startX: cx, startY: cy, endX: cx, endY: cy, justCompleted: false };
      dragRef.current = { active: false, lx: 0, ly: 0, moved: false };
      return;
    }
    // 부재 배치 · 선 작도 모드에서는 드래그(패닝) 비활성화
    if (pendingElement || lineDrawMode === 'click') {
      dragRef.current = { active: false, lx: e.clientX, ly: e.clientY, moved: false };
      return;
    }

    // ── 선택된 선의 꼭짓점 드래그 감지 ──────────────────────────────
    if (selectedLineId) {
      const canvas2 = canvasRef.current;
      if (canvas2) {
        const rect2 = canvas2.getBoundingClientRect();
        const cx2 = e.clientX - rect2.left;
        const cy2 = e.clientY - rect2.top;
        const vp = vpRef.current;
        const [wx, wz] = fromCanvas(cx2, cy2, vp);
        const vtxHitThr = VERTEX_HIT_PX / vp.scale;
        const selLine = lines.find(l => l.lineId === selectedLineId);
        if (selLine) {
          const pts = getLinePoints2D(selLine);
          for (let i = 0; i < pts.length; i++) {
            if (Math.hypot(wx - pts[i][0], wz - (pts[i][1] ?? 0)) <= vtxHitThr) {
              // 꼭짓점 드래그 시작
              vertexDragRef.current = {
                active: true,
                lineId: selectedLineId,
                vtxIdx: i,
                pts: pts.map(p => [...p]), // 깊은 복사
              };
              dragRef.current = { active: false, lx: 0, ly: 0, moved: false };
              return; // 패닝 비활성화
            }
          }
        }
      }
    }

    dragRef.current = { active: true, lx: e.clientX, ly: e.clientY, moved: false };
    if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
  }, [isSelectMode, pendingElement, lineDrawMode, selectedLineId, lines]);

  const handlePointerMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    mouseRef.current = { cx, cy };

    // rubber band 업데이트
    if (isSelectMode && rubberRef.current.active && (e.buttons & 1)) {
      rubberRef.current.endX = cx;
      rubberRef.current.endY = cy;
      draw();
      return;
    }

    // ── 꼭짓점 드래그 중 ──────────────────────────────────────────
    if (vertexDragRef.current.active) {
      const [wx, wz] = fromCanvas(cx, cy, vpRef.current);
      const { lineId, vtxIdx, pts } = vertexDragRef.current;
      pts[vtxIdx][0] = wx;
      pts[vtxIdx][1] = wz;   // dataY (floor Y) at index 1
      dragRef.current.moved = true; // 드래그 완료 후 click 이벤트 억제
      onLineVertexUpdate?.(lineId, {
        pointsJson: JSON.stringify(pts),
        start: pts[0],
        end: pts[pts.length - 1],
      });
      if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
      draw();
      return;
    }

    // ── 선택된 선의 꼭짓점 위에 있을 때 커서 변경 ────────────────
    if (selectedLineId && !dragRef.current.active) {
      const [wx, wz] = fromCanvas(cx, cy, vpRef.current);
      const vtxHitThr = VERTEX_HIT_PX / vpRef.current.scale;
      const selLine = lines.find(l => l.lineId === selectedLineId);
      if (selLine) {
        const pts = getLinePoints2D(selLine);
        const nearVtx = pts.some(p => Math.hypot(wx - p[0], wz - (p[1] ?? 0)) <= vtxHitThr);
        if (canvasRef.current) canvasRef.current.style.cursor = nearVtx ? 'grab' : 'crosshair';
      }
    }

    // 패닝
    if (dragRef.current.active) {
      const dx = e.clientX - dragRef.current.lx;
      const dy = e.clientY - dragRef.current.ly;
      dragRef.current.lx = e.clientX;
      dragRef.current.ly = e.clientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
      vpRef.current = { ...vpRef.current, x: vpRef.current.x + dx, y: vpRef.current.y + dy };
    }

    // 스냅 · locked 축 · Shift 직교 통합 계산
    if (lineDrawMode === 'click' || !!pendingElement) {
      const [wx, wz] = fromCanvas(cx, cy, vpRef.current);
      let sx = wx, sz = wz;

      // 1. 스냅
      if (snapEnabled) {
        const snap = findNearestSnap(wx, wz, allSnapPoints, SNAP_THRESHOLD_PX, vpRef.current.scale);
        if (snap) { sx = snap[0]; sz = snap[1]; }
      }

      // 2. Locked 축 — 2D에서 x=dataX, y=dataY (z는 항상 0)
      const la = lineDrawMode === 'click' ? lineLockedAxes : placementLockedAxes;
      if (la?.x != null) sx = la.x;
      if (la?.y != null) sz = la.y;  // data Y locked → canvas vertical

      // 3. Shift 직교 제약 (locked 없는 자유 축에만 적용)
      if (e.shiftKey) {
        if (lineDrawMode === 'click' && lineStart) {
          const dx = sx - lineStart[0], dz = sz - (lineStart[1] ?? 0);  // lineStart[1]=dataY
          if (la?.x == null && la?.y == null) {
            if (Math.abs(dx) >= Math.abs(dz)) sz = lineStart[1] ?? 0;
            else sx = lineStart[0];
          }
        } else if (pendingElement) {
          if (la?.x == null) sx = Math.round(sx * 2) / 2;
          if (la?.y == null) sz = Math.round(sz * 2) / 2;
        }
      }

      snapRef.current = { wx: sx, wz: sz };
      onHoverPosition?.({ x: sx, y: sz, z: 0 });  // data coords: x=dataX, y=dataY, z=0
    } else {
      snapRef.current = null;
    }

    draw();
  }, [draw, isSelectMode, snapEnabled, allSnapPoints, lineDrawMode, lineStart, pendingElement, selectedLineId, lines, onLineVertexUpdate, lineLockedAxes, placementLockedAxes, onHoverPosition]);

  const handlePointerUp = useCallback(() => {
    // ── 꼭짓점 드래그 완료 → 서버 저장 ──────────────────────────
    if (vertexDragRef.current.active) {
      const { lineId, pts } = vertexDragRef.current;
      vertexDragRef.current = { active: false, lineId: null, vtxIdx: -1, pts: null };
      onLineVertexSave?.(lineId, pts);
      if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
      draw();
      return;
    }

    // rubber band 완료 → 2D 선택 계산
    if (isSelectMode && rubberRef.current.active) {
      rubberRef.current.active = false;
      const { startX, startY, endX, endY } = rubberRef.current;
      const dx = Math.abs(endX - startX), dy = Math.abs(endY - startY);
      if (dx > 5 && dy > 5 && onRubberBandSelect) {
        const vp = vpRef.current;
        const [wx1, wz1] = fromCanvas(Math.min(startX, endX), Math.min(startY, endY), vp);
        const [wx2, wz2] = fromCanvas(Math.max(startX, endX), Math.max(startY, endY), vp);
        const selMinX = Math.min(wx1, wx2), selMaxX = Math.max(wx1, wx2);
        const selMinZ = Math.min(wz1, wz2), selMaxZ = Math.max(wz1, wz2);

        const hit = modelData.filter(el => {
          const px = Number(el.positionX) || 0;
          const pz = Number(el.positionY) || 0;  // floor Y
          const hx = (Number(el.sizeX) || 0.1) / 2;
          const hz = (Number(el.sizeY) || 0.1) / 2;  // floor Y size
          const ry = Number(el.rotationY) || 0;
          const cos = Math.cos(-ry), sin = Math.sin(-ry);
          // 4 꼭짓점을 회전 적용해 world XY(floor)로 변환 후 AABB 계산
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const [ox, oz] of [[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]]) {
            const wx = px + ox * cos - oz * sin;
            const wz = pz + ox * sin + oz * cos;
            if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
            if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
          }
          return maxX >= selMinX && minX <= selMaxX && maxZ >= selMinZ && minZ <= selMaxZ;
        }).map(el => el.elementId);

        rubberRef.current.justCompleted = true; // handleClick이 선택 해제하지 않도록
        onRubberBandSelect(hit);
      }
      draw();
      return;
    }
    dragRef.current.active = false;
    if (canvasRef.current) canvasRef.current.style.cursor = 'crosshair';
  }, [isSelectMode, modelData, onRubberBandSelect, draw, onLineVertexSave]);

  const handlePointerLeave = useCallback(() => {
    // 꼭짓점 드래그 중 이탈 → 저장 (손 떼기와 동일)
    if (vertexDragRef.current.active) {
      const { lineId, pts } = vertexDragRef.current;
      vertexDragRef.current = { active: false, lineId: null, vtxIdx: -1, pts: null };
      onLineVertexSave?.(lineId, pts);
    }
    dragRef.current.active = false;
    mouseRef.current = { cx: -9999, cy: -9999 };
    snapRef.current = null;
    draw();
  }, [draw, onLineVertexSave]);

  // ── 클릭: 선 작도 / 배치 / 선택 ──────────────────────────────────
  const handleClick = useCallback((e) => {
    if (dragRef.current.moved) { dragRef.current.moved = false; return; }

    // rubber band 완료 직후의 click 이벤트는 무시 (선택 해제 방지)
    if (isSelectMode && rubberRef.current.justCompleted) {
      rubberRef.current.justCompleted = false;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const vp = vpRef.current;
    let [wx, wz] = fromCanvas(cx, cy, vp);

    // snapRef에는 스냅·locked·shift가 모두 반영된 최종 좌표가 들어있음
    if (snapRef.current) {
      wx = snapRef.current.wx;
      wz = snapRef.current.wz;
    } else {
      // 마우스가 캔버스 밖 등 snapRef가 없을 경우 직접 적용
      const la = lineDrawMode === 'click' ? lineLockedAxes : placementLockedAxes;
      if (la?.x != null) wx = la.x;
      if (la?.y != null) wz = la.y;  // data Y
      if (e.shiftKey) {
        if (lineDrawMode === 'click' && lineStart) {
          const dx = wx - lineStart[0], dz = wz - (lineStart[1] ?? 0);
          if (Math.abs(dx) >= Math.abs(dz)) wz = lineStart[1] ?? 0;
          else wx = lineStart[0];
        } else if (pendingElement) {
          wx = Math.round(wx * 2) / 2;
          wz = Math.round(wz * 2) / 2;
        }
      }
    }

    // 선 작도 모드 — data coords: { x: dataX, y: dataY }
    if (lineDrawMode === 'click' && onLineClick) {
      onLineClick({ x: wx, y: wz });
      return;
    }

    // 부재 배치 모드 — data coords: { x: dataX, y: dataY }
    if (pendingElement && onPlacementConfirm) {
      onPlacementConfirm({ x: wx, y: wz });
      return;
    }

    // ── 선 클릭 감지 ─────────────────────────────────────────────
    if (onLineSelect) {
      const hitThr = LINE_HIT_PX / vp.scale;
      for (const line of [...lines].reverse()) {
        const pts = getLinePoints2D(line);
        let hit = false;
        for (let i = 0; i < pts.length - 1 && !hit; i++) {
          if (distToSegment(wx, wz, pts[i][0], pts[i][1] ?? 0, pts[i+1][0], pts[i+1][1] ?? 0) <= hitThr) {
            hit = true;
          }
        }
        if (!hit && line.closed && pts.length >= 3) {
          if (distToSegment(wx, wz, pts[pts.length-1][0], pts[pts.length-1][1] ?? 0, pts[0][0], pts[0][1] ?? 0) <= hitThr) {
            hit = true;
          }
        }
        if (hit) {
          onLineSelect(line.lineId);
          if (onElementSelect) onElementSelect(null, null, false);
          return;
        }
      }
    }

    // ── 부재 클릭 감지 ───────────────────────────────────────────
    if (!onElementSelect) {
      if (!isSelectMode) onLineSelect?.(null);
      return;
    }
    for (const el of [...modelData].reverse()) {
      const px = Number(el.positionX) || 0;
      const pz = Number(el.positionY) || 0;  // floor Y
      const hx = (Number(el.sizeX) || 0.1) / 2;
      const hz = (Number(el.sizeY) || 0.1) / 2;  // floor Y size
      if (wx >= px - hx && wx <= px + hx && wz >= pz - hz && wz <= pz + hz) {
        onLineSelect?.(null);
        onElementSelect(el, null, false);
        return;
      }
    }
    // 빈 공간 클릭 → 모두 해제 (select mode에서는 유지)
    if (!isSelectMode) {
      onLineSelect?.(null);
      onElementSelect(null, null, false);
    }
  }, [isSelectMode, modelData, lines, onElementSelect, onLineSelect, lineDrawMode, onLineClick, pendingElement, onPlacementConfirm, lineLockedAxes, lineStart, placementLockedAxes]);

  // ── 전체보기 ──────────────────────────────────────────────────────
  const handleFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    vpRef.current = fitViewport(modelData, canvas.width, canvas.height);
    draw();
  }, [modelData, draw]);

  const isActionMode = lineDrawMode === 'click' || !!pendingElement;

  const hintText = isSelectMode
    ? t('plan2dSelectMode')
    : isActionMode
      ? lineDrawMode === 'click'
        ? `${lineStart ? t('plan2dLineDrawSecond') : t('plan2dLineDrawFirst')}${snapEnabled ? `  🧲 ${t('plan2dSnapOn')}` : ''}`
        : `${t('plan2dMemberPlace')}${snapEnabled ? `  🧲 ${t('plan2dSnapOn')}` : ''}`
      : '2D floor plan — Wheel: Zoom | Drag: Move | Click: Select';

  return (
    <div className="relative w-full h-full select-none" style={{ background: '#0f0f0f' }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ cursor: isSelectMode ? 'crosshair' : 'crosshair' }}
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
          {t('plan2dMemberCount', { n: modelData.length })}
        </div>
        <button
          onClick={handleFit}
          className="bg-black/75 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 shadow transition"
          title={t('plan2dFitAll')}
        >
          ⊞ {t('plan2dViewAll')}
        </button>
      </div>

      {selectedElement?.data && (
        <div className="absolute bottom-14 left-3 bg-black/80 border border-cyan-900/60 rounded-lg px-3 py-1.5 text-xs text-gray-300 shadow">
          <span className="text-cyan-400 font-semibold">{selectedElement.data.elementType?.replace('Ifc', '')}</span>
          <span className="ml-2 text-gray-500">{selectedElement.data.elementId}</span>
          {selectedElement.data.material && (
            <span className="ml-2 text-gray-500">{selectedElement.data.material}</span>
          )}
          <span className="ml-2 text-gray-600 text-xs">{t('plan2dSnapLegend')}</span>
        </div>
      )}
    </div>
  );
}
