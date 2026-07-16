# 아키텍처

## 디렉토리 구조
```
src/
├── app/
│   ├── page.tsx                 # 랜딩
│   ├── login/page.tsx           # Google OAuth 버튼만
│   ├── dashboard/page.tsx       # 대시보드 셸 (업로드 + 무료/유료 섹션)
│   ├── middleware.ts            # 비로그인 시 /dashboard → /login
│   └── api/
│       ├── csv-analysis/route.ts        # POST — 업로드+파싱+마스킹+무료 리포트 (동기)
│       ├── reports/[uploadId]/[reportType]/route.ts  # GET — lazy-generate (category_summary/anomaly_detection)
│       └── reports/trend/route.ts       # GET — lazy-generate (사용자 전체 스코프 추이)
├── components/        # UI 컴포넌트
├── types/              # TypeScript 타입 정의
├── lib/
│   └── supabase/
│       ├── client.ts   # 브라우저용 (RLS 적용, 읽기 전용 사용)
│       ├── server.ts   # 서버 컴포넌트/라우트용 (세션 기반, RLS 적용, 읽기)
│       └── service.ts  # service-role (API Route 내부 쓰기 전용, 클라이언트 컴포넌트에서 import 금지)
└── services/
    ├── llm/            # Vercel AI SDK 프로바이더 추상화 (Claude 기본값)
    ├── csv-parser/      # 인코딩 감지 + 파싱 (인메모리)
    ├── pii-masking/      # 카드/계좌번호 등 마스킹 (LLM 호출 직전 전용 경계)
    └── polar/            # polar-billing phase에서 구현
```

## 패턴
- Server Components 기본, 인터랙션이 필요한 곳(업로드 폼, 페이월 CTA)만 Client Component.
- **읽기/쓰기 경계 분리**: 대시보드의 읽기는 `lib/supabase/server.ts`(사용자 세션 기반, RLS 적용)로 수행해 RLS가 실제 방어선으로 동작하게 한다. 모든 쓰기(INSERT/UPDATE)는 API Route 안에서 `lib/supabase/service.ts`(service-role)로만 수행하고, 그 코드에서 `user_id` 소유권을 직접 검증한다. 브라우저에서 Supabase 클라이언트로 직접 테이블에 쓰는 경로는 없다(모든 테이블이 authenticated 롤에 SELECT 정책만 가짐).
- CSV 처리는 완전 동기·인메모리 — 별도 백그라운드 잡 큐 없음. 원본 파일은 요청 처리 중에만 존재하고 응답 후 폐기된다.
- 유료 리포트(이상거래탐지, 월별추이)는 업로드 시점에 미리 만들지 않고, 처음 조회될 때 지연 생성(lazy-generate)한다.

## 데이터 흐름

### 1) CSV 업로드 (무료 리포트까지, 동기 1요청)
```
사용자가 CSV 선택 → Client Component가 POST /api/csv-analysis로 파일 전송
  → csv-parser (인코딩 감지 + 파싱, 인메모리)
  → pii-masking (카드/계좌번호 등 마스킹)
  → llm 서비스(Claude)로 category_summary 분석
  → service-role 클라이언트로 csv_uploads / transactions / analysis_reports(category_summary) 저장
  → 응답으로 결과 반환 → UI 업데이트
```
원본 파일 버퍼는 이 요청이 끝나면 사라진다. Storage에도, 디스크에도 쓰지 않는다.

### 2) 유료 리포트 조회 (지연 생성)
```
사용자가 유료 탭 클릭
  → GET /api/reports/:uploadId/:reportType (anomaly_detection) 또는 GET /api/reports/trend
  → [reports/[uploadId]/...] 라우트는 csv_uploads.user_id 소유권 확인 (불일치 시 404)
  → 사용자-스코프 클라이언트(RLS)로 구독 상태·기존 리포트 조회
  → 미구독이면 403(PAYWALL_REQUIRED)
  → 캐시 없으면: transactions(마스킹된 데이터, upload_id 또는 trend는 user_id 전체 스코프)로 LLM 분석 실행
  → service-role 클라이언트로 analysis_reports/trend_reports에 upsert
  → 응답 반환 → UI 업데이트 (짧은 로딩 상태 이후)
```

### 3) 페이월 강제
서버(구독 상태 체크)와 DB(RLS 엔타이틀먼트 정책) 이중으로 강제한다. 클라이언트 UI 숨김은 참고용일 뿐 실제 방어선이 아니다.

### 4) 에러 표시
API는 `403 PAYWALL_REQUIRED` / `404 NOT_FOUND` / `502 GENERATION_FAILED` 같은 정확한 상태 코드+code를 반환하지만, 프론트엔드는 이를 그대로 노출하지 않는다. 세 케이스 모두 같은 모달 컴포넌트로 부드러운 문구를 띄우고, 페이지 이동 없이 현재 화면에 머문다 (문구/스타일은 `docs/UI_GUIDE.md` 참고).

## 상태 관리
- 서버 상태(업로드 목록, 리포트, 구독 상태)는 Server Components에서 `lib/supabase/server.ts`로 직접 조회 — 별도 클라이언트 상태 관리 라이브러리 없음.
- 업로드 진행 중/에러/재시도 같은 일시적 UI 상태만 클라이언트 컴포넌트의 `useState`로 관리.
- 폴링·Realtime 구독 없음 — 모든 처리가 요청/응답 안에서 끝나는 동기 모델이라 불필요.
