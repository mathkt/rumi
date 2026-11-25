// 실행: node rk-net.test.js
// 가짜 DB(실제 Firebase와 같은 규약)로 4명이 동시에 접속하는 상황을 검증한다.
const assert = require('assert');
const RK = require('./rk-engine.js');
const { createNet, thinkMs } = require('./rk-net.js');
const AI = require('./rk-ai.js');

const J = JSON.stringify;
const T = RK.makeTile;
const R = 0, B = 1, Y = 2, K = 3;
const flush = () => new Promise((r) => setTimeout(r, 8));

const { makeFakeDB } = require('./fakedb.js');

/* ---------- 테스트 도구 ---------- */
let passed = 0;
const failed = [];
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

let clockNow = 1000000;
const clock = () => clockNow;

function world() {
  const db = makeFakeDB();
  const mk = (cid) => {
    const fb = db.client();
    return { fb, net: createNet(fb, RK, { cid, now: clock, AI }) };
  };
  return { db, mk };
}

async function fullRoom(settings, pw) {
  const w = world();
  const names = ['선생님', '가', '나', '다'];
  const cs = ['h', 'a', 'b', 'c'].map((c) => w.mk(c));
  const n = (settings && settings.players) || 4;
  const { code } = await cs[0].net.createRoom({ name: names[0], settings: Object.assign({ turnSec: 60, totalMin: 20 }, settings), pw });
  for (let i = 1; i < n; i++) await cs[i].net.joinRoom({ code, name: names[i], pw });
  return { w, cs: cs.slice(0, n), code };
}
const byTurn = (cs) => cs.find((c) => c.net.seat === c.net.getView().game.turn);

/* ---------- 테스트 ---------- */
test('방 만들기·입장: 비밀번호, 만원, 코드 오류', async () => {
  const { cs, code } = await fullRoom({ players: 3 }, '77');
  const w2 = cs[0];
  const extra = world().mk('z');
  await assert.rejects(extra.net.joinRoom({ code: '0000', name: 'x' }), /그런 방이 없어요/);
  const w = world();
  const h = w.mk('h'), a = w.mk('a'), b = w.mk('b'), c = w.mk('c');
  const r = await h.net.createRoom({ name: '방장', settings: { players: 2 }, pw: '9' });
  await assert.rejects(a.net.joinRoom({ code: r.code, name: '가', pw: '1' }), /비밀번호/);
  await a.net.joinRoom({ code: r.code, name: '가', pw: '9' });
  await assert.rejects(b.net.joinRoom({ code: r.code, name: '나', pw: '9' }), /가득/);
  const v = h.net.getView();
  assert.strictEqual(v.seats.length, 2); assert.strictEqual(v.seats[1].name, '가'); assert.ok(v.isHost);
  assert.ok(!a.net.getView().isHost);
  assert.ok(c && w2);
});

test('첫 데이터가 비동기로 도착해도: 처음엔 loading, 곧 lobby (방이 없다고 잘못 판단하지 않음)', async () => {
  const db = makeFakeDB({ asyncInitial: true });
  const fb = db.client();
  const net = createNet(fb, RK, { cid: 'h', now: clock });
  await net.createRoom({ name: '방장', settings: { players: 2 } });
  assert.strictEqual(net.getView().status, 'loading');
  await flush();
  assert.strictEqual(net.getView().status, 'lobby');
  assert.strictEqual(net.getView().seats[0].name, '방장');
  // 없는 방으로 resume하려 하면 오류, 방이 사라지면 gone
  const other = createNet(db.client(), RK, { cid: 'x', now: clock });
  await assert.rejects(other.resume({ code: '0000', seat: 0 }), /방이 없어졌어요/);
  await net.leave(); await flush();
});

test('시작: 방장만, 자리가 다 차야 함, 14장씩·더미 50장', async () => {
  const w = world();
  const cs = ['h', 'a', 'b', 'c'].map((c) => w.mk(c));
  const { code } = await cs[0].net.createRoom({ name: '방장', settings: { players: 4 } });
  await cs[1].net.joinRoom({ code, name: '가' });
  await assert.rejects(cs[0].net.startGame(), /모든 자리/);
  await cs[2].net.joinRoom({ code, name: '나' });
  await cs[3].net.joinRoom({ code, name: '다' });
  await assert.rejects(cs[1].net.startGame(), /방장만/);
  await cs[0].net.startGame();
  await flush();
  cs.forEach((c) => {
    const v = c.net.getView();
    assert.strictEqual(v.status, 'playing');
    assert.strictEqual(v.myHand.length, 14);
    assert.deepStrictEqual(v.game.counts, [14, 14, 14, 14]);
    assert.strictEqual(v.game.poolLeft, 50);
  });
  const hands = cs.map((c) => c.net.getView().myHand).flat();
  assert.strictEqual(new Set(hands).size, 56);
});

test('설정이 게임에 반영됨: 조커 0개·패 10장·인원 3명', async () => {
  const { cs } = await fullRoom({ players: 3, jokers: 0, handSize: 10 });
  await cs[0].net.startGame();
  await flush();
  const v = cs[1].net.getView();
  assert.strictEqual(v.myHand.length, 10);
  assert.strictEqual(v.game.poolLeft, 104 - 30);
  assert.ok(!v.pool.some(RK.isJoker));
});

test('설정 변경: 대기실에서만, 들어온 인원보다 줄일 수 없음', async () => {
  const w = world();
  const h = w.mk('h'), a = w.mk('a'), b = w.mk('b');
  const { code } = await h.net.createRoom({ name: '방장', settings: { players: 4 } });
  await a.net.joinRoom({ code, name: '가' });
  await b.net.joinRoom({ code, name: '나' });
  await assert.rejects(h.net.updateSettings({ players: 2 }), /줄일 수 없어요/);
  await h.net.updateSettings({ players: 3, minMeld: 20, turnSec: 120 });
  await flush();
  const s = a.net.getView().settings;
  assert.strictEqual(s.players, 3); assert.strictEqual(s.minMeld, 20); assert.strictEqual(s.turnSec, 120);
  await assert.rejects(a.net.updateSettings({ players: 4 }), /방장만/);
});

test('뽑고 넘기기: 패 +1, 더미 −1, 모두의 화면이 갱신', async () => {
  const { cs } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const me = byTurn(cs);
  const t = me.net.seat;
  const r = await me.net.drawPass();
  await flush();
  assert.ok(r.ok && r.drew);
  cs.forEach((c) => {
    const g = c.net.getView().game;
    assert.strictEqual(g.turn, (t + 1) % 4);
    assert.strictEqual(g.poolLeft, 49);
    assert.strictEqual(g.counts[t], 15);
  });
  assert.strictEqual(me.net.getView().myHand.length, 15);
});

test('내 차례가 아니면 뽑기·제출 불가', async () => {
  const { cs } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const other = cs.find((c) => c.net.seat !== c.net.getView().game.turn);
  const r = await other.net.drawPass();
  assert.ok(!r.ok);
  const r2 = await other.net.commit([], other.net.getView().myHand);
  assert.ok(!r2.ok);
});

test('제출: 규칙 위반 메시지, 첫 등록 통과 후 모두에게 보임', async () => {
  const { w, cs, code } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const me = byTurn(cs);
  const s = me.net.seat;
  const hand = [T(R, 10), T(B, 10), T(Y, 10), T(K, 1), T(K, 2)];
  w.db.setRaw('rummikub/hands/' + code + '/' + s, J(hand)); await flush();
  const bad = await me.net.commit([[T(R, 10), T(B, 10)]], [T(Y, 10), T(K, 1), T(K, 2)]);
  assert.ok(!bad.ok); assert.deepStrictEqual(bad.badSets, [0]);
  const low = await me.net.commit([[T(K, 1), T(K, 2), T(R, 10)].slice(0, 0)].filter((x) => x.length), hand);
  assert.ok(!low.ok); assert.strictEqual(low.code, 'NO_TILE_PLACED');
  const ok = await me.net.commit([[T(R, 10), T(B, 10), T(Y, 10)]], [T(K, 1), T(K, 2)]);
  await flush();
  assert.ok(ok.ok, ok.message);
  cs.forEach((c) => {
    const g = c.net.getView().game;
    assert.deepStrictEqual(g.table, [[T(R, 10), T(B, 10), T(Y, 10)]]);
    assert.strictEqual(g.melded[s], true);
    assert.strictEqual(g.counts[s], 2);
    assert.strictEqual(g.turn, (s + 1) % 4);
    assert.deepStrictEqual(g.lastPlaced, [T(R, 10), T(B, 10), T(Y, 10)]);
  });
  assert.deepStrictEqual(me.net.getView().myHand, [T(K, 1), T(K, 2)]);
});

test('첫 등록 30점 미만은 거절', async () => {
  const { w, cs, code } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const me = byTurn(cs);
  const hand = [T(R, 3), T(B, 3), T(Y, 3), T(K, 1)];
  w.db.setRaw('rummikub/hands/' + code + '/' + me.net.seat, J(hand)); await flush();
  const r = await me.net.commit([[T(R, 3), T(B, 3), T(Y, 3)]], [T(K, 1)]);
  assert.ok(!r.ok); assert.strictEqual(r.code, 'MELD_TOO_LOW');
});

test('패를 모두 내면 승리: 점수 합 0, 모두 패 공개, 상태 over', async () => {
  const { w, cs, code } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const me = byTurn(cs);
  const s = me.net.seat;
  const set = [T(R, 11), T(B, 11), T(Y, 11)];
  w.db.setRaw('rummikub/hands/' + code + '/' + s, J(set)); await flush();
  const r = await me.net.commit([set], []);
  await flush();
  assert.ok(r.ok, r.message);
  cs.forEach((c) => {
    const v = c.net.getView();
    assert.strictEqual(v.status, 'over');
    assert.strictEqual(v.game.winner, s);
    assert.strictEqual(v.game.endReason, 'empty');
    assert.strictEqual(v.game.scores.reduce((a, b) => a + b, 0), 0);
    assert.strictEqual(v.game.finalHands.length, 4);
    assert.ok(v.game.scores[s] > 0);
  });
});

test('다시 하기: 방장이 대기실로 되돌리고 다시 시작', async () => {
  const { w, cs, code } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const me = byTurn(cs);
  const set = [T(R, 11), T(B, 11), T(Y, 11)];
  w.db.setRaw('rummikub/hands/' + code + '/' + me.net.seat, J(set)); await flush();
  await me.net.commit([set], []); await flush();
  await cs[1].net.rematch(); await flush();
  assert.strictEqual(cs[0].net.getView().status, 'over'); // 방장이 아니면 무시됨
  await cs[0].net.rematch(); await flush();
  assert.strictEqual(cs[2].net.getView().status, 'lobby');
  assert.strictEqual(cs[2].net.getView().game, null);
  await cs[0].net.startGame(); await flush();
  assert.strictEqual(cs[3].net.getView().myHand.length, 14);
});

test('시간 초과: 내 차례가 시간이 지나면 자동으로 뽑고 넘김', async () => {
  const { cs } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const me = byTurn(cs);
  const s = me.net.seat;
  me.net.tick(); await flush();
  assert.strictEqual(me.net.getView().game.turn, s); // 아직 시간 안 지남
  clockNow += 61 * 1000;
  me.net.tick(); await flush();
  const v = me.net.getView();
  assert.strictEqual(v.game.turn, (s + 1) % 4);
  assert.strictEqual(v.myHand.length, 15);
});

test('자리를 비운 사람 대신 넘기기: 시간 + 유예 후 가장 앞 번호의 접속자가 처리', async () => {
  const { cs, code, w } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  const stalled = byTurn(cs);
  const s = stalled.net.seat;
  clockNow += 61 * 1000;
  cs.forEach((c) => c.net.tick()); await flush(); // 유예 전: 본인만 처리 가능 → 본인이 tick하면 처리됨
  // 본인(stalled)은 tick 했으므로 처리됨 → 다시 한 번 시나리오: 다음 사람이 멈춘 경우
  const v1 = cs[0].net.getView();
  assert.strictEqual(v1.game.turn, (s + 1) % 4);
  const stalled2 = byTurn(cs);
  const s2 = stalled2.net.seat;
  clockNow += 61 * 1000;
  cs.filter((c) => c !== stalled2).forEach((c) => c.net.tick()); await flush(); // 유예 전: 아무도 안 함
  assert.strictEqual(cs[0].net.getView().game.turn, s2);
  clockNow += 6 * 1000;
  cs.filter((c) => c !== stalled2).forEach((c) => c.net.tick()); await flush();
  const g = cs[0].net.getView().game;
  assert.strictEqual(g.turn, (s2 + 1) % 4);
  assert.strictEqual(g.counts[s2], 15);
  const hand = JSON.parse(w.db.getAt('rummikub/hands/' + code + '/' + s2));
  assert.strictEqual(hand.length, 15);
});

test('총 제한 시간 종료: 가장 낮은 번호의 접속자가 정산, 감점 낮은 사람 승리', async () => {
  const { cs, code, w } = await fullRoom({ totalMin: 20, turnSec: 0 });
  await cs[0].net.startGame(); await flush();
  const hands = [[T(R, 9)], [T(R, 2)], [T(R, 5)], [T(R, 7)]];
  hands.forEach((h, i) => w.db.setRaw('rummikub/hands/' + code + '/' + i, J(h)));
  await flush();
  clockNow += 20 * 60 * 1000 + 1;
  cs.forEach((c) => c.net.tick()); await flush();
  const v = cs[3].net.getView();
  assert.strictEqual(v.status, 'over');
  assert.strictEqual(v.game.endReason, 'timeup');
  assert.strictEqual(v.game.winner, 1);
  assert.strictEqual(v.game.scores.reduce((a, b) => a + b, 0), 0);
});

test('더미가 비고 모두 넘기면 교착 종료', async () => {
  const { cs, code, w } = await fullRoom({ totalMin: 0, turnSec: 0 });
  await cs[0].net.startGame(); await flush();
  const hands = [[T(R, 9)], [T(R, 2)], [T(R, 5)], [T(R, 7)]];
  hands.forEach((h, i) => w.db.setRaw('rummikub/hands/' + code + '/' + i, J(h)));
  w.db.setRaw('rummikub/rooms/' + code + '/poolJson', '[]');
  await flush();
  for (let i = 0; i < 4; i++) {
    const me = byTurn(cs);
    const r = await me.net.drawPass(); await flush();
    assert.ok(r.ok);
  }
  const v = cs[0].net.getView();
  assert.strictEqual(v.status, 'over');
  assert.strictEqual(v.game.endReason, 'stalemate');
  assert.strictEqual(v.game.winner, 1);
});

test('방장이 게임 끝내기: 감점으로 정산', async () => {
  const { cs } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  await cs[1].net.endGame(); await flush();
  assert.strictEqual(cs[0].net.getView().status, 'playing');
  await cs[0].net.endGame(); await flush();
  assert.strictEqual(cs[2].net.getView().status, 'over');
  assert.strictEqual(cs[2].net.getView().game.endReason, 'host');
});

test('접속 끊김 → 접속 표시, 같은 기기 재접속(resume), 다른 기기는 같은 이름으로 이어받기', async () => {
  const { w, cs, code } = await fullRoom();
  await cs[0].net.startGame(); await flush();
  cs[2]._off = true;
  cs[2].fb._disconnect(); await flush();
  assert.strictEqual(cs[0].net.getView().seats[2].online, false);
  // 같은 기기(같은 cid) 새 페이지
  const again = w.mk('b');
  await again.net.resume({ code, seat: 2 }); await flush();
  assert.strictEqual(cs[0].net.getView().seats[2].online, true);
  assert.strictEqual(again.net.getView().myHand.length, 14);
  // 다른 기기 + 같은 이름, 접속이 끊긴 상태에서만 가능
  const other = w.mk('zzz');
  await assert.rejects(other.net.joinRoom({ code, name: '나' }), /이미 시작된 방/);
  again.fb._disconnect(); await flush();
  await other.net.joinRoom({ code, name: '나' }); await flush();
  assert.strictEqual(other.net.seat, 2);
  assert.strictEqual(other.net.getView().myHand.length, 14);
  // 다른 이름은 불가
  const stranger = w.mk('yyy');
  await assert.rejects(stranger.net.joinRoom({ code, name: '모르는사람' }), /이미 시작된 방/);
  // 엉뚱한 기기는 resume 불가
  await assert.rejects(w.mk('qqq').net.resume({ code, seat: 2 }), /자리를 찾을 수 없어요/);
});

test('대기실 나가기: 자리가 비고, 방장이 나가면 방장 이전, 모두 나가면 방 삭제', async () => {
  const w = world();
  const h = w.mk('h'), a = w.mk('a');
  const { code } = await h.net.createRoom({ name: '방장', settings: { players: 3 } });
  await a.net.joinRoom({ code, name: '가' });
  await h.net.leave(); await flush();
  assert.ok(a.net.getView().isHost);
  assert.strictEqual(a.net.getView().seats[0], null);
  await a.net.leave(); await flush();
  assert.strictEqual(w.db.getAt('rummikub/rooms/' + code), null);
});

test('방장이 대기실에서 내보내기', async () => {
  const w = world();
  const h = w.mk('h'), a = w.mk('a');
  const { code } = await h.net.createRoom({ name: '방장', settings: { players: 2 } });
  await a.net.joinRoom({ code, name: '가' }); await flush();
  await h.net.kick(1); await flush();
  assert.strictEqual(h.net.getView().seats[1], null);
});


test('컴퓨터 넣기: 방장만, 빈자리에만, 모두 채우면 시작 가능, 빼기 가능', async () => {
  const w = world();
  const h = w.mk('h'), a = w.mk('a');
  const { code } = await h.net.createRoom({ name: '선생님', settings: { players: 4, aiLevel: 1 } });
  await a.net.joinRoom({ code, name: '가' });
  await a.net.addBot(2); await flush();
  assert.strictEqual(h.net.getView().seats[2], null); // 방장 아님 → 무시
  await h.net.addBot(1); await flush();             // 이미 사람이 있는 자리 → 무시
  assert.strictEqual(h.net.getView().seats[1].name, '가');
  await h.net.fillBots(); await flush();
  const v = a.net.getView();
  assert.ok(v.seats[2].bot && v.seats[3].bot);
  assert.strictEqual(v.seats[2].name, '컴퓨터3');
  assert.strictEqual(v.settings.aiLevel, 1);
  await h.net.kick(3); await flush();
  assert.strictEqual(h.net.getView().seats[3], null);
  await h.net.addBot(3); await flush();
  await assert.rejects(w.mk('n').net.joinRoom({ code, name: '나' }), /가득/);
  await h.net.startGame(); await flush();
  assert.strictEqual(a.net.getView().status, 'playing');
});

test('사람 1 + 컴퓨터 3: 방장 화면이 컴퓨터 차례를 둬서 다시 내 차례로 돌아옴', async () => {
  const w = world();
  const h = w.mk('h');
  const { code } = await h.net.createRoom({ name: '선생님', settings: { players: 4, turnSec: 60, totalMin: 0 } });
  await h.net.fillBots(); await h.net.startGame(); await flush();
  let guard = 0;
  // 컴퓨터 차례면 생각 시간을 지나게 하고 tick
  while (h.net.getView().game.turn !== 0 && guard++ < 10) {
    h.net.tick(); await flush();
    assert.notStrictEqual(h.net.getView().game.turn, -1);
    clockNow += 3100;
    h.net.tick(); await flush(); await flush();
  }
  assert.strictEqual(h.net.getView().game.turn, 0);
  // 한 바퀴 더: 내가 뽑고 넘기면 컴퓨터 셋이 두고 돌아옴
  await h.net.drawPass(); await flush();
  const seq0 = h.net.getView().game.seq;
  for (let i = 0; i < 3; i++) {
    h.net.tick(); await flush();               // 생각 시간 전에는 두지 않음
    assert.strictEqual(h.net.getView().game.seq, seq0 + i);
    clockNow += 3100;
    h.net.tick(); await flush(); await flush();
    assert.strictEqual(h.net.getView().game.seq, seq0 + i + 1);
  }
  const g = h.net.getView().game;
  assert.strictEqual(g.turn, 0);
  // 컴퓨터의 패 수는 더미·테이블과 합이 맞아야 함
  const hands = [1, 2, 3].map((i) => JSON.parse(w.db.getAt('rummikub/hands/' + code + '/' + i)));
  hands.forEach((hd, k) => assert.strictEqual(hd.length, g.counts[k + 1]));
  const all = [...JSON.parse(w.db.getAt('rummikub/hands/' + code + '/0')), ...hands.flat(), ...g.table.flat(), ...h.net.getView().pool.slice(g.poolPos)];
  assert.strictEqual(new Set(all).size, 106);
  assert.strictEqual(all.length, 106);
});

test('컴퓨터 차례는 방장(실행 담당) 한 명만 처리, 방장이 끊기면 다음 사람이 이어받음', async () => {
  const w = world();
  const h = w.mk('h'), a = w.mk('a');
  const { code } = await h.net.createRoom({ name: '선생님', settings: { players: 3, turnSec: 0, totalMin: 0 } });
  await a.net.joinRoom({ code, name: '가' });
  await h.net.fillBots(); await h.net.startGame(); await flush();
  // 컴퓨터(2번) 차례로 만든다
  w.db.setRaw('rummikub/rooms/' + code + '/game/turn', 2); await flush();
  clockNow += 3100;
  a.net.tick(); await flush(); await flush();
  assert.strictEqual(a.net.getView().game.turn, 2); // 학생 화면은 손대지 않음
  h.fb._disconnect(); await flush();
  assert.strictEqual(a.net.getView().seats[0].online, false);
  a.net.tick(); await flush(); await flush();
  assert.strictEqual(a.net.getView().game.turn, 0); // 학생 화면이 이어받아 둠
});

test('끊긴 사람 자리를 컴퓨터로 대신 → 컴퓨터가 두고, 같은 이름으로 들어오면 돌려받음', async () => {
  const { w, cs, code } = await fullRoom({ players: 3, turnSec: 0, totalMin: 0 });
  await cs[0].net.startGame(); await flush();
  cs[1].fb._disconnect(); await flush();
  assert.strictEqual(await cs[2].net.takeoverOffline(), 0); // 방장만
  assert.strictEqual(await cs[0].net.takeoverOffline(), 1); await flush();
  assert.ok(cs[2].net.getView().seats[1].ai);
  w.db.setRaw('rummikub/rooms/' + code + '/game/turn', 1); await flush();
  const seq = cs[0].net.getView().game.seq;
  clockNow += 3100;
  cs[0].net.tick(); await flush(); await flush();
  assert.strictEqual(cs[0].net.getView().game.turn, 2);
  assert.ok(cs[0].net.getView().game.seq > seq);
  const back = w.mk('a-new');
  await back.net.joinRoom({ code, name: '가' }); await flush();
  const s1 = cs[0].net.getView().seats[1];
  assert.ok(s1.online && !s1.ai);
});

test('컴퓨터만 남기고 방장이 대기실에서 나가면 방 삭제', async () => {
  const w = world();
  const h = w.mk('h');
  const { code } = await h.net.createRoom({ name: '선생님', settings: { players: 2 } });
  await h.net.fillBots(); await flush();
  await h.net.leave(); await flush();
  assert.strictEqual(w.db.getAt('rummikub/rooms/' + code), null);
});

test('생각 시간은 1.5~3초', () => {
  for (let i = 0; i < 50; i++) { const t = thinkMs(i); assert.ok(t >= 1500 && t < 3000); }
});

(async () => {
  for (const [name, fn] of tests) {
    clockNow = 1000000;
    try { await fn(); passed++; } catch (e) { failed.push([name, e.stack.split('\n').slice(0, 3).join(' | ')]); }
  }
  console.log(`통과 ${passed}개 / 실패 ${failed.length}개`);
  failed.forEach(([n, m]) => console.log('  ✗', n, '→', m));
  process.exit(failed.length ? 1 : 0);
})();
