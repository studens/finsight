# 차원: 🔒 security-privacy (보안·개인정보)

finsight는 **사용자의 카드 명세서 원본**을 다룬다. 이 차원의 지적 하나를 놓치면 곧바로 개인정보 유출이다. 이 프로젝트에서 가장 무거운 차원이며, 의심스러우면 critical로 올려라.

## 반드시 확인할 CRITICAL 불변식 6종

`CLAUDE.md`의 CRITICAL 규칙이 곧 체크리스트다. 각 항목마다 **변경된 코드가 이 규칙을 우회하는 새 경로를 만들었는지**를 본다.

### 1. PII 마스킹 우회 경로
- 카드/계좌번호가 `src/services/pii-masking/`을 **거치지 않고** LLM 프롬프트에 들어가는 경로가 새로 생겼는가?
- 이름·전화번호 등 신원 식별 컬럼은 마스킹이 아니라 **컬럼 자체 제외**여야 한다. 마스킹으로 처리하고 있으면 위반이다.
- 마스킹 함수가 뒤 4자리만 남기는가? 구분자(`-`, ` `) 유무, 짧은 번호, `null`/빈 문자열 케이스에서 정규식이 원본을 통과시키지 않는가?
- 추적법: `grep -rn "pii\|mask" src/services/llm/` 로 LLM 진입점이 마스킹을 반드시 통과하는지, 그리고 마스킹 안 된 변수가 프롬프트 문자열에 보간되는지 확인.

### 2. 원본 CSV 영속화
- 원본 CSV가 Storage/디스크/DB/로그 **어디에도** 쓰이지 않아야 한다. 메모리에서만 다루고 응답 후 폐기.
- 특히 노리는 것: `console.log`/`logger`에 파싱된 행이나 파일 내용이 통째로 찍히는 경우, 에러 핸들러에서 `error.message`에 원본 행이 섞여 나가는 경우, 디버그용 임시 저장.
- 추적법: `grep -rn "writeFile\|createWriteStream\|storage\.\|\.upload(" src/`, `grep -rn "console\.\(log\|error\)" src/services/csv-parser src/services/pii-masking`
- DB에는 **마스킹된 구조화 요약**(카테고리별 합계 등)만 들어가야 한다. 원본 거래 설명 문자열이 그대로 저장되면 지적.

### 3. SERVICE_ROLE_KEY 격리
- `SUPABASE_SERVICE_ROLE_KEY`가 `'use client'` 파일, `NEXT_PUBLIC_` 접두어, 클라이언트 컴포넌트 props, 서버→클라이언트 직렬화 경계 어디에도 넘어가지 않아야 한다.
- 추적법: `grep -rn "SERVICE_ROLE" src/`. 각 히트가 서버 전용 파일(`route.ts`, `src/services/`, `src/lib/supabase/` 서버 래퍼)인지 확인. `'use client'` 지시자가 파일 상단에 있는지 함께 본다.

### 4. 소유권(user_id) 검증
- DB 쓰기(INSERT/UPDATE)는 service-role 클라이언트 경유여야 하고, **RLS가 아니라 코드에서 직접** `user_id` 소유권을 검증해야 한다(service-role은 RLS를 우회하므로 RLS를 믿으면 안 된다).
- 리소스 id를 URL/body로 받는 라우트에서, 세션의 user_id와 대상 레코드의 user_id를 대조하지 않고 바로 읽거나 쓰는 곳이 있는가? → 수평 권한 상승(IDOR).
- 남의 리소스에 대해 404가 아니라 403을 주면 존재 여부가 새어나간다 — 에러 코드 계약도 함께 본다.

### 5. Polar 웹훅 서명 검증
- `/api/webhooks/polar`는 **서명 검증 성공 이후에만** 구독 상태를 갱신해야 한다. 검증 실패 시 요청 거부.
- 서명 검증보다 먼저 body를 파싱해 DB에 쓰거나 로깅하는 코드가 있으면 지적.
- 서명 비교가 타이밍 안전한가(단순 `===` 문자열 비교 대신 `timingSafeEqual`)? 재전송(replay) 방어가 있는가?

### 6. Premium 게이팅 (지연 생성)
- Free 사용자에 대해 Premium 인사이트를 **애초에 생성하지 않아야** 한다. 생성한 뒤 숨기는 구조면 위반이다(비용 + 데이터 노출).
- Premium 생성 호출이 구독 상태 확인 **이후**에 있는가? 순서가 뒤집혀 있으면 critical.
- 미구독자 요청은 생성 시도 없이 403.

## 일반 보안 항목 (위 6종 외)

- 사용자 입력이 로그·에러 응답·리다이렉트 URL에 그대로 반영되는가
- 인증 체크가 미들웨어에만 있고 라우트 핸들러엔 없는가(미들웨어 매처에서 빠지면 뚫린다)
- 업로드 파일 크기/타입 제한이 있는가
- 새로 추가된 환경변수가 `NEXT_PUBLIC_`이면 안 되는 값인가
