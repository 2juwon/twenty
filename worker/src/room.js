// 후엠아이 방 하나 = Durable Object 하나. 참가자들은 WebSocket으로 붙는다.
import { DurableObject } from 'cloudflare:workers';
import { newState, apply, join, disconnect, view } from './whoami_game.js';

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
      await this.save(); return this.broadcast();
    }
    if(!a.pid) return this.send(ws, {t: 'error', error: 'not_joined'});
    const err = apply(this.st, a.pid, m);
    if(err) return this.send(ws, {t: 'error', error: err});
    await this.save(); this.broadcast();
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
