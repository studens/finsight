# 아키텍처

## 디렉토리 구조
```
src/
├── app/
│   ├── (marketing)/          # 랜딩 페이지 ("/")
│   ├── login/                # Google OAuth 진입
│   ├── (app)/dashboard/      # 로그인 필요 대시보드 (업로드 + Free/Premium 섹션)
│   └── api/
│       ├── upload/                              # POST — CSV 파싱 + PII 마스킹 + 컬럼 매핑 추론
│       ├── analyze/                             # POST — 매핑 확인 후 Free 요약 생성/저장 (동기)
│       ├── reports/[analysisId]/[reportType]/    # GET — Premium 리포트 지연 생성/조회
│       └── webhooks/polar/                       # 구독 웹훅 (polar-billing phase에서 구현)
├── components/        # UI 컴포넌트
├── types/             # TypeScript 타입 정의
├── middleware.ts       # 세션 체크: 비로그인 시 /dashboard → /login, 로그인 시 랜딩 → /dashboard
├── lib/
│   └── supabase/
│       ├── client.ts   # 브라우저용 (RLS 적용, 읽기 전용 사용)
│       ├── server.ts   # 서버 컴포넌트/라우트용 (세션 기반, RLS 적용, 읽기)
│       └── service.ts  # service-role 원시 클라이언트 (services/supabase-admin 내부에서만 사용, 클라이언트 컴포넌트에서 import 금지)
└── services/
    ├── llm/            # Vercel AI SDK 프로바이더 추상화 — 컬럼 매핑 추론 + 인사이트 분석, Claude 기본값
    ├── csv-parser/      # 인코딩 감지 + 파싱 (인메모리)
    ├── pii-masking/      # 카드/계좌번호 마스킹, PII 컬럼 제외 (LLM 호출 직전 전용 경계)
    ├── supabase-admin/   # lib/supabase/service.ts로 DB 쓰기 + user_id 소유권 검증
    └── polar/            # 체크아웃 세션 생성, 웹훅 서명 검증 (polar-billing phase에서 구현)
```

## 패턴
- Server Components 기본. CSV 드롭존, 컬럼 매핑 확인 폼, 페이월 CTA처럼 인터랙션이 필요한 곳만 Client Component.
- **읽기/쓰기 경계 분리**: 읽기는 `lib/supabase/server.ts`(사용자 세션 기반, RLS 적용)로 수행해 RLS가 실제 방어선으로 동작하게 한다. 모든 쓰기(INSERT/UPDATE)는 `services/supabase-admin`을 통해 `lib/supabase/service.ts`(service-role)로만 수행하고, 그 코드에서 `user_id` 소유권을 직접 검증한다. 브라우저에서 Supabase 클라이언트로 직접 테이블에 쓰는 경로는 없다(모든 테이블이 `authenticated` 롤에 SELECT 정책만 가짐).
- 인증/구독 상태에 따른 라우팅 분기는 미들웨어에서 처리한다.
- CSV 처리는 완전 동기·인메모리 — 별도 백그라운드 잡 큐 없음. 원본 파일은 요청 처리 중에만 존재하고 응답 후 폐기된다.
- **Premium 인사이트는 지연 생성(lazy-generate)**: Free 사용자에 대해서는 애초에 계산하지 않는다. 업로드 시엔 Free 요약만 생성하고, Premium 리포트는 구독자가 해당 탭을 처음 열 때 서버가 그 시점에 생성해 캐시한다. 미구독 사용자의 요청은 생성 시도 없이 403으로 거부한다.
- **페이월 이중 강제**: 서버(구독 상태 체크)와 DB(Supabase RLS SELECT 정책) 둘 다로 강제한다. 클라이언트 UI 숨김은 참고용일 뿐 실제 방어선이 아니다.

## 데이터 흐름

### 1) CSV 업로드 → 컬럼 매핑 추론
```
사용자가 대시보드에서 CSV 업로드 (Client Component) → POST /api/upload
  → csv-parser: 파일을 메모리에서만 파싱 (헤더 + 샘플 행)
  → pii-masking: 카드/계좌번호 마스킹, 이름/전화번호 컬럼 제외
  → llm 서비스(Claude): 마스킹된 샘플로 컬럼 매핑 추론 (date/merchant/amount/category) + confidence
  → 매핑 결과를 클라이언트에 반환. 원본 CSV는 이 요청 처리 중에만 서버 메모리에 존재하고 응답 후 폐기 (영구 저장 금지). 클라이언트는 사용자가 매핑을 확인할 때까지 원본 File을 브라우저 메모리에 들고 있다가, 확인 시 2단계에서 다시 전송한다.
```

### 2) 매핑 확인 → Free 요약 생성
```
사용자가 매핑 확인/수정 (Client Component) → POST /api/analyze (원본 CSV 파일 재전송 + 확정된 매핑)
  → csv-parser + pii-masking: 서버가 마스킹을 처음부터 다시 수행 (아래 이유 참조)
  → llm 서비스(Claude): Free 요약만 실행 (카테고리별 합계, 총 지출/거래 건수, 가맹점 Top 5)
  → services/supabase-admin: 마스킹된 거래 데이터 + Free 요약을 analyses 테이블에 저장
  → 원본 CSV/샘플 폐기
  → 응답: Free 요약 반환 → 대시보드 UI 업데이트. Premium 섹션은 이 시점엔 데이터 없이 잠금 카드로만 렌더링.
```

**왜 마스킹된 데이터가 아니라 원본 파일을 다시 보내는가**: "마스킹 완료"는 코드상 타입(브랜디드 타입)으로만 보장되는데, 이 표식은 클라이언트→서버 네트워크 왕복을 거치면 사라진다. 클라이언트가 보낸 JSON을 서버가 "이미 마스킹됨"으로 그냥 신뢰하면, 조작된 요청이 마스킹되지 않은 원본 값을 마스킹된 것처럼 위장해 보낼 수 있다. 또한 Vercel 서버리스 환경에서는 `/api/upload`와 `/api/analyze` 두 요청이 같은 인스턴스에서 처리된다는 보장이 없어 서버 쪽 인메모리 캐시로 원본을 들고 있을 수도 없다. 따라서 확정된 매핑과 함께 원본 파일을 다시 보내 서버가 매 요청마다 마스킹을 직접 수행하는 쪽이 더 단순하고 안전하다. 원본은 이번에도 요청 처리 중에만 메모리에 존재하고 응답 후 폐기되므로, "원본 미영구저장" CRITICAL 규칙은 그대로 유지된다.

### 3) Premium 리포트 조회 (지연 생성)
```
사용자가 Premium 탭(전월 대비/이상거래/절약 제안/예산 추천) 클릭
  → GET /api/reports/:analysisId/:reportType
  → analyses.user_id 소유권 확인 (불일치 시 404)
  → 사용자-스코프 클라이언트(RLS)로 구독 상태 조회 → 미구독이면 생성 시도 없이 403(PAYWALL_REQUIRED)
  → 이미 생성된 리포트가 있으면 캐시된 값 바로 반환
  → 캐시가 없으면: llm 서비스(Claude)로 리포트 생성
    ("전월 대비"는 같은 사용자의 직전 analyses 레코드와 비교해 계산)
  → services/supabase-admin: 생성 결과를 upsert
  → 응답 반환 → 대시보드 UI 업데이트 (짧은 로딩 상태 이후)
```

### 4) 구독 결제 (`polar-billing` phase에서 구현 — 이번 phase는 스키마만)
```
대시보드 "Upgrade" 클릭 → services/polar: 체크아웃 세션 생성 → Polar Hosted Checkout 리다이렉트
→ 결제 완료 → Polar 웹훅(/api/webhooks/polar) → services/polar: 서명 검증
→ services/supabase-admin: subscriptions 테이블 갱신 → 다음 요청부터 Premium 게이팅 해제
```
이번 phase에는 `subscriptions` 테이블 스키마만 존재하고 위 흐름의 실제 구현(체크아웃 세션 생성, 웹훅 처리)은 없다. 개발 중 Premium 흐름을 확인하려면 `subscriptions` 레코드를 수동으로 만들어 테스트한다.

### 5) 에러 표시
API는 `403 PAYWALL_REQUIRED` / `404 NOT_FOUND` / `502 GENERATION_FAILED` 같은 정확한 상태 코드+code를 반환하지만, 프론트엔드는 이를 그대로 노출하지 않는다. 세 케이스 모두 같은 모달 컴포넌트로 부드러운 문구를 띄우고, 페이지 이동 없이 현재 화면에 머문다 (문구/스타일은 `ui-design` 스킬 참고).

## 상태 관리
- 서버 상태(업로드 목록, 리포트, 구독 상태, 분석 이력)는 Server Components에서 `lib/supabase/server.ts`로 직접 조회 — 별도 상태 관리 라이브러리 없음.
- 클라이언트 상태(업로드 진행률, 컬럼 매핑 폼 입력값, 에러/재시도)는 `useState`로 컴포넌트 로컬에서 관리한다.
- 폴링·Realtime 구독 없음 — 모든 처리가 요청/응답 안에서 끝나는 동기 모델이라 불필요.
