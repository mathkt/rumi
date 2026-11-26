// 디자인 확인용 스크린샷 (크롬북 1366x768)
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await b.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto('file://' + path.join(__dirname, 'index.html'));
  await page.waitForTimeout(300);
  await page.click('[data-tab="create"]');
  await page.screenshot({ path: OUT + '/d1-home.png' });
  await page.click('[data-tab="local"]');
  await page.evaluate(() => { window.__AI_FAST__ = false; });
  await page.click('#btn-local');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/d2-firstdraw.png' });
  if (await page.locator('#fd-go').isVisible()) await page.click('#fd-go');
  // 보기 좋은 장면 만들기: 테이블과 패 구성
  await page.evaluate(() => {
    const T = RK.makeTile;
    const c = window.__app.ctl;
    const st = c.getView();
    c._debugSetHand(st.mySeat, [T(0, 3), T(0, 4), T(0, 5), T(1, 9), T(2, 9), T(3, 9), T(1, 1), T(2, 12), T(3, 7), T(0, 11), 104, T(1, 6), T(2, 2), T(3, 13), T(1, 13)]);
  });
  await page.waitForFunction(() => window.__app.view.game.turn === window.__app.view.mySeat, null, { timeout: 20000 });
  await page.dblclick('#rack .tile[data-id="2"]');
  await page.dblclick('#rack .tile[data-id="3"]');
  await page.dblclick('#rack .tile[data-id="4"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + '/d3-game.png' });
  await page.click('#b-undo');
  await page.click('#b-hint');
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/d4-hint.png' });
  // 결과 화면
  await page.evaluate(() => window.__app.ctl.endGame());
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/d5-result.png' });
  await b.close();
})();
