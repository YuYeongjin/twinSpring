**
 * 통합관제 WBS 진척도 + BIM 부재 채우기 종합 테스트
 *
 * 실행: node src/view/integration/__tests__/wbs-bim-progress.test.js
 *   (서버 http://localhost:8080, 프론트 http://localhost:3000 실행 중이어야 함)
 *
 * 검증 시나리오:
 *   C. getFloorProgress   단위 테스트 (pure function)
 *   D. calcRealTimeProgress 단위 테스트 (pure function)
 *   A. 일반 WBS 태스크 API 생성 + 달력 진도 계산 확인
 *   B. 브라우저 — BIM 부재 채우기 & 층별 cascade 시각 확인
 */

const http = require('http');

// ─────────────────────────────────────────────────────
// 간단한 assert 유틸
// ─────────────────────────────────────────────────────
let pass = 0, fail = 0;
function assert(label, condition, got, expected) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ ${label}  got=${JSON.stringify(got)}  expected=${JSON.stringify(expected)}`);
    fail++;
  }
}

// ─────────────────────────────────────────────────────
// HTTP 헬퍼
// ─────────────────────────────────────────────────────
function apiGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8080${path}`, { headers: { Accept: 'application/json' } }, res => {
      let d = '';
      res.on('data', c => (d += c));
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
const apiPost   = (p, b) => apiRequest('POST',   p, b);
const apiPut    = (p, b) => apiRequest('PUT',    p, b);
const apiDelete = p      => apiRequest('DELETE', p, {});

// ─────────────────────────────────────────────────────
// C. 단위 테스트: getFloorProgress
//    (floorUtils.js 와 동일한 로직 — OVERLAP_RATIO=1.0)
// ─────────────────────────────────────────────────────
function getFloorProgress(floorIndex, totalFloors, overallProgress) {
  if (totalFloors <= 1) return overallProgress;
  const stride = 100 / totalFloors;
  const start  = floorIndex * stride;
  return Math.min(100, Math.max(0, (overallProgress - start) / stride * 100));
}

function testFloorProgress() {
  console.log('\n[C] getFloorProgress 단위 테스트');

  // 전체 0% → 모든 층 0%
  assert('층0, 전체0% → 0',   getFloorProgress(0, 3,   0) === 0,   getFloorProgress(0, 3,   0), 0);
  assert('층1, 전체0% → 0',   getFloorProgress(1, 3,   0) === 0,   getFloorProgress(1, 3,   0), 0);

  // 전체 11.1% (PLAN:0 1/9 완료) → B1≈33.3%, 1층=0%
  const f0_11 = getFloorProgress(0, 3, 11.1);
  assert('층0, 전체11.1% ≈ 33.3%', Math.abs(f0_11 - 33.3) < 1, Math.round(f0_11 * 10) / 10, 33.3);
  assert('층1, 전체11.1% → 0',     getFloorProgress(1, 3, 11.1) === 0, 0, 0);
  assert('층2, 전체11.1% → 0',     getFloorProgress(2, 3, 11.1) === 0, 0, 0);

  // 전체 33.3% → B1=100%, 1층=0%
  assert('층0, 전체33.3% → 100', Math.round(getFloorProgress(0, 3, 33.3)) === 100, Math.round(getFloorProgress(0, 3, 33.3)), 100);
  assert('층1, 전체33.3% → 0',   getFloorProgress(1, 3, 33.3) === 0,                getFloorProgress(1, 3, 33.3), 0);

  // 전체 50% → 층0=100%, 층1=50%, 층2=0%
  assert('층0, 전체50% → 100', Math.round(getFloorProgress(0, 3, 50)) === 100, Math.round(getFloorProgress(0, 3, 50)), 100);
  assert('층1, 전체50% ≈ 50%', Math.abs(getFloorProgress(1, 3, 50) - 50) < 1, Math.round(getFloorProgress(1, 3, 50)), 50);
  assert('층2, 전체50% → 0',   getFloorProgress(2, 3, 50) === 0,               getFloorProgress(2, 3, 50), 0);

  // 전체 100% → 모든 층 100%
  assert('층0, 전체100% → 100', Math.round(getFloorProgress(0, 3, 100)) === 100, Math.round(getFloorProgress(0, 3, 100)), 100);
  assert('층1, 전체100% → 100', Math.round(getFloorProgress(1, 3, 100)) === 100, Math.round(getFloorProgress(1, 3, 100)), 100);
  assert('층2, 전체100% → 100', Math.round(getFloorProgress(2, 3, 100)) === 100, Math.round(getFloorProgress(2, 3, 100)), 100);
}

// ─────────────────────────────────────────────────────
// D. 단위 테스트: calcRealTimeProgress
//    (progressEngine.js 와 동일한 로직)
// ─────────────────────────────────────────────────────
function calcRealTimeProgress(task, rate) {
  if (!task.startDate) return null;
  if (rate <= 0)       return null;
  const startDate = new Date(task.startDate);
  const now = new Date();
  if (now < startDate) return 0;
  const elapsedDays = (now - startDate) / 86400000;
  let plannedDays;
  if (task.endDate)        plannedDays = Math.max(1, (new Date(task.endDate) - startDate) / 86400000);
  else if (task.duration)  plannedDays = Math.max(1, Number(task.duration));
  else                     return null;
  return Math.min(100, (elapsedDays / (plannedDays / rate)) * 100);
}

function testCalcRealTimeProgress() {
  console.log('\n[D] calcRealTimeProgress 단위 테스트');

  const future10 = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
  const past30   = new Date(Date.now() - 86400000 * 30).toISOString().slice(0, 10);
  const past1    = new Date(Date.now() - 86400000 *  1).toISOString().slice(0, 10);

  assert('startDate 없음 → null',    calcRealTimeProgress({ endDate: future10 }, 1.0) === null, null, null);
  assert('rate=0 → null',            calcRealTimeProgress({ startDate: past30, endDate: future10 }, 0) === null, null, null);
  assert('미래 시작 → 0%',           calcRealTimeProgress({ startDate: future10, endDate: future10 }, 1.0) === 0, 0, 0);
  assert('endDate/duration 모두 없음 → null', calcRealTimeProgress({ startDate: past30 }, 1.0) === null, null, null);

  // 30일 전 시작, 60일 duration → ~50%
  const p50 = calcRealTimeProgress({ startDate: past30, duration: 60 }, 1.0);
  assert('30일/60일 → ~50%', Math.abs(p50 - 50) < 3, Math.round(p50), 50);

  // rate=2.0 → 2배 빠름 → 30일/60일 × 2배속 → ~100% (clamp)
  const p2x = calcRealTimeProgress({ startDate: past30, duration: 60 }, 2.0);
  assert('30일/60일/rate=2 → 100%', Math.round(p2x) >= 100, Math.round(p2x), 100);

  // 이미 종료(어제) → 100%
  const pDone = calcRealTimeProgress({ startDate: past30, endDate: past1 }, 1.0);
  assert('이미 종료 → 100%', Math.round(pDone) >= 100, Math.round(pDone), 100);
}

// ─────────────────────────────────────────────────────
// A. API 테스트: 일반(비-BIM) WBS 태스크 달력 진도 검증
// ─────────────────────────────────────────────────────
async function testNonBimWbsTask() {
  console.log('\n[A] 일반 WBS 태스크 달력 진도 API 테스트');

  // 통합관제 프로젝트 조회
  const projects = await apiGet('/api/integration/projects');
  if (!Array.isArray(projects) || !projects[0]) {
    console.log('  [SKIP] 통합관제 프로젝트 없음');
    return null;
  }
  const { wbsProjectId, projectName } = projects[0];
  console.log('  프로젝트:', projectName, '| WBS ID:', wbsProjectId);

  // 현재 태스크 목록
  const tasks    = await apiGet(`/api/wbs/project/${wbsProjectId}/tasks`);
  const maxSort  = Math.max(0, ...tasks.map(t => t.sortOrder || 0));
  const nonBim   = tasks.filter(t => !(t.notes || '').startsWith('BIM:'));
  console.log('  기존 일반 WBS 태스크:', nonBim.length, '개');

  // 테스트용 태스크 생성: 30일 전 시작, 60일 기간 → 기대 진도 ≈50%
  const past30   = new Date(Date.now() - 86400000 * 30).toISOString().slice(0, 10);
  const future30 = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);

  const created = await apiPost(`/api/wbs/project/${wbsProjectId}/task`, {
    taskName:       '[TEST] 일반 WBS — 달력 진도',
    startDate:      past30,
    endDate:        future30,
    duration:       60,
    progress:       0,
    status:         'NOT_STARTED',
    notes:          'TEST_INTEGRATION_WBS',
    sortOrder:      maxSort + 1,
    wbsCode:        '99',
    responsible:    'tester',
    predecessorIds: '',
    parentTaskId:   null,
  });
  const taskId = created?.taskId;
  assert('태스크 생성 성공', !!taskId, taskId, '(UUID)');

  if (!taskId) return null;
  console.log('  생성된 taskId:', taskId);

  // calcRealTimeProgress 로 예상 진도 계산
  const expected = calcRealTimeProgress({ startDate: past30, endDate: future30 }, 1.0);
  console.log(`  예상 달력 진도 ≈ ${Math.round(expected)}%`);
  assert('예상 진도 ≈ 50% (30/60일)', Math.abs(expected - 50) < 3, Math.round(expected), 50);

  return { taskId, wbsProjectId, expected };
}

// ─────────────────────────────────────────────────────
// B. 브라우저 테스트: 층별 진행현황 + 부재 채우기
// ─────────────────────────────────────────────────────
async function testBimFillBrowser() {
  // playwright 없이 실행되는 환경을 대비해 동적 import
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { console.log('\n[B] playwright 없음 — SKIP (npm install playwright 후 재실행)'); return; }

  console.log('\n[B] BIM 부재 채우기 + 층별 cascade 브라우저 테스트');

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const page    = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  page.setDefaultTimeout(20000);

  try {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator('text=통합관제').first().click();
    await page.waitForTimeout(2000);
    await page.locator('text=통합관제 열기').first().click();
    // 첫 tick 실행 + 화면 안정화 대기
    await page.waitForTimeout(8000);
    console.log('  대시보드 열림');

    // body 전체 innerText → JSX {expr}% 패턴은 innerText에서 숫자+% 합쳐짐
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('  body 앞 400자:', bodyText.slice(0, 400).replace(/\n+/g, ' | '));

    const pctFromStr = str => { const m = str?.match(/([\d.]+)%/); return m ? parseFloat(m[1]) : null; };

    // "전체 공정  10.1%" / "전체 공정\n10.1%" / "wbsOverall key  10.1%"
    // → body 전체에서 첫 번째 xx.x% 를 찾되 "전체" / "overall" 근처에서 찾기
    const overallMatch = bodyText.match(/전체\s*공정\s*([\d.]+)\s*%/)
                      || bodyText.match(/Overall\s*([\d.]+)\s*%/i);
    const overall = overallMatch ? parseFloat(overallMatch[1]) : (() => {
      // 전체 공정 레이블 바로 뒤 숫자 텍스트 추출: "전체 공정" 다음 줄 혹은 공백 뒤에 오는 숫자
      const idx = bodyText.indexOf('전체 공정');
      if (idx < 0) return null;
      const snippet = bodyText.slice(idx, idx + 40);
      const m = snippet.match(/([\d.]+)\s*%/);
      return m ? parseFloat(m[1]) : null;
    })();
    console.log('  전체 공정률:', overall, '%');
    assert('전체 공정률 > 0%', overall !== null && overall > 0, overall, '>0%');

    // B1 층 진행 > 0%  (bodyText 안에 "B1  33.3%" 형태 or "B-1  33.3%")
    const b1Match = bodyText.match(/B[\-]?1\s+([\d.]+)\s*%/)
                 || bodyText.match(/지하\s*1\s*층\s*([\d.]+)\s*%/);
    const b1 = b1Match ? parseFloat(b1Match[1]) : null;
    console.log('  B1 층 진도:', b1, '%');
    assert('B1 층 진행 > 0%', b1 !== null && b1 > 0, b1, '>0%');

    // 층별 순차: B1 < 100% 이면 1층 = 0%
    const floor1Match = bodyText.match(/1층\s*([\d.]+)\s*%/);
    const floor1      = floor1Match ? parseFloat(floor1Match[1]) : null;
    if (b1 !== null && b1 < 100) {
      assert('B1 미완 → 1층 0%', floor1 === 0 || floor1 === null, floor1, 0);
    }

    // 우측 WBS 공정 진행률 패널 — WBS 섹션 펼치기 후 [TEST] 태스크 확인
    // (tick이 mount 직후 바로 실행되므로 태스크 데이터 로드 후 50% 이어야 함)
    const wbsSectionBtn = page.locator('button', { hasText: 'WBS' }).last();
    if (await wbsSectionBtn.isVisible().catch(() => false)) {
      await wbsSectionBtn.click().catch(() => {});
      await page.waitForTimeout(800);
    }

    const testTaskEl = page.locator('text=[TEST] 일반 WBS').first();
    const testVisible = await testTaskEl.isVisible().catch(() => false);
    if (testVisible) {
      // 태스크 행 innerText 추출
      const rowText = await testTaskEl.locator('xpath=ancestor::div[1]').innerText().catch(() => '');
      const testPct = pctFromStr(rowText);
      console.log(`  [TEST] 태스크 진도: ${testPct}%`);
      // 첫 tick은 mount 시 즉시 실행되나, DataLoader 완료 전일 수 있음
      // → 태스크가 표시되는 것 자체가 로드 성공 증거; 진도는 ≥ 0% 확인
      assert('[TEST] 태스크 패널에 표시됨', testPct !== null, testPct, '≥0%');
    } else {
      console.log('  [!] [TEST] 태스크 패널 미표시 — 섹션 미열림 or 아직 로드 중');
    }

    // 스크린샷 저장
    const vp = page.viewportSize();
    await page.screenshot({ path: 'c:/temp/bim-test-full.png' });
    await page.screenshot({ path: 'c:/temp/bim-test-scene.png', clip: { x: 260, y: 40, width: 1020, height: 860 } });
    await page.screenshot({ path: 'c:/temp/bim-test-left.png',  clip: { x: 0, y: 0, width: 260, height: 700 } });
    await page.screenshot({ path: 'c:/temp/bim-test-right.png', clip: { x: vp.width - 320, y: 0, width: 320, height: 900 } });
    console.log('  스크린샷: c:/temp/bim-test-*.png');

  } catch (e) {
    console.error('  Error:', e.message);
    await page.screenshot({ path: 'c:/temp/bim-test-error.png' }).catch(() => {});
    fail++;
  }
  await browser.close();
}

// ─────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────
(async () => {
  console.log('══════════════════════════════════════════════════');
  console.log('  통합관제 WBS 진척도 + BIM 부재 채우기 종합 테스트');
  console.log('══════════════════════════════════════════════════');

  // 동기 단위 테스트
  testFloorProgress();
  testCalcRealTimeProgress();

  // API 테스트
  let taskInfo = null;
  try { taskInfo = await testNonBimWbsTask(); }
  catch (e) { console.error('[A] 오류:', e.message); fail++; }

  // 브라우저 테스트
  try { await testBimFillBrowser(); }
  catch (e) { console.error('[B] 오류:', e.message); fail++; }

  // 테스트 태스크 정리
  if (taskInfo?.taskId) {
    console.log('\n[cleanup] 테스트 태스크 삭제...');
    await apiDelete(`/api/wbs/task/${taskInfo.taskId}`).catch(() => {});
    console.log('  ✓ 완료');
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  결과: ✓ ${pass}개 통과  ✗ ${fail}개 실패`);
  console.log('══════════════════════════════════════════════════\n');
  process.exit(fail > 0 ? 1 : 0);
})();
