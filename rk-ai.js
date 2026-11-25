/*!
 * 루미큐브 컴퓨터 플레이어 (rk-ai.js)
 * - 자기 패와 테이블만 보고 둔다(다른 사람의 패·더미 순서는 보지 않음).
 * - 결과는 항상 규칙 엔진(validateTurn)을 통과한 수만 돌려준다. 낼 수 없으면 null(= 뽑고 넘기기).
 * 난이도 level: 1 쉬움 / 2 보통 / 3 어려움
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rk-engine.js'));
  else root.RKAI = factory(root.RK);
})(typeof self !== 'undefined' ? self : this, function (RK) {
  'use strict';
  const { isJoker, colorOf, numOf, validateSet, validateTurn, arrangeSet } = RK;
  const JOKERS = [104, 105];
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /** 주어진 타일로 만들 수 있는 세트 후보: {real:[id], jokers:n, size, pts} (조커는 개수로만 셈) */
  function genCandidates(tiles, jokerCount) {
    const J = jokerCount;
    const byCN = new Map();
    for (const id of tiles) {
      if (isJoker(id)) continue;
      const k = colorOf(id) * 13 + numOf(id) - 1;
      if (!byCN.has(k)) byCN.set(k, []);
      byCN.get(k).push(id);
    }
    const out = [];
    const add = (real, jk) => {
      const set = arrangeSet(real.concat(JOKERS.slice(0, jk)));
      const v = validateSet(set);
      if (v.valid) out.push({ real, jokers: jk, size: real.length + jk, pts: v.points });
    };
    // 그룹
    for (let n = 1; n <= 13; n++) {
      const reals = [];
      for (let c = 0; c < 4; c++) {
        const a = byCN.get(c * 13 + n - 1);
        if (a) reals.push(a[0]);
      }
      const m = reals.length;
      for (let mask = 1; mask < 1 << m; mask++) {
        const sub = reals.filter((_, i) => mask & (1 << i));
        if (sub.length < 2) continue;
        for (let jk = 0; jk <= Math.min(J, 4 - sub.length); jk++) if (sub.length + jk >= 3) add(sub, jk);
      }
    }
    // 런
    for (let c = 0; c < 4; c++) {
      for (let s = 1; s <= 11; s++) {
        const reals = [];
        let missing = 0;
        for (let e = s; e <= 13; e++) {
          const a = byCN.get(c * 13 + e - 1);
          if (a) reals.push(a[0]);
          else missing++;
          if (missing > J) break;
          if (e - s + 1 >= 3 && reals.length >= 2) add(reals.slice(), missing);
        }
      }
    }
    return out;
  }

  /**
   * 패만으로 만들 수 있는 가장 좋은 세트 묶음.
   * 목표: 점수가 minPoints 이상인 묶음 중 타일을 가장 많이 쓰는 것(동점이면 점수가 높은 것).
   * 반환: 세트 배열(조커 id 배정 완료) 또는 null
   */
  function bestMelds(hand, minPoints, maxNodes, deadline) {
    const jokerIds = hand.filter(isJoker);
    const reals = hand.filter((id) => !isJoker(id));
    const cands = genCandidates(reals, jokerIds.length).sort((a, b) => b.size - a.size || b.pts - a.pts);
    let best = null;
    let bestTiles = 0;
    let bestPts = -1;
    let nodes = 0;
    const used = new Set();
    const chosen = [];
    const total = hand.length;
    (function dfs(i, jokersLeft, tiles, pts) {
      if (pts >= minPoints && tiles > 0 && (tiles > bestTiles || (tiles === bestTiles && pts > bestPts))) {
        best = chosen.slice();
        bestTiles = tiles;
        bestPts = pts;
      }
      if (++nodes > maxNodes || (deadline && now() > deadline)) return;
      if (tiles + (total - tiles - (jokerIds.length - jokersLeft) * 0) <= bestTiles && pts >= minPoints) {
        // 남은 타일을 모두 써도 지금 최선보다 많아질 수 없으면 그만
        const remaining = reals.filter((id) => !used.has(id)).length + jokersLeft;
        if (tiles + remaining <= bestTiles) return;
      }
      for (let k = i; k < cands.length; k++) {
        const c = cands[k];
        if (c.jokers > jokersLeft) continue;
        if (c.real.some((id) => used.has(id))) continue;
        c.real.forEach((id) => used.add(id));
        chosen.push(c);
        dfs(k + 1, jokersLeft - c.jokers, tiles + c.size, pts + c.pts);
        chosen.pop();
        c.real.forEach((id) => used.delete(id));
        if (nodes > maxNodes) return;
      }
    })(0, jokerIds.length, 0, 0);
    if (!best) return null;
    const js = jokerIds.slice();
    return best.map((c) => arrangeSet(c.real.concat(js.splice(0, c.jokers))));
  }

  /** 패의 타일을 테이블 세트에 이어 붙이기(런 늘리기, 그룹 채우기). 조커는 패를 다 비울 수 있을 때만 */
  function extendSets(table, hand) {
    let t = table.map((s) => s.slice());
    let h = hand.slice();
    let changed = true;
    while (changed) {
      changed = false;
      const order = h.filter((id) => !isJoker(id)).concat(h.filter(isJoker));
      for (const id of order) {
        if (isJoker(id) && h.some((x) => !isJoker(x))) continue;
        for (let i = 0; i < t.length; i++) {
          const ns = arrangeSet(t[i].concat([id]));
          if (validateSet(ns).valid) {
            t[i] = ns;
            h = h.filter((x) => x !== id);
            changed = true;
            break;
          }
        }
      }
    }
    return { table: t, hand: h };
  }

  /**
   * 어려움: 테이블 전체를 다시 짜서 패의 타일을 더 많이 쓰는 배치를 찾는다(시간 제한 안에서).
   */
  function rearrange(table, hand, deadline) {
    const tableTiles = table.reduce((a, s) => a.concat(s), []);
    const reqReal = tableTiles.filter((id) => !isJoker(id));
    const tableJokers = tableTiles.filter(isJoker);
    const handJokers = hand.filter(isJoker);
    const allJokers = tableJokers.concat(handJokers);
    const handReal = hand.filter((id) => !isJoker(id));
    const reqSet = new Set(reqReal);
    let best = null;
    let bestUsed = 0;
    const avail = new Set(reqReal.concat(handReal));
    const chosen = [];
    let nodes = 0;

    function finish(jokersUsed) {
      if (jokersUsed < tableJokers.length) return;
      const js = allJokers.slice(); // 테이블 조커를 먼저 배정
      const sets = chosen.map((c) => arrangeSet(c.real.concat(js.splice(0, c.jokers))));
      const restHand = handReal.filter((id) => avail.has(id)).concat(js); // 남은 조커는 패의 조커
      const melds = bestMelds(restHand, 0, 400, deadline) || [];
      const meldIds = new Set(melds.reduce((a, s) => a.concat(s), []));
      const ext = extendSets(sets.concat(melds), restHand.filter((id) => !meldIds.has(id)));
      const usedCount = hand.length - ext.hand.length;
      if (usedCount > bestUsed) {
        bestUsed = usedCount;
        best = ext;
      }
    }
    (function cover(jokersUsed) {
      if (++nodes > 6000 || now() > deadline) return;
      let t = -1;
      for (const id of reqReal) if (avail.has(id)) { t = id; break; }
      if (t < 0) { finish(jokersUsed); return; }
      const pool = [...avail].sort((a, b) => (reqSet.has(b) ? 1 : 0) - (reqSet.has(a) ? 1 : 0));
      const cN = colorOf(t) * 13 + numOf(t);
      const cands = genCandidates(pool, allJokers.length - jokersUsed)
        .map((c) => {
          const k = c.real.findIndex((id) => colorOf(id) * 13 + numOf(id) === cN);
          if (k < 0) return null;
          const real = c.real.slice();
          real[k] = t;
          return { real, jokers: c.jokers, size: c.size };
        })
        .filter(Boolean)
        .sort((a, b) => a.jokers - b.jokers || b.real.filter((id) => !reqSet.has(id)).length - a.real.filter((id) => !reqSet.has(id)).length);
      for (const c of cands) {
        if (c.real.some((id) => !avail.has(id))) continue;
        c.real.forEach((id) => avail.delete(id));
        chosen.push(c);
        cover(jokersUsed + c.jokers);
        chosen.pop();
        c.real.forEach((id) => avail.add(id));
        if (nodes > 6000 || now() > deadline) return;
      }
    })(0);
    return best;
  }

  /**
   * 한 차례의 수를 고른다.
   * p = {table, hand, melded, minMeld, level, rng}
   * 반환: {table, hand} (규칙 통과 보장) 또는 null(뽑고 넘기기)
   */
  function chooseMove(p) {
    const level = p.level || 2;
    const rng = p.rng || Math.random;
    const minMeld = p.minMeld == null ? 30 : p.minMeld;
    const table = p.table.map((s) => s.slice());
    const hand = p.hand.slice();
    const deadline = now() + (level >= 3 ? 450 : 200);
    const candidates = [];

    if (level === 1 && rng() < 0.25) return null; // 쉬움: 가끔은 그냥 뽑는다

    const melds = bestMelds(hand, p.melded ? 0 : minMeld, level === 1 ? 1500 : 8000, deadline);
    let base = null;
    if (melds) {
      const ids = new Set(melds.reduce((a, s) => a.concat(s), []));
      base = { table: table.concat(melds), hand: hand.filter((id) => !ids.has(id)) };
    }
    if (!p.melded) {
      if (base) candidates.push(base);
    } else {
      if (level === 1) {
        // 쉬움: 새 세트는 내고, 이어 붙이기는 절반쯤만, 재배치는 하지 않음
        const start = base || { table, hand };
        const ext = rng() < 0.5 ? extendSets(start.table, start.hand) : start;
        if (ext.hand.length < hand.length) candidates.push(ext);
      } else {
        const start = base || { table, hand };
        const ext = extendSets(start.table, start.hand);
        if (ext.hand.length < hand.length) candidates.push(ext);
        // 보통: 절반쯤의 차례에만 짧게(약 0.06초), 어려움: 매번 길게(약 0.7초) 테이블을 다시 짜 본다
        if (level >= 3 || rng() < 0.45) {
          const r = rearrange(table, hand, level >= 3 ? deadline + 250 : now() + 60);
          if (r && r.hand.length < hand.length) candidates.push(r);
        }
      }
    }
    candidates.sort((a, b) => a.hand.length - b.hand.length);
    for (const c of candidates) {
      const v = validateTurn({ tableBefore: table, handBefore: hand, tableAfter: c.table, handAfter: c.hand, melded: p.melded, minMeld });
      if (v.ok) return c;
    }
    return null;
  }

  const LEVEL_NAMES = { 1: '쉬움', 2: '보통', 3: '어려움' };
  return { chooseMove, bestMelds, extendSets, rearrange, genCandidates, LEVEL_NAMES };
});
