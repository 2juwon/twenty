# Claude 추리 중계 서버 (Cloudflare Workers)

GitHub Pages의 스무고개가 'Claude 추리' 모드에서 부르는 서버예요.
Anthropic API 키는 이 서버의 비밀값에만 저장되고, 페이지에는 노출되지 않아요.

## 하는 일

- `POST /api/turn`: 지금까지의 질문과 답을 받아 Claude에게 다음 질문이나 추측을 받아 와요.
- `POST /api/result`: 끝난 판의 결과(못 맞힌 정답 포함)를 저장해요.
- `GET /api/stats?token=...`: 오늘 판 수, API 호출 수, 예상 비용, 못 맞힌 정답 목록을 보여 줘요.

## 제한 (저장소 루트 `wrangler.toml`의 `[vars]`에서 바꿀 수 있어요)

| 항목 | 값 |
| --- | --- |
| 하루 전체 판 수 `DAILY_GAMES` | 100 |
| 기기(IP)당 하루 판 수 `DAILY_GAMES_PER_DEVICE` | 10 |
| 판당 API 호출 | 최대 30번 |
| 허용 주소 `ALLOWED_ORIGINS` | https://2juwon.github.io |
| 모델 `MODEL` | claude-haiku-5-5 (없으면 claude-haiku-4-5) |

날짜는 한국 시간 기준으로 바뀌어요. 첫 질문부터 실패한 판은 판 수에서 빠져요.

## 주인 테스트 모드

게임 주소 뒤에 `?dev=<STATS_TOKEN>`을 붙여 한 번 열면, 그 기기에 저장돼서 이후로는 하루 제한에 걸리지 않아요. 그 판들은 통계에서 `testGames`로 따로 집계되고, GA로도 보내지 않아요. 해제하려면 `?dev=off`로 한 번 열면 돼요.

## Cloudflare Git 연동으로 배포 (권장)

Cloudflare 대시보드에서 이 저장소를 연결하면 `main`에 푸시할 때마다 자동으로 배포돼요. 설정 파일 `wrangler.toml`이 **저장소 루트**에 있으니 루트 디렉터리는 비워 두면(`/`) 돼요. 비밀값 `ANTHROPIC_API_KEY`, `STATS_TOKEN`은 Worker의 설정 → 변수 및 비밀에 넣어요.

## 명령어로 배포

1. **Anthropic 콘솔** (console.anthropic.com)
   - API 키를 만들어요.
   - Settings → Limits에서 월 사용 한도를 꼭 걸어 두세요. 예: $10
2. **Cloudflare**
   - 무료 계정을 만들어요.
3. **이 폴더에서 명령어 실행**

   ```bash
   cd worker
   npm install
   npx wrangler login                          # 브라우저에서 Cloudflare 로그인
   npx wrangler secret put ANTHROPIC_API_KEY   # API 키 붙여넣기 (채팅에 올리지 말 것)
   npx wrangler secret put STATS_TOKEN         # 통계 페이지용 아무 비밀번호
   npm run deploy                              # = wrangler deploy --config ../wrangler.toml
   ```

4. 배포가 끝나면 `https://twenty-claude.<계정이름>.workers.dev` 같은 주소가 나와요. 저장소 루트의 `site.json`에 있는 `workerUrl`에 그 주소를 넣고, `python3 build.py`를 실행한 다음 커밋해요.

## 통계 보기

브라우저에서 `https://twenty-claude.<계정이름>.workers.dev/api/stats?token=<STATS_TOKEN>`을 열면 돼요.

`missed`에는 Claude가 못 맞힌 정답이 많이 나온 순서대로 쌓여요. 이 목록을 보고 `src/data_*.txt`에 항목을 추가하면 기본 모드도 같이 좋아져요.

## 로컬 테스트

`.dev.vars` 파일에 아래 값을 넣어요.

```
ANTHROPIC_API_KEY=...
STATS_TOKEN=test
```

그다음 `npx wrangler dev`를 실행해요.
