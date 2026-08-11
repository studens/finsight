# QA 계획 검증 — phase `7-premium-report-fix`

- 검증 시점: 2026-08-10 (Codex 실행 **전**, 0단계 계획 검증)
- 대상: `phases/7-premium-report-fix/{index.json, step0.md, step1.md, step2.md}`, `phases/index.json`
- 참조 코드: `src/services/supabase-admin/index.ts`, `src/app/api/reports/[analysisId]/[reportType]/route.ts`, `src/services/llm/{provider.ts,reports/*}`, `src/components/PremiumSection.tsx`, 각 `*.test.ts`
- 실 DB 대조: Supabase project `peewjgbhqpkysitzqjum` (읽기 조회 + 롤백되는 프로브 1회)
- 코드 검증: **미실시(대상 phase 미실행)** — 본 리포트는 계획 검증만 담는다.

**결론: FAIL (BLOCKER 3건).** 실행 전에 B-1/B-2/B-3을 반드시 해소해야 한다.

---

## 0. 실 DB로 확인한 사실 (판단 근거)

| 확인 | 결과 |
|---|---|
| `analyses` 행 수 / `premium_reports IS NOT NULL` | **3행 중 2행이 실제 캐시 보유** |
| `auth.users` | 2명 |
| `pg_roles.rolbypassrls('service_role')` | **true** → `security invoker`로 충분, `definer` 불필요 |
| `pg_policies where tablename='analyses'` | `SELECT` 1건(`select_own_analyses`)뿐. INSERT/UPDATE/DELETE 없음 |
| `pg_default_acl` (functions) | `anon=X`, `authenticated=X`, `service_role=X` — **신규 함수는 기본적으로 anon/authenticated에 EXECUTE가 붙는다** → step0의 revoke 3줄은 필수이며 설계가 옳다 |
| MCP `execute_sql` 실행 주체 | `current_user=postgres`, `transaction_read_only=**off**` → **실제 쓰기가 가능하다** |
| `merge_premium_report` 존재 여부 | 없음(신규) |

### SQL 원자성 — 직접 검증함 (통과)

`pg_temp`에 step0과 동형인 함수를 만들어 예외로 롤백시키는 프로브를 실행했다(프로덕션 무변경). 결과:

- `update ... where id=? and user_id=? returning true` 가 **0행이면 함수 반환값은 SQL `NULL`** → PostgREST가 `null` 반환 → step1의 `data !== true`가 정확히 "없거나 내 것 아님"에 대응한다. **정합 확인.**
- `coalesce(null::jsonb,'{}') || jsonb_build_object('a', ...)` = `{"a": {"x": 1}}`
- `null::jsonb || jsonb_build_object(...)` = **`NULL`** → `coalesce`는 실제로 load-bearing(빼면 첫 리포트 유실). step0의 설계 근거가 옳다.
- `language sql` + `security invoker` + `set search_path = ''` + `public.` 정규화 조합이 **컴파일·실행된다**(pg_catalog는 암묵적으로 검색되므로 `coalesce`/`jsonb_build_object`/`||` 해석 정상).

READ COMMITTED에서 동시 UPDATE는 행 락 해제 후 **갱신된 튜플 기준으로 SET 식을 재평가**하므로, 두 요청이 서로 다른 키를 병합해도 유실되지 않는다. **계획대로 실행하면 경쟁 상태는 실제로 사라진다.**

---

## BLOCKER

### B-1. `step2.md` 30–46행 제안 코드 + AC(78·82행) — 로그가 프롬프트(마스킹 거래 전문)와 리포트 본문을 유출한다

step2는 스스로 "로그에 `current`/`maskedTransactions`/생성된 `report` 본문을 넣지 말 것"이라고 못박아 놓고, 제안 코드에서 **에러 객체를 통째로** 넘긴다.

```ts
console.error("[reports] 리포트 생성 실패", { analysisId, reportType, error })
```

이 경로에서 실제로 던져지는 에러는 다음을 들고 있다.

1. **Vercel AI SDK `APICallError`** — `node_modules/@ai-sdk/provider/dist/index.d.ts:672-694`
   ```
   readonly url: string
   readonly requestBodyValues: unknown   // ← 프로바이더로 보낸 요청 본문 전체 = 프롬프트
   readonly responseBody?: string        // ← 모델 원문 = 리포트 본문
   readonly responseHeaders?: Record<string, string>
   ```
   `requestBodyValues`/`responseBody`는 **enumerable own property**이고, Node `console.error`는 `{ ..., error }` 객체를 `util.inspect`로 직렬화하므로 그대로 Vercel 로그에 남는다.
2. 그 프롬프트에는 거래 데이터가 들어 있다 — `src/services/llm/reports/anomaly-detection.ts:44` 이하에서 `current.maskedTransactions`를 직렬화해 프롬프트에 넣는다(4개 리포트 모두 동일 패턴, `provider.ts:37` `generateAnalysisText({ prompt })` → `generateText`).
3. **`JSON.parse(text)`가 던지는 `SyntaxError`** — V8은 메시지에 입력 문자열 일부를 포함시킨다(`Unexpected token 'x', "…" is not valid JSON`). 여기서 입력은 **모델이 생성한 리포트 본문**이다.
4. step1이 그대로 전파하는 **PostgrestError**도 `details`/`hint`에 실패한 문장의 파라미터 값(= `p_report` 조각)이 실릴 수 있다.

CLAUDE.md CRITICAL("원본 CSV는 어떤 형태로도 — Storage, 디스크, **로그** 등 — 영구 저장하지 않는다") 및 scope 문서 28행 위반이다.

**더 나쁜 점: step2의 테스트 4번은 이 유출을 구조적으로 잡지 못한다.** `generateReport`는 목킹되어 `new Error("provider unavailable")` 같은 평범한 에러를 던지므로, 픽스처의 가맹점명은 애초에 에러에 실리지 않는다. **AC는 통과하는데 프로덕션은 샌다.**

**수정 문구 (step2.md 제안 코드 및 AC 교체):**

작업 절에 다음을 추가하고 코드 예시를 바꾼다.

> **에러 객체를 로그에 그대로 넘기지 않는다.** `generateReport`가 던지는 `APICallError`는 `requestBodyValues`(프로바이더로 보낸 프롬프트 = 마스킹 거래 전문)와 `responseBody`(모델 원문 = 리포트 본문)를 enumerable 프로퍼티로 갖고 있고, `JSON.parse` 실패 시의 `SyntaxError`는 메시지 자체에 모델 출력 조각을 담는다. 따라서 **허용 목록 방식으로 요약해서만** 기록한다.
>
> ```ts
> // 에러 객체에는 프롬프트(requestBodyValues)·모델 원문(responseBody)·
> // 파싱 실패 입력 조각이 실릴 수 있어, 종류와 상태코드만 뽑아 남긴다.
> function describeError(error: unknown): {
>   errorName: string
>   statusCode?: number
> } {
>   if (!(error instanceof Error)) return { errorName: "UnknownError" }
>   const statusCode = (error as { statusCode?: unknown }).statusCode
>   return {
>     errorName: error.name,
>     ...(typeof statusCode === "number" ? { statusCode } : {}),
>   }
> }
>
> let report
> try {
>   report = await generateReport({ reportType, current, previous })
> } catch (error) {
>   console.error("[reports] 리포트 생성 실패", {
>     analysisId,
>     reportType,
>     ...describeError(error),
>   })
>   return NextResponse.json({ code: "GENERATION_FAILED" }, { status: 502 })
> }
>
> try {
>   await upsertPremiumReport({ userId: user.id, analysisId, reportType, report })
> } catch (error) {
>   console.error("[reports] 리포트 캐시 저장 실패", {
>     analysisId,
>     reportType,
>     ...describeError(error),
>   })
> }
> ```
>
> `errorName` + `statusCode`만으로도 이 phase가 원했던 구분(프로바이더 5xx/429 vs `TypeError`("Claude returned an invalid anomaly report") vs `SyntaxError` vs `PostgrestError`)은 전부 가능하다.

AC 82행을 다음으로 교체한다.

> - [ ] `console.error`에 전달되는 값이 `analysisId`, `reportType`, `errorName`, `statusCode` **네 키로 한정**되며, 에러 객체 자체·`error.message`·`error.stack`을 넘기지 않는다.
> - [ ] `generateReport`가 **`requestBodyValues`와 `responseBody`를 가진 `APICallError` 형태의 객체**(예: `Object.assign(new Error("api failed"), { name: "AI_APICallError", statusCode: 500, requestBodyValues: { prompt: "LEAK_MARKER_MERCHANT 12000원" }, responseBody: "LEAK_MARKER_REPORT" })`)를 던지는 테스트에서, `console.error` 인자를 `JSON.stringify`한 결과에 `LEAK_MARKER_MERCHANT`와 `LEAK_MARKER_REPORT`가 **둘 다 없음**을 단언한다.
> - [ ] `upsertPremiumReport`가 `message`에 리포트 조각을 담은 에러를 던지는 경우에도 같은 단언이 성립한다.

---

### B-2. `step0.md` 69–74행 AC — 프로덕션 데이터를 파괴한다

AC는 "기존 `analyses` 행 하나를 골라" 다음을 검증하라고 지시한다.

- `premium_reports`가 **`null`인 상태에서** 호출 → 기존 행에는 null이 아닌 값이 2/3개 들어 있으므로, Codex는 이 조건을 만들려고 **실제 캐시를 NULL로 지운다.**
- "같은 키로 다시 호출하면 그 키의 값만 교체" → **실제 사용자의 캐시된 Premium 리포트를 테스트 값으로 덮어쓴다.**

그런데 원상복구 지시는 마지막 하위 항목의 "**검증에 임시 행을 만들었다면** 반드시 삭제해 원상복구한다"뿐이라, **기존 행을 고른 경로에는 복구 의무가 전혀 걸려 있지 않다.**

실 DB 확인 결과 이 위험은 가설이 아니다. `analyses` 3행 중 **2행이 실제 `premium_reports`를 보유**하고 있고, MCP `execute_sql`은 `postgres` 권한 + `transaction_read_only=off`로 실제 쓰기가 들어간다. execute.py는 `--dangerously-bypass-approvals-and-sandbox`로 돌기 때문에 중간 승인도 없다. **리포트 유실을 고치는 phase가 QA 단계에서 리포트를 유실시킨다.**

**수정 문구 (step0.md의 69–74행 두 AC를 아래 한 항목으로 교체):**

> - [ ] 함수 동작을 **프로덕션 행을 전혀 변경하지 않고** 검증한다. 아래를 `execute_sql`로 그대로 1회 실행하면, 마지막 `raise exception`이 블록 전체를 롤백하므로 `analyses`에는 아무 변경도 남지 않는다. 에러 메시지에 찍히는 4개 값이 각각 `first=…{"qa":{"n":1}}…`, `merged=…"qa":{"n":1}…와 기존 키 보존…`, `replaced=…{"qa":{"n":2}}…`, `foreign=<NULL>`이어야 한다.
>
>   ```sql
>   do $$
>   declare v_user uuid; v_id uuid; r1 boolean; r4 boolean; j1 jsonb; j2 jsonb; j3 jsonb;
>   begin
>     select id into v_user from auth.users limit 1;
>     insert into public.analyses (user_id, masked_transactions, free_summary, premium_reports)
>       values (v_user, '[]'::jsonb, '{}'::jsonb, null) returning id into v_id;
>
>     -- (1) premium_reports IS NULL 에서 첫 병합 → coalesce 동작
>     select public.merge_premium_report(v_id, v_user, 'qa', '{"n":1}'::jsonb) into r1;
>     select premium_reports into j1 from public.analyses where id = v_id;
>
>     -- (2) 다른 키 추가 → 기존 키 보존(덮어쓰기 아님)
>     perform public.merge_premium_report(v_id, v_user, 'qa2', '{"n":9}'::jsonb);
>     select premium_reports into j2 from public.analyses where id = v_id;
>
>     -- (3) 같은 키 재호출 → 그 키만 교체
>     perform public.merge_premium_report(v_id, v_user, 'qa', '{"n":2}'::jsonb);
>     select premium_reports into j3 from public.analyses where id = v_id;
>
>     -- (4) 소유자가 아닌 uuid → null 반환 + 무변경
>     select public.merge_premium_report(
>       v_id, '00000000-0000-0000-0000-000000000000'::uuid, 'qa3', '{"n":3}'::jsonb) into r4;
>
>     raise exception 'QA r1=% first=% merged=% replaced=% foreign=% unchanged=%',
>       r1, j1::text, j2::text, j3::text, coalesce(r4::text,'<NULL>'),
>       (select (premium_reports ? 'qa3') = false from public.analyses where id = v_id);
>   end $$;
>   ```
>
>   - [ ] 검증 후 `select count(*) from public.analyses;`가 **3**(검증 전 값)이고, `select id, premium_reports from public.analyses;` 결과가 검증 전과 동일함을 확인한다.
>   - [ ] 기존 `analyses` 행의 `premium_reports`를 **읽기 외의 목적으로 건드리지 않았다** — `update`/`delete`를 롤백되지 않는 문맥에서 실행하지 않았다.

---

### B-3. supabase-js → PostgREST 실호출 경로를 검증하는 AC가 어느 step에도 없는데, step2가 그 실패를 200으로 삼킨다

step0의 검증은 전부 `execute_sql`(직접 SQL, `postgres` 권한)로 이뤄지고, step1의 테스트는 `supabase.rpc`를 통째로 목킹한다. 따라서 다음 두 실패 모드는 **세 step의 어떤 AC로도 걸리지 않는다.**

1. **PostgREST 스키마 캐시 미갱신** → 런타임에 `PGRST202 Could not find the function public.merge_premium_report(...)`. step0.md는 "revoke 근거"에서 PostgREST 자동 노출을 언급하면서도 캐시 리로드는 다루지 않는다.
2. **파라미터명/타입 불일치** → 같은 `PGRST202`. step1 AC 54행이 "하나라도 다르면 런타임에 함수를 찾지 못한다"고 스스로 경고하지만, 대조는 사람 눈으로 두 파일을 비교하는 것 외엔 없다.

여기에 step2가 결합하면 문제가 심각해진다. step2는 `upsertPremiumReport` 실패를 catch → log → **200 반환**으로 바꾼다. 즉 RPC가 영구히 실패해도

- 사용자는 매번 200과 리포트를 받고(생성은 성공하므로),
- `premium_reports`는 **영원히 비어 있고**(= 이 phase가 고치려는 증상 그대로),
- 5xx도 안 나고, 3개 step은 전부 `completed`로 마킹된다.

**"고쳤다고 표시되지만 실제로는 안 고쳐진" 상태가 성립 가능한 계획**이므로 BLOCKER로 분류한다.

**수정 문구:**

(a) step0.md 「작업」 3번 뒤에 절차 추가:

> 3-1. `apply_migration` 직후 `execute_sql`로 `notify pgrst, 'reload schema';`를 실행해 PostgREST 스키마 캐시를 즉시 갱신한다(자동 리로드가 지연되면 step 1의 `supabase.rpc` 호출이 `PGRST202`로 실패한다).

(b) step0.md AC에 **기계적 시그니처 대조** 추가:

> - [ ] `execute_sql`로 아래를 실행하면 `argnames`가 정확히 `{p_analysis_id,p_user_id,p_report_type,p_report}`, `argtypes`가 `uuid, uuid, text, jsonb`, `rettype`이 `boolean`, `volatile`이 `v`, `searchpath`가 `search_path=""`(또는 `search_path=`)를 포함한다. 이 4개 이름은 step 1의 `supabase.rpc` 인자 키와 **글자 단위로 같아야** 한다.
>   ```sql
>   select p.proargnames as argnames,
>          pg_get_function_identity_arguments(p.oid) as argtypes,
>          p.prorettype::regtype::text as rettype,
>          p.provolatile as volatile,
>          p.prosecdef as secdef,
>          p.proconfig as searchpath
>     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
>    where n.nspname = 'public' and p.proname = 'merge_premium_report';
>   ```

(c) `phases/7-premium-report-fix/index.json`에 **step 3 추가** + `step3.md` 신설:

> `{ "step": 3, "name": "실 DB 스모크 검증 — RPC 왕복과 4키 동시 병합 확인", "status": "pending" }`
>
> step3.md 작업: 실행 전 `select id, premium_reports from public.analyses order by created_at desc limit 1;`로 현재 상태를 기록한다. 그 다음 리더가 브라우저에서 해당 분석의 Premium 카드 4개를 **연달아(서로 다른 카드를 동시에)** 누른 뒤, 같은 쿼리를 다시 실행해 `premium_reports`에 4개 키(`mom_comparison`, `anomaly_detection`, `savings_suggestions`, `budget_recommendation`)가 **모두** 남아 있는지 확인한다. 하나라도 없으면 이 phase는 실패다.
>
> 브라우저 조작은 Codex가 수행할 수 없으므로, 이 step은 사용자 개입이 필요하면 `blocked`로 표시하고 `blocked_reason`에 위 확인 절차와 기록해 둔 실행 전 상태를 적는다. **`completed`로 임의 마킹하지 않는다.**

---

## MAJOR

### M-1. `step2.md` 테스트 4번이 공유 픽스처 변경을 유도해 기존 테스트를 깬다

step2는 "테스트 픽스처의 `masked_transactions`에 넣어둔 식별 가능한 문자열(예: 가맹점명)"을 전제하는데, 현재 `route.test.ts:54`의 `analysis()` 픽스처는 `masked_transactions: [{ card: "****1234", amount: "12000" }]`로 **가맹점명이 없다.** 같은 값이 `route.test.ts:158`의 "lazy-generates" 테스트에서 `current.maskedTransactions` 기대값으로 **하드코딩**되어 있어, 픽스처만 고치면 그 테스트가 깨진다 — step2는 67행에서 기존 테스트가 그대로 통과해야 한다고 못박아 놓았으므로 지시가 서로 모순이다.

**수정 문구 (step2.md 테스트 4번 교체):**

> 4. **로그에 데이터가 새지 않는다** — 공유 픽스처 `analysis()`(route.test.ts:49)는 **수정하지 않는다**(route.test.ts:158의 `current.maskedTransactions` 기대값이 같은 값에 묶여 있어 함께 깨진다). 대신 이 테스트 안에서만 `getAnalysisById.mockResolvedValue({ ...analysis(), masked_transactions: [{ card: "****1234", amount: "12000", merchant: "LEAK_MARKER_MERCHANT" }] })`로 덮어쓰고, B-1의 `APICallError` 유사 객체를 `generateReport`가 던지게 한 뒤 `console.error` 인자에 `LEAK_MARKER_MERCHANT`/`LEAK_MARKER_REPORT`가 없음을 단언한다.

### M-2. `step0.md` AC 67행 — `anon`의 EXECUTE 회수를 검증하지 않는다

실측한 `pg_default_acl`은 신규 함수에 `anon=X`, `authenticated=X`를 자동 부여한다. step0의 SQL은 revoke 3줄로 옳게 처리하지만, AC는 `authenticated`와 `service_role`만 확인한다. Codex가 재시도 중 revoke 한 줄을 빠뜨리거나 순서를 바꿔도 AC는 통과한다 — 그러면 브라우저의 익명 세션이 `POST /rest/v1/rpc/merge_premium_report`를 호출할 수 있게 된다(현재 `analyses`에 UPDATE 정책이 없어 실제 갱신은 0행이지만, "쓰기는 service-role 경유" 경계가 문서상으로만 남는다).

**수정 문구 (step0.md AC 67행 교체):**

> - [ ] `execute_sql`로 `select r.rolname, has_function_privilege(r.rolname, 'public.merge_premium_report(uuid, uuid, text, jsonb)', 'execute') as can_execute from unnest(array['anon','authenticated','service_role']) as r(rolname);`를 실행하면 `anon`=**false**, `authenticated`=**false**, `service_role`=**true**다.

### M-3. `step2.md` — 소유권 실패(`Analysis not found`)까지 200으로 강등되는데 그 판단 근거가 문서에 없다

step1은 "소유자가 아니거나 존재하지 않는 분석"에서 `"Analysis not found"`를 던지도록 유지한다. 그런데 step2는 `upsertPremiumReport`의 **모든** 예외를 삼켜 200으로 만든다. 즉 소유권 술어가 걸러낸 케이스가 로그 한 줄로 강등된다.

실질 위험은 낮다 — `route.ts:50`의 `getAnalysisById` 선검증이 1차 방어선이고 RPC 술어는 2차 방어선이므로, 여기 도달하는 소유권 실패는 사실상 TOCTOU/버그를 의미한다. 문제는 **계획 문서 어디에도 이 판단이 적혀 있지 않다**는 것이다. Codex도 후속 리뷰어도 "보안 완화를 의도한 것인지" 알 수 없다.

**수정 문구 (step2.md 「설계 근거」에 항목 추가):**

> - **소유권 실패도 200으로 삼키는 것이 안전한 이유를 명시한다.** `upsertPremiumReport`가 던지는 `"Analysis not found"`는 RPC의 `user_id` 술어가 0행을 갱신했다는 뜻인데, 이 라우트는 이미 `route.ts:50`에서 `getAnalysisById` + `analysis.user_id !== user.id`로 소유권을 선검증했으므로 여기 도달하면 그 자체가 버그(또는 분석이 그 사이 삭제됨)다. 남의 데이터가 써진 것이 아니라 **아무것도 안 써진** 상태이므로 응답을 200으로 두어도 데이터 노출은 없다. 다만 이 경우가 로그에서 구분되도록 `errorName`을 반드시 남긴다.

---

## MINOR

- **N-1. `step0.md` AC 66행이 `prosecdef`만 본다.** `provolatile`(=`v`)과 `proconfig`의 `search_path` 설정은 검증되지 않는다 → B-3(b)의 통합 쿼리로 함께 해결된다.
- **N-2. 마이그레이션 버전 드리프트.** 리포지토리 파일명(`20260720164500_create_analyses.sql`)과 원격 `supabase_migrations.schema_migrations.version`(`20260720074357`)이 이미 다르다(KST/UTC 차이로 추정). step0의 "파일 저장 + `apply_migration` 별도 실행" 절차는 이 드리프트를 한 건 더 만든다. `create or replace`라 재적용은 무해하므로 실질 위험은 없지만, step0에 "원격 version과 파일명 타임스탬프가 달라도 정상이며 맞추려 하지 않는다"는 한 줄을 넣어 Codex가 불필요한 교정을 시도하지 않게 할 것.
- **N-3. `route.test.ts:203`의 기존 "GENERATION_FAILED" 테스트가 스파이 없이 `console.error`를 실행**하게 되어 테스트 출력이 오염된다. step2에 "기존 502 테스트에도 `vi.spyOn(console, "error")`를 걸고 `afterEach`에서 복원한다"를 추가할 것.
- **N-4. `analysisId`는 미검증 사용자 입력**(`reportType`만 화이트리스트 검증됨)이라 로그에 그대로 들어간다. 구조화 객체 인자라 로그 인젝션 위험은 낮지만, `describeError` 도입 시 `analysisId`도 길이 절단(예: `.slice(0, 64)`)을 권장.

---

## 통과 항목

| 점검 | 결과 |
|---|---|
| **경쟁 상태가 실제로 사라지는가** | **통과.** 실 DB 프로브로 `coalesce`/`\|\|`/0행→`NULL` 전부 확인. 행 락 + READ COMMITTED 재평가로 병합 원자성 성립 |
| **step0 반환 계약 ↔ step1 판정 정합** | **통과.** 0행 → `NULL` → PostgREST `null` → `data !== true` → `"Analysis not found"`. 정확히 맞물린다 |
| **step0 파라미터명·순서·타입 ↔ step1 `rpc` 인자** | 문서상 **일치**(`p_analysis_id`, `p_user_id`, `p_report_type`, `p_report` / uuid,uuid,text,jsonb). 다만 기계적 대조 AC 부재 → B-3(b) |
| **(a) `analyses` SELECT-only RLS 유지** | **통과.** 계획은 정책을 추가하지 않고, step0 AC 68행이 "SELECT 1건, 쓰기 정책 0건"을 명시 검증한다. 현 DB 상태와도 일치 |
| **(b) 소유권 검증 유지** | **통과(단서 있음).** JS 비교 → SQL 술어로 이동하지만 버전 관리되는 마이그레이션이고 step0/step1 AC가 양쪽에서 검증한다. `route.ts:50` 선검증이 1차 방어선으로 그대로 남는다. → M-3의 근거 명시 필요 |
| **(c) `security definer` 오용** | **통과.** `security invoker` 명시 + `service_role.rolbypassrls=true` 실측 확인으로 definer 불필요. 근거도 step0에 적혀 있다 |
| **(d) PostgREST 노출 대비 `revoke` 충분성** | **SQL은 충분**(default ACL의 anon/authenticated 부여를 실측 확인, revoke 3줄이 정확히 이를 겨냥). **AC가 불충분** → M-2 |
| **(e) step2 로깅의 PII 유출** | **실패** → B-1 |
| **누락된 호출 경로** | **없음.** `upsertPremiumReport` 호출부는 `route.ts:82` 단 하나(grep 확인). `premium_reports`에 쓰는 다른 코드 없음 |
| **깨질 기존 테스트** | `supabase-admin/index.test.ts:84-130`(select/update 체인 목) — step1이 재작성 지시로 정확히 커버. `route.test.ts` 픽스처 → M-1 |
| **`PremiumSection.tsx:216`의 단일 `loading`을 범위 밖으로 둔 판단** | **타당.** 원자 병합 후 동시 요청은 서로를 덮어쓰지 않는다. 남는 것은 중복 LLM 비용뿐이며 scope 21행이 이를 명시한다 |
| **step 순서 / 중간 커밋 무결성** | **통과.** step0이 원격 적용까지 끝낸 뒤 step1이 코드를 바꾸므로 중간 커밋이 깨지지 않는다. 롤백 시에만 역순 주의(step1만 revert는 안전, step0만 revert하면 런타임 깨짐) — step0에 한 줄 메모 권장 |
| **step 크기** | **적절.** 각 step이 파일 1개 + 테스트 1개 범위로 `codex exec` 1회에 완결 가능 |
| **`phases/index.json` 등록** | **통과.** 8번째 항목 `{"dir": "7-premium-report-fix", "status": "pending"}` |
| **`index.json`의 `phase` 필드 규약** | **통과.** `"7-premium-report-fix"` — 디렉토리명과 동일, 기존 `6-polar-billing` 규약과 일치(브랜치 `feat-7-premium-report-fix`, 커밋 `feat(7-premium-report-fix): step N — …`) |

---

## 실행 전 필수 조치 요약

1. **B-1** — `step2.md` 제안 코드를 `describeError` 허용목록 방식으로 교체하고, `APICallError` 형태 객체를 던지는 유출 테스트 AC를 추가한다.
2. **B-2** — `step0.md` 69–74행 AC를 롤백되는 `do $$ … raise exception … $$` 블록 검증으로 교체하고, 프로덕션 행 무변경 확인 AC를 추가한다.
3. **B-3** — `step0.md`에 `notify pgrst, 'reload schema'` 절차와 `pg_proc` 시그니처 대조 AC를 추가하고, `index.json`에 실 DB 스모크 검증 step 3을 신설한다.
4. M-1 / M-2 / M-3도 함께 반영하는 것을 권장한다(M-2는 보안 경계 검증이라 사실상 필수에 가깝다).

**VERDICT: FAIL**

---
---

# 재검증 (2차) — 2026-08-10, 지적사항 반영 후

- 대상: 갱신된 `step0.md` / `step2.md` / 신규 `step3.md` / `index.json`(step 4개), `step1.md`(미변경)
- 방법: 계획 문서 재독 + 실 DB 실증(step0의 DDL·검증 블록을 **그대로** 1회 실행 후 롤백 확인) + `execute.py` blocked 경로 코드 확인 + `@supabase/postgrest-js` / `@ai-sdk/provider` 구현 확인
- 코드 검증: 여전히 **미실시**(phase 미실행)

**결론: FAIL (BLOCKER 1건 — 신규).** 1차 지적 B-1/B-2/B-3 및 M-1~M-3, N-1~N-4는 **전부 해소**됐다. 다만 그 수정 과정에서 B-3의 방어를 무력화하는 신규 결함이 하나 생겼다.

## 1. 1차 지적 해소 여부

### B-1 (로그 유출) — 해소 (잔여 결함 2건은 아래 M-4/M-5)

`step2.md` 28–37행에 근거 절이 신설되고, 제안 코드가 `describeError` 허용목록 방식으로 교체됐으며, 「로그에 넣지 말 것」 98행에 "에러 객체 자체·`error.message`·`error.stack`"이 추가됐다. AC 139–140이 4키 한정 + `LEAK_MARKER_*` 부재를 단언한다. **핵심 지적은 반영됐다.**

구현 라이브러리로 교차 확인한 결과도 계획과 맞는다:
- `APICallError`는 `AISDKError`를 통해 `this.name = "AI_APICallError"`를 세팅하고(`node_modules/@ai-sdk/provider/dist/index.js:39`, `:21`) `statusCode`를 own property로 갖는다 → `describeError`가 정상 동작한다.
- `TypeError`(리포트 검증 실패) / `SyntaxError`(모델 출력 파싱 실패)도 `name`으로 구분된다.

### B-2 (프로덕션 데이터 파괴) — 해소, **실증 완료**

`step0.md` 84–116행의 DDL과 검증 블록을 **문자 그대로** 실 DB에서 1회 실행했다(함수 DDL을 같은 DO 블록 안에서 생성해 함께 롤백되도록 함). 결과는 AC 84행이 예측한 값과 **완전히 일치**했다:

```
QA r1=t
   first={"qa": {"n": 1}}
   merged={"qa": {"n": 1}, "qa2": {"n": 9}}
   replaced={"qa": {"n": 2}, "qa2": {"n": 9}}
   foreign=<NULL> unchanged=t n_before=3 n_after=4
```

롤백 후 상태 재조회:

| 확인 | 결과 |
|---|---|
| `count(*) from analyses` | **3** (변경 없음) |
| `merge_premium_report` 존재 | **0** (DDL도 함께 롤백됨) |
| 각 행의 `premium_reports` 키 집합 | `27aaa9b7`=4키, `deffb84a`=0키, `cb0eefa6`=4키 — 검증 전과 동일 |

즉 이 AC는 **프로덕션을 전혀 건드리지 않으면서 실제로 수행 가능**하다. `raise exception`이 임시 행 INSERT까지 확실히 되돌린다. B-2 해소 확인.

### B-3 (실호출 경로 미검증) — 부분 해소 → **아래 B-4로 재발**

`notify pgrst, 'reload schema'`(절차 4번)와 `pg_proc` 통합 대조 AC(71행), step 3 신설까지 지시대로 반영됐다. 추가 근거도 확인했다 — `@supabase/postgrest-js`의 `RETRYABLE_METHODS = ['GET','HEAD','OPTIONS']`이고 `rpc`는 POST이므로, "503 = PostgREST schema cache not yet loaded"에 대한 SDK 자동 재시도 대상이 **아니다.** `notify pgrst`는 실제로 load-bearing하다.

다만 step 3 자체가 헛돌 수 있게 설계돼 있다 → **B-4**.

### M-1 / M-2 / M-3 / N-1 / N-2 / N-3 / N-4 — 전부 해소

| 지적 | 반영 위치 | 판정 |
|---|---|---|
| M-1 공유 픽스처 | `step2.md` 109–128행(지역 오버라이드) + AC 141 | 해소 |
| M-2 `anon` 미검증 | `step0.md` AC 82(3롤 `unnest`) | 해소 |
| M-3 소유권 실패 근거 | `step2.md` 88행 | 해소 |
| N-1 `provolatile`/`proconfig` | `step0.md` AC 71에 통합 | 해소 |
| N-2 버전 드리프트 | `step0.md` 참고 1 (원격 `20260720074357` 실측 일치) | 해소 |
| N-3 기존 502 테스트 스파이 | `step2.md` 131행 | 해소 |
| N-4 `analysisId` 절단 | `step2.md` 61·72행 | 해소 |

---

## BLOCKER (신규)

### B-4. `step3.md`가 대상 분석을 특정하지 않아, 이미 캐시가 찬 행을 고르면 검증이 **공허하게 통과**한다 — B-3 방어가 그대로 무력화된다

`step3.md` 30행은 "구독이 `active`인 계정으로 `/dashboard/{분석 id}`에 들어가"라고만 하고 **어느 분석을 고를지 기준이 없다.**

실측한 현재 DB 상태:

| 분석 id | created_at | 캐시된 키 |
|---|---|---|
| `cb0eefa6` | 2026-08-10 (**가장 최근**) | **4개 전부** |
| `deffb84a` | 2026-07-30 | **0개** |
| `27aaa9b7` | 2026-07-21 | **4개 전부** |

3행 중 2행이 이미 4키를 갖고 있고, **가장 최근 분석이 하필 4키가 찬 행**이라 사람이 자연스럽게 고를 확률이 높다. 그 행을 고르면:

- 카드 4개를 눌러도 `route.ts:59-62`의 캐시 히트 분기에서 즉시 반환된다 → `generateReport`도 `upsertPremiumReport`도 **한 번도 호출되지 않는다.**
- 즉 supabase-js → PostgREST → `merge_premium_report` 실호출 경로를 **한 번도 타지 않는다.**
- 그런데 AC 49("4개 키가 모두 존재")와 AC 50("유실 재현 안 됨")과 AC 51("캐시 저장 실패 로그 없음")은 **전부 자동으로 통과한다.**
- 사람에게도 아무 이상 신호가 없다 — 카드는 정상적으로 즉시 렌더된다.

결과적으로 B-3에서 지적한 **"고쳤다고 표시되지만 실제로는 안 고쳐진" 상태가 그대로 성립**한다. step 3은 그 구멍을 막으라고 만든 step인데, 대상 선정 기준이 없어 스스로 그 구멍이 된다.

**수정 문구 (`step3.md` 「작업」 1번 뒤에 삽입하고 2번을 수정):**

> 1-1. **대상 분석은 `cached_keys = 0`인 행에서 고른다.** 이미 4키가 찬 행을 고르면 카드 4개가 전부 `route.ts:59-62`의 캐시 히트로 끝나 `generateReport`도 `upsertPremiumReport`도 호출되지 않는다 — RPC 경로를 한 번도 타지 않은 채 이 step의 AC가 **전부 자동 통과**해 검증이 무의미해진다. 1번 쿼리 결과에서 `cached_keys = 0`인 행의 id를 대상으로 삼고, 그 id를 `summary`에 명시한다.
>
> 1-2. `cached_keys = 0`인 행이 하나도 없으면, **기존 행의 `premium_reports`를 지우지 말고** 새 CSV를 업로드해 새 분석을 만들어 그것을 대상으로 삼는다. 기존 행을 비우는 것은 이 phase가 고치려는 유실을 직접 일으키는 행위다.
>
> 2. (수정) 구독이 `active`인 계정으로 `npm run dev` 후 **1-1에서 고른 `cached_keys = 0`인 분석**의 `/dashboard/{analysisId}`에 들어가, Premium 카드 4개를 서로 다른 카드로 연달아(앞 카드의 로딩이 끝나기 전에) 누른다.

AC에도 다음을 추가한다.

> - [ ] 대상 분석은 **실행 전 `cached_keys`가 0**이었던 행이며, 그 id가 `summary`에 기록되어 있다. (캐시가 이미 차 있던 행을 대상으로 삼았다면 이 step은 아무것도 검증하지 못한 것이므로 실패로 처리한다.)

---

## MAJOR (신규)

### M-4. `describeError`가 `code`를 남기지 않아 `step3.md` 32행의 `PGRST202` 판별이 **로그로 불가능**하다 — step2 ↔ step3 불일치

`step3.md` 32행은 "그 로그의 `errorName`을 기록한다(특히 `PGRST202`면 step 0의 스키마 캐시 리로드 또는 파라미터명 불일치 문제다)"라고 지시한다. 그런데 `@supabase/postgrest-js@2.110.7`의 `src/PostgrestError.ts`를 확인하면:

```ts
export default class PostgrestError extends Error {
  details: string
  hint: string
  code: string
  constructor(context: {...}) {
    super(context.message)
    this.name = 'PostgrestError'   // ← name은 항상 이 값
    ...
  }
}
```

- `name`은 **항상 `"PostgrestError"`** 이고, `PGRST202`/`42501`/`23503`을 구분하는 필드는 **`code`** 다.
- `PostgrestError`에는 **`statusCode` 프로퍼티가 없다.**

따라서 `describeError`가 남기는 것은 `{ errorName: "PostgrestError" }` 하나뿐이고, step3이 요구하는 `PGRST202` 판별은 **로그만으로 불가능**하다. step2와 step3이 서로 다른 것을 가정하고 있다.

**수정 문구 (`step2.md` `describeError` 교체 + AC 보강):**

> ```ts
> // 에러 객체에는 프롬프트(requestBodyValues)·모델 원문(responseBody)·
> // 파싱 실패 입력 조각·PostgrestError.details(= 문제가 된 값/행)가 실릴 수 있어,
> // 진단에 필요한 짧은 식별자만 뽑아 남긴다.
> function describeError(error: unknown): {
>   errorName: string
>   statusCode?: number
>   code?: string
> } {
>   if (!(error instanceof Error)) return { errorName: "UnknownError" }
>   const { statusCode, code } = error as { statusCode?: unknown; code?: unknown }
>   return {
>     errorName: error.name,
>     ...(typeof statusCode === "number" ? { statusCode } : {}),
>     ...(typeof code === "string" && code.length <= 32 ? { code } : {}),
>   }
> }
> ```
>
> `code`만 추가하고 **`details`·`hint`·`message`는 절대 추가하지 않는다.** postgrest-js 자신의 문서가 `details`를 "extra context, **often the offending value, key, or row**"라고 설명한다 — 여기에 `p_report` 페이로드가 실린다. 같은 파일 상단 주석은 아예 **"Always log the full object (`console.error(error)`)"**를 권하는데, **이 프로젝트에서는 그 조언을 따르면 안 된다**(CRITICAL: 로그도 영구 저장 수단). `code`는 `PGRST202`·`42501`·`23503` 같은 짧은 고정 코드이며, 같은 리포지토리의 `isUnknownUserError`(`src/services/supabase-admin/index.ts:83-89`)가 이미 `.code`로 분기하고 있어 일관된다.

AC 139를 다음으로 교체한다(N-8도 함께 해소).

> - [ ] `console.error`에 전달되는 객체의 키가 **`analysisId`, `reportType`, `errorName`, `statusCode`, `code` 집합 안에만** 있다(`statusCode`/`code`는 해당 에러에 있을 때만 포함되므로 개수는 3~5개로 달라질 수 있다). 에러 객체 자체·`error.message`·`error.stack`·`details`·`hint`는 넘기지 않는다.
> - [ ] `PostgrestError` 형태의 객체(`Object.assign(new Error("db"), { name: "PostgrestError", code: "PGRST202", details: "LEAK_MARKER_REPORT", hint: "h" })`)를 `upsertPremiumReport`가 던지면, 로그에 `code: "PGRST202"`가 **남고** `LEAK_MARKER_REPORT`는 **남지 않는다.**

### M-5. `step2.md` 테스트 5(및 4의 `message` 경로)가 `JSON.stringify` 기준이면 **공허하게 통과**한다

`Error`의 `message`와 `stack`은 **non-enumerable**이므로 `JSON.stringify({ error: new Error("LEAK_MARKER_REPORT") })`는 `{"error":{}}`가 된다. 즉 회귀가 실제로 일어나(에러 객체를 통째로 로깅) 프로덕션에서 메시지가 새더라도 **테스트는 통과한다.**

- 테스트 4는 `requestBodyValues`/`responseBody`가 `Object.assign`으로 붙은 enumerable own property라 **우연히** 잡힌다.
- 테스트 5(`message`에 마커를 담은 에러)는 **구조적으로 절대 못 잡는다.** M-4가 지적한 `details` 유출도 `PostgrestError.toJSON()`이 있어 우연히 잡히지만, 이런 우연에 기대면 안 된다.

근본 원인은 **기준 불일치**다 — 프로덕션 유출 경로는 `console.error`의 `util.inspect`인데 단언은 `JSON.stringify`로 한다.

**수정 문구 (`step2.md` 테스트 절 128–129행 교체):**

> `console.error` 인자 검사는 **`JSON.stringify`가 아니라 `util.inspect`로** 한다. `Error`의 `message`/`stack`은 non-enumerable이라 `JSON.stringify`로는 보이지 않지만 `console.error`(= `util.inspect`)로는 그대로 출력되므로, `JSON.stringify` 기준 단언은 회귀를 놓친다.
>
> ```ts
> import { inspect } from "node:util"
>
> const logged = inspect(errorSpy.mock.calls, { depth: null })
> expect(logged).not.toContain("LEAK_MARKER_MERCHANT")
> expect(logged).not.toContain("LEAK_MARKER_REPORT")
>
> // 키 화이트리스트 — 허용 집합 밖의 키가 없어야 한다
> const ALLOWED = ["analysisId", "reportType", "errorName", "statusCode", "code"]
> const [, payload] = errorSpy.mock.calls[0]
> expect(Object.keys(payload).every((k) => ALLOWED.includes(k))).toBe(true)
> ```
>
> 이 두 단언을 테스트 4·5 **양쪽 모두**에 적용한다.

AC 140에도 "`JSON.stringify`가 아니라 `util.inspect(…, { depth: null })` 기준으로 단언한다"를 명시한다.

---

## MINOR (신규)

- **N-5. `step3.md` 1번 쿼리가 키 "개수"만 돌려주는데 AC 49는 키 "이름" 4개를 요구한다.** 실제로 실행해 확인했다 — `cached_keys` 정수만 나온다. 3번의 "1번과 같은 쿼리를 다시 실행해 4개 키가 모두 남아 있는지 확인"은 그 쿼리로 불가능하다. 아래로 교체할 것(`cached_keys`와 키 이름, 4키 충족 여부를 한 번에 준다):
  ```sql
  select id, created_at,
         (select coalesce(json_agg(k order by k), '[]'::json)
            from jsonb_object_keys(coalesce(premium_reports, '{}'::jsonb)) k) as cached_key_names,
         coalesce(premium_reports, '{}'::jsonb) ?& array[
           'mom_comparison','anomaly_detection','savings_suggestions','budget_recommendation'
         ] as has_all_four
    from public.analyses
   order by created_at desc;
  ```
- **N-6. `step3.md`에 blocked 이후의 종료(close-out) 절차가 없다.** `scripts/execute.py:270-283`의 `_check_blockers`는 `__init__`에서 실행되며 blocked를 만나면 `sys.exit(2)`, `_execute_single_step`도 blocked에서 `_update_top_index("blocked")` 후 `sys.exit(2)`다. 사람이 브라우저 확인을 마친 뒤 `execute.py`를 재실행하면 다시 exit(2)이고, step 3을 `pending`으로 되돌리면 Codex가 또 브라우저를 못 열어 다시 blocked → **무한 루프**다. 「Codex가 이 step을 수행할 수 없는 경우」 절 끝에 다음을 추가할 것:
  > **사람이 확인을 마친 뒤의 마무리.** `execute.py`를 다시 실행하지 마라 — Codex는 여전히 브라우저를 열 수 없어 또 `blocked`가 된다. 대신 확인 결과를 반영해 **수동으로** `phases/7-premium-report-fix/index.json`의 step 3을 `"completed"`(+`summary`에 확인한 4키와 대상 분석 id)로, `phases/index.json`의 `7-premium-report-fix`를 `"completed"`로 바꾸고 `chore(7-premium-report-fix): mark phase completed`로 커밋한다. 확인이 실패했다면 `completed`로 바꾸지 말고 원인(예: `PGRST202`)에 해당하는 step을 `pending`으로 되돌려 재실행한다.

  덧붙여 blocked 종료 시 `_commit_step`이 호출되지 않아 `index.json` 변경이 **커밋되지 않은 채** 남는다는 점도 적어둘 것.
- **N-7. `step0.md` AC 117의 `count(*)` = **3** 하드코딩.** 계획 작성~실행 사이에 CSV 업로드가 한 건이라도 있으면 4가 되어 AC가 거짓 실패한다. "**검증 직전에 기록한 값과 동일**"로 바꿀 것(현재 값이 3이라는 것은 참고로만).
- **N-8. `step1.md` 39행의 근거 문장이 낡았다.** "전자는 원본 에러 객체를 그대로 던져 **step 2의 로깅이 원인을 볼 수 있게 한다**" — step 2는 이제 에러 객체를 로깅하지 않는다. 원본을 그대로 던지는 것 자체는 여전히 옳지만(`describeError`가 `name`/`statusCode`/`code`를 읽어야 하므로), 이 문장은 Codex를 "step 2에서 에러를 더 자세히 남겨야 한다"로 오도할 수 있다. → "전자는 원본 에러 객체를 그대로 던진다. step 2가 그 객체에서 `name`/`statusCode`/`code`만 뽑아 기록하므로(에러 객체 자체는 로깅하지 않는다), 여기서 메시지를 감싸거나 새 `Error`로 바꾸면 그 식별자가 사라진다."
- **N-9. `step2.md` AC 139의 "네 키로 한정" 표현.** `statusCode`는 없을 때 생략되므로 실제 키가 3개일 수 있고, M-4를 반영하면 `code`가 더해진다. M-4의 수정 문구가 이를 함께 해소한다.

---

## 재검증 통과 항목

| 점검 | 결과 |
|---|---|
| step0 롤백 블록이 프로덕션을 건드리지 않는가 | **통과 — 실증.** 정확한 DDL+블록 실행 후 `count=3`, `fn_exists=0`, 3행 키 집합 원상 그대로 |
| step0 AC 84가 예측한 값의 정확성 | **통과 — 실증.** `r1=t` / `first` / `merged`(qa+qa2) / `replaced`(qa 교체, qa2 보존) / `foreign=<NULL>` / `unchanged=t` 전부 일치 |
| `describeError`의 4종 구분 | `AI_APICallError`(+`statusCode`) / `TypeError` / `SyntaxError`는 **통과**. `PostgrestError`는 `name`만으로 `PGRST202` 구분 불가 → **M-4** |
| step0 절차 번호 재정렬(1~5) | **통과.** 끊긴 참조 없음. 참고 1/2 내용도 실측과 일치 |
| step2 AC 중복 | **없음.** AC 139(키 한정)와 140(마커 부재)은 관심사가 다르다 |
| step3 ↔ step0~2 작업 중복/충돌 | **없음.** step3은 파일을 만들지 않고 검증만 한다 |
| step3의 URL `/dashboard/{analysisId}` | **통과.** `src/app/(app)/dashboard/[analysisId]/page.tsx`, route group `(app)`은 URL에서 제거됨 |
| step3 실행 가능성(페이월) | **통과.** `subscriptions`의 두 사용자 모두 `status='active'` → 403에 막히지 않는다 |
| `blocked` 처리와 execute.py 상호작용 | **의도대로 동작.** blocked 시 `_update_top_index("blocked")`로 phase가 임의로 `completed`가 되지 않는다 — 올바른 안전장치. 단 close-out 절차 부재 → **N-6** |
| step1 ↔ step0 파라미터명 정합 | **통과.** step1 미변경이며 4개 키가 step0 DDL과 일치, step0 AC 71이 이를 기계적으로 대조한다 |
| `notify pgrst`의 필요성 | **통과 — 근거 보강.** postgrest-js의 `RETRYABLE_METHODS`가 GET/HEAD/OPTIONS뿐이라 POST인 `rpc`는 503 자동 재시도 대상이 아니다 |
| `phases/index.json` / phase별 `index.json` 스키마 | **통과.** step 0~3 연속 번호, 초기 필드 3개(`step`/`name`/`status`)만 존재 |

## 실행 전 필수 조치

1. **B-4** — `step3.md`에 "`cached_keys = 0`인 행을 대상으로 고른다" 기준과 그 AC를 추가한다. **이것 없이는 step 3이 헛돈다.**
2. M-4 — `describeError`에 `code` 추가(+ `details`/`hint`/`message` 금지 명시), step3의 `PGRST202` 지시와 정합시킨다.
3. M-5 — 마커 단언을 `util.inspect` + 키 화이트리스트 기준으로 바꾼다.
4. N-5~N-9도 함께 반영 권장(N-5·N-6은 step 3의 실효성에 직결).

**VERDICT: FAIL**

---
---

# 재검증 (3차) — 2026-08-10, 2차 지적 반영 후

- 대상: `step0.md`(AC 117 교체) / `step1.md`(39행 교체) / `step2.md`(`describeError`+`code`, `util.inspect` 기준) / `step3.md`(2번 신설, 번호 재정렬, blocked 마무리 절)
- 방법: 계획 재독 + 실 DB로 신규 쿼리 2건 실행 검증 + `@ai-sdk/provider`·`ai` 패키지 에러 클래스 전수 확인 + `execute.py:161-173, 270-283, 326-335` 코드 확인

**결론: PASS (BLOCKER 0건, MAJOR 0건).** 2차 지적 B-4 / M-4 / M-5는 모두 해소됐다. 남은 것은 MINOR 3건(전부 문서 정합성)과 선택적 강화 1건이며, 실행을 막을 사유는 없다.

## 1. 2차 지적 해소 여부

| 지적 | 반영 위치 | 판정 |
|---|---|---|
| **B-4** 대상 분석 미특정 | `step3.md` 30–34행(2번 신설 + `order by created_at desc limit 1` 금지 경고), AC 60·63 | **해소** |
| **M-4** `code` 누락 | `step2.md` 47–60행(`describeError`), 90행(근거), 41행(라이브러리 조언 반박), 110·112행(금지 목록), `step1.md` 39행, `step3.md` 39행·AC 64 | **해소** |
| **M-5** `JSON.stringify` 공허 통과 | `step2.md` 140–155행(`util.inspect` + 이유), 158행(테스트 5를 `PostgrestError` 유사 객체로), AC 169·171 | **해소** |
| **N-5** 키 개수 → 이름 | `step3.md` 19–28행 `string_agg(k, ',' order by k)` | **해소 — 쿼리 실행 확인** |
| **N-6** blocked 마무리 | `step3.md` 53–55행 | **부분 해소** → N-10 |
| **N-7** `count(*)`=3 하드코딩 | `step0.md` AC 117 `md5(string_agg(...))` 지문 대조 | **해소 — 쿼리 실행 확인** |
| **N-8** step1 낡은 근거 | `step1.md` 39행 | **해소** |
| **N-9** "네 키로 한정" | `step2.md` AC 168 "다섯 개의 부분집합, 허용 목록 밖 0개" | **해소** |

### B-4 해소 근거

`step3.md` 32행의 경고 블록이 실측 사실(`cb0eefa6`가 최신이면서 4키)과 메커니즘(`route.ts:59-62` 캐시 히트 → RPC 미경유 → AC 자동 통과)을 모두 담고 있고, 34행이 대상 선정 기준(`cached_keys = '(none)'`)과 "없으면 기존 행을 비우지 말고 새 업로드"까지 지정한다. AC 60이 "대상의 실행 전 `cached_keys`가 `(none)`이었음"을, AC 63이 "대상 외 다른 행의 `cached_keys`가 실행 전과 동일"을 요구한다. 공허 통과 경로가 닫혔다.

### N-5 / N-7 실행 검증

두 쿼리를 실 DB에서 실제로 실행했다.

- `step3.md` 1번 쿼리 — 키 **이름**을 정상 반환한다. `'(none)'` 대체값도 의도대로 동작해 `deffb84a`가 명확히 식별된다.
- `step0.md` AC 117 지문 쿼리 — `n=3`, `fingerprint=0b2a572bd52e16f808b21d4250cc3215`. `jsonb::text`는 키 순서가 정규화되어 있어 같은 내용이면 항상 같은 문자열이 나오므로 **지문이 결정적**이다. 검증 전후 대조가 실제로 성립한다. 행 수 하드코딩도 제거됐다.

## 2. 질문에 대한 답

### Q1. 키 화이트리스트 단언 코드가 그대로 쓸 수 있는 형태인가

**아니다 — `step2.md` 149–152행의 3줄은 삭제해야 한다.** 지적한 대로다.

```ts
expect(Object.keys(errorSpy.mock.calls[0][1]).sort()).toEqual(
  expect.arrayContaining([]), // 실제 단언은 아래 subset 검사로
)
```

`expect.arrayContaining([])`는 **모든 배열에 대해 통과**하는 no-op이고, 인라인 주석이 스스로 "실제 단언은 아래"라고 인정한다. Codex는 이 예시를 그대로 테스트에 복사할 가능성이 높고, 그러면 리뷰어가 "키 집합이 단언되어 있다"고 오해할 여지가 생긴다. 진짜 단언은 그 아래 `allowed` Set 필터 2줄이며 **그것만으로 충분하다.**

다만 화이트리스트 검사는 "**추가 키가 없음**"만 증명하고 "**필요한 키가 있음**"은 증명하지 않는다. 양성 단언을 한 줄 더하는 것을 권한다.

**수정 문구 (149–155행을 아래로 교체):**

> ```ts
> import { inspect } from "node:util"
>
> const logged = inspect(errorSpy.mock.calls, { depth: null })
> expect(logged).not.toContain("LEAK_MARKER_MERCHANT")
> expect(logged).not.toContain("LEAK_MARKER_REPORT")
>
> const payload = errorSpy.mock.calls[0][1]
> // 필요한 값이 실제로 남았는지(양성) — 화이트리스트만으로는 빈 객체도 통과한다
> expect(payload.errorName).toBe("AI_APICallError")
> expect(payload.statusCode).toBe(500)
> // 허용된 5개 외의 키가 하나도 없어야 한다(음성)
> const allowed = new Set(["analysisId", "reportType", "errorName", "statusCode", "code"])
> expect(Object.keys(payload).filter((k) => !allowed.has(k))).toEqual([])
> ```
>
> (테스트 5에서는 양성 단언을 `expect(payload.errorName).toBe("PostgrestError")` / `expect(payload.code).toBe("PGRST202")`로 바꾼다.)

### Q2. `describeError`에 `code`를 추가한 것이 새 유출 경로를 만드는가

**만들지 않는다.** 이 라우트에 도달할 수 있는 에러를 전수 확인했다.

| 경로 | `code` 존재 | 값의 성질 |
|---|---|---|
| `APICallError`(`@ai-sdk/provider`) | **없음** — `grep "readonly code\|this.code" node_modules/@ai-sdk/provider/dist/index.d.ts` 결과 **0건** | — |
| `ai` 패키지 에러 22종(`NoObjectGeneratedError`, `RetryError`, `InvalidArgumentError` …) | **없음** — 전부 `AISDKError` 파생이고 `code` 필드 없음 | — |
| `TypeError`(리포트 검증 실패), `SyntaxError`(`JSON.parse`) | 없음 | — |
| undici `fetch failed` | 최상위엔 없음. `code`(`ECONNREFUSED` 등)는 **`cause` 안**에 있고 `describeError`는 `cause`를 보지 않는다 | — |
| `PostgrestError` | 있음 | `PGRST202`·`PGRST301`(PostgREST 고정 코드) 또는 `23503`·`42501`(5자 SQLSTATE). **데이터가 실릴 자리가 아니다** |
| `Error("Analysis not found")`, `Error("SUPABASE_SERVICE_ROLE_KEY is required")` | 없음 | — |

데이터를 담는 필드(`details`/`hint`/`message`/`requestBodyValues`/`responseBody`)는 전부 금지 목록(`step2.md` 109–110행)에 있고, `code`는 32자 절단으로 상한이 걸려 있다. **새 유출 경로 없음.**

> **선택적 강화(필수 아님).** `describeError`는 `code`를 오리 타이핑으로 읽으므로, 장래에 어떤 라이브러리가 `code`에 데이터를 넣으면 32자까지는 새어 나갈 수 있다. 형식 가드를 걸면 그 여지도 닫힌다:
> ```ts
> ...(typeof code === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(code) ? { code } : {}),
> ```
> `PGRST202` / `23503` / `ECONNRESET` 같은 실제 코드는 모두 통과하고, 공백·한글·따옴표가 섞인 문장은 걸러진다.

### Q3. step3 번호 재정렬로 끊긴 참조 / blocked 절차의 정확성

**끊긴 참조 2건 있다 → N-11, N-12.** blocked 절차 자체는 `execute.py` 동작과 **정확히 일치**한다.

`execute.py` 실제 동작을 코드로 확인했다:
- `_check_blockers`(`:270-283`) — `__init__`에서 호출(`:85`), `blocked` step을 만나면 `"Resolve and reset status to 'pending' to retry."` 출력 후 `sys.exit(2)`. → step3.md 55행의 "다시 돌리지 말고 손으로 `completed`로 바꿔라"가 옳다.
- `_execute_single_step`(`:326-335`) — `blocked` 시 `blocked_at` 기록 → `_update_top_index("blocked")` → `sys.exit(2)`. `_commit_step`은 호출되지 않으므로 `index.json` 변경이 **커밋되지 않은 채** 남는다.
- `pending`으로 되돌려 재실행하면 Codex가 또 브라우저를 못 열어 다시 blocked → 55행의 "무한 루프" 서술도 정확하다.

## MINOR (신규 / 잔여)

- **N-10. blocked 마무리 절차가 최상위 `phases/index.json`을 빼먹었다.** `_update_top_index("blocked")`(`execute.py:161-173`)는 `phases/index.json`의 `7-premium-report-fix`에 `status: "blocked"` + `blocked_at`을 쓴다. `step3.md` 55행은 **phase 내부** `index.json`만 고치라고 해서, 최상위는 영구히 `blocked`로 남아 진행률 기록이 틀어진다. (전례가 있다 — `phases/index.json`의 `0-db-schema`에 `blocked_at`과 `completed_at`이 **둘 다** 남아 있다.) 55행에 다음을 덧붙일 것:
  > 함께 `phases/index.json`의 `7-premium-report-fix`도 `"status": "completed"`(+`completed_at`)로 바꾼다 — `_update_top_index("blocked")`가 최상위에도 `blocked`를 써 놓기 때문이다. 그리고 blocked 종료 시에는 `_commit_step`이 호출되지 않아 `index.json` 변경이 커밋되지 않은 상태이므로, 손으로 수정한 뒤 `chore(7-premium-report-fix): mark phase completed`로 함께 커밋한다.
- **N-11. `step3.md` 46행 "위 `2~4번` 확인 절차 전문" — 번호가 낡았다.** 2번 신설로 사람이 수행할 절차가 2~**5**번이 됐다. 현재 문구는 **5번(서버 로그의 `[reports] 리포트 캐시 저장 실패` / `code` 확인)을 인수인계에서 누락**시킨다 — M-4로 어렵게 확보한 `PGRST202` 진단 경로가 정작 blocked_reason에서 빠진다. → `위 2~5번 확인 절차 전문`으로 정정.
- **N-12. `step3.md` 45행 "각 행의 캐시 키 `개수`" — N-5 반영과 어긋난다.** 1번 쿼리는 이제 이름을 돌려주고 AC 59도 "키 **이름 목록**"을 요구한다. → `각 행의 캐시 키 이름 목록`으로 정정.

## 3차 재검증 통과 항목

| 점검 | 결과 |
|---|---|
| B-4 해소 | **통과.** 대상 선정 기준 + 금지 경고 + AC 2건으로 공허 통과 경로 차단 |
| M-4 해소 | **통과.** `code` 추가, `PostgrestError`의 `name` 고정·`statusCode` 부재 근거 명시, 라이브러리의 "Always log the full object" 조언을 명시적으로 반박, `details`/`hint`/`message` 금지, step1·step3과 정합 |
| M-5 해소 | **통과.** `util.inspect` 기준 + non-enumerable 근거 + 테스트 5를 `PostgrestError` 유사 객체로 교체 → 이제 통째 로깅 회귀를 실제로 잡는다 |
| `code` 추가의 신규 유출 여부 | **통과.** AI SDK 에러 전 클래스에 `code` 없음(전수 확인), `PostgrestError.code`는 고정 식별자, undici `code`는 `cause` 안, 32자 절단 |
| step0 지문 AC의 실행 가능성·결정성 | **통과 — 실증.** `n=3`, `fingerprint=0b2a572bd52e16f808b21d4250cc3215`, `jsonb::text` 정규화로 결정적 |
| step3 1번 쿼리 | **통과 — 실증.** 키 이름 반환, `'(none)'` 동작 정상 |
| blocked 절차 ↔ `execute.py` | **통과.** exit(2), 재실행 금지, 무한 루프 서술 모두 코드와 일치. 최상위 index.json만 누락 → N-10 |
| step1 ↔ step2 ↔ step3 `code` 계약 | **통과.** step1이 `PostgrestError`를 감싸지 않고 그대로 던지고 → step2가 `name`+`code`만 뽑고 → step3이 `code`로 `PGRST202`를 판별한다. 세 step이 같은 것을 가정한다 |
| step2 허용 키 집합 정합 | **통과.** 코드(58행) ↔ 주석(71행) ↔ 금지 목록(112행) ↔ AC 168 ↔ 테스트 화이트리스트(153행)가 모두 5키로 일치 |
| step0~3 AC 중복/모순 | **없음** |
| step 번호·크기·순서, `phases/index.json` 등록 | **통과**(1차·2차와 동일) |
| 1차·2차 지적 전체 | **전부 반영 확인** — 미반영 지적 없음 |

## 실행 판단

BLOCKER·MAJOR 없음. **N-10~N-12는 전부 step3.md의 문서 정합성 문제이고, step3는 어차피 `blocked`로 사람 손에 넘어갈 step이므로 실행을 막지 않는다.** 다만 N-11(로그 확인 절차 누락)은 인수인계 품질에 직결되므로 실행 전 한 줄 고치는 편이 낫다. Q1의 no-op 단언 3줄도 실행 전 삭제를 권한다(실행 후에는 코드 검증에서 다시 지적하게 된다).

**VERDICT: PASS**
