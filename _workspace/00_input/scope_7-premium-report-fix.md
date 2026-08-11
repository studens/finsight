# 실행 범위: 7-premium-report-fix

## 배경

Premium 리포트가 간헐적으로 유실된다. 실제 DB 증거: `27aaa9b7` 4/4 캐시, `cb0eefa6` 2/4(`anomaly_detection`·`budget_recommendation` 유실), `deffb84a` 0/4.

원인은 `src/services/supabase-admin/index.ts`의 `upsertPremiumReport`가 `premium_reports`를 **읽어서 spread한 뒤 통째로 UPDATE**하기 때문이다. jsonb 병합도 낙관적 락도 없는데, 읽기와 쓰기 사이에 LLM 생성이 6~21초 걸린다(실측: `mom_comparison` 2.6s / `anomaly_detection` 6.1s / `savings_suggestions` 20.9s / `budget_recommendation` 16.3s).

`src/components/PremiumSection.tsx:186`의 `loading`이 단일 `ReportType | null`이라 **같은 카드 재클릭만** 막는다. 다른 카드를 누르면 두 요청이 나란히 달리고 나중 쓰기가 앞선 결과를 지운다.

원인 특정에 LLM 재호출 10회 + DB 조회 + 지연 측정이 필요했던 이유는 `route.ts`의 `catch {}`가 에러 종류·스택·컨텍스트를 전부 삼키기 때문이다.

## 이번 phase에서 고치는 것

1. `premium_reports` 덮어쓰기 경쟁 → Postgres 원자적 jsonb 병합(`||`) RPC로 교체
2. `route.ts`의 `catch {}` → 에러를 로깅하고 502 계약은 유지
3. `upsertPremiumReport` 호출이 try/catch 밖 → 캐시 쓰기 실패가 생성 결과를 유실시키지 않도록 분리 처리

## 범위 밖 (의도적)

- **`PremiumSection`의 단일 `loading` 상태** — 원자적 병합이 들어가면 동시 요청이 더 이상 서로를 덮어쓰지 않으므로 정합성 목적의 수정은 불필요해진다. 중복 LLM 호출 비용 절감은 별건이므로 후속 과제로 남긴다.
- **웹훅 순서 역전 방어(`last_event_at`)** — 별개 관심사, 별도 phase.

## 관련 CRITICAL 규칙

- DB 쓰기(INSERT/UPDATE)는 service-role 클라이언트로만 수행하고 **코드에서 소유권(user_id)을 직접 검증**한다.
- `analyses`에 INSERT/UPDATE/DELETE RLS 정책을 만들지 않는다(SELECT 전용 유지).
- 원본 CSV/PII는 어떤 형태로도 영구 저장하지 않는다 — **로그 포함**.
- 새 기능은 테스트를 먼저 작성한다(TDD).
