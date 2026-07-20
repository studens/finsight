# Step 2: advisors 보안 점검 및 TypeScript 타입 생성

## 작업

앞선 두 step에서 만든 `analyses`, `subscriptions` 스키마가 보안상 올바른지 Supabase 어드바이저로 점검하고, 확정된 스키마의 TypeScript 타입을 생성해 다른 phase가 참조할 수 있게 한다.

**대상 Supabase 프로젝트**: `project_id: peewjgbhqpkysitzqjum` (이름: finsight, 리전: ap-northeast-2). 모든 Supabase MCP 도구 호출에 이 project_id를 사용한다.

절차:
1. Supabase MCP `get_advisors`(project_id: `peewjgbhqpkysitzqjum`, type: `security`)를 실행해 보안 경고 목록을 확인한다.
2. `analyses` 또는 `subscriptions`에 대해 "RLS 미적용(rls disabled)" 또는 "정책 없는 RLS(RLS enabled no policy가 의도와 다름)" 같은 경고가 남아 있으면, 원인을 마이그레이션으로 교정한 뒤 다시 `get_advisors`로 재확인한다.
3. Supabase MCP `generate_typescript_types`(project_id: `peewjgbhqpkysitzqjum`)로 DB 타입을 생성해 `src/types/database.ts`(존재하지 않으면 새로 생성)에 저장한다. 다른 planner(core-services, api-routes)가 이 타입을 import한다.

이 step은 새 테이블/컬럼을 추가하지 않는다. 스키마 검증과 타입 산출만 수행한다.

## Acceptance Criteria
- [ ] `get_advisors`(security) 결과에 `analyses`·`subscriptions` 테이블의 RLS 미적용(rls disabled) 경고가 **하나도 없다**. 경고가 있었다면 마이그레이션으로 교정 후 재실행해 사라진 것을 확인했다.
- [ ] `analyses`와 `subscriptions` 두 테이블 모두 SELECT 정책만 존재하고 INSERT/UPDATE/DELETE 정책이 없음을 `get_advisors` 또는 `list_tables`/정책 조회로 재확인했다 — `authenticated` 롤에 쓰기 정책이 열려 있지 않다.
- [ ] `generate_typescript_types`로 생성한 타입이 `src/types/database.ts`에 저장되어 있고, `analyses`와 `subscriptions` 두 테이블 타입을 포함한다.
- [ ] 생성된 타입에서 `analyses` 행 타입이 `masked_transactions`, `free_summary`, `premium_reports`(nullable) 필드를 포함하고, 원본 PII 전용 필드가 없다.
- [ ] 이 step에서 새 테이블이나 컬럼을 추가하지 않았다 (검증과 타입 생성만 수행).
