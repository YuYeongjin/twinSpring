import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import * as THREE from 'three';

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPE_KOR = {
  IfcColumn: 'Column', IfcBeam: 'Beam', IfcWall: 'Wall', IfcSlab: 'Slab', IfcPier: 'Pier',
};

// BimElement.jsx의 getBaseColor와 동일
const BASE_COLORS = {
  IfcColumn: '#8B4513',
  IfcBeam:   '#A9A9A9',
  IfcMember: '#A9A9A9',
  IfcWall:   '#E0E0E0',
  IfcSlab:   '#B0C4DE',
  IfcPier:   '#D2691E',
};

function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function fmt(v, d = 3) {
  const n = Number(v);
  return isNaN(n) ? '0.000' : n.toFixed(d);
}

// ── Scene info calculation (includes Y-axis correction) ──────────────────────
function computeSceneInfo(elements) {
  if (!elements.length) return { center: { x: 0, y: 0, z: 0 }, size: 10 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const el of elements) {
    const px = Number(el.positionX) || 0;
    const pz = Number(el.positionZ) || 0;
    const sx = Math.max(Number(el.sizeX) || 0.1, 0.05);
    const sy = Math.max(Number(el.sizeY) || 0.1, 0.05);
    const sz = Math.max(Number(el.sizeZ) || 0.1, 0.05);
    // Y는 bottom 기준이므로 center = positionY + sizeY/2
    const py = (Number(el.positionY) || 0) + sy / 2;
    minX = Math.min(minX, px - sx / 2); maxX = Math.max(maxX, px + sx / 2);
    minY = Math.min(minY, py - sy / 2); maxY = Math.max(maxY, py + sy / 2);
    minZ = Math.min(minZ, pz - sz / 2); maxZ = Math.max(maxZ, pz + sz / 2);
  }
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    size: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1),
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}

// ── Three.js offscreen scene setup ───────────────────────────────────────────
function buildScene(elements) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111827);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(8, 15, 8);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xaabbff, 0.4);
  fill.position.set(-6, -4, -6);
  scene.add(fill);

  for (const el of elements) {
    const sx = Math.max(Number(el.sizeX) || 0.1, 0.05);
    const sy = Math.max(Number(el.sizeY) || 0.1, 0.05);
    const sz = Math.max(Number(el.sizeZ) || 0.1, 0.05);
    const px = Number(el.positionX) || 0;
    const py = (Number(el.positionY) || 0) + sy / 2;   // bottom → center
    const pz = Number(el.positionZ) || 0;
    const rx = THREE.MathUtils.degToRad(Number(el.rotationX) || 0);
    const ry = THREE.MathUtils.degToRad(Number(el.rotationY) || 0);
    const rz = THREE.MathUtils.degToRad(Number(el.rotationZ) || 0);

    const hex = el.resolvedColor || BASE_COLORS[el.elementType] || '#888888';
    const color = new THREE.Color(hex);

    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, ry, rz);
    scene.add(mesh);

    // 외곽선
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 1 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    mesh.add(edges);
  }

  return scene;
}

// ── Multi-angle screenshot capture ───────────────────────────────────────────
async function captureViews(elements) {
  const { center, size } = computeSceneInfo(elements);
  const cx = center.x, cy = center.y, cz = center.z;
  const d = size * 2.4;

  const W = 800, H = 600;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(W, H);
  renderer.setPixelRatio(1);

  // Must attach canvas to DOM briefly for WebGL context creation in some browsers
  renderer.domElement.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
  document.body.appendChild(renderer.domElement);

  const scene = buildScene(elements);

  const ASPECT = W / H;
  const half   = size * 0.62;

  // Orthographic camera for plan view
  const orthoCamera = new THREE.OrthographicCamera(
    -half * ASPECT, half * ASPECT, half, -half, 0.01, 100000
  );
  // Perspective camera (front / side / perspective)
  const persCamera = new THREE.PerspectiveCamera(45, ASPECT, 0.01, 100000);

  const viewDefs = [
    {
      label: 'Plan View (TOP)',
      render() {
        orthoCamera.position.set(cx, cy + d, cz);
        orthoCamera.up.set(0, 0, -1);
        orthoCamera.lookAt(cx, cy, cz);
        renderer.render(scene, orthoCamera);
      },
    },
    {
      label: 'Front View (FRONT)',
      render() {
        persCamera.position.set(cx, cy + size * 0.15, cz + d);
        persCamera.up.set(0, 1, 0);
        persCamera.lookAt(cx, cy, cz);
        persCamera.updateProjectionMatrix();
        renderer.render(scene, persCamera);
      },
    },
    {
      label: 'Longitudinal Section (LONGITUDINAL)',
      render() {
        persCamera.position.set(cx + d, cy + size * 0.15, cz);
        persCamera.up.set(0, 1, 0);
        persCamera.lookAt(cx, cy, cz);
        persCamera.updateProjectionMatrix();
        renderer.render(scene, persCamera);
      },
    },
    {
      label: 'Cross Section (CROSS)',
      render() {
        persCamera.position.set(cx - d * 0.5, cy + size * 0.5, cz + d * 0.5);
        persCamera.up.set(0, 1, 0);
        persCamera.lookAt(cx, cy, cz);
        persCamera.updateProjectionMatrix();
        renderer.render(scene, persCamera);
      },
    },
    {
      label: 'Perspective View (PERSPECTIVE)',
      render() {
        persCamera.position.set(cx + d * 0.65, cy + d * 0.55, cz + d * 0.65);
        persCamera.up.set(0, 1, 0);
        persCamera.lookAt(cx, cy, cz);
        persCamera.updateProjectionMatrix();
        renderer.render(scene, persCamera);
      },
    },
  ];

  const results = {};
  for (const v of viewDefs) {
    v.render();
    results[v.label] = renderer.domElement.toDataURL('image/png');
  }

  // 정리
  document.body.removeChild(renderer.domElement);
  scene.traverse(obj => {
    obj.geometry?.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => m.dispose());
    }
  });
  renderer.dispose();

  return results;
}

// ── 수량산출서 HTML 생성 ──────────────────────────────────────────────────────
function buildQuantityHtml(elements, projectName) {
  // 타입별 집계
  const typeMap = {};
  for (const el of elements) {
    const type = el.elementType;
    if (!typeMap[type]) typeMap[type] = { count: 0, vol: 0, materials: new Set(), sizes: [] };
    const sx = Number(el.sizeX) || 0, sy = Number(el.sizeY) || 0, sz = Number(el.sizeZ) || 0;
    typeMap[type].count++;
    typeMap[type].vol += sx * sy * sz;
    if (el.material) typeMap[type].materials.add(el.material);
    typeMap[type].sizes.push([sx, sy, sz]);
  }

  // 타입별 대표 규격 (가장 많이 등장하는 크기)
  function representativeSpec(sizes) {
    const key = sizes.map(s => s.map(v => v.toFixed(2)).join('×'));
    const freq = {};
    key.forEach(k => { freq[k] = (freq[k] || 0) + 1; });
    return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
  }

  const totalVol = Object.values(typeMap).reduce((s, t) => s + t.vol, 0);

  const summaryRows = Object.entries(typeMap).map(([type, info], i) => `
    <tr style="background:${i % 2 === 0 ? '#162032' : '#1c2a3a'}">
      <td style="${TD}">${TYPE_KOR[type] || type}</td>
      <td style="${TD}">${type}</td>
      <td style="${TD};text-align:center;color:#60a5fa;font-weight:600">${info.count}</td>
      <td style="${TD}">${[...info.materials].join(', ') || '-'}</td>
      <td style="${TD};font-family:monospace">${representativeSpec(info.sizes)} m</td>
      <td style="${TD};text-align:right;color:#34d399">${info.vol.toFixed(3)}</td>
      <td style="${TD};text-align:right;color:#94a3b8">${((info.vol / totalVol) * 100 || 0).toFixed(1)}%</td>
    </tr>`).join('');

  // 부재 상세 목록 (최대 40개)
  const detailRows = elements.slice(0, 40).map((el, i) => {
    const sx = Number(el.sizeX) || 0, sy = Number(el.sizeY) || 0, sz = Number(el.sizeZ) || 0;
    const vol = sx * sy * sz;
    const section = sx * sz;
    return `
    <tr style="background:${i % 2 === 0 ? '#162032' : '#1c2a3a'}">
      <td style="${TD_SM};color:#64748b">${i + 1}</td>
      <td style="${TD_SM}">${TYPE_KOR[el.elementType] || el.elementType}</td>
      <td style="${TD_SM};color:#94a3b8;font-size:9px">${el.elementId?.slice(-10) || '-'}</td>
      <td style="${TD_SM}">${el.material || '-'}</td>
      <td style="${TD_SM};font-family:monospace;font-size:9px">${fmt(sx,2)}×${fmt(sy,2)}×${fmt(sz,2)}</td>
      <td style="${TD_SM};text-align:right">${fmt(section)}</td>
      <td style="${TD_SM};text-align:right;color:#34d399">${fmt(vol)}</td>
      <td style="${TD_SM};text-align:right;color:#94a3b8">${fmt(el.positionX,2)}</td>
      <td style="${TD_SM};text-align:right;color:#94a3b8">${fmt(el.positionY,2)}</td>
      <td style="${TD_SM};text-align:right;color:#94a3b8">${fmt(el.positionZ,2)}</td>
    </tr>`;
  }).join('');

  return `
    <div style="width:780px;background:#0d1b2a;color:#e2e8f0;font-family:sans-serif;padding:36px;box-sizing:border-box">

      <div style="display:flex;justify-content:space-between;align-items:flex-end;
                  border-bottom:2px solid #2a5080;padding-bottom:14px;margin-bottom:22px">
        <div>
          <div style="font-size:20px;font-weight:700;color:#60a5fa;letter-spacing:1px">BIM Quantity Report</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:5px">
            Project: <b style="color:#e2e8f0">${projectName}</b>
          </div>
        </div>
        <div style="text-align:right;font-size:11px;color:#64748b">
          <div>Date: ${new Date().toLocaleDateString('en-US')}</div>
          <div>Total Members: <b style="color:#60a5fa">${elements.length}</b></div>
        </div>
      </div>

      <!-- KPI 카드 -->
      <div style="display:flex;gap:12px;margin-bottom:22px">
        ${Object.entries(typeMap).map(([t, info]) => `
          <div style="flex:1;background:#162032;border:1px solid #2a5080;border-radius:10px;
                      padding:10px 14px;border-left:3px solid ${BASE_COLORS[t] || '#60a5fa'}">
            <div style="font-size:10px;color:#64748b">${TYPE_KOR[t] || t}</div>
            <div style="font-size:22px;font-weight:700;color:#60a5fa">${info.count}</div>
            <div style="font-size:10px;color:#94a3b8">${info.vol.toFixed(2)} m³</div>
          </div>`).join('')}
        <div style="flex:1;background:#162032;border:1px solid #2a5080;border-radius:10px;
                    padding:10px 14px;border-left:3px solid #34d399">
          <div style="font-size:10px;color:#64748b">Total Volume</div>
          <div style="font-size:22px;font-weight:700;color:#34d399">${totalVol.toFixed(2)}</div>
          <div style="font-size:10px;color:#94a3b8">m³</div>
        </div>
      </div>

      <!-- 타입별 요약 표 -->
      <div style="margin-bottom:22px">
        <div style="${SECTION_TITLE}">▌ Quantity Summary by Type</div>
        <table style="${TABLE}">
          <thead>
            <tr style="${TH_ROW}">
              <th style="${TH}">Component</th>
              <th style="${TH}">Type Code</th>
              <th style="${TH}">Qty (EA)</th>
              <th style="${TH}">Material</th>
              <th style="${TH}">Typical Size (W×H×D)</th>
              <th style="${TH}">Total Vol (m³)</th>
              <th style="${TH}">Ratio</th>
            </tr>
          </thead>
          <tbody>${summaryRows}</tbody>
          <tfoot>
            <tr style="background:#1e3a5f;font-weight:700">
              <td colspan="2" style="${TD};color:#93c5fd">Total</td>
              <td style="${TD};text-align:center;color:#60a5fa">${elements.length}</td>
              <td style="${TD}">-</td>
              <td style="${TD}">-</td>
              <td style="${TD};text-align:right;color:#34d399">${totalVol.toFixed(3)}</td>
              <td style="${TD};text-align:right;color:#94a3b8">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- 부재 상세 목록 -->
      <div>
        <div style="${SECTION_TITLE}">▌ Member Detail List${elements.length > 40 ? ` (Top 40 / Total ${elements.length})` : ''}</div>
        <table style="${TABLE}">
          <thead>
            <tr style="${TH_ROW}">
              <th style="${TH}">No</th>
              <th style="${TH}">Type</th>
              <th style="${TH}">Member ID</th>
              <th style="${TH}">Material</th>
              <th style="${TH}">Spec W×H×D (m)</th>
              <th style="${TH}">Section (m²)</th>
              <th style="${TH}">Volume (m³)</th>
              <th style="${TH}">X (m)</th>
              <th style="${TH}">Y (m)</th>
              <th style="${TH}">Z (m)</th>
            </tr>
          </thead>
          <tbody>${detailRows}</tbody>
        </table>
        ${elements.length > 40 ? `
          <div style="font-size:10px;color:#64748b;text-align:center;margin-top:8px;
                      border:1px dashed #253347;border-radius:6px;padding:6px">
            Full member details available in the Quantity Sheet Excel file
          </div>` : ''}
      </div>

      <div style="margin-top:22px;font-size:9px;color:#4a5568;
                  border-top:1px solid #253347;padding-top:8px;display:flex;justify-content:space-between">
        <span>Digital Twin BIM System — Auto-generated Quantity Report</span>
        <span>${new Date().toLocaleString('en-US')}</span>
      </div>
    </div>`;
}

// ── 도면 HTML 생성 (2×3 그리드) ──────────────────────────────────────────────
function buildDrawingsHtml(views, projectName, elementCount) {
  const viewEntries = Object.entries(views); // [[label, dataURL], ...]
  return `
    <div style="width:1120px;background:#0d1b2a;color:#e2e8f0;font-family:sans-serif;
                padding:24px;box-sizing:border-box">

      <!-- 헤더 -->
      <div style="display:flex;justify-content:space-between;align-items:center;
                  border-bottom:2px solid #2a5080;padding-bottom:12px;margin-bottom:18px">
        <div>
          <div style="font-size:16px;font-weight:700;color:#60a5fa;letter-spacing:1px">BIM Drawing</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:3px">
            Project: <b style="color:#e2e8f0">${projectName}</b> &nbsp;|&nbsp; Total Members: ${elementCount}
          </div>
        </div>
        <div style="text-align:right;font-size:10px;color:#64748b">
          <div>${new Date().toLocaleDateString('en-US')}</div>
          <div style="color:#475569">Plan · Front · Longitudinal · Cross · Perspective</div>
        </div>
      </div>

      <!-- 도면 그리드 -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${viewEntries.map(([label, dataURL]) => `
          <div style="background:#111827;border:1px solid #1e3a5f;border-radius:10px;overflow:hidden">
            <div style="background:#1e3a5f;padding:5px 12px;font-size:11px;
                        font-weight:600;color:#93c5fd;letter-spacing:0.5px">
              ${label}
            </div>
            <div style="padding:4px">
              <img src="${dataURL}" style="width:100%;display:block;border-radius:4px" />
            </div>
          </div>`).join('')}
      </div>

      <!-- 범례 -->
      <div style="margin-top:14px;background:#111827;border:1px solid #1e3a5f;
                  border-radius:8px;padding:10px 16px">
        <div style="font-size:10px;font-weight:600;color:#64748b;margin-bottom:8px">Legend (LEGEND)</div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          ${Object.entries(BASE_COLORS).map(([type, color]) => `
            <div style="display:flex;align-items:center;gap:6px">
              <div style="width:16px;height:12px;background:${color};border-radius:2px;
                          border:1px solid rgba(255,255,255,0.2)"></div>
              <span style="font-size:10px;color:#94a3b8">${TYPE_KOR[type] || type}</span>
            </div>`).join('')}
        </div>
      </div>

      <div style="margin-top:12px;font-size:9px;color:#4a5568;text-align:center">
        Digital Twin BIM System &nbsp;|&nbsp; Auto-generated Drawing
      </div>
    </div>`;
}

// 인라인 스타일 상수
const SECTION_TITLE = 'font-size:13px;font-weight:600;color:#60a5fa;margin-bottom:10px';
const TABLE = 'width:100%;border-collapse:collapse;font-size:11px';
const TH_ROW = 'background:#1e3a5f;color:#93c5fd';
const TH = 'padding:6px 8px;border:1px solid #2a5080;text-align:left;font-weight:600;white-space:nowrap';
const TD = 'padding:6px 8px;border:1px solid #253347';
const TD_SM = 'padding:4px 6px;border:1px solid #253347;font-size:10px';

// ── 수량산출서 Excel 내보내기 ─────────────────────────────────────────────────
export function exportQuantityToExcel(elements, projectName) {
  const wb = XLSX.utils.book_new();

  // ── 요약 시트 ──────────────────────────────────────────
  const typeMap = {};
  for (const el of elements) {
    if (!typeMap[el.elementType]) {
      typeMap[el.elementType] = { count: 0, vol: 0, section: 0, materials: new Set(), specs: [] };
    }
    const sx = Number(el.sizeX) || 0, sy = Number(el.sizeY) || 0, sz = Number(el.sizeZ) || 0;
    typeMap[el.elementType].count++;
    typeMap[el.elementType].vol += sx * sy * sz;
    typeMap[el.elementType].section += sx * sz;
    if (el.material) typeMap[el.elementType].materials.add(el.material);
    typeMap[el.elementType].specs.push(`${fmt(sx,2)}×${fmt(sy,2)}×${fmt(sz,2)}`);
  }

  const totalVol = Object.values(typeMap).reduce((s, t) => s + t.vol, 0);

  const summaryData = [
    ['Project Name', projectName],
    ['Date', new Date().toLocaleDateString('en-US')],
    ['Total Members', elements.length],
    ['Total Volume (m³)', totalVol.toFixed(3)],
    [],
    ['Component', 'Type Code', 'Qty (EA)', 'Material', 'Typical Size (W×H×D m)', 'Total Section (m²)', 'Total Vol (m³)', 'Ratio (%)'],
    ...Object.entries(typeMap).map(([type, info]) => {
      const freqMap = {};
      info.specs.forEach(s => { freqMap[s] = (freqMap[s] || 0) + 1; });
      const repSpec = Object.entries(freqMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
      return [
        TYPE_KOR[type] || type,
        type,
        info.count,
        [...info.materials].join(', ') || '-',
        repSpec,
        info.section.toFixed(3),
        info.vol.toFixed(3),
        ((info.vol / totalVol) * 100 || 0).toFixed(1),
      ];
    }),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 20 },
    { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary');

  // ── 부재목록 시트 ──────────────────────────────────────
  const headers = [
    'No', 'Member ID', 'Type', 'Type (EN)', 'Material',
    'Spec (W×H×D)',
    'Width X (m)', 'Height Y (m)', 'Depth Z (m)',
    'Section (m²)', 'Volume (m³)',
    'X Pos (m)', 'Y Pos (m)', 'Z Pos (m)',
    'Rot X (°)', 'Rot Y (°)', 'Rot Z (°)',
  ];
  const rows = elements.map((el, i) => {
    const sx = Number(el.sizeX) || 0, sy = Number(el.sizeY) || 0, sz = Number(el.sizeZ) || 0;
    return [
      i + 1,
      el.elementId,
      el.elementType,
      TYPE_KOR[el.elementType] || el.elementType,
      el.material || '-',
      `${fmt(sx, 2)}×${fmt(sy, 2)}×${fmt(sz, 2)}`,
      fmt(sx), fmt(sy), fmt(sz),
      fmt(sx * sz), fmt(sx * sy * sz),
      fmt(el.positionX), fmt(el.positionY), fmt(el.positionZ),
      fmt(el.rotationX), fmt(el.rotationY), fmt(el.rotationZ),
    ];
  });
  const ws2 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws2['!cols'] = [
    { wch: 5 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 18 },
    { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Members');

  XLSX.writeFile(wb, `${projectName}_QuantitySheet_${today()}.xlsx`);
}

// ── PDF 내보내기 (수량산출서 + 다각도 도면) ──────────────────────────────────
export async function exportToPDF(elements, projectName) {
  // 1. 다각도 스크린샷
  const views = await captureViews(elements);

  // 2. HTML → Canvas 변환
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
  document.body.appendChild(container);

  const htmlOpts = { backgroundColor: '#0d1b2a', scale: 1.4, useCORS: true, logging: false };

  // 수량산출서
  container.innerHTML = buildQuantityHtml(elements, projectName);
  const qCanvas = await html2canvas(container, htmlOpts);

  // 도면
  container.innerHTML = buildDrawingsHtml(views, projectName, elements.length);
  const dCanvas = await html2canvas(container, htmlOpts);

  document.body.removeChild(container);

  // 3. PDF 생성
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297;

  // 1페이지: 수량산출서 (세로 A4)
  const qH = Math.min((qCanvas.height / qCanvas.width) * PW, PH);
  pdf.addImage(qCanvas.toDataURL('image/png'), 'PNG', 0, 0, PW, qH);

  // 2페이지: 도면 (가로 A4)
  pdf.addPage('a4', 'landscape');
  const LW = 297, LH = 210;
  const dH = Math.min((dCanvas.height / dCanvas.width) * LW, LH);
  pdf.addImage(dCanvas.toDataURL('image/png'), 'PNG', 0, 0, LW, dH);

  pdf.save(`${projectName}_BIMDrawing_${today()}.pdf`);
}
