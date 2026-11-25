/*!
 * 루미큐브 온라인 통신 모듈 (rk-net.js)
 * - Firebase를 직접 부르지 않고 어댑터(fb)를 통해서만 접근한다 → 가짜 DB로 테스트 가능.
 * - fb 어댑터 규약 (경로는 'a/b/c' 문자열, 루트는 ''):
 *     get(path) → Promise<값|null>
 *     set(path, 값)               update(path, {상대경로: 값, ...})   (값 null = 삭제)
 *     onValue(path, cb(값)) → 해제 함수
 *     transaction(path, fn) → Promise<{committed:boolean}>   (fn이 undefined를 돌려주면 중단)
 *     onDisconnectSet(path, 값)
 *
 * DB 구조
 *   rummikub/rooms/{코드}/meta   {roomName, pw, hostCid, status:'lobby'|'playing'|'over', createdAt, settings}
 *   rummikub/rooms/{코드}/seats/{0..3}  {name, cid, online}
 *   rummikub/rooms/{코드}/game   진행 상태 (배열은 JSON 문자열로 저장해 Firebase 배열 변환 문제를 피함)
 *   rummikub/rooms/{코드}/poolJson   남은 타일 더미(섞인 순서)
 *   rummikub/hands/{코드}/{자리}     각자의 패(JSON 문자열)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RKNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const J = JSON.stringify;
  const P = JSON.parse;
  const GRACE_MS = 6000; // 시간 초과 후 다른 사람이 대신 넘겨주기까지 기다리는 시간

  const pick = (v, list, d) => (list.indexOf(Number(v)) >= 0 ? Number(v) : d);

  function sanitizeSettings(s, allowSolo) {
    const x = s || {};
    return {
      players: pick(x.players, allowSolo ? [1, 2, 3, 4] : [2, 3, 4], 4),
      minMeld: pick(x.minMeld, [0, 20, 30], 30),
      jokers: pick(x.jokers, [0, 2], 2),
      handSize: pick(x.handSize, [10, 14], 14),
      turnSec: pick(x.turnSec, [0, 60, 90, 120], 90),
      totalMin: pick(x.totalMin, [0, 20, 30, 40], 30),
      aiLevel: pick(x.aiLevel, [1, 2, 3], 2),
    };
  }
  /** 컴퓨터가 '생각하는' 시간(1.5~3초) */
  const thinkMs = (seq) => 1500 + ((seq * 7919) % 1500);

  function createNet(fb, RK, opts) {
    const o = opts || {};
    const AI = o.AI || (typeof self !== 'undefined' ? self.RKAI : null);
    const cid = o.cid;
    const clock = o.now || (() => Date.now());
    let code = null;
    let seat = null;
    let room = null;
    let loaded = false; // 방 데이터 첫 수신 여부 (Firebase는 첫 데이터가 비동기로 도착함)
    let myHandStr = null;
    let offset = 0;
    let unsubs = [];
    let busy = false;
    const subs = new Set();

    const now = () => clock() + offset;
    const base = (c) => 'rummikub/rooms/' + (c || code);
    const handPath = (s, c) => 'rummikub/hands/' + (c || code) + '/' + s;

    /* ----- 화면에 넘기는 view ----- */
    function buildView() {
      if (!room || !room.meta) return { status: loaded ? 'gone' : 'loading', mySeat: seat, code };
      const meta = room.meta;
      const st = meta.settings;
      const seats = [];
      for (let i = 0; i < st.players; i++) {
        const s = room.seats && room.seats[i];
        seats.push(s ? { name: s.name, online: !!s.online, bot: !!s.bot, ai: !!s.ai } : null);
      }
      const v = {
        code,
        roomName: meta.roomName || '',
        hasPw: !!meta.pw,
        settings: st,
        status: meta.status,
        seats,
        mySeat: seat,
        isHost: meta.hostCid === cid,
        myHand: myHandStr ? P(myHandStr) : [],
        game: null,
        pool: null,
      };
      if (room.game && room.poolJson) {
        const g = room.game;
        const pool = P(room.poolJson);
        v.pool = pool;
        v.game = {
          seq: g.seq,
          turn: g.turn,
          turnStartedAt: g.turnStartedAt,
          endsAt: g.endsAt,
          table: P(g.tableJson),
          melded: P(g.meldedJson),
          counts: P(g.countsJson),
          poolPos: g.poolPos,
          poolLeft: pool.length - g.poolPos,
          passes: g.passes,
          lastPlaced: P(g.lastPlacedJson),
          winner: g.winner,
          endReason: g.endReason,
          scores: P(g.scoresJson),
          finalHands: P(g.finalHandsJson),
        };
      }
      return v;
    }

    function emit() {
      const v = buildView();
      subs.forEach((f) => f(v));
    }

    /* ----- 접속 상태 ----- */
    let marking = false;
    function markOnline() {
      if (seat == null || !code || marking) return;
      marking = true;
      Promise.resolve(fb.update(base() + '/seats/' + seat, { online: true, ai: null }))
        .then(() => fb.onDisconnectSet(base() + '/seats/' + seat + '/online', false))
        .catch(() => {})
        .then(() => {
          marking = false;
        });
    }

    function attach(c, s) {
      detach();
      code = c;
      seat = s;
      unsubs.push(
        fb.onValue(base(), (val) => {
          loaded = true;
          room = val;
          const me = room && room.seats && room.seats[seat];
          if (me && me.cid === cid && me.online !== true) markOnline();
          emit();
        })
      );
      unsubs.push(
        fb.onValue(handPath(seat), (val) => {
          myHandStr = val;
          emit();
        })
      );
      unsubs.push(fb.onValue('.info/serverTimeOffset', (val) => (offset = val || 0)));
      unsubs.push(
        fb.onValue('.info/connected', (val) => {
          if (val) markOnline();
        })
      );
    }

    function detach() {
      unsubs.forEach((u) => {
        try {
          u();
        } catch (e) {}
      });
      unsubs = [];
      room = null;
      loaded = false;
      myHandStr = null;
    }

    /* ----- 방 만들기 / 입장 ----- */
    async function createRoom(p) {
      const st = sanitizeSettings(p.settings);
      for (let i = 0; i < 30; i++) {
        const c = String(1000 + Math.floor(Math.random() * 9000));
        const meta = {
          roomName: p.roomName || null,
          pw: p.pw || null,
          hostCid: cid,
          status: 'lobby',
          createdAt: now(),
          settings: st,
        };
        const r = await fb.transaction(base(c) + '/meta', (cur) => (cur ? undefined : meta));
        if (r.committed) {
          await fb.set(base(c) + '/seats/0', { name: p.name, cid, online: true });
          attach(c, 0);
          return { code: c, seat: 0 };
        }
      }
      throw new Error('방 코드를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요');
    }

    async function joinRoom(p) {
      const c = String(p.code || '').trim();
      const meta = await fb.get(base(c) + '/meta');
      if (!meta) throw new Error('그런 방이 없어요. 코드를 다시 확인해 주세요');
      if (meta.pw && meta.pw !== p.pw) throw new Error('비밀번호가 달라요');
      const seatsObj = (await fb.get(base(c) + '/seats')) || {};
      const n = meta.settings.players;
      // 같은 기기로 다시 들어온 경우
      for (let i = 0; i < n; i++) {
        if (seatsObj[i] && seatsObj[i].cid === cid) {
          attach(c, i);
          return { code: c, seat: i };
        }
      }
      if (meta.status !== 'lobby') {
        // 진행 중에는 접속이 끊긴 같은 이름의 자리만 이어받을 수 있음
        for (let i = 0; i < n; i++) {
          const s = seatsObj[i];
          if (s && s.name === p.name && !s.online) {
            const r = await fb.transaction(base(c) + '/seats/' + i, (cur) =>
              cur && cur.name === p.name && !cur.online ? { name: cur.name, cid, online: true } : undefined
            );
            if (r.committed) {
              attach(c, i);
              return { code: c, seat: i };
            }
          }
        }
        throw new Error('이미 시작된 방이에요 (끊긴 자리와 같은 이름이면 다시 들어갈 수 있어요)');
      }
      for (let i = 0; i < n; i++) {
        if (seatsObj[i]) continue;
        const r = await fb.transaction(base(c) + '/seats/' + i, (cur) => (cur ? undefined : { name: p.name, cid, online: true }));
        if (r.committed) {
          attach(c, i);
          return { code: c, seat: i };
        }
      }
      throw new Error('방이 가득 찼어요');
    }

    async function resume(sess) {
      const meta = await fb.get(base(sess.code) + '/meta');
      if (!meta) throw new Error('방이 없어졌어요');
      const s = await fb.get(base(sess.code) + '/seats/' + sess.seat);
      if (!s || s.cid !== cid) throw new Error('자리를 찾을 수 없어요');
      attach(sess.code, sess.seat);
      return { code: sess.code, seat: sess.seat };
    }

    /* ----- 대기실 ----- */
    async function updateSettings(s) {
      const v = buildView();
      if (!v.isHost || v.status !== 'lobby') throw new Error('방장만, 시작 전에만 바꿀 수 있어요');
      const st = sanitizeSettings(s);
      const joined = v.seats.filter(Boolean).length;
      if (st.players < joined) throw new Error('이미 ' + joined + '명이 들어와 있어서 인원을 그보다 줄일 수 없어요');
      const upd = {};
      upd[base() + '/meta/settings'] = st;
      await fb.update('', upd);
    }

    async function kick(i) {
      const v = buildView();
      if (!v.isHost || v.status !== 'lobby' || i === seat) return;
      await fb.set(base() + '/seats/' + i, null);
    }

    async function addBot(i) {
      const v = buildView();
      if (!v.isHost || v.status !== 'lobby' || i < 0 || i >= v.settings.players) return;
      await fb.transaction(base() + '/seats/' + i, (cur) => (cur ? undefined : { name: '컴퓨터' + (i + 1), cid: 'bot-' + i, online: true, bot: true }));
    }
    async function fillBots() {
      const v = buildView();
      for (let i = 0; i < v.seats.length; i++) if (!v.seats[i]) await addBot(i);
    }
    /** 게임 중 접속이 끊긴 사람 자리를 컴퓨터가 대신 두게 함(다시 들어오면 돌려받음) */
    async function takeoverOffline() {
      const v = buildView();
      if (!v.isHost || v.status !== 'playing') return 0;
      const upd = {};
      v.seats.forEach((s, i) => { if (s && !s.bot && !s.online && !s.ai) upd[base() + '/seats/' + i + '/ai'] = true; });
      const n = Object.keys(upd).length;
      if (n) await fb.update('', upd);
      return n;
    }

    async function startGame() {
      const v = buildView();
      if (!v.isHost || v.status !== 'lobby') throw new Error('방장만 시작할 수 있어요');
      const st = v.settings;
      if (v.seats.filter(Boolean).length !== st.players) throw new Error('모든 자리가 차야 시작할 수 있어요');
      const g = RK.newGame({ players: st.players, minMeld: st.minMeld, jokers: st.jokers, handSize: st.handSize });
      const t = now();
      const upd = {};
      upd[base() + '/poolJson'] = J(g.pool);
      g.hands.forEach((h, i) => {
        upd[handPath(i)] = J(h);
      });
      upd[base() + '/game'] = {
        seq: 1,
        turn: Math.floor(Math.random() * st.players),
        turnStartedAt: t,
        endsAt: st.totalMin ? t + st.totalMin * 60000 : 0,
        tableJson: '[]',
        meldedJson: J(new Array(st.players).fill(false)),
        countsJson: J(g.hands.map((h) => h.length)),
        poolPos: 0,
        passes: 0,
        lastPlacedJson: '[]',
        winner: -1,
        endReason: 'none',
        scoresJson: 'null',
        finalHandsJson: 'null',
      };
      upd[base() + '/meta/status'] = 'playing';
      await fb.update('', upd);
    }

    async function rematch() {
      const v = buildView();
      if (!v.isHost || v.status !== 'over') return;
      const upd = {};
      upd[base() + '/meta/status'] = 'lobby';
      upd[base() + '/game'] = null;
      upd[base() + '/poolJson'] = null;
      upd['rummikub/hands/' + code] = null;
      await fb.update('', upd);
    }

    async function leave() {
      const v = buildView();
      const c = code;
      const s = seat;
      // 먼저 구독을 끊는다 (끊지 않으면 '접속 중'으로 되돌리는 코드가 다시 돌아 자리가 계속 접속 상태로 남음)
      detach();
      code = null;
      seat = null;
      emit();
      if (!c || s == null) return;
      if (v.status === 'lobby') {
        await fb.set(base(c) + '/seats/' + s, null);
        if (v.isHost) {
          const others = await fb.get(base(c) + '/seats');
          const ids = others ? Object.keys(others).filter((k) => !others[k].bot) : [];
          const upd = {};
          if (ids.length === 0) {
            upd[base(c)] = null;
            upd['rummikub/hands/' + c] = null;
          } else {
            upd[base(c) + '/meta/hostCid'] = others[ids[0]].cid;
          }
          await fb.update('', upd);
        }
      } else {
        try {
          await fb.set(base(c) + '/seats/' + s + '/online', false);
        } catch (e) {}
      }
    }

    /* ----- 게임 진행 ----- */
    async function readAllHands(n, overrideSeat, overrideHand) {
      const out = [];
      for (let i = 0; i < n; i++) {
        if (i === overrideSeat) out.push(overrideHand);
        else {
          const s = await fb.get(handPath(i));
          out.push(s ? P(s) : []);
        }
      }
      return out;
    }

    /** 차례 끝내기: 규칙 검사 → 테이블/차례 갱신 → 패 저장 (target: 둘 자리, 컴퓨터 자리도 가능) */
    async function commitFor(target, table, hand) {
      const seat_ = target;
      const v = buildView();
      const g = v.game;
      if (!g || v.status !== 'playing' || g.turn !== target) return { ok: false, message: '지금은 내 차례가 아니에요' };
      let handBefore = v.myHand;
      if (target !== seat) { const hs = await fb.get(handPath(target)); handBefore = hs ? P(hs) : []; }
      const chk = RK.validateTurn({
        tableBefore: g.table,
        handBefore,
        tableAfter: table,
        handAfter: hand,
        melded: g.melded[seat_],
        minMeld: v.settings.minMeld,
      });
      if (!chk.ok) return { ok: false, message: chk.message, badSets: chk.badSets, code: chk.code };

      const players = v.settings.players;
      const compactTable = table.filter((s) => s.length > 0);
      const counts = g.counts.slice();
      counts[seat_] = hand.length;
      const melded = g.melded.slice();
      melded[seat_] = true;
      let over = null;
      if (hand.length === 0) {
        const hands = await readAllHands(players, seat_, hand);
        over = { scores: RK.roundScores(hands, seat_), hands };
      }
      const t = now();
      const prevHand = myHandStr;
      if (seat_ === seat) myHandStr = J(hand); // 화면 깜빡임 방지: 내 패를 먼저 반영
      const res = await fb.transaction(base() + '/game', (cur) => {
        if (!cur || cur.seq !== g.seq || cur.turn !== seat_) return undefined;
        const n = Object.assign({}, cur, {
          seq: cur.seq + 1,
          tableJson: J(compactTable),
          meldedJson: J(melded),
          countsJson: J(counts),
          passes: 0,
          lastPlacedJson: J(chk.placed),
        });
        if (over) {
          n.winner = seat_;
          n.endReason = 'empty';
          n.scoresJson = J(over.scores);
          n.finalHandsJson = J(over.hands);
        } else {
          n.turn = (seat_ + 1) % players;
          n.turnStartedAt = t;
        }
        return n;
      });
      if (!res.committed) {
        myHandStr = prevHand;
        emit();
        return { ok: false, message: '그 사이에 차례가 바뀌었어요 (시간이 지났을 수 있어요)' };
      }
      const upd = {};
      upd[handPath(seat_)] = J(hand);
      if (over) upd[base() + '/meta/status'] = 'over';
      await fb.update('', upd);
      return { ok: true };
    }

    /** target 자리의 차례를 "1장 뽑고 넘김"으로 처리 (본인 또는 대신 넘겨주는 사람이 호출) */
    async function passFor(target) {
      const v = buildView();
      const g = v.game;
      if (!g || v.status !== 'playing' || g.turn !== target) return { ok: false, message: '지금은 그 사람의 차례가 아니에요' };
      const st = v.settings;
      const pool = v.pool;
      const drawId = g.poolPos < pool.length ? pool[g.poolPos] : null;
      let hand;
      if (target === seat) hand = v.myHand.slice();
      else {
        const s = await fb.get(handPath(target));
        hand = s ? P(s) : [];
      }
      const newHand = drawId !== null ? hand.concat([drawId]) : hand;
      let over = null;
      if (drawId === null && g.passes + 1 >= st.players) {
        const hands = await readAllHands(st.players, target, newHand);
        const fin = RK.finishByScore({ players: st.players, hands }, 'stalemate');
        over = { winner: fin.winner, scores: RK.roundScores(hands, fin.winner), hands };
      }
      const counts = g.counts.slice();
      if (drawId !== null) counts[target] += 1;
      const t = now();
      const prevHand = myHandStr;
      if (target === seat && drawId !== null) myHandStr = J(newHand);
      const res = await fb.transaction(base() + '/game', (cur) => {
        if (!cur || cur.seq !== g.seq || cur.turn !== target) return undefined;
        const n = Object.assign({}, cur, {
          seq: cur.seq + 1,
          countsJson: J(counts),
          lastPlacedJson: '[]',
          poolPos: cur.poolPos + (drawId !== null ? 1 : 0),
          passes: drawId !== null ? 0 : cur.passes + 1,
        });
        if (over) {
          n.winner = over.winner;
          n.endReason = 'stalemate';
          n.scoresJson = J(over.scores);
          n.finalHandsJson = J(over.hands);
        } else {
          n.turn = (target + 1) % st.players;
          n.turnStartedAt = t;
        }
        return n;
      });
      if (!res.committed) {
        myHandStr = prevHand;
        emit();
        return { ok: false, message: '그 사이에 차례가 바뀌었어요' };
      }
      const upd = {};
      if (drawId !== null) upd[handPath(target)] = J(newHand);
      if (over) upd[base() + '/meta/status'] = 'over';
      if (Object.keys(upd).length) await fb.update('', upd);
      return { ok: true, drew: drawId !== null };
    }

    /** 시간 종료/방장 종료: 감점이 가장 낮은 사람이 승리 */
    async function finishByScore(reason) {
      const v = buildView();
      const g = v.game;
      if (!g || v.status !== 'playing') return { ok: false };
      const st = v.settings;
      const hands = await readAllHands(st.players, null, null);
      const fin = RK.finishByScore({ players: st.players, hands }, reason);
      const scores = RK.roundScores(hands, fin.winner);
      const res = await fb.transaction(base() + '/game', (cur) => {
        if (!cur || cur.seq !== g.seq || cur.winner !== -1) return undefined;
        return Object.assign({}, cur, {
          seq: cur.seq + 1,
          winner: fin.winner,
          endReason: reason,
          scoresJson: J(scores),
          finalHandsJson: J(hands),
        });
      });
      if (!res.committed) return { ok: false };
      const upd = {};
      upd[base() + '/meta/status'] = 'over';
      await fb.update('', upd);
      return { ok: true };
    }

    /** 컴퓨터 차례: 수를 계산해 두고, 낼 수 없으면 뽑고 넘김 */
    async function runAI(target) {
      const v = buildView();
      const g = v.game;
      if (!g || g.turn !== target || !AI) return passFor(target);
      const hs = await fb.get(handPath(target));
      const hand = hs ? P(hs) : [];
      const mv = AI.chooseMove({ table: g.table, hand, melded: g.melded[target], minMeld: v.settings.minMeld, level: v.settings.aiLevel });
      if (mv) {
        const r = await commitFor(target, mv.table, mv.hand);
        if (r.ok) return r;
      }
      return passFor(target);
    }

    /** 1초마다 불러 주세요: 내 시간초과 처리, 끊긴 사람 대신 넘기기, 컴퓨터 차례 두기, 총 제한시간 종료 */
    function tick() {
      if (busy || seat == null) return;
      const v = buildView();
      if (v.status !== 'playing' || !v.game) return;
      const g = v.game;
      const st = v.settings;
      const t = now();
      // 실행 담당: 접속 중인 사람(컴퓨터 제외) 중 번호가 가장 빠른 사람
      const online = [];
      v.seats.forEach((s, i) => {
        if (s && s.online && !s.bot) online.push(i);
      });
      const cur = v.seats[g.turn];
      const aiTurn = !!(cur && (cur.bot || cur.ai));
      const lowest = (ex) => {
        const c = online.filter((i) => i !== ex);
        return c.length ? Math.min.apply(null, c) : -1;
      };
      let job = null;
      if (g.endsAt && t >= g.endsAt && seat === lowest(-1)) job = () => finishByScore('timeup');
      else if (aiTurn) {
        if (seat === lowest(-1) && t >= g.turnStartedAt + thinkMs(g.seq)) job = () => runAI(g.turn);
      } else if (st.turnSec > 0) {
        const dl = g.turnStartedAt + st.turnSec * 1000;
        if (g.turn === seat && t >= dl) job = () => passFor(seat);
        else if (g.turn !== seat && t >= dl + GRACE_MS && seat === lowest(g.turn)) job = () => passFor(g.turn);
      }
      if (job) {
        busy = true;
        Promise.resolve(job())
          .catch(() => {})
          .then(() => {
            busy = false;
          });
      }
    }

    return {
      createRoom, joinRoom, resume, leave,
      updateSettings, kick, startGame, rematch,
      commit: (table, hand) => commitFor(seat, table, hand),
      addBot, fillBots, takeoverOffline,
      drawPass: () => passFor(seat),
      forcePass: () => {
        const v = buildView();
        return v.isHost && v.game ? passFor(v.game.turn) : Promise.resolve({ ok: false });
      },
      endGame: () => {
        const v = buildView();
        return v.isHost ? finishByScore('host') : Promise.resolve({ ok: false });
      },
      tick,
      now,
      getView: buildView,
      subscribe: (f) => {
        subs.add(f);
        return () => subs.delete(f);
      },
      get code() { return code; },
      get seat() { return seat; },
    };
  }

  return { createNet, sanitizeSettings, thinkMs };
});
