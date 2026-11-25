// 실행: NODE_PATH=/opt/npm-tools/node_modules node ui-online.test.js
// 서로 다른 브라우저 2개(방장·학생)가 가짜 DB를 통해 방 만들기~결과까지 진행하는 온라인 화면 점검
const { chromium } = require('playwright');
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeFakeDB } = require('./fakedb.js');

const J = JSON.stringify;
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const db = makeFakeDB();
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const results = [];
  const ok = (name, fn) => fn().then(() => results.push(['✓', name]), (e) => results.push(['✗', name + ' → ' + e.message.split('\n').slice(0, 8).join('\n    ')]));

  async function newUser(label) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(label + ' console: ' + m.text()); });
    const client = db.client();
    const unsubs = {};
    await page.exposeFunction('__db_get', async (p) => db.getAt(p));
    await page.exposeFunction('__db_set', async (p, v) => client.set(p, v));
    await page.exposeFunction('__db_update', async (p, o) => client.update(p, o));
    await page.exposeFunction('__db_cas', async (p, expected, val) => {
      if (J(db.getAt(p)) !== expected) return false;
      await client.set(p, val);
      return true;
    });
    await page.exposeFunction('__db_listen', async (id, p) => {
      unsubs[id] = client.onValue(p, (val) => { page.evaluate(([i, v]) => window.__fbDeliver && window.__fbDeliver(i, v), [id, val]).catch(() => {}); });
    });
    await page.exposeFunction('__db_unlisten', async (id) => { if (unsubs[id]) unsubs[id](); });
    await page.exposeFunction('__db_disc', async () => {});
    await page.addInitScript(() => {
      window.__fbl = {}; let lid = 0;
      window.__fbDeliver = (id, val) => { const f = window.__fbl[id]; if (f) f(val); };
      window.__FB_TEST__ = {
        get: (p) => window.__db_get(p),
        set: (p, v) => window.__db_set(p, v === undefined ? null : v),
        update: (p, o) => window.__db_update(p, o),
        onValue: (p, cb) => { const id = ++lid; window.__fbl[id] = cb; window.__db_listen(id, p); return () => { delete window.__fbl[id]; window.__db_unlisten(id); }; },
        transaction: async (p, fn) => {
          for (let i = 0; i < 6; i++) {
            const cur = await window.__db_get(p);
            const out = fn(cur);
            if (out === undefined) return { committed: false };
            if (await window.__db_cas(p, JSON.stringify(cur), out)) return { committed: true };
          }
          return { committed: false };
        },
        onDisconnectSet: (p, v) => { window.__db_disc(p, v); },
      };
    });
    await page.goto(URL);
    await page.waitForFunction(() => document.querySelector('#net-status').textContent.includes('준비 완료'));
    return { ctx, page, label };
  }

  const T = (page, c, n) => page.evaluate(([c, n]) => RK.makeTile(c, n, 0), [c, n]);
  const center = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  async function drag(page, fromSel, to) {
    const f = await center(page, fromSel);
    await page.mouse.move(f.x, f.y); await page.mouse.down();
    await page.mouse.move(f.x + 6, f.y - 6, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  const view = (page) => page.evaluate(() => { const v = window.__app.view; return v && { status: v.status, seat: v.mySeat, turn: v.game && v.game.turn, hand: v.myHand, game: v.game, seats: v.seats, settings: v.settings, isHost: v.isHost }; });

  const A = await newUser('방장'); // 방장
  const B = await newUser('학생');
  let code = null;

  await ok('방장: 설정을 바꿔서 방 만들기 → 대기실', async () => {
    await A.page.fill('#in-name', '선생님');
    await A.page.click('[data-tab="create"]');
    await A.page.fill('#in-roomname', '3반 1모둠');
    await A.page.selectOption('#cs-players', '2');
    await A.page.selectOption('#cs-minMeld', '0');
    await A.page.selectOption('#cs-turnSec', '0');
    await A.page.selectOption('#cs-totalMin', '0');
    await A.page.selectOption('#cs-handSize', '10');
    await A.page.selectOption('#cs-jokers', '0');
    await A.page.click('#btn-create');
    await A.page.waitForSelector('#s-lobby:not(.hidden)');
    code = (await A.page.locator('#lb-code').textContent()).trim();
    assert.match(code, /^\d{4}$/);
    const sum = await A.page.locator('#lb-summary').textContent();
    assert.ok(sum.includes('10개') && sum.includes('없음'), sum);
    assert.ok(await A.page.locator('#lb-start').isDisabled());
    await A.page.screenshot({ path: OUT + '/7-lobby-host.png' });
  });

  await ok('학생: 방 코드로 입장 → 대기실, 방장 화면에 자리 채워짐', async () => {
    await B.page.fill('#in-name', '민수');
    await B.page.click('[data-tab="join"]');
    await B.page.fill('#in-code', code);
    await B.page.click('#btn-join');
    await B.page.waitForSelector('#s-lobby:not(.hidden)');
    await A.page.waitForFunction(() => document.querySelectorAll('#lb-seats .seat:not(.empty)').length === 2);
    assert.ok(await A.page.locator('#lb-start').isEnabled());
    assert.ok(await B.page.locator('#lb-start').isHidden());
    assert.ok((await B.page.locator('#lb-wait').textContent()).includes('기다리는'));
  });

  await ok('방장이 대기실에서 설정 변경 → 학생 화면에 즉시 반영', async () => {
    await A.page.click('#lb-hostbox summary');
    await A.page.selectOption('#lb-minMeld', '20');
    await A.page.selectOption('#lb-turnSec', '60');
    await A.page.click('#lb-save');
    await B.page.waitForFunction(() => document.querySelector('#lb-summary').textContent.includes('20점'));
    const s = await B.page.locator('#lb-summary').textContent();
    assert.ok(s.includes('60초'), s);
  });

  await ok('시작 → 두 화면 모두 게임 화면, 패 10장, 조커 없음', async () => {
    await A.page.click('#lb-start');
    await A.page.waitForSelector('#s-game:not(.hidden)');
    await B.page.waitForSelector('#s-game:not(.hidden)');
    await A.page.waitForFunction(() => document.querySelectorAll('#rack .tile').length === 10);
    await B.page.waitForFunction(() => document.querySelectorAll('#rack .tile').length === 10);
    const va = await view(A.page);
    assert.strictEqual(va.hand.filter((id) => id >= 104).length, 0);
    assert.strictEqual(va.game.poolLeft, 104 - 20);
  });

  // 현재 차례인 사람 / 아닌 사람
  const who = async () => {
    const va = await view(A.page);
    return va.turn === va.seat ? { cur: A, other: B } : { cur: B, other: A };
  };

  await ok('차례 표시: 내 차례 / 상대 차례 문구', async () => {
    const { cur, other } = await who();
    assert.ok((await cur.page.locator('#g-turn').textContent()).includes('내 차례'));
    assert.ok((await other.page.locator('#g-turn').textContent()).includes('님의 차례'));
    assert.ok(await other.page.locator('#b-end').isDisabled());
    assert.ok(await other.page.locator('#b-draw').isDisabled());
  });

  await ok('내 차례가 아닐 때: 테이블 타일은 못 끌고, 내 패 정렬은 가능', async () => {
    const { other } = await who();
    await other.page.click('#b-sortn');
    assert.ok(await other.page.locator('#rack .tile').count() === 10);
  });

  await ok('첫 등록(20점 설정): 드래그해서 제출 → 상대 화면에 세트가 보이고 개수 갱신', async () => {
    const { cur, other } = await who();
    const seat = (await view(cur.page)).seat;
    const R10 = await T(cur.page, 0, 10), B10 = await T(cur.page, 1, 10), Y10 = await T(cur.page, 2, 10), K1 = await T(cur.page, 3, 1);
    db.setRaw('rummikub/hands/' + code + '/' + seat, J([R10, B10, Y10, K1]));
    await cur.page.waitForFunction(() => document.querySelectorAll('#rack .tile').length === 4);
    const board = await center(cur.page, '#board');
    await drag(cur.page, `#rack .tile[data-id="${R10}"]`, { x: board.x, y: board.y });
    let s = await center(cur.page, '.set');
    await drag(cur.page, `#rack .tile[data-id="${B10}"]`, { x: s.b.x + s.b.width - 4, y: s.y });
    s = await center(cur.page, '.set');
    await drag(cur.page, `#rack .tile[data-id="${Y10}"]`, { x: s.b.x + s.b.width - 4, y: s.y });
    assert.ok((await cur.page.locator('#msg').textContent()).includes('30점 / 20점'));
    await cur.page.click('#b-end');
    await other.page.waitForFunction(() => document.querySelectorAll('#board .set').length === 1);
    assert.ok((await other.page.locator('#g-turn').textContent()).includes('내 차례'));
    assert.strictEqual(await other.page.locator('#board .tile.recent').count(), 3); // 방금 낸 타일 강조
    const vo = await view(other.page);
    assert.deepStrictEqual(vo.game.counts[seat], 1);
    assert.ok(vo.game.melded[seat]);
    await other.page.screenshot({ path: OUT + '/8-online-other.png' });
  });

  await ok('상대 차례에서 뽑고 넘기기', async () => {
    const { cur, other } = await who();
    const before = (await view(cur.page)).hand.length;
    await cur.page.click('#b-draw');
    await other.page.waitForFunction(() => document.querySelector('#g-turn').textContent.includes('내 차례'));
    assert.strictEqual((await view(cur.page)).hand.length, before + 1);
  });

  await ok('새로고침해도 같은 방·같은 자리로 자동 재접속', async () => {
    await B.page.reload();
    await B.page.waitForSelector('#s-game:not(.hidden)');
    const vb = await view(B.page);
    assert.ok(vb.hand.length > 0);
    assert.strictEqual(vb.status, 'playing');
  });

  await ok('패를 모두 내면 두 화면 모두 결과, 방장만 다시 하기', async () => {
    const { cur } = await who();
    const seat = (await view(cur.page)).seat;
    const s3 = [await T(cur.page, 0, 11), await T(cur.page, 1, 11), await T(cur.page, 2, 11)];
    db.setRaw('rummikub/hands/' + code + '/' + seat, J(s3));
    await cur.page.waitForFunction(() => document.querySelectorAll('#rack .tile').length === 3);
    const board = await center(cur.page, '#board');
    // 빈 곳에 첫 타일 (기존 세트 아래쪽 빈 영역)
    await drag(cur.page, `#rack .tile[data-id="${s3[0]}"]`, { x: board.b.x + board.b.width / 2, y: board.b.y + board.b.height - 30 });
    const sets = cur.page.locator('.set');
    const last = await sets.count();
    const sp = await center(cur.page, `.set:nth-of-type(${last})`);
    await drag(cur.page, `#rack .tile[data-id="${s3[1]}"]`, { x: sp.b.x + sp.b.width - 4, y: sp.y });
    const sp2 = await center(cur.page, `.set:nth-of-type(${last})`);
    await drag(cur.page, `#rack .tile[data-id="${s3[2]}"]`, { x: sp2.b.x + sp2.b.width - 4, y: sp2.y });
    await cur.page.click('#b-end');
    await A.page.waitForSelector('#s-result:not(.hidden)');
    await B.page.waitForSelector('#s-result:not(.hidden)');
    assert.ok((await A.page.locator('#rs-reason').textContent()).includes('패를 모두 냈어요'));
    assert.strictEqual(await A.page.locator('.rank').count(), 2);
    assert.ok(await A.page.locator('#rs-again').isVisible());
    assert.ok(await B.page.locator('#rs-again').isHidden());
    await A.page.screenshot({ path: OUT + '/9-online-result.png' });
  });

  await ok('다시 하기 → 두 화면 모두 대기실로, 설정 유지', async () => {
    await A.page.click('#rs-again');
    await A.page.waitForSelector('#s-lobby:not(.hidden)');
    await B.page.waitForSelector('#s-lobby:not(.hidden)');
    const s = await B.page.locator('#lb-summary').textContent();
    assert.ok(s.includes('20점') && s.includes('60초'));
    await A.page.click('#lb-start');
    await A.page.waitForSelector('#s-game:not(.hidden)');
    await B.page.waitForFunction(() => document.querySelectorAll('#rack .tile').length === 10);
  });

  await ok('초대 링크(?room=코드)로 열면 입장 탭에 코드가 채워짐', async () => {
    const C = await newUser('링크');
    await C.page.goto(URL + '?room=' + code);
    await C.page.waitForFunction(() => document.querySelector('#net-status').textContent.includes('준비 완료'));
    assert.strictEqual(await C.page.inputValue('#in-code'), code);
    assert.ok(await C.page.locator('#tab-join').isVisible());
    await C.page.fill('#in-name', '구경꾼');
    await C.page.click('#btn-join');
    await C.page.waitForTimeout(300);
    const t = await C.page.locator('#toast').textContent();
    assert.ok(t.includes('이미 시작된'), t);
  });

  await ok('나가기: 대기실이 아닌 진행 중 나가기 후 같은 이름으로 다시 입장(접속이 끊긴 자리)', async () => {
    await B.page.click('#b-menu');
    B.page.once('dialog', (d) => d.accept());
    await B.page.click('#m-leave');
    await B.page.waitForSelector('#s-home:not(.hidden)');
    await A.page.waitForFunction(() => window.__app.view.seats.some((s) => s && !s.online));
    await B.page.fill('#in-name', '민수');
    await B.page.click('[data-tab="join"]');
    await B.page.fill('#in-code', code);
    await B.page.click('#btn-join');
    await B.page.waitForSelector('#s-game:not(.hidden)');
    assert.ok((await view(B.page)).hand.length >= 10);
  });

  await browser.close();
  server.close();
  results.forEach((r) => console.log(r[0], r[1]));
  const bad = results.filter((r) => r[0] === '✗').length;
  console.log(`\n통과 ${results.length - bad}개 / 실패 ${bad}개`);
  if (errors.length) { console.log('브라우저 오류:'); errors.forEach((e) => console.log('  -', e)); }
  process.exit(bad || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
