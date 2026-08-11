# Step 1: `merge_premium_report`의 `Returns` 타입을 `boolean | null`로 정정한다

## 배경

`supabase/migrations/20260810173000_create_merge_premium_report.sql`의 함수는 `returns boolean`이지만, **소유자가 아니거나 존재하지 않는 analysis id면 0행이 갱신되어 `returning true`가 아무 행도 내지 않고 함수는 `null`을 반환한다.** 이것은 버그가 아니라 의도된 설계다 — 소유권 검증을 SQL 술어에 두고, 0행이면 호출부가 `"Analysis not found"`로 처리한다.

문제는 타입이다. `src/types/database.ts`(80행)는 `Returns: boolean`으로 **null을 표현하지 않는다.** 즉 타입이 런타임 계약과 불일치한다. `src/services/supabase-admin/index.ts`의 `if (data !== true) throw new Error("Analysis not found")`는 런타임에는 옳게 동작하지만, 타입 관점에서는 "절대 일어날 수 없는 비교"로 보인다. 이 상태로는 나중에 누가 `data`를 `boolean`으로 신뢰해 `if (!data)` 대신 `if (data === false)` 같은 코드를 쓰거나, 린터/컴파일러가 불필요한 비교라고 판단해 제거를 유도할 수 있다.

## 작업

1. **`src/types/database.ts`의 `Functions.merge_premium_report.Returns`를 `boolean | null`로 수정한다.** `Args`는 건드리지 않는다(현재 `p_analysis_id`, `p_report`, `p_report_type`, `p_user_id` 4개가 정확하다).

2. **`src/services/supabase-admin/index.ts`의 `upsertPremiumReport`는 로직을 바꾸지 않는다.** `if (error) throw error` → `if (data !== true) throw new Error("Analysis not found")` 순서와 메시지를 그대로 유지한다. 타입만 정직해지면 이 코드는 그대로 옳다. **`data`가 null일 가능성을 없애려고 `!` non-null assertion이나 `as boolean` 캐스팅을 넣지 마라** — 그것은 타입 거짓을 다른 위치로 옮기는 것일 뿐이다.

3. **null 반환 경로 테스트를 추가한다.** `src/services/supabase-admin/index.test.ts`에 RPC가 `{ data: null, error: null }`을 반환하는 케이스를 넣고 `upsertPremiumReport`가 `"Analysis not found"` 메시지로 reject하는지 검증한다. 이 케이스가 이미 있다면 중복 추가하지 말고, `data: null`(0행)과 `data: false`가 **둘 다** `"Analysis not found"`가 되는지 확인하는 형태로 보강한다.

4. `src/types/database.ts`는 원래 Supabase가 생성하는 파일이지만 이 프로젝트에서는 손으로 관리하고 있다. 파일 상단에 생성 파일임을 알리는 주석이 있다면 유지하고, 이번 수정이 수동 정정임을 알 수 있게 `Returns` 옆에 **한국어 한 줄 주석**으로 이유를 남긴다(예: 0행 갱신 시 null 반환).

## Acceptance Criteria

- [ ] `src/types/database.ts`의 `merge_premium_report.Returns`가 `boolean | null`이다.
- [ ] `src/services/supabase-admin/index.ts`의 `upsertPremiumReport` 본문에 `as boolean`, `as unknown as boolean`, `data!` 같은 캐스팅/non-null assertion이 **없다**. `p_report`에 원래 있던 `as unknown as Json` 캐스팅은 이번 작업 대상이 아니므로 그대로 둔다.
- [ ] `src/services/supabase-admin/index.test.ts`에서 RPC가 `data: null, error: null`을 반환할 때 `upsertPremiumReport`가 `"Analysis not found"`로 reject하는 테스트가 통과한다.
- [ ] 같은 테스트 파일에서 RPC가 `error`를 반환하면 **그 원본 에러 객체가 그대로 throw**되는(메시지를 갈아치우지 않는) 기존 동작이 여전히 통과한다.
- [ ] SQL 마이그레이션 파일은 이 step에서 **수정하지 않는다** — 함수 시그니처(`returns boolean`)는 그대로다. Postgres의 `returns boolean`은 nullable이므로 SQL 쪽은 이미 정확하고, 고칠 대상은 TypeScript 타입뿐이다.
- [ ] `npm run typecheck` 통과, `npm run lint` 소스 코드 0 errors, `npm run test` 전부 통과.
