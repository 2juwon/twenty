// 후엠아이 온라인 — 게임 규칙 (서버가 유일한 판정자, DOM/네트워크 없음)
export const MIN_PLAYERS = 3, MAX_PLAYERS = 8, MAX_Q = 20;
const LEN = {name: 12, topic: 30, secret: 30, q: 60};

export function newState(code){
  return {code, phase: 'lobby', players: [], topic: '', order: [], secrets: {}, logs: {}, used: {},
    turn: null, pending: null, solved: {}, out: {}, nextLogId: 1, round: 1, updated: Date.now()};
}

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const player = (st, pid) => st.players.find(p => p.pid === pid);
const host = st => st.players.find(p => p.host);

// 정답을 쓴 사람 = 순서상 바로 앞 사람 (내가 쓴 답은 옆 사람의 정답)
export function writerOf(st, pid){
  const i = st.order.indexOf(pid), n = st.order.length;
  return i < 0 ? null : st.order[(i - 1 + n) % n];
}
export function targetOf(st, pid){
  const i = st.order.indexOf(pid), n = st.order.length;
  return i < 0 ? null : st.order[(i + 1) % n];
}
const active = (st, pid) => !st.solved[pid] && !st.out[pid];

function nextTurn(st){
  st.pending = null;
  const n = st.order.length;
  if(!st.order.some(p => active(st, p))){ endGame(st); return; }
  let i = st.order.indexOf(st.turn);
  for(let k = 1; k <= n; k++){
    const p = st.order[(i + k) % n];
    if(active(st, p)){ st.turn = p; return; }
  }
}
function endGame(st){ st.phase = 'end'; st.turn = null; st.pending = null; }

function useQuestion(st, pid){
  st.used[pid] = (st.used[pid] || 0) + 1;
  if(st.used[pid] >= MAX_Q && !st.solved[pid]) st.out[pid] = true;
}
function markSolved(st, pid){
  if(st.solved[pid]) return;
  const rank = Object.keys(st.solved).length + 1;
  st.solved[pid] = {rank, used: st.used[pid] || 0};
  delete st.out[pid];
}
function unSolve(st, pid){
  if(!st.solved[pid]) return;
  delete st.solved[pid];
  // 순위 다시 매기기
  Object.entries(st.solved).sort((a, b) => a[1].rank - b[1].rank).forEach(([p, s], i) => s.rank = i + 1);
  if((st.used[pid] || 0) >= MAX_Q) st.out[pid] = true;
}

// 이 기록에 대답할 수 있는 사람: 정답 쓴 사람, 그 사람이 나가 있으면 질문자 빼고 아무나
export function canRespond(st, pid){
  if(!st.pending || pid === st.turn) return false;
  const w = writerOf(st, st.turn), wp = player(st, w);
  return pid === w || !(wp && wp.connected);
}
// 이의 제기 투표 자격: 질문한 사람과 정답 쓴 사람 빼고
function voters(st, entry){
  return st.players.filter(p => !p.bot && p.pid !== entry.asker && p.pid !== entry.writer && st.order.includes(p.pid)).map(p => p.pid);
}
function findEntry(st, id){
  for(const pid in st.logs){ const e = st.logs[pid].find(x => x.id === id); if(e) return e; }
  return null;
}
function resolveVote(st, e){
  const vs = Object.values(e.vote.votes);
  const wrong = vs.filter(v => v === 'wrong').length, right = vs.length - wrong;
  e.vote.open = false;
  e.vote.result = wrong > right ? 'overturned' : 'kept';
  if(e.vote.result !== 'overturned') return;
  if(e.kind === 'q'){
    e.ans = e.ans === 'yes' ? 'no' : e.ans === 'no' ? 'yes' : 'unsure';
  } else {
    e.ans = e.ans === 'correct' ? 'wrong' : 'correct';
    if(e.ans === 'correct'){ markSolved(st, e.asker); if(st.turn === e.asker) nextTurn(st); }
    else { unSolve(st, e.asker); if(st.phase === 'end'){ st.phase = 'play'; st.turn = e.asker; } }
    if(st.phase === 'play' && !st.order.some(p => active(st, p))) endGame(st);
  }
}

// 메시지 처리: 오류면 문자열 반환
export function apply(st, pid, m){
  const me = player(st, pid);
  if(!me) return 'not_joined';
  const isHost = !!me.host;
  st.updated = Date.now();
  switch(m.t){
    case 'topic':
      if(!isHost || st.phase !== 'lobby') return 'not_allowed';
      st.topic = clean(m.topic, LEN.topic); return;
    case 'addBot': {
      if(!isHost || st.phase !== 'lobby') return 'not_allowed';
      if(st.players.length >= MAX_PLAYERS) return 'full';
      const used = new Set(st.players.map(p => p.name));
      const base = (m.names || []).find(n => !used.has('AI ' + n)) || 'AI ' + (st.players.length + 1);
      const name = base.startsWith('AI ') ? base : 'AI ' + base;
      st.players.push({pid: rid(), key: rid(), name, host: false, connected: true, bot: true});
      return;
    }
    case 'claimHost': {
      const h = host(st);
      if(h && h.connected) return 'not_allowed';
      if(h) h.host = false;
      me.host = true; return;
    }
    case 'leave':
      if(st.phase !== 'lobby') return 'not_allowed';
      st.players = st.players.filter(p => p.pid !== pid);
      if(isHost){ const h = st.players.find(p => !p.bot); if(h) h.host = true; }
      return;
    case 'kick': {
      if(!isHost || st.phase !== 'lobby' || m.pid === pid) return 'not_allowed';
      st.players = st.players.filter(p => p.pid !== m.pid); return;
    }
    case 'start': {
      if(!isHost || st.phase !== 'lobby') return 'not_allowed';
      if(!st.topic) return 'no_topic';
      // AI 봇이 있으면 2명(나 + 봇 1)부터 가능
      const need = st.players.some(p => p.bot) ? 2 : MIN_PLAYERS;
      if(st.players.filter(p => p.connected).length < need) return 'not_enough';
      st.players = st.players.filter(p => p.connected);
      const ids = st.players.map(p => p.pid);
      for(let i = ids.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      Object.assign(st, {phase: 'write', order: ids, secrets: {}, logs: {}, used: {}, solved: {}, out: {}, turn: null, pending: null});
      ids.forEach(p => st.logs[p] = []);
      return;
    }
    case 'write': {
      if(st.phase !== 'write' || !st.order.includes(pid)) return 'not_allowed';
      const text = clean(m.text, LEN.secret); if(!text) return 'empty';
      st.secrets[targetOf(st, pid)] = {text, by: pid};
      if(st.order.every(p => st.secrets[p])){ st.phase = 'play'; st.turn = st.order[0]; }
      return;
    }
    case 'ask': case 'guess': {
      if(st.phase !== 'play' || st.turn !== pid || st.pending) return 'not_allowed';
      const text = clean(m.text, LEN.q); if(!text) return 'empty';
      st.pending = {kind: m.t === 'ask' ? 'q' : 'g', text, at: Date.now()};
      return;
    }
    case 'answer': {
      if(st.phase !== 'play' || !canRespond(st, pid)) return 'not_allowed';
      const p = st.pending, asker = st.turn;
      const ok = p.kind === 'q' ? ['yes', 'no', 'unsure'] : ['correct', 'wrong'];
      if(!ok.includes(m.ans)) return 'bad_answer';
      st.logs[asker].push({id: st.nextLogId++, kind: p.kind, text: p.text, ans: m.ans, asker, writer: writerOf(st, asker), by: pid, n: (st.used[asker] || 0) + 1, vote: null});
      useQuestion(st, asker);
      if(p.kind === 'g' && m.ans === 'correct') markSolved(st, asker);
      nextTurn(st);
      return;
    }
    case 'skip':
      if(!isHost || st.phase !== 'play') return 'not_allowed';
      nextTurn(st); return;
    case 'giveup':
      if(st.phase !== 'play' || !active(st, pid)) return 'not_allowed';
      st.out[pid] = true;
      if(st.turn === pid) nextTurn(st); else if(!st.order.some(p => active(st, p))) endGame(st);
      return;
    case 'dispute': {
      const e = findEntry(st, Number(m.id));
      if(!e || e.vote) return 'not_allowed';
      if(!voters(st, e).includes(pid)) return 'not_allowed';
      e.vote = {open: true, by: pid, votes: {}};
      return;
    }
    case 'vote': {
      const e = findEntry(st, Number(m.id));
      if(!e || !e.vote || !e.vote.open) return 'not_allowed';
      const vs = voters(st, e); if(!vs.includes(pid)) return 'not_allowed';
      if(!['right', 'wrong'].includes(m.v)) return 'bad_vote';
      e.vote.votes[pid] = m.v;
      const online = vs.filter(v => (player(st, v) || {}).connected);
      if(online.every(v => e.vote.votes[v])) resolveVote(st, e);
      return;
    }
    case 'closeVote': {
      const e = findEntry(st, Number(m.id));
      if(!isHost || !e || !e.vote || !e.vote.open) return 'not_allowed';
      resolveVote(st, e); return;
    }
    case 'again':
      if(!isHost || st.phase !== 'end') return 'not_allowed';
      Object.assign(st, {phase: 'lobby', order: [], secrets: {}, logs: {}, used: {}, solved: {}, out: {}, turn: null, pending: null, round: st.round + 1});
      st.players = st.players.filter(p => p.connected);
      if(!host(st)){ const h = st.players.find(p => !p.bot); if(h) h.host = true; }
      return;
    default: return 'unknown';
  }
}

// 입장 / 재입장. 반환: {pid, key} 또는 {error}
export function join(st, name, pid, key){
  const old = pid && st.players.find(p => p.pid === pid && p.key === key);
  if(old){ old.connected = true; if(name) old.name = clean(name, LEN.name) || old.name; return {pid: old.pid, key: old.key}; }
  if(st.phase !== 'lobby') return {error: 'started'};
  if(st.players.length >= MAX_PLAYERS) return {error: 'full'};
  const nm = clean(name, LEN.name); if(!nm) return {error: 'no_name'};
  let final = nm, k = 2;
  while(st.players.some(p => p.name === final)) final = nm + k++;
  const p = {pid: rid(), key: rid(), name: final, host: st.players.length === 0, connected: true};
  st.players.push(p);
  return {pid: p.pid, key: p.key};
}
export function disconnect(st, pid){
  const p = player(st, pid); if(!p) return;
  p.connected = false;   // 새로고침해도 자리는 남는다. 방장이 나가 있으면 다른 사람이 방장을 가져갈 수 있다
  // 열린 투표가 남은 사람만으로 끝날 수 있으면 마무리
  for(const id in st.logs) for(const e of st.logs[id]) if(e.vote && e.vote.open){
    const online = voters(st, e).filter(v => (player(st, v) || {}).connected);
    if(online.every(v => e.vote.votes[v])) resolveVote(st, e);
  }
}

// 각 사람에게 보낼 화면 정보: 내 정답은 끝날 때까지 가린다
export function view(st, pid){
  const reveal = st.phase === 'end';
  const secrets = {};
  for(const p in st.secrets){
    const s = st.secrets[p];
    secrets[p] = (p === pid && !reveal) ? {hidden: true, by: s.by} : {text: s.text, by: s.by};
  }
  return {
    t: 'state', me: pid, code: st.code, phase: st.phase, topic: st.topic, round: st.round, maxQ: MAX_Q,
    players: st.players.map(p => ({pid: p.pid, name: p.name, host: !!p.host, connected: !!p.connected, bot: !!p.bot})),
    order: st.order, written: st.phase === 'write' ? Object.values(st.secrets).map(s => s.by) : [],
    myTarget: st.order.length ? targetOf(st, pid) : null,
    secrets: st.phase === 'write' ? {} : secrets,
    logs: st.logs, used: st.used, solved: st.solved, out: st.out, turn: st.turn,
    pending: st.pending, canRespond: canRespond(st, pid),
  };
}
