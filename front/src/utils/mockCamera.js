// Canvas-based fake camera stream for development/testing without a physical camera.
// Simulates a concrete wall with animated cracks on a ~22s cycle.

function jaggedLine(x1, y1, x2, y2, segments) {
  const pts = [{ x: x1, y: y1 }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const j = (Math.random() - 0.5) * 22;
    pts.push({ x: x1 + (x2 - x1) * t + j, y: y1 + (y2 - y1) * t + j * 0.35 });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

function drawPolyline(ctx, pts, count) {
  if (!pts || pts.length < 2) return;
  const n = Math.max(2, Math.ceil(pts.length * count));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export function createMockCameraStream(width = 640, height = 480) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Generate crack paths once per session (slightly random each time)
  const CRACK_A = jaggedLine(width * 0.29, height * 0.11, width * 0.31, height * 0.79, 12);
  const CRACK_B = jaggedLine(width * 0.57, height * 0.17, width * 0.60, height * 0.73, 10);
  const CRACK_C = jaggedLine(width * 0.14, height * 0.43, width * 0.56, height * 0.51, 8);
  const STATIC  = jaggedLine(width * 0.68, height * 0.29, width * 0.71, height * 0.56, 7);

  let rafId = null;
  let startTime = null;
  const PERIOD = 22; // seconds per cycle

  function draw(ts) {
    if (!startTime) startTime = ts;
    const elapsed = (ts - startTime) / 1000;
    const phase = (elapsed % PERIOD) / PERIOD; // 0–1

    // Crack severity: 0→1→0 smoothly over 15%-85% of period
    const severity = (phase < 0.15 || phase > 0.85)
      ? 0
      : Math.sin(((phase - 0.15) / 0.70) * Math.PI); // half-sine, 0→1→0

    // ── Concrete wall background ──
    const wallGrad = ctx.createLinearGradient(0, 0, 0, height);
    wallGrad.addColorStop(0, '#4b4b43');
    wallGrad.addColorStop(0.55, '#5e5e54');
    wallGrad.addColorStop(1, '#3f3f38');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, width, height);

    // Form-line seams
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    for (let y = 90; y < height; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // Surface noise (sparse, cheap)
    for (let i = 0; i < 80; i++) {
      const nx = Math.random() * width;
      const ny = Math.random() * height;
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},255,255,0.018)`;
      ctx.fillRect(nx, ny, Math.random() * 2 + 0.5, Math.random() * 2 + 0.5);
    }

    // ── Static hairline crack (always present) ──
    ctx.save();
    ctx.strokeStyle = 'rgba(18,9,0,0.38)';
    ctx.lineWidth = 0.9;
    drawPolyline(ctx, STATIC, 1);
    ctx.restore();

    // ── Dynamic cracks (based on severity) ──
    if (severity > 0.05) {
      const drawCrack = (path, alpha, lenFrac) => {
        ctx.save();
        ctx.strokeStyle = `rgba(10,4,0,${alpha * 0.45})`;
        ctx.lineWidth = 3.8;
        drawPolyline(ctx, path, lenFrac);
        ctx.strokeStyle = `rgba(14,6,0,${alpha})`;
        ctx.lineWidth = 1.6;
        drawPolyline(ctx, path, lenFrac);
        ctx.restore();
      };

      if (severity > 0.08) drawCrack(CRACK_A, Math.min(severity * 1.15, 0.95), Math.min(severity * 1.2, 1));
      if (severity > 0.32) drawCrack(CRACK_B, Math.min(severity * 0.90, 0.85), Math.min(severity * 1.1, 1));
      if (severity > 0.58) drawCrack(CRACK_C, Math.min(severity * 0.78, 0.75), Math.min(severity, 1));

      if (severity > 0.67) {
        ctx.fillStyle = `rgba(255,35,0,${(severity - 0.67) * 0.11})`;
        ctx.fillRect(0, 0, width, height);
      }
    }

    // ── Measurement grid overlay ──
    ctx.strokeStyle = 'rgba(0,200,120,0.10)';
    ctx.lineWidth = 0.5;
    for (let x = 60; x < width; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 60; y < height; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // ── HUD overlays ──
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ko-KR', { hour12: false });

    // Timestamp + DEMO badge
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(8, 8, 210, 22);
    ctx.fillStyle = '#00e896';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`■ DEMO  ${timeStr}`, 13, 24);

    // REC indicator (blink every 0.5s)
    if (Math.floor(elapsed * 2) % 2 === 0) {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(width - 18, 18, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('REC', width - 52, 23);
    }

    // Corner brackets
    const L = 18;
    ctx.strokeStyle = 'rgba(0,230,140,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // TL
    ctx.moveTo(8, 8 + L); ctx.lineTo(8, 8); ctx.lineTo(8 + L, 8);
    // TR
    ctx.moveTo(width - 8 - L, 8); ctx.lineTo(width - 8, 8); ctx.lineTo(width - 8, 8 + L);
    // BL
    ctx.moveTo(8, height - 8 - L); ctx.lineTo(8, height - 8); ctx.lineTo(8 + L, height - 8);
    // BR
    ctx.moveTo(width - 8 - L, height - 8); ctx.lineTo(width - 8, height - 8); ctx.lineTo(width - 8, height - 8 - L);
    ctx.stroke();

    // Bottom label
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(8, height - 26, 260, 18);
    ctx.fillStyle = 'rgba(210,210,210,0.8)';
    ctx.font = '9.5px monospace';
    ctx.fillText('CAM-01  구조물 균열 점검 (데모)', 12, height - 12);

    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);
  const stream = canvas.captureStream(30);

  return {
    stream,
    stop: () => { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } },
  };
}
