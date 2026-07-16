# 프로젝트: finsight

## 기술 스택
- Next.js 15 (App Router)
- TypeScript strict mode
- Tailwind CSS
- Supabase (Postgres DB + Auth, Google OAuth)
- Vercel AI SDK (Claude API 기본 프로바이더)
- Vercel 배포

## 아키텍처 규칙
- CRITICAL: 외부 API 호출(Claude, Supabase, 추후 Polar)은 `src/services/`를 통해서만 수행한다. 컴포넌트나 라우트 핸들러에서 직접 호출하지 않는다.
- CRITICAL: CSV의 카드/계좌번호 등 PII는 `src/services/pii-masking/`을 거쳐 마스킹한 뒤에만 LLM에 전달한다. 원본 값을 프롬프트에 절대 포함하지 않는다.
- CRITICAL: 원본 CSV 파일은 어떤 형태로도(Storage, 디스크, 로그 등) 영구 저장하지 않는다. 업로드된 파일은 요청 처리 중 메모리에서만 다루고 응답 후 폐기한다.
- CRITICAL: `SUPABASE_SERVICE_ROLE_KEY`는 API Route(서버 전용 코드)에서만 사용한다. 클라이언트 컴포넌트로 절대 전달하지 않으며 `NEXT_PUBLIC_` 접두어를 붙이지 않는다. DB 쓰기(INSERT/UPDATE)는 이 service-role 클라이언트를 통해서만 수행하고, 코드에서 소유권(user_id)을 직접 검증한다.
- 컴포넌트는 `src/components/`, 타입은 `src/types/`, Supabase 클라이언트 래퍼는 `src/lib/supabase/`에 분리한다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트
