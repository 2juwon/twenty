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
  phase = 'intro'; cur = null; limit = BASE_LIMIT; endWrong = 0; extended = false;
  learned = loadLearned();
  E = Engine(DATA[theme], learned);
  ridge(0);
  const T = THEMES[theme];
  const learnedN = Object.keys(learned.items || {}).length;
  show(`
    <div class="seg" role="group" aria-label="주제">${Object.keys(THEMES).map(t => `<button class="seg-b" data-t="${t}" aria-pressed="${t === theme}">${THEMES[t].label}</button>`).join('')}</div>
    <h2 class="q">${T.prompt}</h2>
    <p class="lead">예, 아니요로 답할 수 있는 질문을 스무 번까지 할게요. 헷갈리면 '아마도'나 '모르겠어요'를 눌러도 괜찮아요.</p>
    <div class="chips">${T.chips.map(c => `<span class="chip">${c}</span>`).join('')}</div>
    <button class="primary big" id="start">생각했어요, 시작!</button>
    <p class="note">아는 ${theme === 'celeb' ? '사람' : '것'} ${E.items.length}${T.unit} · 질문 ${E.KEYS.length}가지${learnedN ? ` · 이 기기에서 배운 것 ${learnedN}${T.unit}` : ''}</p>`);
  card.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { if(b.dataset.t !== theme){ setTheme(b.dataset.t); intro(); } });
  $('start').onclick = next;
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
  if(e.key === 'y' || e.key === 'Y') answer(1);
  if(e.key === 'n' || e.key === 'N') answer(0);
});

intro();
