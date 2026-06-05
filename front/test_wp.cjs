const { chromium } = require('playwright');
const { writeFileSync, mkdirSync } = require('fs');
const OUT = __dirname + '/test_screenshots';
try { mkdirSync(OUT); } catch {}
const ss = async (page, name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ fullPage: false }));
  console.log('📸', name);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);

  // BIM 탭 클릭
  const bimTab = await page.$('button:has-text("BIM"), [class*="tab"]:has-text("BIM"), nav button:has-text("BIM")');
  if (bimTab) { await bimTab.click(); console.log('✅ BIM 탭 클릭'); }
  else {
    // 텍스트로 탐색
    const allBtns = await page.$$('button');
    for (const b of allBtns) {
      const txt = await b.innerText();
      if (txt.includes('BIM')) { await b.click(); console.log('✅ BIM 버튼 발견:', txt); break; }
    }
  }
  await page.waitForTimeout(2000);
  await ss(page, '04_bim_tab');

  // 프로젝트 목록 확인
  const projectItems = await page.$$('[class*="project"], [class*="card"], li');
  console.log('프로젝트 아이템 수:', projectItems.length);

  // 첫 번째 프로젝트 클릭 시도
  if (projectItems.length > 0) {
    await projectItems[0].click();
    await page.waitForTimeout(2000);
    await ss(page, '05_bim_project');

    // "작업계획" 탭 찾기
    const tabs = await page.$$('button');
    let foundWorkPlan = false;
    for (const btn of tabs) {
      const txt = await btn.innerText().catch(() => '');
      if (txt.includes('작업계획') || txt.includes('Work Plan') || txt.includes('作業計画')) {
        await btn.click();
        foundWorkPlan = true;
        console.log('✅ 작업계획 탭 발견 및 클릭:', txt);
        break;
      }
    }
    if (!foundWorkPlan) console.log('⚠️ 작업계획 탭 없음 (프로젝트가 에디터 상태에 있지 않음)');
    await page.waitForTimeout(2000);
    await ss(page, '06_workplan_tab');
  } else {
    console.log('⚠️ 프로젝트 없음 (백엔드 미실행)');
  }

  console.log('빌드 오류:', errors.filter(e => e.includes('SyntaxError') || e.includes('TypeError') || e.includes('ReferenceError')));
  await browser.close();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
