// 스무고개 'Claude 추리' 중계 서버 (Cloudflare Workers)
// - Anthropic API 키는 서버 비밀값(ANTHROPIC_API_KEY)에만 있다
// - 하루 전체 판 수, 기기(IP)별 판 수, 판당 질문 수를 제한한다
// - 끝난 판의 결과(특히 못 맞힌 정답)를 모아 데이터 보강에 쓴다
import { DurableObject } from 'cloudflare:workers';
import { buildPrompt, cleanHistory, parseReply, CLAUDE_LIMIT, CLAUDE_EXTRA_GUESSES } from '../../src/claude_prompt.js';

const MAX_TURNS = CLAUDE_LIMIT + CLAUDE_EXTRA_GUESSES + 7;   // 판당 API 호출 상한 (되돌리기 여유 포함)

export default {
  async fetch(req, env){
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {status, headers: {...cors, 'Content-Type': 'application/json; charset=utf-8'}});
    if(req.method === 'OPTIONS') return new Response(null, {headers: cors});

    const url = new URL(req.url);
    const limiter = env.LIMITER.get(env.LIMITER.idFromName('global'));

    if(url.pathname === '/api/stats' && req.method === 'GET'){
      if(!env.STATS_TOKEN || url.searchParams.get('token') !== env.STATS_TOKEN) return json({error: 'forbidden'}, 403);
      return json(await limiter.stats(Number(env.DAILY_GAMES || 100)));
    }

    if(req.method !== 'POST') return json({error: 'not_found'}, 404);
    if(allowed.length && !allowed.includes(origin)) return json({error: 'forbidden'}, 403);
    let body; try{ body = await req.json(); }catch(e){ return json({error: 'bad_request'}, 400); }

    if(url.pathname === '/api/result'){
      const r = body || {};
      await limiter.result(String(r.gameId || '').slice(0, 40), {
        theme: r.theme === 'celeb' ? 'celeb' : 'all', won: !!r.won,
        name: String(r.name || '').trim().slice(0, 30), questions: Math.min(Number(r.questions) || 0, 40),
      });
      return json({ok: true});
    }

    if(url.pathname !== '/api/turn') return json({error: 'not_found'}, 404);
    const theme = body.theme === 'celeb' ? 'celeb' : 'all';
    const history = cleanHistory(body.history);
    if(!history) return json({error: 'bad_request'}, 400);

    // 판 시작 또는 이어가기 — 제한 확인
    let gameId = typeof body.gameId === 'string' ? body.gameId.slice(0, 40) : '';
    const ipHash = await sha(req.headers.get('CF-Connecting-IP') || 'unknown', env.STATS_TOKEN || 'salt');
    const gate = gameId
      ? await limiter.turn(gameId, MAX_TURNS)
      : await limiter.start(ipHash, Number(env.DAILY_GAMES || 100), Number(env.DAILY_GAMES_PER_DEVICE || 10));
    if(!gate.ok) return json({error: gate.reason}, 429);
    gameId = gate.gameId || gameId;

    // 모델을 순서대로 시도 (없는 모델이면 다음 것으로), 답을 못 읽으면 한 번 더 엄격하게
    const models = (env.MODEL || 'claude-haiku-5-5').split(',').map(m => m.trim()).filter(Boolean);
    const headers = {'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'};
    if(env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
    async function ask(prompt){
      let res, detail = '';
      for(const model of models){
        res = await fetch((env.ANTHROPIC_URL || 'https://api.anthropic.com') + '/v1/messages', {
          method: 'POST', headers,
          body: JSON.stringify({model, max_tokens: 600, messages: [{role: 'user', content: prompt}]}),
        });
        if(res.ok) break;
        const errText = await res.text();
        try{ detail = JSON.parse(errText).error.message || ''; }catch(e){ detail = errText; }
        console.log('anthropic error', model, res.status, errText.slice(0, 300));
        if(res.status !== 404) break;
      }
      if(!res.ok) return {err: json({error: 'upstream', status: res.status, detail: String(detail).slice(0, 160), gameId}, 502)};
      const data = await res.json();
      const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      const reply = parseReply(text);
      if(!reply) console.log('bad reply', data.stop_reason, text.slice(0, 400));
      return {reply};
    }
    let r = await ask(buildPrompt(theme, history));
    if(r.err) return r.err;
    if(!r.reply){ r = await ask(buildPrompt(theme, history, true)); if(r.err) return r.err; }
    const reply = r.reply;
    if(!reply) return json({error: 'bad_reply', gameId}, 502);
    return json({gameId, ...reply});
  },
};

async function sha(s, salt){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + s));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
function today(){   // 한국 날짜 기준
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

// 카운터와 결과를 한곳에서 관리 (동시에 들어와도 숫자가 꼬이지 않게)
export class Limiter extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, day TEXT, ip TEXT, turns INTEGER, created INTEGER);
      CREATE TABLE IF NOT EXISTS results(id TEXT, day TEXT, theme TEXT, won INTEGER, name TEXT, questions INTEGER, created INTEGER);
      CREATE INDEX IF NOT EXISTS games_day ON games(day);`);
  }
  async start(ip, dailyLimit, perDevice){
    const day = today();
    const total = this.sql.exec('SELECT COUNT(*) c FROM games WHERE day = ?', day).one().c;
    if(total >= dailyLimit) return {ok: false, reason: 'daily_limit'};
    const mine = this.sql.exec('SELECT COUNT(*) c FROM games WHERE day = ? AND ip = ?', day, ip).one().c;
    if(mine >= perDevice) return {ok: false, reason: 'device_limit'};
    const id = crypto.randomUUID();
    this.sql.exec('INSERT INTO games VALUES (?, ?, ?, 1, ?)', id, day, ip, Date.now());
    if(Math.random() < 0.05) this.sql.exec('DELETE FROM games WHERE created < ?', Date.now() - 14 * 86400e3);
    return {ok: true, gameId: id};
  }
  async turn(id, maxTurns){
    const row = this.sql.exec('SELECT turns FROM games WHERE id = ?', id).toArray()[0];
    if(!row) return {ok: false, reason: 'unknown_game'};
    if(row.turns >= maxTurns) return {ok: false, reason: 'turn_limit'};
    this.sql.exec('UPDATE games SET turns = turns + 1 WHERE id = ?', id);
    return {ok: true};
  }
  async result(id, r){
    const known = this.sql.exec('SELECT 1 FROM games WHERE id = ?', id).toArray().length;
    const dup = this.sql.exec('SELECT 1 FROM results WHERE id = ?', id).toArray().length;
    if(!known || dup) return;
    this.sql.exec('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?)', id, today(), r.theme, r.won ? 1 : 0, r.name, r.questions, Date.now());
  }
  async stats(dailyLimit){
    const day = today();
    const g = this.sql.exec('SELECT COUNT(*) games, COALESCE(SUM(turns),0) calls FROM games WHERE day = ?', day).one();
    const days = this.sql.exec(`SELECT day, COUNT(*) games, SUM(turns) calls FROM games GROUP BY day ORDER BY day DESC LIMIT 14`).toArray();
    const res = this.sql.exec(`SELECT day, theme, SUM(won) won, COUNT(*) played FROM results GROUP BY day, theme ORDER BY day DESC LIMIT 28`).toArray();
    const missed = this.sql.exec(`SELECT theme, name, COUNT(*) times FROM results WHERE won = 0 AND name <> '' GROUP BY theme, name ORDER BY times DESC LIMIT 100`).toArray();
    return {today: {day, games: g.games, limit: dailyLimit, apiCalls: g.calls, estCostUSD: +(g.calls * 0.0002).toFixed(3)}, days, results: res, missed};
  }
}
