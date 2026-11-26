// 실행: node rk-engine.test.js
const assert = require('assert');
const RK = require('./rk-engine.js');

const T = RK.makeTile; // T(색0~3, 숫자, 복사본)
const J1 = 104, J2 = 105;
const R = 0, B = 1, Y = 2, K = 3; // 빨강 파랑 노랑 검정

let passed = 0;
const failed = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed.push([name, e.message]); }
}

/* ----- 덱 ----- */
test('덱: 106개, 중복 없음, 조커 2개', () => {
  const d = RK.createDeck();
  assert.strictEqual(d.length, 106);
  assert.strictEqual(new Set(d).size, 106);
  assert.strictEqual(d.filter(RK.isJoker).length, 2);
});
test('덱: (색,숫자) 조합마다 정확히 2장', () => {
  const cnt = {};
  RK.createDeck().filter((id) => !RK.isJoker(id)).forEach((id) => {
    const k = RK.colorOf(id) + '-' + RK.numOf(id);
    cnt[k] = (cnt[k] || 0) + 1;
  });
  assert.strictEqual(Object.keys(cnt).length, 52);
  Object.values(cnt).forEach((v) => assert.strictEqual(v, 2));
});
test('makeTile ↔ colorOf/numOf 일치', () => {
  for (let c = 0; c < 4; c++) for (let n = 1; n <= 13; n++) for (let k = 0; k < 2; k++) {
    const id = T(c, n, k);
    assert.strictEqual(RK.colorOf(id), c);
    assert.strictEqual(RK.numOf(id), n);
  }
});

/* ----- 그룹 ----- */
test('그룹: 3장·4장 유효', () => {
  assert.ok(RK.validateSet([T(R, 7), T(B, 7), T(Y, 7)]).valid);
  const g = RK.validateSet([T(R, 7), T(B, 7), T(Y, 7), T(K, 7)]);
  assert.ok(g.valid); assert.strictEqual(g.points, 28);
});
test('그룹: 같은 색 중복 불가', () => {
  assert.ok(!RK.validateSet([T(R, 7), T(R, 7, 1), T(Y, 7)]).valid);
});
test('그룹: 5장 불가, 2장 불가', () => {
  assert.ok(!RK.validateSet([T(R, 7), T(B, 7), T(Y, 7), T(K, 7), J1]).valid);
  assert.ok(!RK.validateSet([T(R, 7), T(B, 7)]).valid);
});
test('그룹: 조커 포함 유효, 점수는 숫자×장수', () => {
  const g = RK.validateSet([T(R, 9), T(B, 9), J1]);
  assert.ok(g.valid); assert.strictEqual(g.points, 27);
});
test('그룹: 숫자가 다르면 불가', () => {
  assert.ok(!RK.validateSet([T(R, 7), T(B, 8), T(Y, 7)]).valid);
});

/* ----- 런 ----- */
test('런: 같은 색 연속 3장 유효, 점수 합', () => {
  const r = RK.validateSet([T(B, 4), T(B, 5), T(B, 6)]);
  assert.ok(r.valid); assert.strictEqual(r.kind, 'run'); assert.strictEqual(r.points, 15);
});
test('런: 순서가 틀리면 불가(배열 순서가 곧 배치)', () => {
  assert.ok(!RK.validateSet([T(B, 5), T(B, 4), T(B, 6)]).valid);
});
test('런: 색이 섞이면 불가', () => {
  assert.ok(!RK.validateSet([T(B, 4), T(R, 5), T(B, 6)]).valid);
});
test('런: 13→1 순환 불가', () => {
  assert.ok(!RK.validateSet([T(R, 12), T(R, 13), T(R, 1)]).valid);
});
test('런: 1부터·13까지는 유효', () => {
  assert.ok(RK.validateSet([T(R, 1), T(R, 2), T(R, 3)]).valid);
  assert.ok(RK.validateSet([T(R, 11), T(R, 12), T(R, 13)]).valid);
});
test('런: 13장 전부(1~13)도 유효', () => {
  const s = []; for (let n = 1; n <= 13; n++) s.push(T(K, n));
  const r = RK.validateSet(s); assert.ok(r.valid); assert.strictEqual(r.points, 91);
});
test('런: 조커가 가운데에 있으면 그 값으로 계산', () => {
  const r = RK.validateSet([T(R, 3), J1, T(R, 5)]);
  assert.ok(r.valid); assert.strictEqual(r.points, 12);
});
test('런: 조커가 끝에 있을 때 범위를 넘으면 불가', () => {
  assert.ok(!RK.validateSet([T(R, 12), T(R, 13), J1]).valid);
  assert.ok(RK.validateSet([J1, T(R, 12), T(R, 13)]).valid);
});
test('런: 조커 2개 사용', () => {
  const r = RK.validateSet([T(Y, 5), J1, J2, T(Y, 8)]);
  assert.ok(r.valid); assert.strictEqual(r.points, 26);
});
test('조커만으로는 세트 불가', () => {
  assert.ok(RK.validateSet([J1, J2, T(R, 5)]).valid); // 진짜 타일 1장 + 조커 2장은 가능
  assert.ok(!RK.validateSet([J1, J2]).valid); // 조커만 있으면 불가
});
test('모호한 세트는 점수가 높은 해석을 택함 ([5,조커,조커])', () => {
  const r = RK.validateSet([T(R, 5), J1, J2]);
  assert.ok(r.valid); assert.strictEqual(r.points, 18); // 런 5+6+7=18 > 그룹 5×3=15
});
test('중복 id는 불가', () => {
  assert.ok(!RK.validateSet([T(R, 5), T(R, 5), T(R, 6)]).valid);
});
test('불가 이유 메시지가 있음', () => {
  const r = RK.validateSet([T(R, 5), T(B, 6), T(Y, 9)]);
  assert.ok(!r.valid && typeof r.reason === 'string' && r.reason.length > 0);
});

/* ----- 차례 검증 ----- */
const base = (over) => Object.assign({ melded: false, minMeld: 30, tableBefore: [], tableAfter: [], handBefore: [], handAfter: [] }, over);

test('첫 등록: 30점 미만이면 거절', () => {
  const set = [T(R, 3), T(B, 3), T(Y, 3)]; // 9점
  const hand = [...set, T(K, 1)];
  const v = RK.validateTurn(base({ handBefore: hand, handAfter: [T(K, 1)], tableAfter: [set] }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'MELD_TOO_LOW');
});
test('첫 등록: 30점 이상이면 통과, 여러 세트 합산', () => {
  const a = [T(R, 10), T(B, 10), T(Y, 10)]; // 30
  const hand = [...a, T(K, 1)];
  const v = RK.validateTurn(base({ handBefore: hand, handAfter: [T(K, 1)], tableAfter: [a] }));
  assert.ok(v.ok); assert.strictEqual(v.meldPoints, 30);
  const b = [T(R, 4), T(R, 5), T(R, 6)]; // 15
  const c = [T(B, 5), T(Y, 5), T(K, 5)]; // 15
  const v2 = RK.validateTurn(base({ handBefore: [...b, ...c, T(K, 1)], handAfter: [T(K, 1)], tableAfter: [b, c] }));
  assert.ok(v2.ok); assert.strictEqual(v2.meldPoints, 30);
});
test('첫 등록 전에는 테이블 세트를 건드릴 수 없음', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const newSet = [T(B, 12), T(Y, 12), T(K, 12)]; // 36
  const extra = T(R, 7);
  const v = RK.validateTurn(base({
    tableBefore: [tableSet],
    handBefore: [...newSet, extra],
    handAfter: [],
    tableAfter: [[...tableSet, extra], newSet],
  }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'MELD_TOUCHED_TABLE');
});
test('첫 등록: 테이블 세트가 그대로면 새 세트만 점수에 반영', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const newSet = [T(B, 12), T(Y, 12), T(K, 12)];
  const v = RK.validateTurn(base({
    tableBefore: [tableSet], handBefore: [...newSet, T(K, 1)], handAfter: [T(K, 1)], tableAfter: [tableSet, newSet],
  }));
  assert.ok(v.ok); assert.strictEqual(v.meldPoints, 36);
});
test('등록 후: 테이블 세트에 붙이기 가능', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const v = RK.validateTurn(base({
    melded: true, tableBefore: [tableSet], handBefore: [T(R, 7), T(K, 1)], handAfter: [T(K, 1)],
    tableAfter: [[...tableSet, T(R, 7)]],
  }));
  assert.ok(v.ok);
});
test('등록 후: 세트 쪼개고 합치기(재배치) 가능', () => {
  // 런 R3-R7 을 R3 R4 R5 / R6 R7 + 내 R8 → R6 R7 R8
  const run = [T(R, 3), T(R, 4), T(R, 5), T(R, 6), T(R, 7)];
  const v = RK.validateTurn(base({
    melded: true, tableBefore: [run], handBefore: [T(R, 8), T(K, 1)], handAfter: [T(K, 1)],
    tableAfter: [[T(R, 3), T(R, 4), T(R, 5)], [T(R, 6), T(R, 7), T(R, 8)]],
  }));
  assert.ok(v.ok);
});
test('테이블 타일을 패로 가져오면 거절', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const v = RK.validateTurn(base({
    melded: true, tableBefore: [tableSet, [T(B, 1), T(B, 2), T(B, 3)]], handBefore: [T(K, 1)],
    handAfter: [T(K, 1), T(R, 6)], tableAfter: [[T(R, 4), T(R, 5)], [T(B, 1), T(B, 2), T(B, 3)]],
  }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'TABLE_TILE_REMOVED');
});
test('타일을 하나도 안 내면 거절', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const v = RK.validateTurn(base({ melded: true, tableBefore: [tableSet], tableAfter: [tableSet], handBefore: [T(K, 1)], handAfter: [T(K, 1)] }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'NO_TILE_PLACED');
});
test('유효하지 않은 세트가 남아 있으면 거절하고 위치를 알려줌', () => {
  const v = RK.validateTurn(base({
    melded: true, tableBefore: [], handBefore: [T(R, 1), T(B, 5), T(Y, 9)], handAfter: [],
    tableAfter: [[T(R, 1), T(B, 5), T(Y, 9)]],
  }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'INVALID_SET'); assert.deepStrictEqual(v.badSets, [0]);
});
test('내 패에 없던 타일을 올리면 거절', () => {
  const v = RK.validateTurn(base({
    melded: true, handBefore: [T(R, 1)], handAfter: [],
    tableAfter: [[T(R, 1), T(R, 2), T(R, 3)]],
  }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'FOREIGN_TILE');
});
test('조커 회수: 테이블 조커를 빼내고 진짜 타일로 교체 + 조커를 다른 세트에 사용', () => {
  const runWithJoker = [T(R, 3), T(R, 4), J1]; // 조커 = R5
  const other = [T(B, 8), T(Y, 8)];
  const v = RK.validateTurn(base({
    melded: true, tableBefore: [runWithJoker, other],
    handBefore: [T(R, 5), T(K, 8), T(K, 1)], handAfter: [T(K, 1)],
    tableAfter: [[T(R, 3), T(R, 4), T(R, 5)], [T(B, 8), T(Y, 8), J1]].concat([]),
  }));
  // 위 구성은 T(K,8)을 놓지 않아 패와 불일치 → 거절되어야 함
  assert.ok(!v.ok);
  const v2 = RK.validateTurn(base({
    melded: true, tableBefore: [runWithJoker, other],
    handBefore: [T(R, 5), T(K, 8), T(K, 1)], handAfter: [T(K, 1)],
    tableAfter: [[T(R, 3), T(R, 4), T(R, 5)], [T(B, 8), T(Y, 8), J1, T(K, 8)]],
  }));
  assert.ok(v2.ok);
});
test('조커를 교체 없이 가져가면 거절', () => {
  const runWithJoker = [T(R, 3), T(R, 4), J1];
  const v = RK.validateTurn(base({
    melded: true, tableBefore: [runWithJoker], handBefore: [T(K, 1)], handAfter: [T(K, 1), J1],
    tableAfter: [[T(R, 3), T(R, 4)]],
  }));
  assert.ok(!v.ok); assert.strictEqual(v.code, 'TABLE_TILE_REMOVED');
});

/* ----- 점수·정렬 ----- */
test('감점: 숫자 합, 조커는 30점', () => {
  assert.strictEqual(RK.handPenalty([T(R, 5), T(B, 12), J1]), 47);
});
test('라운드 점수: 승자는 합계 +, 나머지는 자기 감점 −, 합은 0', () => {
  const hands = [[], [T(R, 5)], [T(R, 10), T(B, 2)], [J1]];
  const s = RK.roundScores(hands, 0);
  assert.deepStrictEqual(s, [47, -5, -12, -30]);
  assert.strictEqual(s.reduce((a, b) => a + b, 0), 0);
});
test('정렬: 색 순 / 숫자 순, 조커는 맨 뒤', () => {
  const h = [T(B, 2), J1, T(R, 9), T(R, 1), T(B, 1)];
  assert.deepStrictEqual(RK.sortHand(h, 'color'), [T(R, 1), T(R, 9), T(B, 1), T(B, 2), J1]);
  assert.deepStrictEqual(RK.sortHand(h, 'number'), [T(R, 1), T(B, 1), T(B, 2), T(R, 9), J1]);
});

/* ----- 게임 진행 ----- */
test('새 게임: 14장씩, 더미 50장, 타일 중복 없음', () => {
  const g = RK.newGame({ players: 4, seed: 1 });
  g.hands.forEach((h) => assert.strictEqual(h.length, 14));
  assert.strictEqual(g.pool.length, 50);
  const all = [...g.pool, ...g.hands.flat()];
  assert.strictEqual(new Set(all).size, 106);
});
test('같은 시드면 같은 패, 다른 시드면 다른 패', () => {
  const a = RK.newGame({ seed: 7 }), b = RK.newGame({ seed: 7 }), c = RK.newGame({ seed: 8 });
  assert.deepStrictEqual(a.hands, b.hands);
  assert.notDeepStrictEqual(a.hands, c.hands);
});
test('2~3인 게임도 생성 가능', () => {
  assert.strictEqual(RK.newGame({ players: 2, seed: 1 }).pool.length, 106 - 28);
  assert.strictEqual(RK.newGame({ players: 3, seed: 1 }).pool.length, 106 - 42);
});
test('뽑고 넘기기: 패 +1, 더미 −1, 차례 이동', () => {
  const g = RK.newGame({ seed: 3 });
  const r = RK.drawAndPass(g);
  assert.ok(r.ok);
  assert.strictEqual(r.state.hands[0].length, 15);
  assert.strictEqual(r.state.pool.length, 49);
  assert.strictEqual(r.state.turn, 1);
  assert.strictEqual(g.hands[0].length, 14); // 원본 상태는 바뀌지 않음
});
test('차례는 4인 기준으로 한 바퀴 돈다', () => {
  let g = RK.newGame({ seed: 3 });
  for (let i = 0; i < 4; i++) g = RK.drawAndPass(g).state;
  assert.strictEqual(g.turn, 0);
});
test('패를 모두 내면 승리, 게임 종료', () => {
  let g = RK.newGame({ seed: 5, minMeld: 30 });
  const set = [T(R, 10), T(B, 10), T(Y, 10)];
  g.hands[0] = set.slice();
  const r = RK.commitTurn(g, [set], []);
  assert.ok(r.ok); assert.ok(r.state.over); assert.strictEqual(r.state.winner, 0); assert.strictEqual(r.state.endReason, 'empty');
});
test('commitTurn 실패 시 이유를 돌려주고 상태는 그대로', () => {
  const g = RK.newGame({ seed: 5 });
  const r = RK.commitTurn(g, [], g.hands[0]);
  assert.ok(!r.ok); assert.strictEqual(r.code, 'NO_TILE_PLACED');
});
test('더미가 비고 모두 넘기면 감점이 가장 낮은 사람이 승리', () => {
  let g = RK.newGame({ seed: 9 });
  g.pool = [];
  g.hands = [[T(R, 9)], [T(R, 2)], [T(R, 5)], [T(R, 7)]];
  for (let i = 0; i < 4; i++) {
    const r = RK.drawAndPass(g); assert.ok(r.ok); g = r.state;
  }
  assert.ok(g.over); assert.strictEqual(g.winner, 1); assert.strictEqual(g.endReason, 'stalemate');
});
test('시간종료 정산: 감점 낮은 순, 동점이면 타일 수 적은 사람', () => {
  const g = RK.newGame({ seed: 2 });
  g.hands = [[T(R, 6)], [T(R, 3), T(R, 3, 1)], [T(R, 9)], [T(R, 8)]];
  const e = RK.finishByScore(g, 'timeup');
  assert.strictEqual(e.winner, 0); assert.strictEqual(e.endReason, 'timeup');
});

/* ----- 방 설정 옵션 ----- */
test('조커 0개 덱은 104장, 조커 1개는 105장', () => {
  assert.strictEqual(RK.createDeck(0).length, 104);
  assert.strictEqual(RK.createDeck(1).length, 105);
  assert.strictEqual(RK.createDeck().length, 106);
});
test('설정: 조커 0개·시작 패 10장으로 게임 시작', () => {
  const g = RK.newGame({ players: 3, jokers: 0, handSize: 10, seed: 4 });
  g.hands.forEach((h) => assert.strictEqual(h.length, 10));
  assert.strictEqual(g.pool.length, 104 - 30);
  assert.ok(![...g.pool, ...g.hands.flat()].some(RK.isJoker));
});
test('설정: 첫 등록 0점이면 어떤 유효한 세트로도 등록', () => {
  const set = [T(R, 1), T(B, 1), T(Y, 1)];
  const v = RK.validateTurn(base({ minMeld: 0, handBefore: set, handAfter: [], tableAfter: [set] }));
  assert.ok(v.ok);
});
test('1인 연습 게임도 동작', () => {
  let g = RK.newGame({ players: 1, seed: 2 });
  const r = RK.drawAndPass(g);
  assert.ok(r.ok); assert.strictEqual(r.state.turn, 0); assert.strictEqual(r.state.hands[0].length, 15);
});

/* ----- 화면용 함수 ----- */
test('meldPointsOf: 새 세트 점수만 합산, 원래 세트는 제외', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const a = [T(B, 12), T(Y, 12), T(K, 12)];
  const m = RK.meldPointsOf([tableSet], [tableSet, a]);
  assert.strictEqual(m.points, 36); assert.strictEqual(m.touched, false); assert.strictEqual(m.newCount, 1);
});
test('meldPointsOf: 원래 세트를 바꾸면 touched', () => {
  const tableSet = [T(R, 4), T(R, 5), T(R, 6)];
  const m = RK.meldPointsOf([tableSet], [[T(R, 4), T(R, 5)]]);
  assert.strictEqual(m.touched, true);
});
test('moveTile: 패 → 새 세트 → 같은 세트 안에서 끼워 넣기', () => {
  let w = { table: [], hand: [T(R, 1), T(R, 2), T(R, 3)] };
  w = RK.moveTile(w, T(R, 1), { type: 'new' });
  assert.deepStrictEqual(w.table, [[T(R, 1)]]);
  w = RK.moveTile(w, T(R, 3), { type: 'set', setIndex: 0 });
  w = RK.moveTile(w, T(R, 2), { type: 'set', setIndex: 0, beforeId: T(R, 3) });
  assert.deepStrictEqual(w.table, [[T(R, 1), T(R, 2), T(R, 3)]]);
  assert.deepStrictEqual(w.hand, []);
});
test('moveTile: 세트 사이 이동 시 빈 세트는 사라짐', () => {
  const w = { table: [[T(R, 1)], [T(R, 2), T(R, 3)]], hand: [] };
  const n = RK.moveTile(w, T(R, 1), { type: 'set', setIndex: 1, beforeId: T(R, 2) });
  assert.deepStrictEqual(n.table, [[T(R, 1), T(R, 2), T(R, 3)]]);
});
test('moveTile: 테이블에 원래 있던 타일은 패로 되돌릴 수 없음', () => {
  const w = { table: [[T(R, 1), T(R, 2), T(R, 3)]], hand: [] };
  const locked = new Set([T(R, 1), T(R, 2), T(R, 3)]);
  assert.strictEqual(RK.moveTile(w, T(R, 2), { type: 'hand' }, locked), null);
});
test('moveTile: 이번 차례에 낸 타일은 패로 되돌릴 수 있음', () => {
  const w = { table: [[T(R, 1), T(R, 2), T(R, 3)]], hand: [] };
  const n = RK.moveTile(w, T(R, 2), { type: 'hand' }, new Set());
  assert.deepStrictEqual(n.hand, [T(R, 2)]);
  assert.deepStrictEqual(n.table, [[T(R, 1), T(R, 3)]]);
});
test('moveTile: 자기 자신 앞에 놓거나 없는 타일은 null', () => {
  const w = { table: [], hand: [T(R, 1)] };
  assert.strictEqual(RK.moveTile(w, T(R, 1), { type: 'hand', beforeId: T(R, 1) }), null);
  assert.strictEqual(RK.moveTile(w, T(B, 9), { type: 'new' }), null);
});

/* ----- 자동 정렬·세트 이동 ----- */
test('arrangeSet: 런은 숫자 순', () => {
  assert.deepStrictEqual(RK.arrangeSet([T(B, 7), T(B, 5), T(B, 6)]), [T(B, 5), T(B, 6), T(B, 7)]);
});
test('arrangeSet: 런의 빈 숫자는 조커가 채움', () => {
  assert.deepStrictEqual(RK.arrangeSet([T(R, 8), J1, T(R, 6)]), [T(R, 6), J1, T(R, 8)]);
  assert.ok(RK.validateSet(RK.arrangeSet([T(R, 8), J1, T(R, 6)])).valid);
});
test('arrangeSet: 남는 조커는 뒤, 13을 넘으면 앞', () => {
  assert.deepStrictEqual(RK.arrangeSet([J1, T(R, 4), T(R, 5)]), [T(R, 4), T(R, 5), J1]);
  assert.deepStrictEqual(RK.arrangeSet([T(R, 13), J1, T(R, 12)]), [J1, T(R, 12), T(R, 13)]);
});
test('arrangeSet: 그룹은 색 순, 조커 뒤', () => {
  assert.deepStrictEqual(RK.arrangeSet([T(K, 9), J1, T(R, 9), T(Y, 9)]), [T(R, 9), T(Y, 9), T(K, 9), J1]);
});
test('arrangeSet: 1장·2장 런/그룹 진행 중에도 정렬', () => {
  assert.deepStrictEqual(RK.arrangeSet([T(B, 9), T(B, 8)]), [T(B, 8), T(B, 9)]);
  assert.deepStrictEqual(RK.arrangeSet([T(K, 3)]), [T(K, 3)]);
});
test('arrangeSet: 타일을 잃거나 늘리지 않음', () => {
  const s = [T(R, 2), T(B, 9), J1, T(R, 2, 1)];
  assert.deepStrictEqual(RK.arrangeSet(s).slice().sort(), s.slice().sort());
});
test('moveSet: 앞으로·뒤로·맨 뒤로', () => {
  const t = [[1], [2], [3], [4]];
  assert.deepStrictEqual(RK.moveSet(t, 3, 0), [[4], [1], [2], [3]]);
  assert.deepStrictEqual(RK.moveSet(t, 0, 2), [[2], [1], [3], [4]]);
  assert.deepStrictEqual(RK.moveSet(t, 1, 4), [[1], [3], [4], [2]]);
  assert.deepStrictEqual(t, [[1], [2], [3], [4]]);
});


/* ----- 공식 정산·벌칙·선 정하기 ----- */
test('정산(공식): 승자에게도 타일이 남으면 차이만큼만 잃음', () => {
  const hands = [[T(R, 2)], [T(R, 9)], [T(R, 5)], [T(R, 1), T(R, 1, 1)]];
  // 승자 = 0번(2점). 1번 9-2=7, 2번 5-2=3, 3번 2-2=0
  assert.deepStrictEqual(RK.roundScores(hands, 0), [10, -7, -3, 0]);
});
test('정산(공식): 패를 비운 승자는 기존 방식과 같음', () => {
  assert.deepStrictEqual(RK.roundScores([[], [T(R, 5)], [J1]], 0), [35, -5, -30]);
});
test('벌칙: 3장 뽑고 넘기기, 더미가 모자라면 있는 만큼', () => {
  let g = RK.newGame({ seed: 3 });
  const r = RK.drawAndPass(g, 3);
  assert.strictEqual(r.state.hands[0].length, 17);
  assert.strictEqual(r.state.pool.length, 47);
  g = r.state; g.pool = g.pool.slice(0, 2);
  const r2 = RK.drawAndPass(g, 3);
  assert.strictEqual(r2.state.hands[1].length, 16);
});
test('선 정하기: 가장 높은 숫자가 먼저, 동점이면 동점자끼리 다시', () => {
  for (let seed = 1; seed < 60; seed++) {
    const f = RK.drawForFirst(4, RK.mulberry32(seed));
    const firstRound = f.tiles.map((t) => RK.numOf(t[0]));
    const max = Math.max(...firstRound);
    assert.strictEqual(firstRound[f.first], max);
    assert.ok(f.tiles.flat().every((id) => !RK.isJoker(id)));
    const tied = firstRound.filter((n) => n === max).length;
    if (tied === 1) assert.ok(f.tiles.every((t) => t.length === 1));
    else assert.ok(f.tiles[f.first].length >= 2);
  }
});
test('newGame: first 옵션으로 시작 차례', () => {
  assert.strictEqual(RK.newGame({ seed: 1, first: 2 }).turn, 2);
});

/* ----- 결과 ----- */
console.log(`통과 ${passed}개 / 실패 ${failed.length}개`);
failed.forEach(([n, m]) => console.log('  ✗', n, '→', m));
process.exit(failed.length ? 1 : 0);
