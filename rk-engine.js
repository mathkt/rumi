/*!
 * 루미큐브 규칙 엔진 (rk-engine.js)
 * - 화면·네트워크와 무관한 순수 함수 모음. 나중에 단일 HTML 안에 그대로 붙여 넣어 쓴다.
 * - 타일은 정수 id 하나로 표현한다(Firebase에 그대로 저장하기 좋음).
 *     id 0~103  : 숫자 타일 (복사본 2벌)  → 색 = floor((id%52)/13), 숫자 = id%13 + 1
 *     id 104,105: 조커
 * - 세트는 id 배열. 런(연속)은 "배열 순서"가 곧 왼쪽→오른쪽 순서다.
 * - 테이블은 세트의 배열: [[id,id,id], [id,id,id,id], ...]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RK = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLOR_NAMES = ['빨강', '파랑', '노랑', '검정'];
  const JOKER_FIRST = 104;
  const TOTAL_TILES = 106;
  const JOKER_PENALTY = 30;

  /* ---------- 타일 기본 ---------- */
  const isJoker = (id) => id >= JOKER_FIRST;
  const colorOf = (id) => (isJoker(id) ? -1 : Math.floor((id % 52) / 13));
  const numOf = (id) => (isJoker(id) ? 0 : (id % 13) + 1);
  const tileInfo = (id) => ({ id, joker: isJoker(id), color: colorOf(id), number: numOf(id) });
  /** 테스트·디버깅용: makeTile(색0~3, 숫자1~13, 복사본0|1) */
  const makeTile = (color, number, copy) => (copy || 0) * 52 + color * 13 + (number - 1);

  /** jokers: 조커 개수(0~2, 기본 2) */
  function createDeck(jokers) {
    const j = jokers == null ? 2 : jokers;
    const deck = [];
    for (let i = 0; i < 104; i++) deck.push(i);
    for (let k = 0; k < j; k++) deck.push(JOKER_FIRST + k);
    return deck;
  }

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const r = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ---------- 세트 판정 ---------- */
  function evalRun(ids) {
    const len = ids.length;
    if (len < 3 || len > 13) return null;
    let color = null;
    let start = null;
    for (let i = 0; i < len; i++) {
      const id = ids[i];
      if (isJoker(id)) continue;
      const c = colorOf(id);
      const s = numOf(id) - i; // 이 위치가 시작 숫자라면 필요한 값
      if (color === null) {
        color = c;
        start = s;
      } else if (c !== color || s !== start) return null;
    }
    if (color === null) return null; // 조커만 있는 런은 불가
    if (start < 1 || start + len - 1 > 13) return null; // 13 다음 1로 이어지는 것도 불가
    let points = 0;
    for (let i = 0; i < len; i++) points += start + i;
    return { kind: 'run', points, color, start };
  }

  function evalGroup(ids) {
    const len = ids.length;
    if (len < 3 || len > 4) return null;
    let num = null;
    const colors = new Set();
    for (const id of ids) {
      if (isJoker(id)) continue;
      const n = numOf(id);
      if (num === null) num = n;
      else if (n !== num) return null;
      const c = colorOf(id);
      if (colors.has(c)) return null;
      colors.add(c);
    }
    if (num === null) return null; // 조커만 있는 그룹은 불가
    return { kind: 'group', points: num * len, number: num };
  }

  function explainInvalid(ids) {
    const len = ids.length;
    if (len < 3) return '타일이 3장 이상 있어야 해요';
    const real = ids.filter((id) => !isJoker(id));
    if (real.length === 0) return '조커만으로는 세트를 만들 수 없어요';
    const nums = new Set(real.map(numOf));
    const cols = new Set(real.map(colorOf));
    if (nums.size === 1) {
      if (len > 4) return '그룹은 최대 4장까지예요';
      if (cols.size < real.length) return '그룹에는 같은 색이 두 번 들어갈 수 없어요';
    }
    if (cols.size === 1) return '같은 색이지만 숫자가 이어지지 않아요 (1~13, 13 다음에 1은 안 돼요)';
    return '같은 색 연속 숫자(런)도, 같은 숫자 다른 색(그룹)도 아니에요';
  }

  /** 세트 하나를 판정. 런·그룹 둘 다 가능하면 점수가 높은 쪽을 택한다. */
  function validateSet(ids) {
    if (new Set(ids).size !== ids.length) {
      return { valid: false, reason: '같은 타일이 중복되어 있어요' };
    }
    const run = evalRun(ids);
    const group = evalGroup(ids);
    let best = null;
    if (run && group) best = run.points >= group.points ? run : group;
    else best = run || group;
    if (!best) return { valid: false, reason: explainInvalid(ids) };
    return Object.assign({ valid: true }, best);
  }

  const compact = (table) => table.filter((s) => s.length > 0);

  function validateTable(table) {
    const sets = compact(table);
    const results = sets.map(validateSet);
    const bad = [];
    results.forEach((r, i) => {
      if (!r.valid) bad.push(i);
    });
    return { ok: bad.length === 0, results, bad };
  }

  /* ---------- 차례 검증 ---------- */
  const err = (code, message, extra) => Object.assign({ ok: false, code, message }, extra || {});
  const flat = (table) => table.reduce((a, s) => a.concat(s), []);
  const keyOf = (set) => set.slice().sort((a, b) => a - b).join(',');

  /**
   * 한 차례의 결과가 규칙에 맞는지 검사한다.
   * @param {object} p
   *   tableBefore/tableAfter : 차례 시작/종료 시 테이블
   *   handBefore/handAfter   : 차례 시작/종료 시 내 패
   *   melded                 : 이미 첫 등록을 마쳤는가
   *   minMeld                : 첫 등록 최소 점수(기본 30)
   */
  function validateTurn(p) {
    const minMeld = p.minMeld == null ? 30 : p.minMeld;
    const tableBefore = compact(p.tableBefore);
    const tableAfter = compact(p.tableAfter);
    const before = flat(tableBefore);
    const after = flat(tableAfter);

    if (new Set(after).size !== after.length) return err('DUPLICATE', '같은 타일이 두 번 쓰였어요');
    if (new Set(p.handAfter).size !== p.handAfter.length) return err('DUPLICATE', '내 패에 같은 타일이 중복돼요');

    const afterSet = new Set(after);
    for (const id of before) {
      if (!afterSet.has(id)) return err('TABLE_TILE_REMOVED', '테이블의 타일을 패로 가져올 수 없어요');
    }

    const beforeSet = new Set(before);
    const placed = after.filter((id) => !beforeSet.has(id));
    const handBeforeSet = new Set(p.handBefore);
    for (const id of placed) {
      if (!handBeforeSet.has(id)) return err('FOREIGN_TILE', '내 패에 없던 타일이 테이블에 올라왔어요');
    }
    const placedSet = new Set(placed);
    const expectedHand = p.handBefore.filter((id) => !placedSet.has(id));
    const handAfterSet = new Set(p.handAfter);
    if (expectedHand.length !== p.handAfter.length || expectedHand.some((id) => !handAfterSet.has(id))) {
      return err('HAND_MISMATCH', '패와 테이블의 타일이 서로 맞지 않아요');
    }

    if (placed.length === 0) return err('NO_TILE_PLACED', '타일을 1장 이상 내야 해요 (낼 수 없으면 타일을 뽑으세요)');

    const tv = validateTable(tableAfter);
    if (!tv.ok) {
      const i = tv.bad[0];
      return err('INVALID_SET', tv.results[i].reason, { badSets: tv.bad });
    }

    let meldPoints = null;
    if (!p.melded) {
      // 첫 등록: 테이블 세트는 건드릴 수 없고, 내 패의 타일만으로 만든 새 세트의 합이 minMeld 이상
      const left = new Map();
      for (const s of tableBefore) {
        const k = keyOf(s);
        left.set(k, (left.get(k) || 0) + 1);
      }
      const untouchedLeft = new Map(left);
      const newSets = [];
      for (const s of tableAfter) {
        const k = keyOf(s);
        if ((untouchedLeft.get(k) || 0) > 0) untouchedLeft.set(k, untouchedLeft.get(k) - 1);
        else newSets.push(s);
      }
      for (const n of untouchedLeft.values()) {
        if (n > 0) return err('MELD_TOUCHED_TABLE', '첫 등록 전에는 테이블의 세트를 바꿀 수 없어요');
      }
      meldPoints = newSets.reduce((sum, s) => sum + validateSet(s).points, 0);
      if (meldPoints < minMeld) {
        return err('MELD_TOO_LOW', `첫 등록은 ${minMeld}점 이상이어야 해요 (지금 ${meldPoints}점)`, { meldPoints });
      }
    }
    return { ok: true, placed, meldPoints, handEmpty: p.handAfter.length === 0 };
  }

  /* ---------- 화면용 보조 함수 ---------- */
  /**
   * 첫 등록 점수를 실시간으로 계산: 테이블 세트가 그대로인 것은 제외하고 새로 만든 세트의 합.
   * touched = 처음 있던 세트를 건드렸는지(첫 등록 전에는 불가)
   */
  function meldPointsOf(tableBefore, tableAfter) {
    const left = new Map();
    for (const s of compact(tableBefore)) {
      const k = keyOf(s);
      left.set(k, (left.get(k) || 0) + 1);
    }
    let points = 0;
    let newCount = 0;
    for (const s of compact(tableAfter)) {
      const k = keyOf(s);
      if ((left.get(k) || 0) > 0) left.set(k, left.get(k) - 1);
      else {
        const v = validateSet(s);
        if (v.valid) points += v.points;
        newCount++;
      }
    }
    let touched = false;
    for (const n of left.values()) if (n > 0) touched = true;
    return { points, touched, newCount };
  }

  /**
   * 타일 하나를 옮긴 뒤의 작업 상태를 돌려준다. 옮길 수 없거나 변화가 없으면 null.
   * work = {table, hand}
   * dest = {type:'hand'|'new'|'set', setIndex?, beforeId?}  (beforeId: 이 타일 앞에 끼워 넣기, 없으면 맨 뒤)
   * locked = 이번 차례 시작 때 이미 테이블에 있던 타일 id 집합(패로 되돌릴 수 없음)
   */
  function moveTile(work, id, dest, locked) {
    const table = work.table.map((s) => s.slice());
    const hand = work.hand.slice();
    let found = false;
    const hi = hand.indexOf(id);
    if (hi >= 0) {
      hand.splice(hi, 1);
      found = true;
    } else {
      for (let i = 0; i < table.length && !found; i++) {
        const k = table[i].indexOf(id);
        if (k >= 0) {
          table[i].splice(k, 1);
          found = true;
        }
      }
    }
    if (!found) return null;
    if (dest.beforeId === id) return null;
    const insert = (arr, beforeId) => {
      const k = beforeId == null ? -1 : arr.indexOf(beforeId);
      if (k < 0) arr.push(id);
      else arr.splice(k, 0, id);
    };
    if (dest.type === 'hand') {
      if (locked && locked.has(id)) return null;
      insert(hand, dest.beforeId);
    } else if (dest.type === 'new') {
      table.push([id]);
    } else if (dest.type === 'set') {
      const s = table[dest.setIndex];
      if (!s) return null;
      insert(s, dest.beforeId);
    } else return null;
    return { table: table.filter((s) => s.length > 0), hand };
  }

  /* ---------- 점수 ---------- */
  const handPenalty = (hand) => hand.reduce((s, id) => s + (isJoker(id) ? JOKER_PENALTY : numOf(id)), 0);

  /** 승자는 +(다른 사람 감점 합), 나머지는 -(자기 감점) */
  function roundScores(hands, winner) {
    const pen = hands.map(handPenalty);
    const total = pen.reduce((a, b) => a + b, 0) - pen[winner];
    return pen.map((p, i) => (i === winner ? total : -p));
  }

  /* ---------- 패 정렬 ---------- */
  function sortHand(hand, mode) {
    const key = (id) => {
      if (isJoker(id)) return 9999 + id;
      return mode === 'number' ? numOf(id) * 10 + colorOf(id) : colorOf(id) * 100 + numOf(id);
    };
    return hand.slice().sort((a, b) => key(a) - key(b) || a - b);
  }

  /* ---------- 게임 진행 (불변 방식: 항상 새 상태를 돌려줌) ---------- */
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function newGame(opts) {
    const o = opts || {};
    const players = o.players || 4;
    const rng = o.seed == null ? Math.random : mulberry32(o.seed);
    const jokers = o.jokers == null ? 2 : o.jokers;
    const handSize = o.handSize || 14;
    const deck = shuffle(createDeck(jokers), rng);
    const hands = [];
    for (let i = 0; i < players; i++) hands.push(deck.splice(0, handSize));
    return {
      players,
      jokers,
      handSize,
      minMeld: o.minMeld == null ? 30 : o.minMeld,
      hands,
      pool: deck,
      table: [],
      turn: 0,
      melded: new Array(players).fill(false),
      passes: 0, // 더미가 빈 뒤 연속으로 넘긴 횟수
      over: false,
      winner: null,
      endReason: null, // 'empty' | 'stalemate' | 'timeup'
    };
  }

  const nextTurn = (s) => (s.turn + 1) % s.players;

  /** 낼 수 없을 때: 1장 뽑고 차례 넘김(더미가 비었으면 그냥 넘김) */
  function drawAndPass(state) {
    if (state.over) return { ok: false, code: 'OVER', message: '이미 끝난 게임이에요' };
    const s = clone(state);
    if (s.pool.length > 0) {
      s.hands[s.turn].push(s.pool.shift());
      s.passes = 0;
    } else {
      s.passes += 1;
    }
    if (s.pool.length === 0 && s.passes >= s.players) return { ok: true, state: finishByScore(s, 'stalemate') };
    s.turn = nextTurn(s);
    return { ok: true, state: s };
  }

  /** 차례 종료: 검사 통과 시 상태를 갱신 */
  function commitTurn(state, newTable, newHand) {
    if (state.over) return { ok: false, code: 'OVER', message: '이미 끝난 게임이에요' };
    const v = validateTurn({
      tableBefore: state.table,
      handBefore: state.hands[state.turn],
      tableAfter: newTable,
      handAfter: newHand,
      melded: state.melded[state.turn],
      minMeld: state.minMeld,
    });
    if (!v.ok) return v;
    const s = clone(state);
    s.table = compact(newTable);
    s.hands[s.turn] = newHand.slice();
    s.melded[s.turn] = true;
    s.passes = 0;
    if (newHand.length === 0) {
      s.over = true;
      s.winner = s.turn;
      s.endReason = 'empty';
      return { ok: true, state: s, result: v };
    }
    s.turn = nextTurn(s);
    return { ok: true, state: s, result: v };
  }

  /** 교착·시간종료: 감점이 가장 낮은 사람이 승리(동점이면 타일 수가 적은 사람 → 번호가 빠른 사람) */
  function finishByScore(state, reason) {
    const s = clone(state);
    const pen = s.hands.map(handPenalty);
    let w = 0;
    for (let i = 1; i < s.players; i++) {
      if (pen[i] < pen[w] || (pen[i] === pen[w] && s.hands[i].length < s.hands[w].length)) w = i;
    }
    s.over = true;
    s.winner = w;
    s.endReason = reason;
    return s;
  }

  return {
    COLOR_NAMES, TOTAL_TILES, JOKER_PENALTY,
    isJoker, colorOf, numOf, tileInfo, makeTile,
    createDeck, shuffle, mulberry32,
    validateSet, validateTable, validateTurn,
    meldPointsOf, moveTile,
    handPenalty, roundScores, sortHand,
    newGame, drawAndPass, commitTurn, finishByScore,
  };
});
