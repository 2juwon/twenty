// Claude 추리 모드 프롬프트 — 브라우저(claude.ai 안에서)와 중계 서버(worker)가 같이 쓴다
export const ANSWERS = ['예', '아니요', '아마도', '아마 아니요', '모르겠어요'];
export const CLAUDE_LIMIT = 20, CLAUDE_EXTRA_GUESSES = 3, CLAUDE_MAX_HISTORY = 40;

const TOPIC = {
  all: '무엇이든 (동물, 음식, 물건, 탈것, 장소, 직업, 캐릭터, 자연, 인물 등)',
  celeb: '인물 (실존하는 유명인, 역사 속 인물, 또는 만화·영화·게임 캐릭터)',
};

// history: [{t:'q', text, a}] 질문과 답, [{t:'g', name}] 틀린 추측
export function cleanHistory(raw){
  if(!Array.isArray(raw)) return null;
  const out = [];
  for(const h of raw.slice(0, CLAUDE_MAX_HISTORY)){
    if(h && h.t === 'q' && typeof h.text === 'string' && ANSWERS.includes(h.a))
      out.push({t: 'q', text: h.text.slice(0, 80), a: h.a});
    else if(h && h.t === 'g' && typeof h.name === 'string')
      out.push({t: 'g', name: h.name.slice(0, 30)});
    else return null;
  }
  return out;
}

export function buildPrompt(theme, history, strict){
  const qs = history.filter(h => h.t === 'q');
  const wrong = history.filter(h => h.t === 'g').map(h => h.name);
  const n = qs.length, mustGuess = n >= CLAUDE_LIMIT;
  const lines = qs.map((h, i) => `${i + 1}. ${h.text} → ${h.a}`).join('\n') || '(아직 없음)';
  return `너는 스무고개 게임에서 상대가 떠올린 것을 맞히는 "시골 할머니"야.
캐릭터: 전라도·충청도 섞인 구수한 시골 사투리를 쓰는 할머니. 스무고개를 평생 져 본 적 없다고 꺼드럭거리고 허세가 심해. 상대를 우리 강아지, 얘야 하고 불러.
맞힐 것 같으면 잘난 척하고, 추측이 틀리면 핑계를 대고(예: 안경을 안 써서 그려), 답이 앞뒤가 안 맞으면 따져(예: 아까는 동물이라며?). 장난스럽게 놀리되 상대를 진짜로 깎아내리거나 욕하지는 마.

주제: ${TOPIC[theme] || TOPIC.all}

지금까지 한 질문과 상대의 답:
${lines}

틀린 추측: ${wrong.length ? wrong.join(', ') : '(없음)'}
질문 ${n}개 사용 / 최대 ${CLAUDE_LIMIT}개

규칙:
- 예/아니요로 답할 수 있는 질문을 하나만 해. 할머니 말투여도 되지만 뜻은 누구나 바로 알 수 있게 분명하게 (예: 그거 살아 있는 겨?). 이미 한 질문과 같은 뜻의 질문은 하지 마.
- 남은 후보를 절반쯤 나누는 질문이 좋아. 초반엔 넓게, 후반엔 구체적으로.
- '아마도', '아마 아니요', '모르겠어요'는 약한 정보야. 상대가 한두 번 잘못 답했을 수도 있다고 생각해.
- 인물이라면 건강, 종교, 성적 지향, 정치 성향, 범죄, 사생활은 묻지 마.
- 70% 이상 확신이 들면 추측해. 틀린 추측은 다시 하지 마.
${mustGuess ? '- 질문을 다 썼으니 지금은 반드시 가장 가능성 높은 답을 추측해.\n' : ''}${n === 0 ? '- 첫 질문이니 quip에서 이 할미는 몇 고개면 끝난다고 허세 섞인 선언을 해.\n' : ''}- quip은 지금 상황에 맞는 할머니의 한마디 (40자 이내). 직전 답에 반응하거나 허세를 부려.
- question, name, quip 값 안에는 큰따옴표(")를 절대 쓰지 마.

다른 말 없이 JSON 하나만 출력해. 예시:
{"type":"ask","question":"그거 먹는 거여?","quip":"이 할미 눈엔 벌써 반은 보여~"}
{"type":"guess","name":"고양이","confidence":0.8,"quip":"이거 아니면 할미가 손에 장을 지진다잉"}${strict ? '\n\n주의: 반드시 위 형식의 JSON 객체 하나만, 코드 블록이나 설명 없이 출력해.' : ''}`;
}

// 모델 답에서 JSON을 꺼내 검사한다
export function parseReply(text){
  if(typeof text !== 'string') return null;
  const cands = [];
  for(let i = 0; i < text.length; i++){
    if(text[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for(let j = i; j < text.length; j++){
      const c = text[j];
      if(inStr){ if(esc) esc = false; else if(c === '\\') esc = true; else if(c === '"') inStr = false; continue; }
      if(c === '"') inStr = true;
      else if(c === '{') depth++;
      else if(c === '}' && --depth === 0){ cands.push(text.slice(i, j + 1)); break; }
    }
  }
  for(const c of cands.reverse()){
    try{ const r = checkReply(JSON.parse(c)); if(r) return r; }catch(e){}
  }
  return looseParse(text);
}
// 따옴표가 섞여 JSON이 깨진 경우를 위한 예비 파서
function looseParse(text){
  const field = k => {
    const m = text.match(new RegExp('"' + k + '"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"(?:type|question|name|quip|confidence)"|\\})'));
    return m ? m[1].replace(/\\"/g, '"') : '';
  };
  const type = (text.match(/"type"\s*:\s*"(ask|guess)"/) || [])[1];
  if(!type) return null;
  const conf = Number((text.match(/"confidence"\s*:\s*([0-9.]+)/) || [])[1]) || 0;
  return checkReply({type, question: field('question'), name: field('name'), quip: field('quip'), confidence: conf});
}
export function checkReply(o){
  if(!o || typeof o !== 'object') return null;
  const quip = typeof o.quip === 'string' ? o.quip.trim().slice(0, 60) : '';
  if(o.type === 'ask' && typeof o.question === 'string' && o.question.trim())
    return {type: 'ask', question: o.question.trim().slice(0, 80), quip};
  if(o.type === 'guess' && typeof o.name === 'string' && o.name.trim())
    return {type: 'guess', name: o.name.trim().slice(0, 30), confidence: Number(o.confidence) || 0, quip};
  return null;
}
