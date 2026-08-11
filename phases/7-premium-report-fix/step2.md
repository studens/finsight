# Step 2: reports 라우트 에러 처리 — catch{} 제거 + 캐시 쓰기 실패 분리

## 작업

대상 파일: `src/app/api/reports/[analysisId]/[reportType]/route.ts`

현재 코드의 마지막 부분이 이렇다:

```ts
let report
try {
  report = await generateReport({ reportType, current, previous })
} catch {
  return NextResponse.json({ code: "GENERATION_FAILED" }, { status: 502 })
}

await upsertPremiumReport({ userId: user.id, analysisId, reportType, report })

return NextResponse.json({ reportType, data: report })
```

문제가 둘이다.

**(1) `catch {}`가 에러를 통째로 삼킨다.** 에러 종류·메시지·스택이 전부 사라져 프로덕션에서 502가 왜 났는지 알 방법이 없다. 실제로 이 phase의 원인 특정에 LLM 재호출 10회와 DB 직접 조회가 필요했던 이유가 이것이다.

**(2) `upsertPremiumReport`가 try/catch 밖에 있다.** 캐시 쓰기가 실패하면 처리되지 않은 예외가 Next.js까지 올라가 **500이 나가고, 이미 6~21초 들여 생성한 리포트가 응답에도 담기지 못한 채 버려진다.**

### 에러 객체를 로그에 그대로 넘기지 마라 (이 step에서 가장 중요한 제약)

`generateReport`가 던지는 Vercel AI SDK `APICallError`는 다음을 **enumerable own property로** 갖고 있다 (`node_modules/@ai-sdk/provider/dist/index.d.ts:672-694`):

- `requestBodyValues: unknown` — 프로바이더로 보낸 **요청 본문 = 프롬프트**
- `responseBody?: string` — **모델 원문 = 리포트 본문**

그리고 프롬프트에는 거래 데이터가 들어 있다 — `src/services/llm/reports/anomaly-detection.ts:51`이 `JSON.stringify(current.maskedTransactions)`를 프롬프트에 넣는다(4개 리포트 동일 패턴). 추가로 `JSON.parse(text)` 실패 시의 `SyntaxError`는 V8이 메시지 안에 **모델이 생성한 리포트 본문 조각**을 넣는다. `console.error("...", { error })`는 Node의 `util.inspect`로 이들을 전부 직렬화한다.

즉 에러 객체를 통째로 넘기면 "원본 CSV는 어떤 형태로도(로그 포함) 영구 저장하지 않는다"는 CRITICAL 규칙을 위반한다. **허용 목록 방식으로 요약해서만** 기록한다.

두 가지를 다음과 같이 고친다:

> **`@supabase/postgrest-js`의 `PostgrestError.ts` 주석은 "Always log the full object (e.g. `console.error(error)`)"를 권한다. 이 프로젝트에서는 그 조언을 따르지 마라.** 같은 문서가 `details`를 "often the offending value, key, or row"라고 설명하는데, 여기서 그 값은 `p_report`(= 리포트 본문)다. `hint`/`details`/`message`는 로그에 넣지 않는다.

```ts
// 에러 객체에는 프롬프트(requestBodyValues)·모델 원문(responseBody)·
// 파싱 실패 입력 조각·PostgrestError의 details(=offending value)가 실릴 수 있어,
// 종류를 식별하는 최소 필드만 허용 목록으로 뽑아 남긴다.
function describeError(error: unknown): {
  errorName: string
  statusCode?: number
  code?: string
} {
  if (!(error instanceof Error)) return { errorName: "UnknownError" }
  const statusCode = (error as { statusCode?: unknown }).statusCode
  const code = (error as { code?: unknown }).code
  return {
    errorName: error.name,
    ...(typeof statusCode === "number" ? { statusCode } : {}),
    ...(typeof code === "string" ? { code: code.slice(0, 32) } : {}),
  }
}

let report
try {
  report = await generateReport({ reportType, current, previous })
} catch (error) {
  console.error("[reports] 리포트 생성 실패", {
    analysisId: analysisId.slice(0, 64),
    reportType,
    ...describeError(error),
  })
  // 로그 인자는 analysisId / reportType / errorName / statusCode? / code? 로 한정된다.
  return NextResponse.json({ code: "GENERATION_FAILED" }, { status: 502 })
}

try {
  await upsertPremiumReport({ userId: user.id, analysisId, reportType, report })
} catch (error) {
  console.error("[reports] 리포트 캐시 저장 실패", {
    analysisId: analysisId.slice(0, 64),
    reportType,
    ...describeError(error),
  })
}

return NextResponse.json({ reportType, data: report })
```

이 세 필드로 이 phase가 원했던 구분이 전부 가능하다 — 프로바이더 5xx/429(`errorName: "AI_APICallError"` + `statusCode`) vs 리포트 검증 실패(`TypeError`) vs 모델 출력 파싱 실패(`SyntaxError`) vs DB 오류(`PostgrestError` + `code`).

**`code`가 반드시 필요한 이유:** `PostgrestError`는 `name`이 `'PostgrestError'`로 **고정**이고 `statusCode` 프로퍼티가 **없다**(`node_modules/@supabase/postgrest-js/src/PostgrestError.ts`). `PGRST202`(함수 못 찾음 — step 0의 스키마 캐시/파라미터명 문제), `42501`(권한), `23503`(FK)을 가르는 유일한 필드가 `code`다. 이게 없으면 step 3에서 RPC 왕복 실패의 원인을 특정할 수 없다. 같은 파일의 `isUnknownUserError`(`src/services/supabase-admin/index.ts:83-89`)가 이미 `.code`로 분기하므로 코드베이스 관례와도 일관된다.

`analysisId`는 화이트리스트 검증을 거치지 않은 사용자 입력이므로 길이를 절단해 넣는다(`reportType`은 이미 `isReportType`으로 검증됨). `code`도 방어적으로 32자 절단한다.

설계 근거 — 임의로 바꾸지 말 것:

- **502 `GENERATION_FAILED` 응답 계약은 그대로 유지한다.** 프론트엔드(`PremiumSection`, `useApiError`)가 이 코드에 의존한다. 이 step은 **관측 가능성만** 추가하고 계약은 건드리지 않는다.
- **캐시 쓰기 실패는 응답을 실패시키지 않는다.** 생성은 이미 성공했으므로 사용자에게 리포트를 정상 반환하는 것이 맞다. 캐시가 비었으면 다음 조회 때 재생성될 뿐이고, 여기서 5xx를 내면 성공한 작업을 실패로 뒤집는 셈이다.
- **캐시 쓰기 실패를 조용히 넘기지 않는다.** 반드시 `console.error`로 남긴다 — 로그가 없으면 "왜 캐시가 계속 비어 있지"를 다시 추적할 수 없게 되어 이 phase가 고치려는 문제를 되풀이한다.
- **소유권 실패까지 200으로 삼키는 것이 안전한 이유.** `upsertPremiumReport`가 던지는 `"Analysis not found"`는 RPC의 `user_id` 술어가 0행을 갱신했다는 뜻이다. 그런데 이 라우트는 이미 `route.ts:50`에서 `getAnalysisById` + `analysis.user_id !== user.id`로 소유권을 선검증했으므로, 여기 도달한다는 것 자체가 버그이거나 그 사이 분석이 삭제된 경우다. **남의 데이터가 써진 것이 아니라 아무것도 안 써진 상태**이므로 200으로 두어도 데이터 노출은 없다. 다만 이 경우가 로그에서 구분되도록 `errorName`을 반드시 남긴다.
- 인증·소유권·페이월·캐시 히트 등 **이 블록 위쪽의 모든 분기는 건드리지 않는다.**

### 로그에 넣지 말 것 (CRITICAL)

원본 CSV·PII는 어떤 형태로도 영구 저장하지 않으며 **로그도 저장 수단에 포함된다.** 따라서 로그에 다음을 넣지 않는다:

- `current` / `maskedTransactions` / `analysis` 객체 전체 또는 그 일부 거래 데이터
- `free_summary`, 생성된 `report` 본문
- 사용자 이메일 등 신원 식별 값
- **에러 객체 자체, `error.message`, `error.stack`** — 위에서 설명한 대로 이들이 프롬프트·모델 원문의 유출 경로다
- **`PostgrestError`의 `details` / `hint` / `message`** — `details`는 라이브러리 문서상 "offending value, key, or row"이며 여기서는 `p_report`(리포트 본문)다

로그에 넣는 값은 `analysisId`(절단), `reportType`, `errorName`, 그리고 있을 때만 `statusCode`·`code`(절단)로 한정한다. **이 5개 키 외의 어떤 필드도 넣지 않는다.**

## 테스트 (먼저 작성한다 — TDD)

`src/app/api/reports/[analysisId]/[reportType]/route.test.ts`에 다음을 추가한다. 기존 테스트(401/404/403/캐시 히트/정상 생성)는 **그대로 통과해야 한다.**

1. **생성 실패 시 로깅** — `generateReport`가 throw하면 응답이 502 `{ code: "GENERATION_FAILED" }`이고 `console.error`가 호출된다. `vi.spyOn(console, "error")`로 단언하고, 넘겨진 객체에 `reportType`과 `errorName`이 포함되는지 확인한다.
2. **캐시 쓰기 실패해도 200** — `generateReport`는 성공하고 `upsertPremiumReport`가 throw하는 상황에서 응답이 **200이고 body의 `data`가 생성된 리포트와 같다.** (현재 코드는 여기서 500이 나므로 이 테스트가 회귀 방지선이 된다.)
3. **캐시 쓰기 실패 시 로깅** — 2번 상황에서 `console.error`가 호출된다.
4. **로그에 프롬프트·모델 원문이 새지 않는다 (B-1 회귀 방지)** — 공유 픽스처 `analysis()`(`route.test.ts:49`)는 **수정하지 않는다.** `route.test.ts:158`의 "lazy-generates" 테스트가 `current.maskedTransactions` 기대값으로 같은 값을 하드코딩하고 있어 픽스처를 고치면 그 테스트가 함께 깨진다. 대신 **이 테스트 안에서만** 다음처럼 덮어쓴다:

   ```ts
   getAnalysisById.mockResolvedValue({
     ...analysis(),
     masked_transactions: [
       { card: "****1234", amount: "12000", merchant: "LEAK_MARKER_MERCHANT" },
     ],
   })
   generateReport.mockRejectedValue(
     Object.assign(new Error("api failed"), {
       name: "AI_APICallError",
       statusCode: 500,
       requestBodyValues: { prompt: "LEAK_MARKER_MERCHANT 12000원" },
       responseBody: "LEAK_MARKER_REPORT",
     }),
   )
   ```

   단언 기준은 **`JSON.stringify`가 아니라 `util.inspect`다.** `Error`의 `message`/`stack`은 non-enumerable이므로 `JSON.stringify({ error: new Error("LEAK_MARKER_REPORT") })`는 `{"error":{}}`가 되어 **에러 객체를 통째로 로깅하는 회귀가 나도 테스트가 통과한다.** 반면 프로덕션의 실제 유출 경로는 `console.error`가 쓰는 `util.inspect`다. 따라서 다음 두 단언을 **병행**한다:

   ```ts
   import { inspect } from "node:util"

   const logged = inspect(errorSpy.mock.calls, { depth: null })
   expect(logged).not.toContain("LEAK_MARKER_MERCHANT")
   expect(logged).not.toContain("LEAK_MARKER_REPORT")

   const payload = errorSpy.mock.calls[0][1]

   // (a) 음성 단언 — 허용된 5개 외의 키가 하나도 없다
   const allowed = new Set(["analysisId", "reportType", "errorName", "statusCode", "code"])
   expect(Object.keys(payload).filter((k) => !allowed.has(k))).toEqual([])

   // (b) 양성 단언 — 진단에 필요한 값이 실제로 들어 있다
   expect(payload.errorName).toBe("AI_APICallError")
   expect(payload.statusCode).toBe(500)
   ```

   (a)만으로는 "추가 키가 없다"만 증명되고 로그가 텅 비어도 통과한다. (b)를 반드시 함께 넣는다. 테스트 5에서는 `errorName`이 `"PostgrestError"`, `code`가 `"PGRST202"`임을 단언한다.

   평범한 `new Error()`를 던지는 테스트로는 이 유출을 잡을 수 없다 — 목킹된 에러에 애초에 프롬프트가 실리지 않기 때문이다. **반드시 위 `Object.assign` 형태의 객체를 써야 한다.**
5. **캐시 쓰기 에러에도 같은 단언** — `upsertPremiumReport`가 `message`에 `LEAK_MARKER_REPORT`를 담은 `PostgrestError` 유사 객체(`Object.assign(new Error("LEAK_MARKER_REPORT"), { name: "PostgrestError", code: "PGRST202", details: "LEAK_MARKER_REPORT", hint: "LEAK_MARKER_REPORT" })`)를 던지는 경우에도, `inspect` 기준으로 마커가 없고 `code`는 `"PGRST202"`로 남는다.

테스트에서 `console.error`를 스파이할 때는 `afterEach`에서 반드시 복원해 다른 테스트 출력에 영향을 주지 않게 한다. 기존 502 테스트(`route.test.ts:203`)도 이제 `console.error`를 실행하게 되므로, **그 테스트에도 스파이를 걸어** 테스트 출력이 오염되지 않게 한다.

## Acceptance Criteria

- [ ] `route.ts`에 인자 없는 `catch {`가 **하나도 없다**. 생성 실패 catch가 에러를 바인딩해 `console.error`로 기록한다.
- [ ] 생성 실패 시 응답이 여전히 **502 `{ code: "GENERATION_FAILED" }`**다(기존 계약 유지). 상태코드나 code 문자열을 바꾸지 않았다.
- [ ] `upsertPremiumReport` 호출이 **자체 try/catch 안에** 있고, 그 실패가 응답을 5xx로 바꾸지 않는다 — 캐시 쓰기가 throw해도 **200과 생성된 리포트 본문**이 반환되는 테스트가 통과한다.
- [ ] 캐시 쓰기 실패가 `console.error`로 기록되는 테스트가 통과한다(조용히 삼키지 않는다).
- [ ] `console.error`에 전달되는 객체의 키가 `analysisId`, `reportType`, `errorName`, `statusCode`, `code` **다섯 개의 부분집합**이며(허용 목록 밖의 키가 0개), **에러 객체 자체·`error.message`·`error.stack`·`details`·`hint`를 넘기지 않는다.**
- [ ] 유출 단언이 **`util.inspect` 기준**으로 작성되었다(`JSON.stringify` 단독 사용 금지 — `Error.message`/`stack`이 non-enumerable이라 통째 로깅 회귀를 놓친다).
- [ ] `requestBodyValues`와 `responseBody`를 가진 `APICallError` 형태의 객체를 `generateReport`가 던지는 테스트에서 `LEAK_MARKER_MERCHANT`·`LEAK_MARKER_REPORT`가 **둘 다** 로그에 없음이 단언된다.
- [ ] `upsertPremiumReport`가 `message`/`details`/`hint`에 리포트 조각을 담은 `PostgrestError` 유사 객체를 던지는 테스트에서도 마커가 로그에 없고, `code`는 정상적으로 기록된다.
- [ ] 공유 픽스처 `analysis()`(`route.test.ts:49`)와 `route.test.ts:158`의 `current.maskedTransactions` 기대값이 **수정되지 않았다**(테스트 내 지역 오버라이드만 사용).
- [ ] 401(미인증) / 404(잘못된 reportType·타인 소유·없는 분석) / 403 `PAYWALL_REQUIRED`(미구독) / 캐시 히트 경로의 기존 테스트가 전부 그대로 통과한다. 특히 **미구독 사용자 요청 시 `generateReport`가 호출되지 않고 403이 즉시 반환되는** 기존 단언이 유지된다.
- [ ] `npm run typecheck` 통과, `npm run lint` 0 errors, `npm run test` 전부 통과.
