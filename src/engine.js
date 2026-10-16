// 스무고개 추론 엔진 (DOM 없음 — 브라우저와 시뮬레이션에서 같이 씀)
const CONFIG = {
  slip: 0.06,       // 사람이 실수로 반대로 답할 확률 (작을수록 엄격)
  guessP: 0.86,     // 이 확신 이상이면 20개 전이라도 찍는다
  minQ: 6,          // 최소 이만큼은 묻고 찍는다
  baseWeight: 3,    // 기본 데이터 하나가 학습 기록 몇 판만큼의 무게인지
  newDefault: 0.5,  // 새로 배운 항목에서 아직 모르는 질문 값
};

function Engine(theme, learned){
  const Q = theme.q, KEYS = Object.keys(Q);
  const items = theme.items.map(it => ({n: it.n, a: it.a || [], v: Object.assign({}, it.v), def: 0, plays: 0}));
  const byName = new Map();
  items.forEach((it, i) => [it.n, ...it.a].forEach(x => { if(!byName.has(norm(x))) byName.set(norm(x), i); }));

  // 학습 기록 반영: 질문마다 [합, 횟수]
  if(learned && learned.items){
    for(const name in learned.items){
      const rec = learned.items[name];
      let i = byName.get(norm(name));
      if(i === undefined){
        i = items.push({n: name, a: [], v: {}, def: CONFIG.newDefault, plays: 0, learned: true}) - 1;
        byName.set(norm(name), i);
      }
      const it = items[i];
      for(const k in rec){
        if(!(k in Q) || !Array.isArray(rec[k])) continue;
        const [s, c] = rec[k]; if(!c) continue;
        const base = (k in it.v) ? it.v[k] : it.def;
        const bw = it.learned ? 1 : CONFIG.baseWeight;
        it.v[k] = (base*bw + s) / (bw + c);
      }
      it.plays = (learned.plays && learned.plays[name]) || 0;
    }
  }

  const val = (it, k) => (k in it.v) ? it.v[k] : it.def;
  // 실제 값 v인 항목에 대해 사람이 a(1, .75, .25, 0)라고 답할 가능도
  function lik(v, a){
    const s = CONFIG.slip;
    const agree = 1 - Math.abs(a - v);         // 0..1
    return s + (1 - 2*s) * agree;
  }

  const st = {answers: [], excluded: new Set(), lastGuessQn: -1};

  function weights(){
    return items.map((it, i) => {
      if(st.excluded.has(i)) return 0;
      let w = 1 + Math.min(it.plays, 10) * 0.05;   // 자주 나온 답은 살짝 우대
      for(const {k, a} of st.answers) if(a !== null) w *= lik(val(it, k), a);
      return w;
    });
  }
  function ranked(W){
    let tot = 0; const r = [];
    W.forEach((w, i) => { tot += w; if(w > 0) r.push(i); });
    r.sort((x, y) => W[y] - W[x]);
    return {order: r, tot, p: tot ? W[r[0]] / tot : 0, p2: tot && r[1] !== undefined ? W[r[1]] / tot : 0};
  }
  function entropy(arr){
    let s = 0; for(const x of arr) s += x; if(!s) return 0;
    let h = 0; for(const x of arr) if(x > 0){ const p = x/s; h -= p*Math.log2(p); }
    return h;
  }
  function pickKey(W, tot, rnd){
    const asked = new Set(st.answers.map(x => x.k));
    // 후보가 많을 땐 상위 후보 위주로 계산 (빠르게)
    const idx = W.map((w, i) => i).filter(i => W[i] > tot * 1e-4);
    const scored = [];
    for(const k of KEYS){
      if(asked.has(k)) continue;
      const wy = [], wn = []; let py = 0, spread = 0;
      for(const i of idx){
        const w = W[i], v = val(items[i], k);
        wy.push(w*lik(v, 1)); wn.push(w*lik(v, 0));
        py += w*v; spread += w*Math.abs(v - 0.5);
      }
      const sum = idx.reduce((s, i) => s + W[i], 0) || 1;
      py /= sum;
      // 기대 엔트로피 + '모르겠어요'가 나올 만한 애매한 질문에 약간의 벌점
      const amb = 1 - 2*spread/sum;
      scored.push({k, s: py*entropy(wy) + (1-py)*entropy(wn) + amb*0.35});
    }
    if(!scored.length) return null;
    scored.sort((a, b) => a.s - b.s);
    const near = scored.filter(x => x.s - scored[0].s < 0.03).slice(0, 3);
    return near[Math.floor((rnd || Math.random)() * near.length)].k;
  }

  // 다음 행동: {type:'ask', k} | {type:'guess', i, p} | {type:'none'}
  function decide(limit, rnd){
    const W = weights(); const R = ranked(W);
    const qn = st.answers.length;
    if(!R.order.length) return {type: 'none'};
    const top = R.order[0];
    if(qn >= limit) return {type: 'guess', i: top, p: R.p};
    if(qn >= CONFIG.minQ && qn > st.lastGuessQn && (R.p >= CONFIG.guessP || (R.p >= 0.6 && R.p >= 12*R.p2)))
      return {type: 'guess', i: top, p: R.p};
    const k = pickKey(W, R.tot, rnd);
    if(!k) return {type: 'guess', i: top, p: R.p};
    return {type: 'ask', k, p: R.p};
  }
  function top(n){ const W = weights(); return ranked(W).order.slice(0, n); }
  function find(name){ return byName.get(norm(name)); }

  return {Q, KEYS, items, st, val, decide, top, find, weights};
}

function norm(s){ return String(s).trim().toLowerCase().replace(/\s+/g, ''); }

// 학습 기록에 한 판의 답을 더한다
function learnInto(learned, name, answers){
  learned.items = learned.items || {}; learned.plays = learned.plays || {};
  const rec = learned.items[name] = learned.items[name] || {};
  for(const {k, a} of answers){ if(a === null) continue; const r = rec[k] = rec[k] || [0, 0]; r[0] += a; r[1] += 1; }
  learned.plays[name] = (learned.plays[name] || 0) + 1;
  return learned;
}

if(typeof module !== 'undefined') module.exports = {Engine, learnInto, CONFIG, norm};
