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

export function buildPrompt(theme, history){
  const qs = history.filter(h => h.t === 'q');
  const wrong = history.filter(h => h.t === 'g').map(h => h.name);
  const n = qs.length, mustGuess = n >= CLAUDE_LIMIT;
  const lines = qs.map((h, i) => `${i + 1}. ${h.text} → ${h.a}`).join('\n') || '(아직 없음)';
  return `너는 스무고개 게임에서 상대가 떠올린 것을 맞히는 역할이야.
주제: ${TOPIC[theme] || TOPIC.all}

지금까지 한 질문과 상대의 답:
${lines}

틀린 추측: ${wrong.length ? wrong.join(', ') : '(없음)'}
질문 ${n}개 사용 / 최대 ${CLAUDE_LIMIT}개

규칙:
- 예/아니요로 답할 수 있는 짧고 쉬운 한국어 질문을 하나만 해. 이미 한 질문과 같은 뜻의 질문은 하지 마.
- 남은 후보를 절반쯤 나누는 질문이 좋아. 초반엔 넓게, 후반엔 구체적으로.
- '아마도', '아마 아니요', '모르겠어요'는 약한 정보야. 상대가 한두 번 잘못 답했을 수도 있다고 생각해.
- 인물이라면 건강, 종교, 성적 지향, 정치 성향, 범죄, 사생활은 묻지 마.
- 70% 이상 확신이 들면 추측해. 틀린 추측은 다시 하지 마.
${mustGuess ? '- 질문을 다 썼으니 지금은 반드시 가장 가능성 높은 답을 추측해.\n' : ''}
JSON 하나만 출력해:
{"type":"ask","question":"질문"} 또는 {"type":"guess","name":"정식 이름","confidence":0.0~1.0}`;
}

// 모델 답에서 JSON을 꺼내 검사한다
export function parseReply(text){
  if(typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/); if(!m) return null;
  let o; try{ o = JSON.parse(m[0]); }catch(e){ return null; }
  return checkReply(o);
}
export function checkReply(o){
  if(!o || typeof o !== 'object') return null;
  if(o.type === 'ask' && typeof o.question === 'string' && o.question.trim())
    return {type: 'ask', question: o.question.trim().slice(0, 80)};
  if(o.type === 'guess' && typeof o.name === 'string' && o.name.trim())
    return {type: 'guess', name: o.name.trim().slice(0, 30), confidence: Number(o.confidence) || 0};
  return null;
}
