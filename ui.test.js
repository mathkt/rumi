// 실행: NODE_PATH=/opt/npm-tools/node_modules node ui.test.js   (index.html을 실제 Chrome으로 열어 드래그까지 점검)
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');

const FILE = 'file://' + path.join(__dirname, 'index.html');
const OUT = path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const results = [];
  const ok = (name, fn) => fn().then(() => results.push(['✓', name]), (e) => results.push(['✗', name + ' → ' + e.message.split('\n').slice(0, 12).join('\n    ')]));

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(FILE);

  const T = (c, n, k) => page.evaluate(([c, n, k]) => RK.makeTile(c, n, k || 0), [c, n, k]);
  const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  async function drag(fromSel, to) {
    const f = await center(fromSel);
    await page.mouse.move(f.x, f.y);
    await page.mouse.down();
    await page.mouse.move(f.x + 6, f.y - 6, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  const tileSel = (id, where) => `${where} .tile[data-id="${id}"]`;
  const getWork = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.work)));
  const getView = () => page.evaluate(() => { const v = window.__app.view; return { status: v.status, game: v.game, myHand: v.myHand, mySeat: v.mySeat }; });

  await page.screenshot({ path: OUT + '/1-home.png' });

  await ok('홈: 탭 전환과 설정 폼', async () => {
    await page.click('[data-tab="create"]');
    assert.ok(await page.locator('#cs-minMeld').isVisible());
    assert.strictEqual(await page.locator('#cs-minMeld option').count(), 3);
    await page.click('[data-tab="local"]');
    assert.ok(await page.locator('#ls-players').isVisible());
  });

  await ok('연습(혼자) 시작 → 게임 화면, 패 14장', async () => {
    await page.selectOption('#ls-players', '1');
    await page.click('#btn-local');
    await page.waitForSelector('#s-game:not(.hidden)');
    assert.strictEqual(await page.locator('#rack .tile').count(), 14);
    assert.ok((await page.locator('#g-turn').textContent()).includes('내 차례'));
  });

  const R10 = await T(0, 10), B10 = await T(1, 10), Y10 = await T(2, 10), K1 = await T(3, 1), K2 = await T(3, 2);
  await page.evaluate((h) => window.__app.ctl._debugSetHand(0, h), [R10, B10, Y10, K1, K2]);

  await ok('드래그: 패 → 빈 테이블(새 세트) → 같은 세트에 붙이기', async () => {
    const board = await center('#board');
    await drag(tileSel(R10, '#rack'), { x: board.x, y: board.y });
    let w = await getWork();
    assert.deepStrictEqual(w.table, [[R10]]);
    const setPos = await center('.set');
    await drag(tileSel(B10, '#rack'), { x: setPos.b.x + setPos.b.width - 4, y: setPos.y });
    w = await getWork();
    assert.deepStrictEqual(w.table, [[R10, B10]]);
    const setPos2 = await center('.set');
    await drag(tileSel(Y10, '#rack'), { x: setPos2.b.x + setPos2.b.width - 4, y: setPos2.y });
    w = await getWork();
    assert.deepStrictEqual(w.table, [[R10, B10, Y10]]);
    assert.strictEqual(w.hand.length, 2);
  });

  await ok('세트가 올바르면 초록 테두리와 점수, 첫 등록 점수 안내', async () => {
    assert.ok(await page.locator('.set.ok').count() === 1);
    assert.strictEqual((await page.locator('.set .pts').textContent()).trim(), '30');
    assert.ok((await page.locator('#msg').textContent()).includes('30점 / 30점'));
    await page.screenshot({ path: OUT + '/2-game-set.png' });
  });

  await ok('같은 세트 안에서 순서 바꾸기(타일을 다른 타일 앞에 끼워 넣기)', async () => {
    const first = await center('.set .tile:first-child');
    const last = await center('.set .tile:nth-child(3)');
    await drag('.set .tile:nth-child(3)', { x: first.b.x + 2, y: first.y });
    const w = await getWork();
    assert.deepStrictEqual(w.table[0].slice().sort(), [R10, B10, Y10].sort());
    assert.strictEqual(w.table[0][0], Y10);
    assert.ok(last);
    // 원래대로
    await drag('.set .tile:nth-child(1)', { x: (await center('.set')).b.x + (await center('.set')).b.width - 4, y: (await center('.set')).y });
    const w2 = await getWork();
    assert.strictEqual(w2.table[0].length, 3);
  });

  await ok('차례 종료: 첫 등록 통과, 테이블에 반영, 패 2장', async () => {
    await page.click('#b-end');
    await page.waitForTimeout(100);
    const v = await getView();
    assert.strictEqual(v.game.table.length, 1);
    assert.strictEqual(v.myHand.length, 2 + 0); // 1인 연습이라 같은 사람 차례가 이어짐
    assert.ok(v.game.melded[0]);
  });

  await ok('틀린 세트: 1~2장 세트 종료 시도 → 안내 메시지, 되돌리기로 복구', async () => {
    const board = await center('#board');
    await drag(tileSel(K1, '#rack'), { x: board.x + board.b.width / 3, y: board.b.y + board.b.height - 20 });
    const w = await getWork();
    assert.strictEqual(w.table.length, 2);
    assert.ok(await page.locator('.set.wip').count() >= 1);
    await page.click('#b-end');
    await page.waitForTimeout(100);
    const msg = await page.locator('#msg').textContent();
    assert.ok(msg.includes('3장 이상'), msg);
    await page.screenshot({ path: OUT + '/3-invalid.png' });
    await page.click('#b-undo');
    const w2 = await getWork();
    assert.strictEqual(w2.table.length, 1);
    assert.strictEqual(w2.hand.length, 2);
  });

  await ok('테이블에 원래 있던 타일은 패로 가져올 수 없음', async () => {
    const rack = await center('#rack');
    await drag('.set .tile:nth-child(2)', { x: rack.x, y: rack.y });
    const w = await getWork();
    assert.strictEqual(w.table[0].length, 3);
    assert.ok((await page.locator('#msg').textContent()).includes('원래 있던'));
  });

  await ok('등록 후 기존 세트에 이어 붙이기: 같은 색 런 확장은 별도, 그룹 4번째 색 붙이기', async () => {
    // 그룹(R10,B10,Y10)에 검정 10을 붙인다. 먼저 K10 을 패에 넣어 둔다
    const K10 = await T(3, 10);
    await page.evaluate((h) => window.__app.ctl._debugSetHand(0, h), [K10, K1, K2]);
    await page.waitForTimeout(50);
    const s = await center('.set');
    await drag(tileSel(K10, '#rack'), { x: s.b.x + s.b.width - 4, y: s.y });
    const w = await getWork();
    assert.strictEqual(w.table[0].length, 4);
    assert.ok(await page.locator('.set.ok').count() === 1);
    await page.click('#b-end');
    await page.waitForTimeout(100);
    const v = await getView();
    assert.strictEqual(v.game.table[0].length, 4);
  });

  await ok('뽑고 넘기기: 패 +1, 더미 −1', async () => {
    const before = (await getView()).myHand.length;
    const pool = (await getView()).game.poolLeft;
    await page.click('#b-draw');
    await page.waitForTimeout(100);
    const v = await getView();
    assert.strictEqual(v.myHand.length, before + 1);
    assert.strictEqual(v.game.poolLeft, pool - 1);
  });

  await ok('정렬 버튼: 색 정렬 / 숫자 정렬', async () => {
    await page.click('#b-sortn', { timeout: 4000 });
    const w = await getWork();
    const nums = await page.evaluate((h) => h.map((id) => RK.numOf(id)), w.hand);
    const sorted = nums.slice().sort((a, b) => a - b);
    // 조커(0)는 맨 뒤이므로 조커 제외하고 비교
    const noJ = nums.filter((n) => n > 0);
    assert.deepStrictEqual(noJ, noJ.slice().sort((a, b) => a - b));
    assert.ok(sorted);
  });

  await ok('메뉴 → 규칙 보기 모달', async () => {
    await page.click('#b-menu');
    await page.click('#m-help');
    assert.ok((await page.locator('#modal-box').textContent()).includes('루미큐브 규칙'));
    await page.click('#m-close');
    assert.ok(await page.locator('#modal').isHidden());
  });

  await ok('2인 연습: 차례가 바뀌면 가림막, 눌러야 패가 보임', async () => {
    page.on('dialog', (d) => d.accept());
    await page.click('#b-menu'); await page.click('#m-leave');
    await page.waitForSelector('#s-home:not(.hidden)');
    await page.click('[data-tab="local"]');
    await page.selectOption('#ls-players', '2');
    await page.click('#btn-local');
    assert.ok(await page.locator('#cover').isVisible());
    await page.click('#cv-go');
    assert.ok(await page.locator('#cover').isHidden());
    assert.strictEqual(await page.locator('#rack .tile').count(), 14);
    await page.click('#b-draw');
    await page.waitForTimeout(100);
    assert.ok(await page.locator('#cover').isVisible());
    await page.screenshot({ path: OUT + '/4-cover.png' });
  });

  await ok('설정 반영: 조커 없음·패 10개·첫 등록 20점 연습', async () => {
    await page.evaluate(() => window.__app.ctl.leave());
    page.removeAllListeners('dialog');
    await page.reload();
    await page.click('[data-tab="local"]');
    await page.selectOption('#ls-players', '1');
    await page.selectOption('#ls-handSize', '10');
    await page.selectOption('#ls-jokers', '0');
    await page.selectOption('#ls-minMeld', '20');
    await page.click('#btn-local');
    await page.waitForSelector('#s-game:not(.hidden)');
    assert.strictEqual(await page.locator('#rack .tile').count(), 10);
    const jokers = await page.evaluate(() => window.__app.view.myHand.filter(RK.isJoker).length + window.__app.view.game.poolLeft);
    assert.strictEqual(jokers, 104 - 10);
    assert.ok((await page.locator('#msg').textContent()).includes('/ 20점'));
  });

  await ok('패를 모두 내면 결과 화면 (점수·남은 타일)', async () => {
    const set = [await T(0, 11), await T(1, 11), await T(2, 11)];
    await page.evaluate((h) => window.__app.ctl._debugSetHand(0, h), set);
    await page.waitForTimeout(50);
    const board = await center('#board');
    await drag(tileSel(set[0], '#rack'), { x: board.x, y: board.y });
    const s = await center('.set');
    await drag(tileSel(set[1], '#rack'), { x: s.b.x + s.b.width - 4, y: s.y });
    const s2 = await center('.set');
    await drag(tileSel(set[2], '#rack'), { x: s2.b.x + s2.b.width - 4, y: s2.y });
    await page.click('#b-end');
    await page.waitForSelector('#s-result:not(.hidden)');
    assert.ok((await page.locator('#rs-reason').textContent()).includes('패를 모두 냈어요'));
    assert.strictEqual(await page.locator('.rank').count(), 1);
    await page.screenshot({ path: OUT + '/5-result.png' });
    await page.click('#rs-again');
    await page.waitForSelector('#s-game:not(.hidden)');
    assert.strictEqual(await page.locator('#rack .tile').count(), 10);
  });

  /* ----- 모바일 화면 크기 ----- */
  const m = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(FILE);
  await mp.click('[data-tab="local"]');
  await mp.selectOption('#ls-players', '1');
  await mp.click('#btn-local');
  await mp.waitForSelector('#s-game:not(.hidden)');
  await mp.screenshot({ path: OUT + '/6-mobile.png' });
  await ok('모바일: 화면 가로로 넘치지 않음', async () => {
    const w = await mp.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(w[0] <= w[1] + 1, JSON.stringify(w));
  });

  await browser.close();
  results.forEach((r) => console.log(r[0], r[1]));
  const bad = results.filter((r) => r[0] === '✗').length;
  console.log(`\n통과 ${results.length - bad}개 / 실패 ${bad}개`);
  if (errors.length) { console.log('브라우저 오류:'); errors.forEach((e) => console.log('  -', e)); }
  process.exit(bad || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
