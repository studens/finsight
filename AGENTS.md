# 프로젝트: finsight

## 기술 스택
- Next.js 15 (App Router)
- TypeScript strict mode
- Tailwind CSS
- Supabase (Postgres DB + Auth, Google OAuth 전용)
- Vercel AI SDK (Claude API 기본 프로바이더, 분석 모델은 Opus 4.8)
- Polar (구독 결제 — Hosted Checkout + 웹훅)
- Vercel 배포

## 아키텍처 규칙
- CRITICAL: 외부 API 호출(Claude, Supabase, Polar)은 `src/services/`를 통해서만 수행한다. 컴포넌트나 라우트 핸들러에서 직접 호출하지 않는다.
- CRITICAL: CSV의 카드/계좌번호는 `src/services/pii-masking/`을 거쳐 뒤 4자리만 남기고 마스킹한 뒤에만 LLM에 전달한다. 이름·전화번호 등 신원 식별 컬럼은 마스킹이 아니라 컬럼 자체를 LLM 요청에서 제외한다. 원본 값을 프롬프트에 절대 포함하지 않는다.
- CRITICAL: 원본 CSV 파일은 어떤 형태로도(Storage, 디스크, 로그 등) 영구 저장하지 않는다. 업로드된 파일은 요청 처리 중 메모리에서만 다루고 응답 후 폐기한다. DB에는 마스킹된 요약 데이터(카테고리별 합계 등 구조화된 값)만 저장한다.
- CRITICAL: `SUPABASE_SERVICE_ROLE_KEY`는 API Route(서버 전용 코드)에서만 사용한다. 클라이언트 컴포넌트로 절대 전달하지 않으며 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. DB 쓰기(INSERT/UPDATE)는 이 service-role 클라이언트를 통해서만 수행하고, 코드에서 소유권(user_id)을 직접 검증한다.
- CRITICAL: Polar 웹훅(`/api/webhooks/polar`)은 반드시 서명(signature)을 검증한 뒤에만 구독 상태를 갱신한다. 검증 실패 시 요청을 거부한다. 서명 검증은 Polar SDK의 `validateEvent()`만 사용한다(직접 HMAC 구현 금지 — secret 이중 base64 디코딩 문제를 유발한다). 체크아웃·웹훅 연동은 `6-polar-billing` phase에서 **이미 구현·머지 완료**됐고 샌드박스 end-to-end 검증까지 끝났다. 구독 해제는 `subscription.revoked` 이벤트 하나로만 처리한다(`canceled`는 해지 예약, `past_due`는 dunning 유예이므로 상태를 바꾸지 않고 200으로 무시).
- CRITICAL: Premium 인사이트는 Free 사용자에 대해 애초에 생성하지 않는다. 업로드 시점엔 Free 요약만 계산/저장하고, Premium 리포트는 구독 중인 사용자가 해당 리포트를 처음 조회할 때만 서버가 생성해 캐시한다(lazy-generate). 미구독 사용자의 Premium 리포트 요청은 생성을 시도하지 않고 403으로 거부한다.
- 컴포넌트는 `src/components/`, 타입은 `src/types/`, Supabase 클라이언트 래퍼는 `src/lib/supabase/`에 분리한다.
- 로그인된 사용자가 `/`(랜딩)에 접근하면 미들웨어에서 세션을 확인해 `/dashboard`로 리다이렉트한다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 유닛 테스트(게이팅 로직, PII 마스킹, 웹훅 서명 검증, 컬럼 매핑 등)는 Vitest, E2E(랜딩→로그인→CSV 업로드→결제→대시보드)는 Playwright를 사용한다.
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트 (Vitest)
npm run test:e2e # E2E 테스트 (Playwright)
