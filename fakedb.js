// 실제 Firebase Realtime Database와 같은 규약의 메모리 가짜 DB (테스트 전용)
const J = JSON.stringify;
/* ---------- 가짜 DB ---------- */
function makeFakeDB(opts) {
  const asyncInitial = !!(opts && opts.asyncInitial); // 실제 Firebase처럼 첫 값을 비동기로 전달
  let tree = { '.info': { connected: true, serverTimeOffset: 0 } };
  const listeners = [];
  const seg = (p) => p.split('/').filter(Boolean);
  const clone = (x) => (x === undefined || x === null ? null : JSON.parse(JSON.stringify(x)));
  function getAt(p) {
    let n = tree;
    for (const k of seg(p)) {
      if (n == null || typeof n !== 'object') return null;
      n = n[k];
    }
    return n === undefined ? null : clone(n);
  }
  function prune(n) {
    if (n && typeof n === 'object') {
      for (const k of Object.keys(n)) {
        prune(n[k]);
        if (n[k] === null || (typeof n[k] === 'object' && Object.keys(n[k]).length === 0)) delete n[k];
      }
    }
  }
  function setAt(p, v) {
    const s = seg(p);
    if (!s.length) { tree = v == null ? {} : clone(v); return; }
    let n = tree;
    for (let i = 0; i < s.length - 1; i++) {
      if (n[s[i]] == null || typeof n[s[i]] !== 'object') n[s[i]] = {};
      n = n[s[i]];
    }
    if (v == null) delete n[s[s.length - 1]];
    else n[s[s.length - 1]] = clone(v);
    prune(tree);
  }
  function notify() {
    for (const l of listeners.slice()) {
      if (!l.active) continue;
      const cur = getAt(l.path);
      const js = J(cur);
      if (js !== l.last) { l.last = js; l.cb(cur); }
    }
  }
  return {
    getAt,
    setRaw(p, v) { setAt(p, v); notify(); },
    client() {
      const mine = [];
      const disc = [];
      return {
        get: async (p) => getAt(p),
        set: async (p, v) => { setAt(p, v); notify(); },
        update: async (p, obj) => {
          for (const k of Object.keys(obj)) setAt((p ? p + '/' : '') + k, obj[k]);
          notify();
        },
        onValue: (p, cb) => {
          const l = { path: p, cb, last: undefined, active: true };
          listeners.push(l); mine.push(l);
          const cur = getAt(p); l.last = J(cur);
          if (asyncInitial) setTimeout(() => { if (l.active) cb(getAt(p)); }, 3);
          else cb(cur);
          return () => { l.active = false; };
        },
        transaction: async (p, fn) => {
          const out = fn(getAt(p));
          if (out === undefined) return { committed: false };
          setAt(p, out); notify();
          return { committed: true };
        },
        onDisconnectSet: (p, v) => { disc.push([p, v]); },
        _disconnect() { mine.forEach((l) => (l.active = false)); disc.forEach(([p, v]) => setAt(p, v)); notify(); },
      };
    },
  };
}


module.exports = { makeFakeDB };
