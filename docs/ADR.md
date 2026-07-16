# Architecture Decision Records

## 철학
MVP 속도 최우선. 검증 안 된 미래 요구사항을 위해 지금 만들지 않는다. 단, 보안/정합성 결함은 속도보다 우선한다.

---

### ADR-001: Next.js 15 + Supabase 선택
**결정**: Next.js 15(App Router) + TypeScript + Tailwind, Supabase를 DB+Auth로, Vercel에 배포.
**이유**: 프론트/API/DB/Auth를 하나의 스택으로 통일해 MVP 구축 속도를 최대화. Supabase MCP와 Vercel이 이미 연동돼 있어 추가 설정 비용이 낮음.
**트레이드오프**: Supabase/Vercel 생태계에 종속. 대규모 트래픽 시 별도 백엔드 분리가 필요할 수 있음.

### ADR-002: LLM은 Claude 단일 기본값, 프로바이더 추상화만 대비
**결정**: `src/services/llm/`을 Vercel AI SDK로 추상화하되, MVP는 Claude API만 실제로 사용. 사용자에게 모델 선택 UI를 노출하지 않는다.
**이유**: Claude+GPT 동시 사용자 선택 UI는 프론트엔드/테스트 범위를 두 배로 늘리는 요소인데, MVP 검증 단계에서 필수가 아님(가설 H7). 추상화만 해두면 GPT 추가는 나중에 코드 몇 줄로 가능.
**트레이드오프**: 프로바이더 비교/장애 시 자동 폴백 같은 이점을 지금은 얻지 못함.

### ADR-003: Polar 선택, 실제 연동은 후속 phase로 분리
**결정**: 결제 수단은 Polar. 계정/프로덕트가 아직 없으므로 이번 단계는 엔타이틀먼트 체크용 최소 스키마(`subscriptions`)만 두고, checkout/webhook 연동은 `polar-billing` phase로 통째로 미룬다.
**이유**: 아직 값을 채울 수 없는 Polar 전용 컬럼(customer_id, current_period_end 등)이나 webhook 멱등성 테이블을 미리 만들 이유가 없음.
**트레이드오프**: `polar-billing` phase에서 `subscriptions` 마이그레이션(컬럼 추가)과 `polar_webhook_events` 테이블 신규 생성이 필요.

### ADR-004: CSV 처리는 완전 동기·인메모리, 원본 파일 미보관
**결정**: 업로드→파싱→마스킹→LLM분석을 하나의 API 요청 안에서 순차 처리하고, 원본 CSV는 어디에도 저장하지 않는다(마스킹된 거래내역만 영구 저장). 백그라운드 잡 큐(Inngest 등)는 도입하지 않는다.
**이유**: 개인 CSV는 대부분 수천 행 이내라 동기 처리로 충분(가설 H6). 큐/워커/폴링/Realtime 인프라는 이 스케일에서 과설계. 원본을 저장 안 하면 TTL 삭제 잡 같은 프라이버시 인프라도 통째로 불필요해짐.
**트레이드오프**: 대용량 CSV나 트래픽 증가 시 Vercel 함수 타임아웃 위험 — 파일 크기/행수 상한으로 완화하고, 필요해지면 그때 백그라운드 잡을 재도입한다.

### ADR-005: 기능 단위 freemium 게이팅 + RLS 이중 강제, 쓰기는 service-role 전용
**결정**: 카테고리별 지출 요약은 무료·무제한, 이상거래탐지·월별추이는 유료. 페이월은 서버 체크와 Supabase RLS SELECT 정책 둘 다로 강제한다. 모든 테이블은 authenticated 롤에 SELECT 정책만 부여하고, 모든 쓰기(INSERT/UPDATE)는 API Route의 service-role 클라이언트로만 수행하며 코드에서 소유권을 직접 검증한다.
**이유**: 클라이언트 UI 숨김만으로는 API 직접 호출로 페이월을 우회할 수 있음. 브라우저에서 Supabase 클라이언트로 직접 쓰기를 허용하면 "PII 마스킹된 데이터만 저장된다"는 핵심 불변식을 우회해 조작된 데이터를 삽입할 수 있음. 유료 리포트는 업로드 시점이 아니라 최초 조회 시 지연 생성해, "무료로 업로드 후 나중에 구독"과 "이미 구독 중 신규 업로드" 두 경우를 같은 코드 경로로 처리한다.
**트레이드오프**: 쓰기 경로가 항상 API Route를 거쳐야 하므로 Supabase의 클라이언트 직접 쓰기 편의성을 포기함. 지연 생성은 첫 조회 시 짧은 로딩(LLM 호출)을 감수해야 함.
