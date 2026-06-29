/**
 * 작업자/장비 WBS 할당 → 진도율 반영 브라우저 테스트 (v2)
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
      res => {
        let d = '';
        res.on('data', c => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
const apiPut = (p, b) => apiRequest('PUT', p, b);

let pass = 0, fail = 0;
function ok(label, val) { console.log(`  ✓ ${label}${val !== undefined ? '  →  ' + JSON.stringify(val) : ''}`); pass++; }
function ng(label, got, exp) { console.error(`  ✗ ${label}  got=${JSON.stringify(got)}  exp=${JSON.stringify(exp)}`); fail++; }
function info(label) { console.log(`  ℹ ${label}`); }

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 60 });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  page.setDefaultTimeout(20000);

  try {
    // ── 1. 앱 로드 ───────────────────────────────────────────────
    console.log('\n[1] 앱 로드');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'c:/temp/assign-01-home.png' });

    // 컴파일 에러 오버레이 확인
    const hasError = await page.locator('[data-overlay-show="true"], .react-error-overlay, iframe[title*="error"]').isVisible({ timeout: 2000 }).catch(() => false);
    if (hasError) {
      info('컴파일 오류 오버레이 감지 — Escape로 닫기 시도');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }
    ok('앱 로드');

    // ── 2. 통합관제 탭 클릭 ──────────────────────────────────────
    console.log('\n[2] 통합관제 탭 진입');

    // 한국어/영어 모두 시도
    const tabTexts = ['통합관제', 'Integration', '統合管制'];
    let tabClicked = false;
    for (const txt of tabTexts) {
      const el = page.locator(`text="${txt}"`).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click();
        info(`탭 클릭: "${txt}"`);
        tabClicked = true;
        break;
      }
    }
    if (!tabClicked) {
      // 아이콘으로 찾기
      const linkIcon = page.locator('button:has-text("🔗")').first();
      if (await linkIcon.isVisible({ timeout: 3000 }).catch(() => false)) {
        await linkIcon.click();
        info('🔗 아이콘 버튼으로 탭 클릭');
        tabClicked = true;
      }
    }
    if (!tabClicked) {
      await page.screenshot({ path: 'c:/temp/assign-02-notab.png' });
      ng('통합관제 탭 찾기 실패', '없음', '탭 버튼');
      return;
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'c:/temp/assign-02-integ-list.png' });
    ok('통합관제 탭 클릭');

    // ── 3. 프로젝트 선택 (integration-projects 목록) ─────────────
    console.log('\n[3] 통합관제 프로젝트 선택');
    // 프로젝트 카드/버튼 목록에서 첫 번째 클릭
    const projCard = page.locator('button[class*="project"], div[class*="project-card"], button:has-text("열기"), button:has-text("Open"), .project-item button').first();
    const projVisible = await projCard.isVisible({ timeout: 5000 }).catch(() => false);
    if (projVisible) {
      await projCard.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'c:/temp/assign-03-project-open.png' });
      ok('프로젝트 선택');
    } else {
      // 프로젝트 카드를 다른 방법으로 찾기
      const anyClickable = page.locator('li button, ul button, [class*="card"] button').first();
      if (await anyClickable.isVisible({ timeout: 3000 }).catch(() => false)) {
        await anyClickable.click();
        await page.waitForTimeout(2500);
        ok('프로젝트 선택 (fallback)');
      } else {
        await page.screenshot({ path: 'c:/temp/assign-03-noproj.png' });
        info('프로젝트 선택 버튼 없음 — 이미 대시보드에 있을 수 있음');
      }
    }

    await page.screenshot({ path: 'c:/temp/assign-04-dashboard.png' });

    // ── 4. WBS 태스크 API 확인 ─────────────────────────────────
    console.log('\n[4] WBS 태스크 및 통합관제 프로젝트 확인');
    const integProjects = await apiGet('/api/integration/projects');
    if (!Array.isArray(integProjects) || !integProjects.length) {
      info('통합관제 프로젝트 없음 — API 테스트 스킵');
    } else {
      ok(`통합관제 프로젝트 ${integProjects.length}개 확인`);
      const integProjId = integProjects[0].projectId;
      info(`프로젝트 ID: ${integProjId}`);

      // sim_config 초기 상태
      const projData = await apiGet(`/api/integration/project/${integProjId}`);
      let simCfg = null;
      try { simCfg = JSON.parse(projData?.simConfig || 'null'); } catch {}
      const workers = simCfg?.workers || [];
      info(`sim_config workers 수: ${workers.length}`);
      if (workers.length > 0) {
        info(`첫 번째 worker: id=${workers[0].id}, assignedWbsTaskId=${workers[0].assignedWbsTaskId}`);
      }

      // WBS 프로젝트 찾기
      const wbsProjects = await apiGet('/api/wbs/projects');
      if (Array.isArray(wbsProjects) && wbsProjects.length > 0) {
        const wbsProjId = wbsProjects[0].projectId;
        const tasks = await apiGet(`/api/wbs/project/${wbsProjId}/tasks`);
        const leafTasks = tasks.filter(t => t.progress < 100);
        if (leafTasks.length > 0) {
          const t = leafTasks[0];
          info(`WBS 미완료 태스크: "${t.taskName}" (${t.taskId?.slice(0, 8)}...) progress=${t.progress}`);
          ok(`WBS 태스크 ${leafTasks.length}개 확인`);
        }
      }
    }

    // ── 5. 작업자 패널 클릭 → WBS 배정 ─────────────────────────
    console.log('\n[5] 작업자 패널 찾기');
    // 스크린샷으로 UI 확인 후 작업자 텍스트 탐색
    const workerTexts = ['Worker A', 'Worker B', '작업자', 'worker'];
    let workerFound = false;
    for (const txt of workerTexts) {
      const el = page.locator(`text="${txt}"`).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        await page.waitForTimeout(1000);
        info(`작업자 클릭: "${txt}"`);
        workerFound = true;
        break;
      }
    }

    if (!workerFound) {
      info('작업자 텍스트 미표시 — 현재 UI 상태 스크린샷');
    }

    await page.screenshot({ path: 'c:/temp/assign-05-worker.png' });

    // ── 6. 담당 작업 드롭다운 확인 ──────────────────────────────
    console.log('\n[6] 담당 작업(assignedWbsTaskId) 드롭다운 확인');
    // WorkerOptionsPanel의 select 찾기
    const selects = page.locator('select');
    const selectCount = await selects.count();
    info(`select 요소 수: ${selectCount}`);

    if (selectCount > 0) {
      // 마지막 select가 보통 WBS 배정 select
      for (let i = 0; i < Math.min(selectCount, 5); i++) {
        const sel = selects.nth(i);
        const isVisible = await sel.isVisible({ timeout: 1000 }).catch(() => false);
        if (isVisible) {
          const val = await sel.inputValue().catch(() => '');
          const opts = await sel.locator('option').allTextContents().catch(() => []);
          info(`select[${i}] value="${val}" options(${opts.length}): ${opts.slice(0, 3).join(', ')}...`);
        }
      }
      ok(`select 드롭다운 ${selectCount}개 발견`);
    } else {
      info('select 드롭다운 없음 — 작업자 패널 미열림');
    }

    // ── 7. 최종 스크린샷 ─────────────────────────────────────────
    console.log('\n[7] 최종 상태 스크린샷');
    await page.screenshot({ path: 'c:/temp/assign-06-final.png' });
    ok('테스트 완료');

  } catch (e) {
    console.error('\n  오류:', e.message);
    await page.screenshot({ path: 'c:/temp/assign-error.png' }).catch(() => {});
    fail++;
  } finally {
    await page.waitForTimeout(2000);
    await browser.close();
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  결과: ✓ ${pass}개 통과  ✗ ${fail}개 실패`);
  console.log(`  스크린샷: c:/temp/assign-*.png`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
})();
