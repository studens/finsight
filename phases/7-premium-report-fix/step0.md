# Step 0: merge_premium_report RPC — 원자적 jsonb 병합 마이그레이션

## 배경 (왜 필요한가)

현재 `src/services/supabase-admin/index.ts`의 `upsertPremiumReport`는 `analyses.premium_reports`를 **SELECT로 읽어 JS에서 spread한 뒤 객체 전체를 UPDATE**한다. 읽기와 쓰기 사이에 LLM 리포트 생성이 6~21초 걸리므로, 사용자가 Premium 카드 두 개를 연달아 누르면 나중에 끝난 요청이 먼저 끝난 요청의 결과를 **지운다**. 실제로 프로덕션 데이터에서 4개 중 2개, 심하면 4개 전부가 유실된 레코드가 관측됐다.

해결책은 병합을 애플리케이션이 아니라 **Postgres가 한 문장 안에서** 하게 만드는 것이다. `jsonb ||` 연산자를 쓰는 단일 UPDATE는 행 수준 락 안에서 원자적으로 실행되므로 경쟁 자체가 성립하지 않는다.

## 작업

**대상 Supabase 프로젝트**: `project_id: peewjgbhqpkysitzqjum` (이름: finsight, 리전: ap-northeast-2). 모든 Supabase MCP 도구 호출(`list_tables` / `apply_migration` / `execute_sql` / `get_advisors` / `generate_typescript_types`)에 이 project_id를 사용한다.

절차:

1. Supabase MCP `list_tables`(project_id: `peewjgbhqpkysitzqjum`)로 `analyses` 현재 스키마를 먼저 확인한다. `premium_reports`가 `jsonb`(nullable)인지 확인한다.
2. 아래 DDL을 `supabase/migrations/<timestamp>_create_merge_premium_report.sql`에 저장한다(리포지토리 버전 관리 대상). 타임스탬프 형식은 기존 파일(`20260720164500_create_analyses.sql`)과 동일한 `YYYYMMDDHHMMSS`를 쓴다.
3. **같은 SQL**을 Supabase MCP `apply_migration`(project_id: `peewjgbhqpkysitzqjum`, name: `create_merge_premium_report`)으로 원격에 적용한다.
4. `apply_migration` **직후** `execute_sql`로 `notify pgrst, 'reload schema';`를 실행해 PostgREST 스키마 캐시를 즉시 갱신한다. 자동 리로드가 지연되면 step 1의 `supabase.rpc` 호출이 런타임에 `PGRST202 Could not find the function`으로 실패한다.
5. 적용 후 `get_advisors`(type: `security`)를 실행해 이 함수 때문에 새로 발생한 보안 경고가 없는지 확인한다.

> **참고 1 — 마이그레이션 버전 드리프트는 정상이다.** 리포지토리 파일명 타임스탬프(`20260720164500_create_analyses.sql`)와 원격 `supabase_migrations.schema_migrations.version`(`20260720074357`)은 이미 KST/UTC 차이로 어긋나 있다. **이를 맞추려 하지 마라.** 기존 마이그레이션 파일이나 원격 버전 레코드를 수정·재정렬하는 작업은 이 step의 범위가 아니다.
>
> **참고 2 — 롤백 방향 주의.** step 1(코드)만 revert하는 것은 안전하지만, 이 step(함수)만 revert하면 step 1의 코드가 없는 함수를 호출하게 되어 런타임이 깨진다. 되돌릴 일이 생기면 step 1 → step 0 순서로 되돌린다.

### 함수 정의

```sql
create or replace function public.merge_premium_report(
  p_analysis_id uuid,
  p_user_id uuid,
  p_report_type text,
  p_report jsonb
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.analyses
     set premium_reports =
           coalesce(premium_reports, '{}'::jsonb)
           || jsonb_build_object(p_report_type, p_report)
   where id = p_analysis_id
     and user_id = p_user_id
  returning true;
$$;

revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from public;
revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from anon;
revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.merge_premium_report(uuid, uuid, text, jsonb) to service_role;
```

설계 근거 — 임의로 바꾸지 말 것:

- **`where ... and user_id = p_user_id`** — 소유권 검증을 SQL 술어 안에 넣는다. "DB 쓰기는 service-role로 수행하고 코드에서 소유권(user_id)을 직접 검증한다"는 CRITICAL 규칙을 만족시키며, 소유자가 아니면 0행이 갱신되고 함수는 `null`을 반환한다. 이 술어를 빼면 analysisId만 알면 남의 리포트를 덮어쓸 수 있다.
- **`returns boolean` + `returning true`** — 0행이면 결과 집합이 비어 `null`이 반환된다. 호출자가 "존재하지 않거나 내 것이 아님"을 구분할 수 있어야 하므로 반환값을 없애지 말 것.
- **`coalesce(premium_reports, '{}'::jsonb)`** — 컬럼 기본값이 `null`이므로 이게 없으면 `null || {...}`가 `null`이 되어 **첫 리포트가 저장되지 않는다.**
- **`security invoker`(기본)** — `security definer`로 만들면 함수가 RLS 우회 통로가 된다. service-role은 이미 RLS를 우회하므로 definer가 필요 없다.
- **`revoke` 3줄** — Supabase는 함수를 PostgREST RPC로 자동 노출한다. `authenticated`에게 execute가 남아 있으면 브라우저에서 `POST /rest/v1/rpc/merge_premium_report`를 직접 호출할 수 있다. `analyses`에 UPDATE 정책이 없어 실제 갱신은 0행이지만, 쓰기 경로를 service-role로 한정한다는 경계를 명시적으로 지키기 위해 권한 자체를 회수한다.
- **`set search_path = ''`** + 스키마 정규화(`public.analyses`) — search_path 하이재킹 방지. Supabase security advisor의 `function_search_path_mutable` 경고도 이걸로 해소된다.

### 타입 반영

`src/types/database.ts`의 `Functions` 블록이 현재 `[_ in never]: never`이므로, 이대로면 다음 step에서 `supabase.rpc("merge_premium_report", ...)`가 **타입 에러**가 난다. Supabase MCP `generate_typescript_types`(project_id: `peewjgbhqpkysitzqjum`)로 타입을 재생성해 `src/types/database.ts`에 반영한다. 재생성 결과가 기존 파일과 구조가 다르면 파일 전체를 덮어쓰지 말고 **`Functions` 블록에 `merge_premium_report` 항목만 추가**해 기존 `Tables` 정의와 하단의 헬퍼 타입(`DatabaseWithoutInternals` 등)이 깨지지 않게 한다.

## Acceptance Criteria

- [ ] `supabase/migrations/` 아래에 `merge_premium_report` 함수 정의와 `revoke`/`grant`를 **함께** 담은 마이그레이션 파일이 존재하고, 같은 내용이 `apply_migration`으로 원격에 적용되어 있다.
- [ ] `execute_sql`로 아래를 실행하면 행이 정확히 1건이고, `argnames`가 정확히 `{p_analysis_id,p_user_id,p_report_type,p_report}`, `argtypes`가 `uuid, uuid, text, jsonb`, `rettype`이 `boolean`, `volatile`이 `v`, `secdef`가 `false`(= security invoker), `searchpath`가 `search_path=""`(또는 `search_path=`)를 포함한다. **이 4개 파라미터명은 step 1의 `supabase.rpc` 인자 키와 글자 단위로 같아야 하며, 하나라도 다르면 런타임에 `PGRST202`로 실패한다.**
  ```sql
  select p.proargnames as argnames,
         pg_get_function_identity_arguments(p.oid) as argtypes,
         p.prorettype::regtype::text as rettype,
         p.provolatile as volatile,
         p.prosecdef as secdef,
         p.proconfig as searchpath
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'merge_premium_report';
  ```
- [ ] `execute_sql`로 `select r.rolname, has_function_privilege(r.rolname, 'public.merge_premium_report(uuid, uuid, text, jsonb)', 'execute') as can_execute from unnest(array['anon','authenticated','service_role']) as r(rolname);`를 실행하면 `anon`=**false**, `authenticated`=**false**, `service_role`=**true**다. (Supabase의 함수 default ACL이 신규 함수에 `anon`/`authenticated` EXECUTE를 자동 부여하므로, revoke 세 줄이 모두 적용됐는지 세 롤 전부를 확인해야 한다.)
- [ ] `analyses` 테이블의 RLS 정책이 이 step 전후로 동일하다 — `execute_sql`로 `select cmd, policyname from pg_policies where tablename = 'analyses';`를 실행하면 `SELECT` 정책 1건뿐이고 INSERT/UPDATE/DELETE 정책이 **하나도 없다**. (쓰기 정책을 열면 브라우저에서 사용자가 자기 데이터를 직접 조작할 수 있어 "마스킹된 데이터만 저장된다" 불변식이 깨진다.)
- [ ] 함수 동작을 **프로덕션 행을 전혀 변경하지 않고** 검증한다. 아래를 `execute_sql`로 그대로 1회 실행한다. 마지막 `raise exception`이 블록 전체를 롤백하므로 `analyses`에는 아무 변경도 남지 않는다. 에러 메시지에 찍히는 값이 각각 `r1=t`, `first={"qa": {"n": 1}}`, `merged`에 `"qa"`와 `"qa2"`가 **둘 다 존재**, `replaced`의 `qa`가 `{"n": 2}`이면서 `qa2`는 보존, `foreign=<NULL>`, `unchanged=t`여야 한다.

  > **기존 `analyses` 행을 골라 검증하지 마라.** 현재 3행 중 2행이 실제 사용자의 `premium_reports`를 보유하고 있고, MCP `execute_sql`은 `postgres` 권한 + `transaction_read_only=off`로 실제 쓰기가 들어간다. 기존 행에 대고 "null 상태 만들기 → 병합 → 같은 키 교체"를 수행하면 **리포트 유실을 고치는 phase가 그 자리에서 리포트를 유실시킨다.** 반드시 아래처럼 임시 행을 만들고 예외로 롤백하는 방식만 쓴다.

  ```sql
  do $$
  declare v_user uuid; v_id uuid; r1 boolean; r4 boolean; j1 jsonb; j2 jsonb; j3 jsonb;
  begin
    select id into v_user from auth.users limit 1;
    insert into public.analyses (user_id, masked_transactions, free_summary, premium_reports)
      values (v_user, '[]'::jsonb, '{}'::jsonb, null) returning id into v_id;

    -- (1) premium_reports IS NULL 에서 첫 병합 → coalesce 동작
    select public.merge_premium_report(v_id, v_user, 'qa', '{"n":1}'::jsonb) into r1;
    select premium_reports into j1 from public.analyses where id = v_id;

    -- (2) 다른 키 추가 → 기존 키 보존(덮어쓰기 아님)
    perform public.merge_premium_report(v_id, v_user, 'qa2', '{"n":9}'::jsonb);
    select premium_reports into j2 from public.analyses where id = v_id;

    -- (3) 같은 키 재호출 → 그 키만 교체
    perform public.merge_premium_report(v_id, v_user, 'qa', '{"n":2}'::jsonb);
    select premium_reports into j3 from public.analyses where id = v_id;

    -- (4) 소유자가 아닌 uuid → null 반환 + 무변경
    select public.merge_premium_report(
      v_id, '00000000-0000-0000-0000-000000000000'::uuid, 'qa3', '{"n":3}'::jsonb) into r4;

    raise exception 'QA r1=% first=% merged=% replaced=% foreign=% unchanged=%',
      r1, j1::text, j2::text, j3::text, coalesce(r4::text,'<NULL>'),
      (select (premium_reports ? 'qa3') = false from public.analyses where id = v_id);
  end $$;
  ```
- [ ] 위 검증 **전과 후**에 각각 `select count(*) as n, md5(string_agg(id::text || coalesce(premium_reports::text, 'null'), '|' order by id)) as fingerprint from public.analyses;`를 실행해 `n`과 `fingerprint`가 **양쪽에서 동일**하다. (행 수를 특정 숫자로 하드코딩하지 말고 검증 전 값을 기준으로 대조한다 — 다른 작업으로 행이 추가돼 있을 수 있다.)
- [ ] 기존 `analyses` 행의 `premium_reports`를 **읽기 외의 목적으로 건드리지 않았다** — 롤백되지 않는 문맥에서 `update`/`delete`를 실행하지 않았다.
- [ ] `get_advisors`(type: `security`) 결과에 `merge_premium_report`와 관련된 신규 경고(특히 `function_search_path_mutable`)가 없다.
- [ ] `src/types/database.ts`의 `Functions` 블록에 `merge_premium_report`의 Args/Returns 타입이 포함되어 있고, `npm run typecheck`가 통과한다.
- [ ] `npm run test`가 전부 통과한다(이 step은 애플리케이션 코드를 바꾸지 않으므로 기존 테스트가 그대로 통과해야 한다).
