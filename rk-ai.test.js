// 실행: node rk-ai.test.js
const assert = require('assert');
const RK = require('./rk-engine.js');
const AI = require('./rk-ai.js');
const T = RK.makeTile;
const J1 = 104, J2 = 105;
const R = 0, B = 1, Y = 2, K = 3;
let passed = 0;
const failed = [];
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failed.push([name, e.message]); } };
const flat = (t) => t.reduce((a, s) => a.concat(s), []);

test('bestMelds: 그룹과 런을 함께 찾음', () => {
  const hand = [T(R, 7), T(B, 7), T(Y, 7), T(K, 2), T(K, 3), T(K, 4), T(R, 1)];
  const m = AI.bestMelds(hand, 0, 5000);
  assert.strictEqual(flat(m).length, 6);
  m.forEach((s) => assert.ok(RK.validateSet(s).valid));
});
test('bestMelds: 첫 등록 점수 미달이면 null', () => {
  assert.strictEqual(AI.bestMelds([T(R, 1), T(R, 2), T(R, 3), T(B, 9)], 30, 5000), null);
});
test('bestMelds: 조커로 빈 숫자 채우기', () => {
  const m = AI.bestMelds([T(Y, 9), T(Y, 11), J1, T(B, 1)], 0, 5000);
  assert.ok(m && m.length === 1 && RK.validateSet(m[0]).valid && m[0].includes(J1));
});
test('보통: 첫 등록 전에는 테이블을 건드리지 않음', () => {
  const table = [[T(R, 4), T(R, 5), T(R, 6)]];
  const mv = AI.chooseMove({ table, hand: [T(R, 7), T(B, 1)], melded: false, minMeld: 30, level: 2 });
  assert.strictEqual(mv, null);
});
test('보통: 등록 후 테이블 세트에 이어 붙임', () => {
  const table = [[T(R, 4), T(R, 5), T(R, 6)], [T(B, 9), T(Y, 9), T(K, 9)]];
  const mv = AI.chooseMove({ table, hand: [T(R, 7), T(R, 9), T(B, 1)], melded: true, minMeld: 30, level: 2 });
  assert.ok(mv);
  assert.deepStrictEqual(mv.hand, [T(B, 1)]);
});
test('쉬움: 이어 붙이기는 가끔만, 재배치는 안 함', () => {
  const table = [[T(R, 4), T(R, 5), T(R, 6)]];
  assert.strictEqual(AI.chooseMove({ table, hand: [T(R, 7), T(B, 1)], melded: true, level: 1, rng: () => 0.9 }), null);
  assert.ok(AI.chooseMove({ table, hand: [T(R, 7), T(B, 1)], melded: true, level: 1, rng: () => 0.3 }));
  const t2 = [[T(R, 4), T(R, 5), T(R, 6), T(R, 7)]];
  assert.strictEqual(AI.chooseMove({ table: t2, hand: [T(B, 4), T(Y, 4)], melded: true, level: 1, rng: () => 0.3 }), null);
});
test('어려움: 세트를 쪼개서 다시 짜기 (런 R4-R7에서 R4를 빼서 R4·B4·Y4 그룹)', () => {
  const table = [[T(R, 4), T(R, 5), T(R, 6), T(R, 7)]];
  const hand = [T(B, 4), T(Y, 4), T(K, 12)];
  const mv = AI.chooseMove({ table, hand, melded: true, level: 3 });
  assert.ok(mv, '어려움은 찾아야 함');
  assert.deepStrictEqual(mv.hand, [T(K, 12)]);
});
test('어려움: 테이블의 조커를 유지한 채 다시 짜기', () => {
  const table = [[T(R, 4), T(R, 5), J1, T(R, 7)], [T(K, 1), T(K, 2), T(K, 3)]];
  const hand = [T(B, 4), T(Y, 4)];
  const mv = AI.chooseMove({ table, hand, melded: true, level: 3 });
  assert.ok(mv);
  assert.ok(flat(mv.table).includes(J1));
});

// 컴퓨터 4명이 끝까지 두는 자동 대국: 모든 수가 규칙을 통과하고 게임이 끝나야 함
function selfPlay(level, seed, opts) {
  const rng = RK.mulberry32(seed);
  let g = RK.newGame(Object.assign({ players: 4, seed }, opts || {}));
  let moves = 0, plays = 0, maxMs = 0;
  while (!g.over && moves < 2000) {
    const t0 = Date.now();
    const mv = AI.chooseMove({ table: g.table, hand: g.hands[g.turn], melded: g.melded[g.turn], minMeld: g.minMeld, level, rng });
    maxMs = Math.max(maxMs, Date.now() - t0);
    if (mv) {
      const r = RK.commitTurn(g, mv.table, mv.hand);
      if (!r.ok) throw new Error('규칙 위반 수: ' + r.message);
      g = r.state; plays++;
    } else g = RK.drawAndPass(g).state;
    moves++;
  }
  return { over: g.over, reason: g.endReason, moves, plays, maxMs, winner: g.winner };
}
const stats = {};
for (const level of [1, 2, 3]) {
  test(`자동 대국 (난이도 ${level}) × 6판: 모든 수 합법, 게임 종료`, () => {
    const res = [];
    for (let s = 1; s <= 6; s++) res.push(selfPlay(level, s * 17 + level));
    res.forEach((r) => assert.ok(r.over, '끝나지 않음'));
    stats[level] = {
      패비움: res.filter((r) => r.reason === 'empty').length,
      평균차례: Math.round(res.reduce((a, r) => a + r.moves, 0) / res.length),
      최대생각ms: Math.max(...res.map((r) => r.maxMs)),
    };
  });
}
test('자동 대국: 조커 없음·패 10장·첫 등록 20점 설정', () => {
  const r = selfPlay(2, 99, { jokers: 0, handSize: 10, minMeld: 20 });
  assert.ok(r.over);
});
test('난이도 비교: 어려움이 보통보다, 보통이 쉬움보다 자주 이김(2:2 대결)', () => {
  let hardWins = 0, normalWins = 0;
  for (let s = 1; s <= 12; s++) {
    const rng = RK.mulberry32(s);
    let g = RK.newGame({ players: 4, seed: 500 + s });
    const lv = (i) => (i % 2 === 0 ? 3 : 2);
    let n = 0;
    while (!g.over && n++ < 2000) {
      const mv = AI.chooseMove({ table: g.table, hand: g.hands[g.turn], melded: g.melded[g.turn], minMeld: g.minMeld, level: lv(g.turn), rng });
      g = mv ? RK.commitTurn(g, mv.table, mv.hand).state : RK.drawAndPass(g).state;
    }
    if (lv(g.winner) === 3) hardWins++; else normalWins++;
  }
  let nWins = 0, eWins = 0;
  for (let s = 1; s <= 12; s++) {
    const rng = RK.mulberry32(s);
    let g = RK.newGame({ players: 4, seed: 900 + s });
    const lv = (i) => (i % 2 === 0 ? 2 : 1);
    let n = 0;
    while (!g.over && n++ < 2000) {
      const mv = AI.chooseMove({ table: g.table, hand: g.hands[g.turn], melded: g.melded[g.turn], minMeld: g.minMeld, level: lv(g.turn), rng });
      g = mv ? RK.commitTurn(g, mv.table, mv.hand).state : RK.drawAndPass(g).state;
    }
    if (lv(g.winner) === 2) nWins++; else eWins++;
  }
  stats.대결 = { 어려움대보통: hardWins + ':' + normalWins, 보통대쉬움: nWins + ':' + eWins };
  assert.ok(hardWins >= normalWins, `어려움 ${hardWins} : 보통 ${normalWins}`);
  assert.ok(nWins >= eWins, `보통 ${nWins} : 쉬움 ${eWins}`);
});

console.log(`통과 ${passed}개 / 실패 ${failed.length}개`);
failed.forEach(([n, m]) => console.log('  ✗', n, '→', m));
console.log('참고:', JSON.stringify(stats));
process.exit(failed.length ? 1 : 0);
