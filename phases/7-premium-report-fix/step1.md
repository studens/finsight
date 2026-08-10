# Step 1: upsertPremiumReport를 RPC 호출로 교체 — 읽고-쓰기 제거

## 작업

`src/services/supabase-admin/index.ts`의 `upsertPremiumReport`가 현재 하는 일:

1. `analyses`에서 `user_id, premium_reports`를 `select ... single()`로 읽는다
2. JS에서 소유권을 비교하고 기존 객체를 spread한다
3. 병합된 객체 전체를 `update`한다

이 3단계를 **step 0에서 만든 `merge_premium_report` RPC 호출 한 번으로 교체**한다. 읽기(1)와 JS 병합(2)은 완전히 제거한다 — 그 둘이 존재하는 한 두 요청 사이에 끼어드는 경쟁이 남는다.

교체 후 구현:

```ts
export async function upsertPremiumReport(input: {
  userId: string
  analysisId: string
  reportType: ReportType
  report: PremiumReport
}): Promise<void> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc("merge_premium_report", {
    p_analysis_id: input.analysisId,
    p_user_id: input.userId,
    p_report_type: input.reportType,
    p_report: input.report as unknown as Json,
  })

  if (error) throw error
  if (data !== true) throw new Error("Analysis not found")
}
```

지켜야 할 것:

- **함수 시그니처(파라미터 객체 4개 필드, `Promise<void>`)를 바꾸지 않는다.** 호출부는 step 2에서 별도로 다루며, 이 step에서 호출부 시그니처를 바꾸면 두 step이 서로 얽힌다.
- **`"Analysis not found"` 에러 메시지와 던지는 조건(소유자가 아니거나 존재하지 않는 분석)을 유지한다.** RPC가 0행을 갱신하면 `null`을 반환하므로 `data !== true`가 그 조건이다.
- **DB 오류(`error`)와 소유권 실패(`data !== true`)를 구분해서 던진다.** 전자는 `PostgrestError`를 그대로 던진다 — step 2가 그 객체에서 `name`과 `code`만 뽑아 로깅하며(에러 객체 자체는 로깅하지 않는다), `code`가 `PGRST202`인지 여부로 "함수를 못 찾음"과 "일시적 DB 오류"를 구분한다. 여기서 에러를 감싸거나 메시지를 재작성하면 그 `code`가 사라진다.
- 같은 파일의 `insertAnalysis`, `upsertSubscriptionStatus`, `isUnknownUserError`는 **건드리지 않는다.**

## 테스트 (먼저 작성한다 — TDD)

`src/services/supabase-admin/index.test.ts`의 기존 `upsertPremiumReport` 테스트는 `select`/`update` 체인을 목킹하고 있어 이 변경으로 **반드시 깨진다**. 기존 테스트를 지우지 말고 RPC 기반으로 **재작성**한다. 재작성 시 다음을 포함한다:

1. 성공 경로 — `supabase.rpc`가 `{ data: true, error: null }`을 반환하면 resolve하고, `rpc`가 **정확히 `("merge_premium_report", { p_analysis_id, p_user_id, p_report_type, p_report })` 인자로 1회** 호출된다.
2. 소유권 실패 — `{ data: null, error: null }`이면 `"Analysis not found"`로 reject한다.
3. DB 오류 — `{ data: null, error }`이면 **그 `error` 객체 자체**로 reject한다(`rejects.toBe(error)`).
4. **회귀 방지(이 phase의 핵심)** — `createServiceClient` 목의 `from`이 **한 번도 호출되지 않음**을 단언한다. `from`이 호출되지 않는다는 것은 읽고-쓰기(select → update) 경로가 코드에서 사라졌다는 뜻이며, 이 단언이 경쟁 상태의 재발을 막는 회귀 테스트다. 이 테스트를 반드시 포함한다.

## Acceptance Criteria

- [ ] `upsertPremiumReport`가 `supabase.rpc("merge_premium_report", ...)`를 호출하며, 이 함수 본문에 `.from("analyses")`나 `.select(`가 **하나도 없다**. (읽고-쓰기 제거 확인 — `grep`으로 검증 가능해야 한다.)
- [ ] `rpc`에 넘기는 인자 키가 정확히 `p_analysis_id`, `p_user_id`, `p_report_type`, `p_report` 4개다(step 0의 함수 파라미터명과 일치해야 하며, 하나라도 다르면 런타임에 함수를 찾지 못한다).
- [ ] 소유권 검증이 유지된다 — 호출자가 넘긴 `userId`가 RPC의 `p_user_id`로 그대로 전달되고, 갱신 행이 없으면 `"Analysis not found"`가 던져지는 테스트가 통과한다. (DB 쓰기는 service-role로 하되 소유권은 코드가 직접 검증한다는 CRITICAL 규칙을 이 경로가 계속 만족한다.)
- [ ] DB 오류가 원본 에러 객체 그대로 전파되는 테스트가 통과한다(`rejects.toBe(error)`).
- [ ] **`from`이 호출되지 않음을 단언하는 회귀 테스트**가 존재하고 통과한다.
- [ ] `insertAnalysis` / `upsertSubscriptionStatus` / `isUnknownUserError`의 구현과 기존 테스트가 변경되지 않았다.
- [ ] `npm run typecheck` 통과, `npm run lint` 0 errors, `npm run test` 전부 통과.
