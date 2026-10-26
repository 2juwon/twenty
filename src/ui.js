// 화면 (DATA, Engine, learnInto, CONFIG, norm 은 빌드할 때 위에 들어온다)
const THEMES = {
  all:{label:'모든 것', chips:['동물','음식','물건','탈것','장소','직업','캐릭터','자연'],
    prompt:'머릿속에 무언가 하나를 떠올려 주세요.', eg:'예: 고구마', unit:'개', who:'무엇을',
    old:'seumugogae-learned-v1'},
  celeb:{label:'연예인', chips:['가수·아이돌','배우','예능인','운동선수','유튜버','감독'],
    prompt:'유명한 사람을 한 명 떠올려 주세요.', eg:'예: 김종국', unit:'명', who:'누구를',
    old:'seumugogae-learned-celeb-v1'}
};
const ORD = ['첫','두','세','네','다섯','여섯','일곱','여덟','아홉','열','열한','열두','열세','열네','열다섯','열여섯','열일곱','열여덟','열아홉','스무','스물한','스물두','스물세','스물네','스물다섯'];
const BASE_LIMIT = 20, EXTRA = 5, END_GUESSES = 3;

let theme = 'all', E = null, learned = null;
let cur = null, guessIdx = -1, phase = 'intro', limit = BASE_LIMIT, endWrong = 0, extended = false;

function storeKey(){ return 'seumugogae-v2-' + theme; }
function loadLearned(){
  let L = null;
  try{ L = JSON.parse(localStorage.getItem(storeKey())); }catch(e){}
  if(!L || typeof L !== 'object') L = {items:{}, plays:{}};
  // 예전 버전 기록 옮기기
  try{
    const old = JSON.parse(localStorage.getItem(THEMES[theme].old));
    if(Array.isArray(old) && old.length){
      old.forEach(o => { if(o && o.name && o.ans) learnInto(L, o.name, Object.keys(o.ans).map(k => ({k, a:o.ans[k]}))); });
      localStorage.removeItem(THEMES[theme].old); saveLearned(L);
    }
  }catch(e){}
  return L;
}
function saveLearned(L){ try{ localStorage.setItem(storeKey(), JSON.stringify(L)); return true; }catch(e){ return false; } }
function setTheme(t){ theme = THEMES[t] ? t : 'all'; try{ localStorage.setItem('seumugogae-theme', theme); }catch(e){} }
try{ setTheme(localStorage.getItem('seumugogae-theme') || 'all'); }catch(e){ setTheme('all'); }

// 모드: basic = 데이터 기반 엔진, claude = Claude가 추리
let mode = 'basic', sampleFn = null;
try{ mode = localStorage.getItem('seumugogae-mode') === 'claude' ? 'claude' : 'basic'; }catch(e){}
function setMode(m){ mode = m; try{ localStorage.setItem('seumugogae-mode', m); }catch(e){} }
const claudeReady = () => !!sampleFn || !!(SITE.workerUrl && !window.claude);
if(window.claude && window.claude.use){
  window.claude.use('sample').then(s => { if(s){ sampleFn = s; if(phase === 'intro') intro(); } }).catch(() => {});
}
// 주인 테스트 모드: 주소 끝에 ?dev=통계비밀번호 를 붙여 한 번 열면 이 기기에 저장돼 하루 제한에서 빠진다 (?dev=off 로 해제)
let devToken = '';
try{
  const q = new URLSearchParams(location.search).get('dev');
  if(q === 'off') localStorage.removeItem('seumugogae-dev'); else if(q) localStorage.setItem('seumugogae-dev', q);
  if(q) history.replaceState(null, '', location.pathname + location.hash);
  devToken = localStorage.getItem('seumugogae-dev') || '';
}catch(e){}
function track(name, params){ if(devToken) return; try{ if(window.gtag) window.gtag('event', name, Object.assign({theme, mode}, params || {})); }catch(e){} }
const CLAUDE_THEMES = {
  all:{label:'모든 것', chips:['무엇이든','동물','음식','물건','장소','캐릭터'], prompt:'아무거나 하나 떠올려 봐라잉. 이 할미가 다 맞혀 줄 텡께.'},
  celeb:{label:'인물', chips:['연예인','역사 인물','운동선수','캐릭터','유튜버'], prompt:'누구든 한 사람 떠올려 봐. 할미가 사람 보는 눈은 있어야.'}
};

const card = document.getElementById('card');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function show(html){ card.classList.remove('fade'); void card.offsetWidth; card.innerHTML = html; card.classList.add('fade'); }
const $ = id => document.getElementById(id);

function ridge(n){
  const svg = $('ridge');
  const xs = i => 12 + i*(376/19);
  const ys = i => i === 19 ? 14 : 58 - 30*Math.abs(Math.sin(i*2.1 + 0.7)) - i*0.6;
  let back = 'M0 96 L0 70', front = 'M0 96 L0 80';
  for(let i=0;i<20;i++){
    const x = xs(i), y = ys(i), vx = x - 376/38;
    back += ` L${(vx+4).toFixed(1)} ${(y+30).toFixed(1)} L${(x+6).toFixed(1)} ${(y+8).toFixed(1)}`;
    front += ` L${vx.toFixed(1)} ${Math.min(88, y+28).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  back += ' L400 66 L400 96 Z'; front += ' L400 78 L400 96 Z';
  let dots = '';
  for(let i=0;i<20;i++){
    const x = xs(i).toFixed(1), y = ys(i).toFixed(1);
    if(i < n) dots += `<circle cx="${x}" cy="${y}" r="4.5" fill="var(--accent)"/>`;
    else if(i === n && phase === 'play') dots += `<circle class="peak-now" cx="${x}" cy="${y}" r="5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2.5"/>`;
    else dots += `<circle cx="${x}" cy="${y}" r="3" fill="var(--bg)" stroke="var(--ridge)" stroke-width="1.5"/>`;
  }
  svg.innerHTML = `<path d="${back}" fill="var(--ridge-back)"/><path d="${front}" fill="var(--ridge)"/>${dots}`;
  $('count').innerHTML = phase === 'intro' ? `<b>20</b>개의 고개`
    : n > 20 ? `<b>${n}</b> / ${limit} 고개 <span class="extra">연장전</span>` : `<b>${n}</b> / ${limit} 고개`;
}

function intro(){
  cTok++; if(cCtl){ try{ cCtl.abort(); }catch(e){} cCtl = null; }
  phase = 'intro'; cur = null; limit = BASE_LIMIT; endWrong = 0; extended = false;
  learned = loadLearned();
  E = Engine(DATA[theme], learned);
  ridge(0);
  if(mode === 'claude' && !claudeReady()) mode = 'basic';
  const isC = mode === 'claude';
  const T = isC ? CLAUDE_THEMES[theme] : THEMES[theme];
  const labels = isC ? CLAUDE_THEMES : THEMES;
  const learnedN = Object.keys(learned.items || {}).length;
  const note = isC
    ? (sampleFn ? 'AI 할머니가 직접 질문을 만들어 추리해요. 내 Claude 사용량으로 돌아가요.' : `AI 할머니가 직접 질문을 만들어 추리해요. 한 사람당 하루 ${SITE.perDevice || 10}판까지 할 수 있어요.`)
    : `아는 ${theme === 'celeb' ? '사람' : '것'} ${E.items.length}${T.unit} · 질문 ${E.KEYS.length}가지${learnedN ? ` · 이 기기에서 배운 것 ${learnedN}${T.unit}` : ''}`;
  show(`
    ${claudeReady() ? `<div class="seg" role="group" aria-label="모드"><button class="seg-b" data-m="basic" aria-pressed="${!isC}">기본</button><button class="seg-b" data-m="claude" aria-pressed="${isC}">시골 할머니</button></div>` : ''}
    <div class="seg" role="group" aria-label="주제">${Object.keys(labels).map(t => `<button class="seg-b" data-t="${t}" aria-pressed="${t === theme}">${labels[t].label}</button>`).join('')}</div>
    <h2 class="q">${T.prompt}</h2>
    ${isC ? '<div class="granny"><span class="face" aria-hidden="true">👵</span><p class="bubble">스무고개로 이 할미를 이긴 사람은 여태 없었어야~ 어디 한번 덤벼 봐.</p></div>' : `<p class="lead">예, 아니요로 답할 수 있는 질문을 스무 번까지 할게요. 헷갈리면 '아마도'나 '모르겠어요'를 눌러도 괜찮아요.</p>`}
    <div class="chips">${T.chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>
    <button class="primary big" id="start">생각했어요, 시작!</button>
    ${SITE.workerUrl ? '<a class="friends" href="whoami/">👥 친구들과 온라인 후엠아이 하기 <span aria-hidden="true">→</span></a>' : ''}
    <p class="note">${note}${isC && devToken ? ' · <b>테스트 모드</b> (하루 제한·통계에서 빠짐)' : ''}</p>`);
  card.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if(b.dataset.t !== theme){ setTheme(b.dataset.t); intro(); } });
  card.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { if(b.dataset.m !== mode){ setMode(b.dataset.m); intro(); } });
  $('start').onclick = () => { track('game_start'); isC ? cStart() : next(); };
}

function next(){
  phase = 'play';
  const d = E.decide(limit);
  if(d.type === 'none') return lose();
  if(d.type === 'guess') return guess(d.i);
  ask(d.k, d.p);
}

function ask(k, p){
  phase = 'play'; cur = k; const qn = E.st.answers.length; ridge(qn);
  if(p === undefined){ const W = E.weights(); const tot = W.reduce((a,b)=>a+b,0); p = tot ? Math.max(...W)/tot : 0; }
  const label = p > .6 ? '거의 알 것 같아요' : p > .3 ? '감이 오고 있어요' : '아직 감 잡는 중';
  show(`
    <span class="eyebrow">${ORD[qn] || (qn+1)+''} 번째 고개${qn >= 20 ? ' · 연장전' : ''}</span>
    <h2 class="q">${esc(E.Q[k])}</h2>
    <div class="row">
      <button class="primary big" data-a="1">예</button>
      <button class="big" data-a="0">아니요</button>
    </div>
    <div class="row3">
      <button class="soft" data-a="0.75">아마도요</button>
      <button class="soft" data-a="null">모르겠어요</button>
      <button class="soft" data-a="0.25">아마 아니요</button>
    </div>
    <div class="foot">
      <button class="link" id="undo" ${qn ? '' : 'disabled'}>이전 질문으로</button>
      <span class="hunch">${label}<i><span style="width:${Math.round(Math.min(1,p)*100)}%"></span></i></span>
    </div>`);
  card.querySelectorAll('[data-a]').forEach(b => b.onclick = () => answer(b.dataset.a === 'null' ? null : Number(b.dataset.a)));
  $('undo').onclick = undo;
}

function answer(a){ if(phase !== 'play' || !cur) return; E.st.answers.push({k:cur, a}); cur = null; next(); }
function undo(){
  if(!E.st.answers.length) return;
  const last = E.st.answers.pop();
  E.st.lastGuessQn = Math.min(E.st.lastGuessQn, E.st.answers.length - 1);
  ask(last.k);
}

function guess(i){
  phase = 'guess'; guessIdx = i; E.st.lastGuessQn = E.st.answers.length; ridge(E.st.answers.length);
  const n = E.st.answers.length, again = E.st.excluded.size > 0;
  show(`
    <span class="eyebrow">${n}개의 고개를 넘었어요</span>
    <h2 class="q">${again ? '그럼 혹시…' : '혹시 생각한 게…'}</h2>
    <p class="answer">${esc(E.items[i].n)}</p>
    <div class="row">
      <button class="gold big" id="yes">맞아요!</button>
      <button class="big" id="no">아니에요</button>
    </div>`);
  $('yes').onclick = win;
  $('no').onclick = () => {
    E.st.excluded.add(guessIdx);
    if(E.st.answers.length >= limit){
      endWrong++;
      if(endWrong >= END_GUESSES) return extended ? lose() : offerExtra();
    }
    next();
  };
}

function offerExtra(){
  phase = 'end'; ridge(E.st.answers.length);
  show(`
    <span class="eyebrow">스무 고개를 다 넘었어요</span>
    <h2 class="q">아깝네요. 다섯 고개만 더 넘어 볼까요?</h2>
    <p class="lead">질문을 다섯 개 더 하고 다시 맞혀 볼게요.</p>
    <div class="row">
      <button class="gold big" id="more">연장전 가기</button>
      <button class="big" id="giveup">정답 알려 주기</button>
    </div>`);
  $('more').onclick = () => { extended = true; limit = BASE_LIMIT + EXTRA; endWrong = 0; next(); };
  $('giveup').onclick = lose;
}

function remember(name){
  learnInto(learned, name, E.st.answers);
  return saveLearned(learned);
}

function win(){
  phase = 'end'; ridge(E.st.answers.length);
  const n = E.st.answers.length, name = E.items[guessIdx].n;
  remember(name);
  track('game_end', {result:'win', questions:n});
  show(`
    <span class="eyebrow">맞혔어요</span>
    <p class="answer">${esc(name)}</p>
    <p class="lead">${n ? ORD[Math.max(0,n-1)] + ' 번째 고개에서 맞혔어요.' : '질문 없이 바로 맞혔어요.'} ${E.st.excluded.size ? `(${E.st.excluded.size}번 틀린 뒤에)` : ''}</p>
    <p class="note">이번 답들도 기록해 뒀어요. 플레이할수록 이 기기에서 더 잘 맞혀요.</p>
    <button class="primary big" id="again">한 번 더 하기</button>`);
  $('again').onclick = intro;
}

function lose(){
  phase = 'end'; ridge(E.st.answers.length);
  const T = THEMES[theme];
  const top = E.top(4);
  track('game_end', {result:'lose', questions:E.st.answers.length});
  show(`
    <span class="eyebrow">제가 졌어요</span>
    <h2 class="q">${T.who} 생각하셨어요?</h2>
    ${top.length ? `<div class="chips">${top.map(i => `<button class="chip" data-n="${esc(E.items[i].n)}">${esc(E.items[i].n)}</button>`).join('')}</div>` : ''}
    <form id="teach">
      <label class="note" for="answer">정답을 알려 주시면 다음엔 맞혀 볼게요</label>
      <input type="text" id="answer" maxlength="20" placeholder="${esc(T.eg)}" autocomplete="off" list="names">
      <datalist id="names">${E.items.map(it => `<option value="${esc(it.n)}">`).join('')}</datalist>
      <button class="primary big" type="submit">알려 주기</button>
    </form>
    <button class="link" id="skip">그냥 다시 하기</button>`);
  card.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { $('answer').value = b.dataset.n; });
  $('skip').onclick = intro;
  $('teach').onsubmit = e => {
    e.preventDefault();
    let name = $('answer').value.trim().slice(0,20);
    if(!name){ $('answer').focus(); return; }
    const known = E.find(name);
    if(known !== undefined) name = E.items[known].n;   // 별명으로 써도 같은 항목으로
    const ok = remember(name);
    show(`
      <span class="eyebrow">고마워요</span>
      <p class="answer">${esc(name)}</p>
      <p class="lead">${!ok ? '이 브라우저에서는 저장이 막혀 있어서 기억하지 못했어요.'
        : known !== undefined ? '알고 있던 건데 놓쳤네요. 이번 답을 반영해서 다음엔 맞혀 볼게요.'
        : '처음 듣는 거예요. 이 기기에 기억해 뒀다가 다음 판부터 맞혀 볼게요.'}</p>
      <button class="primary big" id="again">한 번 더 하기</button>`);
    $('again').onclick = intro;
  };
}

document.addEventListener('keydown', e => {
  if(phase !== 'play' || e.target.tagName === 'INPUT') return;
  const f = mode === 'claude' ? cAnswer : answer;
  if(e.key === 'y' || e.key === 'Y') f(mode === 'claude' ? '예' : 1);
  if(e.key === 'n' || e.key === 'N') f(mode === 'claude' ? '아니요' : 0);
});

// ───────── 시골 할머니 모드 (AI가 추리) ─────────
let cHist = [], cGame = '', cQ = null, cEndWrong = 0, cCtl = null, cGuessName = '', cTok = 0, cQuip = '';
const cCache = new Map();   // 같은 질문·답 흐름이면 AI를 다시 부르지 않고 저장된 답을 쓴다
const cQn = () => cHist.filter(h => h.t === 'q').length;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const GRANNY = {
  think: ['할미가 머리 굴리는 중이여', '가만 있어 봐, 감이 온다잉', '돋보기 좀 찾고…', '어디 보자~ 어디 보자~', '이 할미 촉이 발동 걸리는 중'],
  winFast: ['봤냐? 이 할미 아직 안 죽었어야 😎', '아이고 싱거워라. 좀 어려운 걸로 가져와 봐', '이 정도는 눈 감고도 맞히제'],
  win: ['그려그려, 할미가 맞혔제? 허허', '거 봐라, 할미 말이 맞다 했지', '이 할미 촉은 아직 쓸 만혀'],
  winLate: ['휴… 진땀 뺐네. 그래도 맞혔으니 할미 승이여', '쪼까 헤맸어도 이긴 건 이긴 거여'],
  wrong: ['아따, 안경을 안 써서 그려', '잠깐, 이건 연습이었어야', '귀가 어두워서 잘못 들었나 벼', '흠흠… 다시 간다잉'],
  lose: ['아이고… 할미가 졌다. 이런 건 처음이여', '허 참, 우리 강아지 제법이네?', '이건 인정혀. 근데 다음엔 안 봐준다잉'],
};
const ERR = {
  daily_limit: '오늘은 할미가 너무 많이 놀아서 힘들어야. 내일 다시 오든가 기본 모드로 해 봐.',
  device_limit: '오늘 할미랑 놀 수 있는 판을 다 썼어야. 기본 모드로 해 봐.',
  turn_limit: '이번 판은 질문을 너무 많이 해 부렀네. 새로 시작해 보자.',
  unknown_game: '판 정보가 사라졌어야. 새로 시작해 줘.',
  rate_limited: '사람이 너무 몰려서 할미가 정신이 없어야. 쪼까 있다가 다시 해 봐.',
  not_granted: 'Claude 사용을 허용하지 않아서 할머니 모드를 쓸 수 없어요. 기본 모드로 해 보세요.',
};

async function claudeTurn(){
  if(sampleFn){
    for(const strict of [false, true]){
      cCtl = new AbortController();
      const o = await sampleFn.json(buildPrompt(theme, cHist, strict), {modelTier:'quick', cache:false, signal:cCtl.signal})
        .catch(e => { if(e && e.code === 'invalid_json') return null; throw e; });
      const r = checkReply(o); if(r) return r;
    }
    throw {code:'bad_reply'};
  }
  let res;
  try{
    res = await fetch(SITE.workerUrl + '/api/turn', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({theme, history:cHist, gameId:cGame || undefined, dev:devToken || undefined})});
  }catch(e){ throw {code:'network'}; }
  const j = await res.json().catch(() => ({}));
  if('gameId' in j) cGame = j.gameId || '';
  if(!res.ok) throw {code: j.error || 'upstream', status: j.status || res.status, detail: j.detail};
  const r = checkReply(j); if(!r) throw {code:'bad_reply'}; return r;
}

function granny(text){ return text ? `<div class="granny"><span class="face" aria-hidden="true">👵</span><p class="bubble">${esc(text)}</p></div>` : ''; }

function cStart(){ cHist = []; cGame = ''; cEndWrong = 0; cQuip = ''; cCache.clear(); limit = CLAUDE_LIMIT; cNext(); }

async function cNext(){
  phase = 'think'; ridge(cQn());
  show(`
    <span class="eyebrow">${ORD[cQn()] || ''} 번째 고개 · 시골 할머니</span>
    <h2 class="q thinking">${pick(GRANNY.think)}<span class="dots"><i>.</i><i>.</i><i>.</i></span></h2>
    ${granny(cQuip)}`);
  const tok = ++cTok, key = JSON.stringify(cHist); let r = cCache.get(key);
  if(!r){
    try{ r = await claudeTurn(); }
    catch(e){ if(tok !== cTok) return; return cError(e && e.code, e && e.status, e && e.detail); }
    cCache.set(key, r);
  }
  if(tok !== cTok || phase !== 'think') return;   // 그사이 처음으로 돌아갔으면 무시
  cQuip = r.quip || '';
  if(r.type === 'guess' || cQn() >= CLAUDE_LIMIT + 2) return cGuess(r.type === 'guess' ? r.name : null);
  cAsk(r.question);
}

function cError(code, status, detail){
  if(code === 'cancelled') return;
  phase = 'end';
  const fatal = code in ERR && code !== 'rate_limited';
  show(`
    <span class="eyebrow">잠깐만</span>
    <h2 class="q">${esc(ERR[code] || '할미가 깜빡 졸았네. 다시 해 봐.')}</h2>
    <div class="row">
      ${fatal ? '' : '<button class="primary big" id="retry">다시 시도</button>'}
      <button class="big" id="basic">기본 모드로</button>
    </div>
    <button class="link" id="home">처음으로</button>
    <p class="note">오류 코드: ${esc(code || 'unknown')}${status ? ' ' + esc(status) : ''}${detail ? ' · ' + esc(detail) : ''}</p>`);
  if($('retry')) $('retry').onclick = cNext;
  $('basic').onclick = () => { setMode('basic'); intro(); };
  $('home').onclick = intro;
}

function cAsk(text){
  phase = 'play'; cQ = text; const qn = cQn(); ridge(qn);
  show(`
    <span class="eyebrow">${ORD[qn] || (qn+1)} 번째 고개 · 시골 할머니</span>
    ${granny(cQuip)}
    <h2 class="q">${esc(text)}</h2>
    <div class="row">
      <button class="primary big" data-c="예">예</button>
      <button class="big" data-c="아니요">아니요</button>
    </div>
    <div class="row3">
      <button class="soft" data-c="아마도">아마도요</button>
      <button class="soft" data-c="모르겠어요">모르겠어요</button>
      <button class="soft" data-c="아마 아니요">아마 아니요</button>
    </div>
    <div class="foot">
      <button class="link" id="undo" ${qn ? '' : 'disabled'}>이전 질문으로</button>
    </div>`);
  card.querySelectorAll('[data-c]').forEach(b => b.onclick = () => cAnswer(b.dataset.c));
  $('undo').onclick = cUndo;
}
function cAnswer(a){ if(phase !== 'play' || !cQ) return; cHist.push({t:'q', text:cQ, a}); cQ = null; cNext(); }
function cUndo(){
  for(let i = cHist.length - 1; i >= 0; i--){
    if(cHist[i].t === 'q'){ const last = cHist[i]; cHist = cHist.slice(0, i); cQuip = '다시 물어볼 텡께 똑바로 답혀~'; return cAsk(last.text); }
  }
}

function cGuess(name){
  if(!name) return cLose();
  phase = 'guess'; cGuessName = name; ridge(cQn());
  const again = cHist.some(h => h.t === 'g');
  show(`
    <span class="eyebrow">${cQn()}개의 고개를 넘었어 · 시골 할머니</span>
    ${granny(cQuip || (again ? '이번엔 진짜여' : '할미가 딱 보니께…'))}
    <h2 class="q">${again ? '그럼 이거지?' : '네가 생각한 거, 이거지?'}</h2>
    <p class="answer">${esc(name)}</p>
    <div class="row">
      <button class="gold big" id="yes">맞아요!</button>
      <button class="big" id="no">아니에요</button>
    </div>`);
  $('yes').onclick = cWin;
  $('no').onclick = () => {
    cHist.push({t:'g', name});
    cQuip = pick(GRANNY.wrong);
    if(cQn() >= CLAUDE_LIMIT && ++cEndWrong >= CLAUDE_EXTRA_GUESSES) return cLose();
    cNext();
  };
}

function cReport(won, name){
  track('game_end', {result: won ? 'win' : 'lose', questions: cQn()});
  if(sampleFn || !SITE.workerUrl || !cGame) return;
  fetch(SITE.workerUrl + '/api/result', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({gameId:cGame, theme, won, name, questions:cQn()})}).catch(() => {});
}

function cWin(){
  phase = 'end'; ridge(cQn());
  cReport(true, cGuessName);
  const n = cQn(), wrong = cHist.filter(h => h.t === 'g').length;
  const line = n <= 10 && !wrong ? pick(GRANNY.winFast) : n >= 18 || wrong >= 2 ? pick(GRANNY.winLate) : pick(GRANNY.win);
  show(`
    <span class="eyebrow">할머니가 맞혔어요</span>
    <p class="answer">${esc(cGuessName)}</p>
    ${granny(line)}
    <p class="lead">${n ? ORD[Math.max(0, n-1)] + ' 번째 고개에서 맞혔어요.' : '질문 없이 바로 맞혔어요.'} ${wrong ? `(${wrong}번 틀린 뒤에)` : ''}</p>
    <button class="primary big" id="again">한 판 더 붙기</button>`);
  $('again').onclick = intro;
}

function cLose(){
  phase = 'end'; ridge(cQn());
  const wrong = cHist.filter(h => h.t === 'g').map(h => h.name);
  show(`
    <span class="eyebrow">할머니를 이겼어요 🏆</span>
    ${granny(pick(GRANNY.lose))}
    <h2 class="q">${theme === 'celeb' ? '대체 누구였어?' : '대체 뭐였어?'}</h2>
    ${wrong.length ? `<p class="note">할머니의 헛다리: ${wrong.map(esc).join(', ')}</p>` : ''}
    <form id="teach">
      <label class="note" for="answer">정답을 알려 주면 할머니가 다음엔 안 져요</label>
      <input type="text" id="answer" maxlength="20" placeholder="${esc(THEMES[theme].eg)}" autocomplete="off">
      <button class="primary big" type="submit">알려 주기</button>
    </form>
    <button class="link" id="skip">안 알려 줌 (다시 하기)</button>`);
  $('skip').onclick = () => { cReport(false, ''); intro(); };
  $('teach').onsubmit = e => {
    e.preventDefault();
    const name = $('answer').value.trim().slice(0, 20);
    if(!name){ $('answer').focus(); return; }
    cReport(false, name);
    show(`
      <span class="eyebrow">정답 공개</span>
      <p class="answer">${esc(name)}</p>
      ${granny(`${name}? 아따, 그건 반칙이제~ 다음엔 안 속는다잉`)}
      <button class="primary big" id="again">복수전 하기</button>`);
    $('again').onclick = intro;
  };
}

intro();
