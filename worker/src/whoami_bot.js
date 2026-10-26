// 후엠아이 AI 봇: 정답 쓰기, 대답하기, 질문·정답 외치기를 Claude(Haiku)로 한다.
// API를 못 쓰면(한도 초과·오류) 간단한 규칙으로 대신해서 게임이 멈추지 않게 한다.
import { writerOf, MAX_Q, openChances, revealsAnswer } from './whoami_game.js';

export const BOT_NAMES = ['봇돌이', '봇순이', '깡통이', '삐약봇', '로보할배', '찌릿봇', '뚝딱봇'];

export async function callClaude(env, prompt, maxTokens = 300){
  const models = (env.MODEL || 'claude-haiku-5-5').split(',').map(m => m.trim()).filter(Boolean);
  const headers = {'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'};
  if(env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
  for(const model of models){
    for(const noThink of [true, false]){
      const req = {model, max_tokens: maxTokens, messages: [{role: 'user', content: prompt}]};
      if(noThink) req.thinking = {type: 'disabled'};
      let res;
      try{ res = await fetch((env.ANTHROPIC_URL || 'https://api.anthropic.com') + '/v1/messages', {method: 'POST', headers, body: JSON.stringify(req)}); }
      catch(e){ return null; }
      if(res.ok){
        const data = await res.json();
        return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      }
      const t = await res.text();
      console.log('bot anthropic error', model, res.status, t.slice(0, 200));
      if(noThink && res.status === 400 && /think/i.test(t)) continue;
      if(res.status === 404) break;
      return null;
    }
  }
  return null;
}

function firstJSON(text){
  if(typeof text !== 'string') return null;
  for(let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)){
    let depth = 0, inStr = false, esc = false;
    for(let j = i; j < text.length; j++){
      const c = text[j];
      if(inStr){ if(esc) esc = false; else if(c === '\\') esc = true; else if(c === '"') inStr = false; continue; }
      if(c === '"') inStr = true; else if(c === '{') depth++;
      else if(c === '}' && --depth === 0){ try{ return JSON.parse(text.slice(i, j + 1)); }catch(e){ break; } }
    }
  }
  return null;
}

const RULE = '다른 말 없이 JSON 하나만 출력해. 값 안에는 큰따옴표를 쓰지 마.';

async function ai(env, prompt, check){
  if(!env.ANTHROPIC_API_KEY) return null;
  const text = await callClaude(env, prompt);
  const o = firstJSON(text);
  return o && check(o) ? o : null;
}

// 1) 정답 쓰기
export async function botWrite(env, st, pid, allowAI){
  const taken = Object.values(st.secrets).map(s => s.text);
  if(allowAI){
    const o = await ai(env, `후엠아이(이마에 붙인 정답 맞히기) 게임이야. 주제: ${st.topic}
다른 사람이 예/아니요 질문으로 맞혀야 할 정답을 하나 정해. 한국 사람 대부분이 아는 것으로, 너무 쉽지도 어렵지도 않게, 짧은 이름으로.
이미 나온 정답과 겹치지 마: ${taken.join(', ') || '(없음)'}
${RULE} 예: {"answer":"펭귄"}`, o => typeof o.answer === 'string' && o.answer.trim());
    if(o) return o.answer.trim().slice(0, 30);
  }
  return st.topic + ' 중 하나';
}

// 2) 질문에 대답하기 / 정답 판정
export async function botAnswer(env, st, pid, allowAI){
  const asker = st.turn, p = st.pending, secret = (st.secrets[asker] || {}).text || '';
  if(p.kind === 'o'){
    if(allowAI){
      const o = await ai(env, `후엠아이 게임에서 너는 상대의 정답을 알고 있어. 상대가 자유 질문 찬스를 써서 단답이 아닌 질문을 했어.
정답: ${secret} (주제: ${st.topic})
질문: ${p.text}
질문 속 나는/저는/저의는 정답(${secret})을 뜻해. 사실대로 짧게(25자 이내) 대답해. 정답 이름이나 그 일부는 절대 쓰지 마. 힌트가 되되 바로 답이 나오지 않게.
${RULE} 예: {"reply":"남극에 살아요"}`, o => typeof o.reply === 'string' && o.reply.trim() && !revealsAnswer(o.reply, secret));
      if(o) return {ans: 'open', reply: o.reply.trim().slice(0, 40)};
    }
    return {ans: 'open', reply: '음… 비밀이에요'};
  }
  return {ans: await yesNo(env, st, p, secret, allowAI)};
}
async function yesNo(env, st, p, secret, allowAI){
  if(p.kind === 'g'){
    const norm = s => s.replace(/\s+/g, '').toLowerCase();
    if(norm(p.text) === norm(secret)) return 'correct';
    if(allowAI){
      const o = await ai(env, `후엠아이 게임에서 상대가 정답을 외쳤어. 진짜 정답: ${secret} (주제: ${st.topic})
상대가 외친 답: ${p.text}
같은 것을 가리키면 correct (띄어쓰기, 별명, 영어 표기, 약간의 오타는 같은 것으로 봐). 다르면 wrong.
${RULE} 예: {"ans":"correct"}`, o => ['correct', 'wrong'].includes(o.ans));
      if(o) return o.ans;
    }
    return 'wrong';
  }
  if(allowAI){
    const o = await ai(env, `후엠아이 게임에서 너는 상대의 정답을 알고 있어. 상대가 자기 정답을 맞히려고 예/아니요 질문을 했어.
정답: ${secret} (주제: ${st.topic})
질문: ${p.text}
질문 속 나는/저는/제가는 정답(${secret})을 뜻해. 사실대로 답해. 사람마다 다르게 볼 수 있거나 정말 애매하면 unsure.
${RULE} 예: {"ans":"yes"}  (yes / no / unsure 중 하나)`, o => ['yes', 'no', 'unsure'].includes(o.ans));
    if(o) return o.ans;
  }
  return 'unsure';
}

// 3) 내 차례: 질문하거나 정답 외치기
const FALLBACK_Q = ['저는 살아 있나요?', '저는 사람인가요?', '저는 먹을 수 있나요?', '저는 손에 들 수 있나요?', '저는 한국과 관련 있나요?', '저는 집에서 볼 수 있나요?', '저는 동물인가요?', '저는 유명한가요?'];
export async function botTurn(env, st, pid, allowAI){
  const log = st.logs[pid] || [];
  const left = MAX_Q - (st.used[pid] || 0);
  const ANS = {yes: '예', no: '아니요', unsure: '애매해요', correct: '정답', wrong: '틀림'};
  const lines = log.map((e, i) => `${i + 1}. ${e.kind === 'g' ? '[정답 외치기] ' : e.kind === 'o' ? '[자유 질문] ' : ''}${e.text} → ${e.kind === 'o' ? (e.ans === 'voided' ? '(무효 판정)' : e.reply) : ANS[e.ans]}`).join('\n') || '(아직 없음)';
  const others = st.order.filter(p => p !== pid).map(p => (st.secrets[p] || {}).text).filter(Boolean);
  const chance = openChances(st, pid) > 0;
  if(allowAI){
    const o = await ai(env, `너는 후엠아이 게임 참가자야. 네 이마에 붙은 정답(주제: ${st.topic})을 너만 몰라. 예/아니요 질문으로 맞혀야 해.
지금까지 네 질문과 대답:
${lines}
남은 기회: ${left}번 (질문과 정답 외치기 모두 1번씩 씀)
참고로 다른 사람들의 정답은 ${others.join(', ')} 이라서 네 정답은 이것들과 다를 가능성이 커.
규칙: 짧고 분명한 한국어 질문 하나 (예: 저는 동물인가요?). 이미 한 질문은 다시 하지 마. 70% 이상 확신하거나 남은 기회가 1번이면 정답을 외쳐.
${chance ? '지금 자유 질문 찬스가 있어. 예/아니요가 아닌 질문(예: 저의 대표작은 무엇인가요? / 저는 주로 어디에 있나요?)을 할 수 있어. 쓰려면 type을 open으로.\n' : ''}${RULE} 예: {"type":"ask","text":"저는 날 수 있나요?"} 또는 {"type":"guess","text":"펭귄"}${chance ? ' 또는 {"type":"open","text":"저는 주로 어디에 사나요?"}' : ''}`,
      o => ['ask', 'guess', 'open'].includes(o.type) && typeof o.text === 'string' && o.text.trim() && (o.type !== 'open' || chance));
    if(o) return o.type === 'open' ? {t: 'ask', open: true, text: o.text.trim().slice(0, 60)} : {t: o.type, text: o.text.trim().slice(0, 60)};
  }
  if(left <= 1) return {t: 'guess', text: '모르겠다!'};
  const asked = new Set(log.map(e => e.text));
  const q = FALLBACK_Q.find(x => !asked.has(x)) || ('저는 ' + st.topic + '인가요?');
  return {t: 'ask', text: q};
}

// 지금 봇이 해야 할 일 하나 찾기
export function nextBotJob(st){
  const bot = pid => (st.players.find(p => p.pid === pid) || {}).bot;
  if(st.phase === 'write'){
    const pid = st.order.find(p => bot(p) && !Object.values(st.secrets).some(s => s.by === p));
    return pid ? {kind: 'write', pid} : null;
  }
  if(st.phase !== 'play' || !st.turn) return null;
  if(st.pending){
    const w = writerOf(st, st.turn);
    return bot(w) ? {kind: 'answer', pid: w} : null;
  }
  return bot(st.turn) ? {kind: 'turn', pid: st.turn} : null;
}
