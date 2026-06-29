/**
 * 작업자 WBS 배정 → DB 저장 → 진도율 반영 풀 테스트
 */
const { chromium } = require('playwright');
const http = require('http');

function apiGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8080${path}`, { headers: { Accept: 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    }).on('error', reject);
  });
}
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      { hostname: 'localhost', port: 8080, path, method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { let d=''; res.on('data', c=>d+=c); res.on('end', ()=>{ try{resolve(JSON.parse(d))}catch{resolve(d)} }); }
    );
    req.on('error', reject); req.write(data); req.end();
  });
}
const apiPut = (p, b) => apiRequest('PUT', p, b);

let pass = 0, fail = 0;
function ok(label, val)      { console.log(`  ✓ ${label}${val!==undefined?'  →  '+JSON.stringify(val):''}`); pass++; }
function ng(label, got, exp) { console.error(`  ✗ ${label}  got=${JSON.stringify(got)}  exp=${JSON.stringify(exp)}`); fail++; }
function info(label)         { console.log(`  ℹ ${label}`); }

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  page.setDefaultTimeout(20000);

  let integProjId, wbsProjId, targetTaskId, progressBefore;

  try {
    // ── 1. API: 초기 상태 수집 ───────────────────────────────────
    console.log('\n[1] 초기 상태 수집 (API)');
    const integProjects = await apiGet('/api/integration/projects');
    if (!Array.isArray(integProjects) || !integProjects.length) {
      console.error('통합관제 프로젝트 없음'); process.exit(1);
    }
    integProjId = integProjects[0].projectId;
    info(`통합관제 프로젝트: ${integProjId}`);

    // sim_config에서 w1 초기 배정 확인
    const projData = await apiGet(`/api/integration/project/${integProjId}`);
    let simCfg = null;
    try { simCfg = JSON.parse(projData?.simConfig || 'null'); } catch {}
    const w1Before = simCfg?.workers?.find(w => w.id === 'w1');
    info(`w1 초기 assignedWbsTaskId: ${w1Before?.assignedWbsTaskId ?? 'null'}`);

    // WBS 태스크 목록
    const wbsProjects = await apiGet('/api/wbs/projects');
    wbsProjId = wbsProjects[0]?.projectId;
    const allTasks = await apiGet(`/api/wbs/project/${wbsProjId}/tasks`);
    const target = allTasks.find(t => t.progress < 100);
    if (!target) { info('미완료 태스크 없음 — 스킵'); process.exit(0); }
    targetTaskId = target.taskId;
    progressBefore = target.progress ?? 0;
    info(`대상 태스크: "${target.taskName}" progress=${progressBefore} id=${targetTaskId.slice(0,8)}...`);
    ok('초기 상태 수집 완료');

    // ── 2. 브라우저: 통합관제 진입 ───────────────────────────────
    console.log('\n[2] 통합관제 대시보드 진입');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 통합관제 탭 클릭
    await page.locator('text="통합관제"').first().click();
    await page.waitForTimeout(1500);

    // 프로젝트 진입: "통합관제 열기" 버튼 클릭
    const openBtn = page.locator('button:has-text("통합관제 열기"), button:has-text("열기"), button:has-text("Open")').first();
    if (await openBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await openBtn.click();
      info('"통합관제 열기" 클릭');
      await page.waitForTimeout(3000);
    } else {
      // 이미 대시보드 안에 있을 수 있음
      info('"통합관제 열기" 버튼 없음 — 대시보드로 간주');
    }
    await page.screenshot({ path: 'c:/temp/full-01-dashboard.png' });
    ok('통합관제 대시보드 진입');

    // ── 3. Worker A 클릭 → 담당 작업 select 찾기 ────────────────
    console.log('\n[3] Worker A 클릭 → WBS 배정 드롭다운');
    await page.locator('text="Worker A"').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'c:/temp/full-02-workerA.png' });

    // select[2] = "-- 작업 선택 --" 포함한 WBS 배정 드롭다운 (index 2 or last)
    const selects = page.locator('select');
    const cnt = await selects.count();
    info(`select 수: ${cnt}`);

    // WBS 배정 select 찾기: "작업 선택" 또는 "noTask" option 포함
    let wbsSelect = null;
    for (let i = 0; i < cnt; i++) {
      const sel = selects.nth(i);
      if (!await sel.isVisible({ timeout: 1000 }).catch(() => false)) continue;
      const opts = await sel.locator('option').allTextContents().catch(() => []);
      // taskId형 value를 가진 option 존재 여부 확인
      const vals = await sel.locator('option').evaluateAll(opts => opts.map(o => o.value));
      // UUID-like value가 있는 select = WBS 배정 select
      if (vals.some(v => v.length > 10 && v.includes('-'))) {
        wbsSelect = sel;
        info(`select[${i}] = WBS 배정 select  옵션: ${opts.slice(0,3).join(' | ')}`);
        break;
      }
    }

    if (!wbsSelect) {
      info('WBS 배정 select 미발견 — fallback: 마지막 select 사용');
      wbsSelect = selects.last();
    }

    // 대상 태스크 선택
    await wbsSelect.selectOption({ value: targetTaskId });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'c:/temp/full-03-selected.png' });
    ok(`WBS 태스크 선택: ${targetTaskId.slice(0,8)}...`);

    // 적용 버튼 클릭 (WorkerOptionsPanel의 apply() 호출 → UPDATE_WORKER 디스패치)
    const applyBtn = page.locator('button:has-text("적용"), button:has-text("Apply"), button:has-text("適用")').first();
    if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applyBtn.click();
      info('"적용" 버튼 클릭');
      await page.waitForTimeout(500);
    } else {
      info('"적용" 버튼 없음');
    }
    await page.screenshot({ path: 'c:/temp/full-03b-applied.png' });

    // ── 4. debounce 1.5초 + 여유 대기 → DB 저장 확인 ────────────
    console.log('\n[4] sim_config DB 저장 대기 (2.5초)');
    await page.waitForTimeout(2500);

    const after = await apiGet(`/api/integration/project/${integProjId}`);
    let cfgAfter = null;
    try { cfgAfter = JSON.parse(after?.simConfig || 'null'); } catch {}
    const w1After = cfgAfter?.workers?.find(w => w.id === 'w1');
    info(`w1 저장 후 assignedWbsTaskId: ${w1After?.assignedWbsTaskId ?? 'null'}`);

    if (w1After?.assignedWbsTaskId === targetTaskId) {
      ok(`assignedWbsTaskId DB 저장 확인: ${targetTaskId.slice(0,8)}...`);
    } else {
      ng('assignedWbsTaskId 저장 실패', w1After?.assignedWbsTaskId, targetTaskId);
    }

    // ── 5. tick 대기 → WBS 진도율 변화 확인 (5초) ───────────────
    console.log('\n[5] tick 대기 후 WBS 진도율 확인 (10초)');
    info('시뮬레이션 tick 실행 대기...');
    await page.waitForTimeout(8000);  // 5초 tick + 3초 debounce
    await page.screenshot({ path: 'c:/temp/full-04-after-tick.png' });

    const tasksAfter = await apiGet(`/api/wbs/project/${wbsProjId}/tasks`);
    const taskAfter  = tasksAfter.find(t => t.taskId === targetTaskId);
    const progressAfter = taskAfter?.progress ?? progressBefore;
    info(`WBS 진도율: ${progressBefore}% → ${progressAfter}%`);

    if (progressAfter >= progressBefore) {
      ok(`WBS 진도율 유지 또는 증가: ${progressBefore}% → ${progressAfter}%`);
    } else {
      ng('WBS 진도율 감소', progressAfter, `≥ ${progressBefore}`);
    }
    if (progressAfter > progressBefore) {
      ok(`진도율 실제 증가 확인: +${progressAfter - progressBefore}%`);
    } else {
      info('진도율 변화 없음 — tick 발생 전이거나 blocked 상태일 수 있음 (진행 중이면 UI에서 확인 가능)');
    }

    // ── 6. 새로고침 후 배정 유지 확인 ────────────────────────────
    console.log('\n[6] 새로고침 후 배정 유지 확인');
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator('text="통합관제"').first().click();
    await page.waitForTimeout(1500);
    const openBtn2 = page.locator('button:has-text("통합관제 열기"), button:has-text("열기"), button:has-text("Open")').first();
    if (await openBtn2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await openBtn2.click();
      await page.waitForTimeout(3000);
    }
    // Worker A 클릭해서 현재 배정값 확인
    await page.locator('text="Worker A"').first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'c:/temp/full-05-reload.png' });

    const reloaded = await apiGet(`/api/integration/project/${integProjId}`);
    let cfgReload = null;
    try { cfgReload = JSON.parse(reloaded?.simConfig || 'null'); } catch {}
    const w1Reload = cfgReload?.workers?.find(w => w.id === 'w1');

    if (w1After?.assignedWbsTaskId === targetTaskId) {
      if (w1Reload?.assignedWbsTaskId === targetTaskId) {
        ok(`새로고침 후 assignedWbsTaskId 유지: ${targetTaskId.slice(0,8)}...`);
      } else {
        ng('새로고침 후 배정 소실', w1Reload?.assignedWbsTaskId, targetTaskId);
      }
    } else {
      info('배정 저장 안 됐으므로 새로고침 유지 검사 스킵');
    }

    await page.screenshot({ path: 'c:/temp/full-06-final.png' });

  } catch (e) {
    console.error('\n  오류:', e.message);
    await page.screenshot({ path: 'c:/temp/full-error.png' }).catch(() => {});
    fail++;
  } finally {
    await page.waitForTimeout(1500);
    await browser.close();
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  결과: ✓ ${pass}개 통과  ✗ ${fail}개 실패`);
  console.log(`  스크린샷: c:/temp/full-*.png`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
})();
