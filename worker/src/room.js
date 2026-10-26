// 후엠아이 방 하나 = Durable Object 하나. 참가자들은 WebSocket으로 붙는다.
import { DurableObject } from 'cloudflare:workers';
import { newState, apply, join, disconnect, view } from './whoami_game.js';
import { nextBotJob, botWrite, botAnswer, botTurn, BOT_NAMES } from './whoami_bot.js';

const BOT_CALLS_PER_ROOM = 300;   // 방 하나에서 봇이 Claude를 부를 수 있는 횟수
const sleep = ms => new Promise(r => setTimeout(r, ms));

const IDLE_MS = 6 * 3600e3;   // 6시간 아무 일 없으면 방 정리

export class Room extends DurableObject {
  constructor(ctx, env){
    super(ctx, env);
    this.st = null;
    ctx.blockConcurrencyWhile(async () => { this.st = (await ctx.storage.get('s')) || null; });
  }
  async init(code){
    if(!this.st){ this.st = newState(code); await this.save(); }
    return true;
  }
  async exists(){ return !!this.st; }
  async save(){
    this.st.updated = Date.now();
    await this.ctx.storage.put('s', this.st);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }
  async alarm(){
    if(this.st && Date.now() - this.st.updated < IDLE_MS){ await this.ctx.storage.setAlarm(this.st.updated + IDLE_MS); return; }
    for(const ws of this.ctx.getWebSockets()) try{ ws.close(1000, 'room closed'); }catch(e){}
    await this.ctx.storage.deleteAll(); this.st = null;
  }

  async fetch(req){
    if(!this.st) return new Response('no room', {status: 404});
    if(req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', {status: 426});
    if(this.ctx.getWebSockets().length > 40) return new Response('busy', {status: 429});
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({pid: null});
    return new Response(null, {status: 101, webSocket: client});
  }

  send(ws, obj){ try{ ws.send(JSON.stringify(obj)); }catch(e){} }
  broadcast(){
    for(const ws of this.ctx.getWebSockets()){
      const a = ws.deserializeAttachment() || {};
      if(a.pid) this.send(ws, view(this.st, a.pid));
    }
  }

  async webSocketMessage(ws, raw){
    if(!this.st) return this.send(ws, {t: 'error', error: 'no_room'});
    if(typeof raw !== 'string' || raw.length > 2000) return;
    let m; try{ m = JSON.parse(raw); }catch(e){ return; }
    const a = ws.deserializeAttachment() || {};
    if(m.t === 'ping') return this.send(ws, {t: 'pong'});
    if(m.t === 'join'){
      const r = join(this.st, m.name, m.pid, m.key);
      if(r.error) return this.send(ws, {t: 'error', error: r.error});
      // 같은 사람이 다른 탭으로 다시 들어오면 예전 연결은 닫는다
      for(const other of this.ctx.getWebSockets()){
        if(other !== ws && (other.deserializeAttachment() || {}).pid === r.pid){ other.serializeAttachment({pid: null}); try{ other.close(4000, 'moved'); }catch(e){} }
      }
      ws.serializeAttachment({pid: r.pid});
      this.send(ws, {t: 'joined', pid: r.pid, key: r.key});
      await this.save(); this.broadcast();
      return this.runBots();
    }
    if(!a.pid) return this.send(ws, {t: 'error', error: 'not_joined'});
    if(m.t === 'addBot') m.names = BOT_NAMES;
    const err = apply(this.st, a.pid, m);
    if(err) return this.send(ws, {t: 'error', error: err});
    await this.save(); this.broadcast();
    this.runBots();
  }

  // 봇 차례가 있으면 하나씩 처리 (사람처럼 잠깐 뜸을 들이고)
  async runBots(){
    if(this.botBusy) return;
    this.botBusy = true;
    try{
      for(let guard = 0; guard < 60; guard++){
        const job = this.st && nextBotJob(this.st);
        if(!job) break;
        const before = JSON.stringify([this.st.phase, this.st.turn, this.st.pending]);
        await sleep(job.kind === 'answer' ? 900 : 1400);
        const allowAI = await this.allowAI();
        let msg;
        if(job.kind === 'write') msg = {t: 'write', text: await botWrite(this.env, this.st, job.pid, allowAI)};
        else if(job.kind === 'answer') msg = {t: 'answer', ...(await botAnswer(this.env, this.st, job.pid, allowAI))};
        else { const r = await botTurn(this.env, this.st, job.pid, allowAI); msg = {t: r.t, text: r.text, open: !!r.open}; }
        // 그사이 상황이 바뀌었으면 (누가 차례를 넘김 등) 버리고 다시 판단
        if(JSON.stringify([this.st.phase, this.st.turn, this.st.pending]) !== before && job.kind !== 'write') continue;
        if(!apply(this.st, job.pid, msg)){ await this.save(); this.broadcast(); }
      }
    } finally { this.botBusy = false; }
  }
  async allowAI(){
    this.st.botCalls = (this.st.botCalls || 0) + 1;
    if(this.st.botCalls > BOT_CALLS_PER_ROOM || !this.env.ANTHROPIC_API_KEY) return false;
    try{
      const lim = this.env.LIMITER.get(this.env.LIMITER.idFromName('global'));
      return (await lim.botCall(Number(this.env.DAILY_BOT_CALLS || 2000))).ok;
    }catch(e){ return false; }
  }

  async webSocketClose(ws){ await this.left(ws); }
  async webSocketError(ws){ await this.left(ws); }
  async left(ws){
    const a = ws.deserializeAttachment() || {};
    if(!a.pid || !this.st) return;
    const still = this.ctx.getWebSockets().some(o => o !== ws && (o.deserializeAttachment() || {}).pid === a.pid);
    if(still) return;
    disconnect(this.st, a.pid);
    await this.save(); this.broadcast();
  }
}
