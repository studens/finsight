# Step 2: `merge_premium_report`에 `p_report_type` 화이트리스트를 추가하는 마이그레이션을 작성한다

## 이 step의 범위 제한 — 반드시 먼저 읽어라

**이 step에서는 마이그레이션 파일을 작성하고 로컬 검증만 한다. 원격 Supabase 프로젝트에 적용하지 마라.**

이 세션에는 Supabase MCP도, 원격 DB에 DDL을 적용할 자격증명도 없다. 원격 적용은 이 step이 완료된 뒤 **오케스트레이터가 Supabase MCP로 직접 수행**하고, 적용 후 검증(권한·시그니처·롤백 do-block)도 오케스트레이터가 담당한다. 따라서 원격 적용을 시도하다 실패해 이 step을 `blocked`로 만들지 마라 — 파일 작성과 아래 AC 충족으로 이 step은 완료다. (같은 이유로 `7-premium-report-fix` step 0이 blocked됐던 전례가 있다.)

## 배경

현재 RPC는 `p_report_type text`를 **검증 없이** jsonb 키로 쓴다:

```sql
coalesce(premium_reports, '{}'::jsonb) || jsonb_build_object(p_report_type, p_report)
```

지금은 `src/app/api/reports/[analysisId]/[reportType]/route.ts`의 `isReportType()`이 4개 값만 통과시키는 유일한 방어선이다. 하지만 **쓰기 경로의 마지막 방어선은 DB에 있어야 한다** — 이 프로젝트가 경쟁 상태를 애플리케이션이 아니라 DB에서 막기로 결정한 것과 같은 이유다. 라우트를 우회하는 새 호출부(배치 작업, 관리자 스크립트, 향후 라우트)가 생기면 `premium_reports`에 임의 키가 쌓여 스키마가 오염되고, 프런트엔드의 4개 카드 렌더링 계약이 조용히 깨진다.

## 작업

`supabase/migrations/` 에 **새 마이그레이션 파일**을 추가한다(기존 `20260810173000_create_merge_premium_report.sql`을 수정하지 마라 — 이미 원격에 적용된 마이그레이션은 불변으로 취급한다). 파일명은 기존 규칙에 맞춰 `{YYYYMMDDHHMMSS}_add_report_type_whitelist_to_merge_premium_report.sql` 형식을 쓰고, 타임스탬프는 `20260810173000`보다 뒤여야 한다.

내용은 `create or replace function public.merge_premium_report(...)`로 **같은 시그니처**(`p_analysis_id uuid, p_user_id uuid, p_report_type text, p_report jsonb`, `returns boolean`)를 유지하며 다음을 만족해야 한다:

1. **화이트리스트 검증을 함수 첫 동작으로 둔다.** 허용 값은 정확히 이 4개다:
   `mom_comparison`, `anomaly_detection`, `savings_suggestions`, `budget_recommendation`
   허용 목록에 없으면 **`raise exception`으로 즉시 실패**시킨다. `using errcode = '22023'`(invalid_parameter_value)을 지정한다. 예외 메시지에는 **`p_report_type` 값이나 `p_report` 내용을 넣지 마라** — 에러 메시지는 `PostgrestError.message`로 애플리케이션에 돌아오고, 리포트 본문은 마스킹된 거래 데이터를 담고 있다. 고정 문자열(예: `invalid report type`)만 쓴다.

2. **0행 갱신 시 `null`을 반환하는 기존 계약을 그대로 유지한다.** 호출부 `src/services/supabase-admin/index.ts`가 `data !== true`를 `"Analysis not found"`로 해석하므로, 소유자가 아니거나 없는 id일 때는 예외가 아니라 **null**이어야 한다. `language sql`로는 조건 분기가 어려우므로 `language plpgsql`로 바꾸고, `update ... ; if not found then return null; end if; return true;` 형태로 같은 관측 동작을 만든다.

3. **아래 4가지는 원본에서 하나도 빠뜨리면 안 된다.** 하나라도 누락되면 보안 회귀다.
   - `coalesce(premium_reports, '{}'::jsonb)` — 컬럼 기본값이 null이고 `null || '{...}'::jsonb = null`이라 이게 없으면 **첫 리포트가 유실**된다.
   - `where id = p_analysis_id and user_id = p_user_id` — 소유권을 SQL 술어에 둔다. 소유자가 아니면 0행 갱신.
   - `security invoker` (즉 `security definer`를 쓰지 않는다)
   - `set search_path = ''` — 그리고 이 때문에 테이블은 `public.analyses`로 **스키마 수식**해야 한다.

4. **권한을 다시 명시한다.** 마이그레이션 끝에 원본과 동일한 revoke/grant 4줄을 다시 넣는다:
   ```
   revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from public;
   revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from anon;
   revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from authenticated;
   grant execute on function public.merge_premium_report(uuid, uuid, text, jsonb) to service_role;
   ```
   `create or replace function`은 같은 시그니처일 때 기존 ACL을 보존하지만, **명시적으로 다시 쓰는 편이 안전하다.** 이유: Supabase는 함수를 PostgREST RPC로 자동 노출하고 함수 default ACL이 `anon`/`authenticated`에 EXECUTE를 준다. 이걸 놓치면 브라우저에서 임의 사용자가 남의 리포트를 덮어쓸 수 있다.

5. **`src/types/database.ts`는 이 step에서 수정하지 않는다.** `Args`/`Returns`가 그대로이고, `Returns` nullable 정정은 step 1이 담당한다.

6. **TypeScript 쪽 코드도 이 step에서는 바꾸지 않는다.** 라우트의 `isReportType`은 그대로 남긴다 — DB 화이트리스트는 그것을 대체하는 게 아니라 **뒤에 겹치는 두 번째 방어선**이다.

## Acceptance Criteria

- [ ] `supabase/migrations/`에 새 파일이 추가되고, 파일명 타임스탬프가 `20260810173000`보다 크다. 기존 `20260810173000_create_merge_premium_report.sql`은 **한 글자도 변경되지 않았다**(`git diff`로 확인).
- [ ] 새 마이그레이션의 함수 본문에 4개 허용 값 문자열이 모두 등장하고, 그 외 리포트 타입 이름은 등장하지 않는다.
- [ ] 허용 목록 위반 시 `raise exception ... using errcode = '22023'`이 실행된다. **예외 메시지 문자열 안에 `p_report_type`·`p_report` 변수 보간(`%`, `||`, `format()`)이 없다** — 고정 문자열이다.
- [ ] 함수에 `coalesce(premium_reports, '{}'::jsonb)`, `user_id = p_user_id`, `security invoker`(또는 `security definer` 부재), `set search_path = ''`, `public.analyses` 스키마 수식이 모두 존재한다.
- [ ] 마이그레이션 끝에 `revoke ... from public` / `from anon` / `from authenticated` 3줄과 `grant execute ... to service_role` 1줄이 있다.
- [ ] 함수가 0행 갱신 시 `null`을 반환하는 경로가 코드에 명시적으로 존재한다(`if not found then return null`). 예외를 던지지 않는다.
- [ ] 시그니처가 `merge_premium_report(uuid, uuid, text, jsonb) returns boolean`으로 원본과 동일하다(인자 이름·순서·타입, 반환 타입 전부).
- [ ] SQL 주석은 한국어로 작성돼 있고, 화이트리스트를 DB에 두는 이유(라우트 우회 시 임의 키 오염 방지, 두 번째 방어선)가 파일 안에 설명돼 있다.
- [ ] **원격 Supabase 프로젝트에 적용하지 않았다.** `supabase db push`, `supabase migration up`, MCP 호출 등을 실행하지 않았고, 이 step을 `blocked`로 만들지 않았다.
- [ ] `npm run typecheck` 통과, `npm run test` 전부 통과(이 step은 TS 코드를 바꾸지 않으므로 회귀가 없어야 한다).
