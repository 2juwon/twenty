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

const LABEL = {'예': '예 (맞다)', '아니요': '아니요 (아니다)', '아마도': '아마도 (맞는 편)', '아마 아니요': '아마 아니요 (아닌 편)', '모르겠어요': '모르겠어요 (정보 없음)'};

export function buildPrompt(theme, history, strict){
  const qs = history.filter(h => h.t === 'q');
  const wrong = history.filter(h => h.t === 'g').map(h => h.name);
  const n = qs.length, mustGuess = n >= CLAUDE_LIMIT;
  const lines = qs.map((h, i) => `${i + 1}. ${h.text} → ${LABEL[h.a] || h.a}`).join('\n') || '(아직 없음)';
  return `너는 스무고개 명수야. 상대가 떠올린 것을 예/아니요 질문으로 최대한 빨리 맞혀야 해.
주제: ${TOPIC[theme] || TOPIC.all}

[지금까지의 질문과 상대의 답] (답은 그 질문 문장에 대한 대답이야)
${lines}

[이미 틀린 추측] ${wrong.length ? wrong.join(', ') : '없음'}
[질문 수] ${n}개 사용 / 최대 ${CLAUDE_LIMIT}개

생각하는 순서 (JSON 안에 적어):
1. facts: 위 답들에서 확실히 알게 된 사실을 짧게 정리해. 예를 들어 "동물인가요? → 아니요"면 "동물이 아님". 질문이 부정문이었으면 뜻을 뒤집지 않게 특히 조심해.
2. candidates: facts와 모두 맞는 후보를 가능성 높은 순으로 3~6개. 틀린 추측은 빼.
3. 다음 행동:
   - 1순위 후보가 70% 이상 확실하거나, 후보가 사실상 하나뿐이면 guess.
   - 아니면 남은 후보들을 반반 나누는 질문을 해. 초반엔 큰 분류(살아 있는지, 사람이 만든 건지, 먹는 건지 등), 후반엔 후보끼리 구별되는 특징.
${mustGuess ? '   - 질문을 다 썼으니 지금은 반드시 guess.\n' : ''}
질문 규칙:
- 표준어 존댓말로, 누구나 헷갈리지 않는 긍정문 한 문장 (예: 그것은 먹을 수 있나요?). ~아닌가요? 같은 부정문과 A나 B인가요? 같은 두 가지를 묻는 질문은 금지.
- 이미 한 질문과 뜻이 같은 질문은 하지 마.
- '아마도', '모르겠어요' 같은 답은 약하게 믿고, 상대가 한 번쯤 실수했을 수도 있다고 생각해. 단, '예'/'아니요'는 믿어.
- 인물이라면 건강, 종교, 성적 지향, 정치 성향, 범죄, 사생활은 묻지 마.

quip: 너는 꺼드럭거리는 시골 할머니 캐릭터이기도 해. quip에만 사투리로 한마디(40자 이내) 해. 직전 답에 반응하거나 허세를 부려. 틀린 추측 직후면 핑계를 대. 상대를 진짜로 깎아내리지는 마.${n === 0 ? ' 첫 질문이니 이 할미는 몇 고개면 끝난다고 허세 섞인 선언을 해.' : ''}

다른 말 없이 JSON 하나만 출력해. 값 안에는 큰따옴표를 쓰지 마. 형식:
{"facts":"동물이 아님, 먹을 수 있음","candidates":["사과","바나나","김치"],"type":"ask","question":"그것은 과일인가요?","quip":"요거 거의 다 왔어야~"}
{"facts":"...","candidates":["고양이","강아지"],"type":"guess","name":"고양이","confidence":0.8,"quip":"이거 아니면 할미가 손에 장을 지진다잉"}${strict ? '\n\n주의: 반드시 위 형식의 JSON 객체 하나만, 코드 블록이나 설명 없이 출력해.' : ''}`;
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
