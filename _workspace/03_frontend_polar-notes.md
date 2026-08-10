# frontend 계획 노트 — Polar 결제 화면 (phase 6-polar-billing, step 3)

> 계획 파일: `phases/6-polar-billing/step3.md`.
> 의존: step 1 `POST /api/checkout`(api-routes), step 2 웹훅, `ui-design` 스킬,
> core-services 계약 `_workspace/02_core-services_polar-interface.md`.
>
> ⚠️ `_workspace/`는 Codex 프리앰블에 자동 주입되지 않는다. 이 문서의 결정 사항 중
> Codex가 알아야 하는 것은 이미 `step3.md` 본문에 복사해 넣었다.

## 1. 이 step이 만드는 것

| 파일 | 상태 |
|---|---|
| `src/components/PremiumSection.tsx` | 수정 — 잠금 CTA에 `POST /api/checkout` 연결 |
| `src/components/CheckoutSuccessBanner.tsx` | 신규 — 결제 복귀 안내 배너(Client) |
| `src/app/(app)/dashboard/page.tsx` | 수정 — `searchParams` 수신 + 배너 렌더 |
| `src/components/PremiumSection.test.tsx` | 수정 — 기존 테스트 1개 분해 |
| `src/components/CheckoutSuccessBanner.test.tsx` | 신규 |
| `src/components/DashboardPages.test.tsx` | 수정 — 호출 시그니처 |
| `docs/BROWSER-TEST-SCENARIOS.md` / `docs/ARCHITECTURE.md` | 갱신 |

`/dashboard/[analysisId]`는 건드리지 않는다. Polar 복귀 URL은 `/dashboard` 하나뿐이다.

## 2. 결제 복귀 타이밍 — 채택안과 근거

**문제.** 체크아웃 성공 시 두 경로가 경쟁한다.
- A(브라우저): Polar 확인 화면 → 302 → `GET /dashboard` → 서버 렌더 시 `getSubscriptionStatus` 조회
- B(서버-서버): Polar → `POST /api/webhooks/polar` → `subscriptions.status = 'active'`

A가 이기면 방금 결제한 사용자가 잠금 화면을 본다.

**채택.** 서버가 `?checkout=success`를 보고 **안내 배너 1회 렌더**. 폴링·자동 refresh·refresh 버튼 전부 없음.
문구는 서버가 이미 계산한 `isSubscribed`로 두 갈래:
- `true`: "결제가 완료됐어요. **아래 업로드 이력에서 분석을 열면** Premium 리포트를 확인할 수 있어요." (강조선 `#05b169`)
- `false`: "결제가 완료됐어요. 구독 반영까지 몇 초 걸릴 수 있어요. … 잠시 후 페이지를 새로고침해 주세요." (강조선 `#5b8bff`)

`true` 문구가 이력을 가리키는 이유(QA MINOR-9 반영): 복귀 지점은 `/dashboard`인데 Premium 잠금 카드는 `/dashboard/[analysisId]`에 있다. 배너 바로 아래 `HistoryList`가 이미 렌더되므로 도달 경로는 존재하고, **문구 한 줄로 그 한 칸을 가리켜** 링크·버튼 신설 없이 동선 공백을 메운다.

**기각한 대안과 이유.**

| 대안 | 기각 사유 |
|---|---|
| 폴링/`setInterval` 재검증 | `docs/ARCHITECTURE.md`의 "폴링·Realtime 구독 없음 — 요청/응답 안에서 끝나는 동기 모델" 전제를 이 화면 하나 때문에 깬다. 타이머 + 재시도 횟수 + 포기 조건이라는 상태 기계가 새로 생기고 테스트가 fake timer에 의존한다. |
| 자동 `router.refresh()` 1회 | 배너는 서버가 `searchParams`로 렌더하는데 URL의 `?checkout=success`를 지우므로, refresh가 돌면 **배너 자신이 사라진다.** 읽던 안내가 사라지는데 여전히 잠겨 있는 상태가 만들어진다. 게다가 페이지가 방금 렌더된 직후의 refresh는 얻는 것도 거의 없다. |
| "구독 상태 새로고침" 버튼 | 위와 같은 이유로 클릭 즉시 배너가 사라진다. 동작이 브라우저 새로고침과 동일해, 문구 한 줄로 대체 가능한 UI를 새로 만드는 셈. |

**보강 근거.** 실제로는 대부분 B가 먼저 끝난다(B는 서버 직통, A는 브라우저가 Polar 확인 화면을 거쳐 왕복). 즉 `false` 분기는 상시 경로가 아니라 드문 경합에 대한 정직한 안내다. 실패 모드도 유계다 — 새로고침·페이지 이동만으로 서버가 정확한 상태를 다시 렌더한다(잘못된 상태가 눌러앉는 경로 없음).

## 3. `?checkout=success` 쿼리 정리

`CheckoutSuccessBanner`가 마운트 시 `window.history.replaceState(null, "", "/dashboard")` 1회.

- `router.replace`를 쓰면 서버가 `searchParams` 없이 재렌더해 배너가 즉시 사라진다 → 금지.
- `history.replaceState`는 Next 라우터 재렌더를 트리거하지 않아 배너는 남고 URL만 깨끗해진다. 새로고침 시 배너가 다시 뜨는 문제도 해결된다.
- jsdom에서 동작 확인함: `replaceState` 후 `location.search === ""`, `history.length` 증가 없음(단정 가능).

## 4. 판정은 서버, 배너는 dumb component

`useSearchParams()` 대신 **Server Component가 `searchParams`를 읽어 boolean만 넘긴다.**
- `useSearchParams` Suspense 경계 이슈를 피한다.
- `DashboardPages.test.tsx`가 `next/navigation`을 `{ notFound }`만으로 mock 중이라, 배너가 `next/navigation`을 쓰면 그 테스트가 깨진다. 배너는 `next/navigation`을 import하지 않는다.
- 대가: `DashboardPage`가 `searchParams: Promise<{ checkout?: string | string[] }>`를 받게 되어 기존 테스트 호출부 수정이 필요하다(아래 6번).

## 5. `CoinSpinner` 재사용 검토 → 쓰지 않음

`CoinSpinner`는 `mt-4 flex … role="status"`인 블록 요소로, 수 초짜리 파일 파싱/분석을 카드 아래에서 안내하도록 설계됐다(`UploadFlow` 2곳). `h-14` pill 버튼 안에 넣으면 레이아웃이 깨지고 버튼 안에 `role="status"`가 중첩된다. 카드 아래에 붙이면 같은 컴포넌트의 형제 버튼(`불러오는 중...` 텍스트 교체)과 로딩 표현이 갈린다. → **같은 컴포넌트에 이미 있는 텍스트 교체 방식**을 따른다: 진행 중 라벨 `이동 중...` + 4개 CTA `disabled`.

로딩 상태는 카드별이 아니라 **컴포넌트 단위 단일 플래그**(`isStartingCheckout`)다. 체크아웃은 한 번에 하나만 시작돼야 하므로 어느 카드를 눌러도 4개가 함께 잠긴다. 성공 경로에서는 `finally`로 플래그를 풀지 않는다(이동 대기 중 두 번째 체크아웃 생성 방지).

## 6. 기존 테스트 변경 내역 (파일 2개만 — 그 외 전부 무수정)

**`src/components/PremiumSection.test.tsx` — `"renders four static locked CTA cards without fetching or blurred data"`**

이 테스트가 보장하던 5가지 중 3번만 이번 변경과 충돌한다:
1. 4종 제목 + `PREMIUM` 배지 4개 + `Premium으로 보기` 버튼 4개 → **유지**
2. 설명 문구 `text-[#a8acb3]` → **유지**
3. **CTA 클릭 시 `fetch` 미호출** → 이제 `POST /api/checkout`이 나가므로 성립 불가 → **분해**
4. `backdrop-blur`/`backdrop-filter` 0건 → **유지**
5. `role="list"` 부재(= Premium 데이터 미렌더) → **유지**

조치:
- 기존 테스트는 이름을 `"renders four static locked CTA cards without premium data"`로 바꾸고 클릭 부분만 삭제. "**렌더만으로는** fetch 0회"는 그대로 단정.
- 새 테스트 `"never requests a premium report from a locked card"`로 3번의 **진짜 의도**(미구독자에게 Premium 리포트를 요청하지 않는다)를 더 정확하게 복원: 4개 CTA 전부 클릭 → `fetch` 인자 중 `/api/reports/` 포함 호출 **0건**.
- 추가 테스트 5개(체크아웃 성공·이동, 중복 클릭 차단, 성공 후 비활성 유지, 실패 시 ErrorModal, reject 시 ErrorModal).
- 나머지 기존 4개 테스트(구독자 경로, 403/404/502 모달, 반경 구분)는 **무수정**.

**`src/components/DashboardPages.test.tsx`**
- `render(await DashboardPage())` → `render(await DashboardPage({ searchParams: Promise.resolve({}) }))`. `tsconfig.json`이 `src/**/*.tsx`를 포함하므로 안 고치면 `npm run typecheck`가 깨진다. 기존 단정은 무수정.
- 배너 케이스 테스트 추가(`checkout=success` × `active`/`inactive`, `checkout=cancelled` 시 미렌더).

**목킹 방식 (jsdom 실측 확인)**
- `vi.spyOn(window.location, "assign")` → `assign does not exist`로 **실패**. 쓰지 마라.
- `vi.stubGlobal("location", { href: "" })` → **동작함.** 컴포넌트는 `window.location.href = url`로 이동하고 테스트는 `window.location.href`를 단정한다. 파일에 이미 `afterEach(vi.unstubAllGlobals)`가 있다.

## 7. api-routes 계약 반영 (2026-08-07 확정 — 해소됨)

`_workspace/03_api-routes_polar-contract.md` §3이 확정됐고 step3.md §3-0에 그대로 복사해 넣었다.

| 항목 | 확정값 | 프론트 영향 |
|---|---|---|
| 성공 응답 | `{ "url": "..." }` **한 필드**(`checkoutId` 없음) | 기존 가정과 일치. 변경 없음 |
| 요청 | `POST`, **본문 없음**(라우트가 본문을 읽지 않음) | `fetch("/api/checkout", { method: "POST" })` 그대로 |
| `successUrl` | `/dashboard?checkout=success` 고정 | 배너 판정·`replaceState("/dashboard")` 전제 유지 |
| 에러 코드 | 401 `UNAUTHORIZED` / 403 `FORBIDDEN` / 409 `ALREADY_SUBSCRIBED` / 502 `CHECKOUT_FAILED` / 500 `INTERNAL_ERROR` | 전부 `useApiError` 기본 문구로 처리 |

안전장치는 유지했다 — step3.md는 여전히 "구현 전 `src/app/api/checkout/route.ts`를 열어 필드명을 대조하고, 계약과 코드가 어긋나면 **코드가 최종 근거**"라고 지시한다.

**409 `ALREADY_SUBSCRIBED` 처리 방침(리더 확인 요청 항목):** `useApiError.ERROR_MESSAGES`에 추가하지 않고 기본 문구로 떨어뜨린다. `useApiError.ts`는 무수정. CTA가 미구독자에게만 렌더되므로 409는 stale 화면에서만 나오는 방어적 경로다.
계약 문서 §1-②는 "에러 모달 대신 **페이지 새로고침**이 자연스럽다"고 제안하지만 **채택하지 않았다** — 사용자가 누른 버튼의 결과가 예고 없는 새로고침이면 무슨 일이 일어났는지 알 수 없고, 배너 쪽에서 자동 refresh를 기각한 것과 같은 이유(화면이 사용자 의사와 무관하게 갈아엎힘)로 일관되지 않는다. 대신 에러 5종 전부를 `it.each`로 도는 테스트에서 **409에서 `window.location.href`가 변하지 않음**(= 자동 이동/새로고침 없음)을 단정한다.

**api-routes에 남는 정리 요청(QA MINOR-6):** 계약 문서 §3 "결제 복귀 URL" 마지막 항목이 "짧은 대기/**폴링**·재조회 UX를 고려해야 한다"고 권고하는데, step3는 폴링을 명시적으로 기각했고 `docs/ARCHITECTURE.md`의 "폴링 없음" 전제를 지킨다. 문구를 "폴링 없이 안내 배너 1회"로 맞춰주면 좋겠다(Codex 주입 대상이 아니라 실행에는 영향 없음).

## 8. QA 지적 반영 (`_workspace/qa_plan_review_6-polar-billing.md`)

- **MAJOR-5 (회귀 기준선)** — AC의 고정 수치 "43개 파일 / 311개 테스트"를 삭제했다. step3는 phase의 마지막 step이라 실행 시점엔 step0~2가 추가한 테스트 파일들이 이미 있어 그 숫자가 거짓이 된다. 상대 기준으로 교체: **작업 전에 `npm run test`로 파일 수·테스트 수를 기록 → 작업 후 실패 0건 + 테스트 수가 기록값보다 줄지 않음(≥, 새 테스트만큼 증가)**. 변경 허용 테스트 2개(`PremiumSection.test.tsx` 첫 테스트 분해, `DashboardPages.test.tsx` 시그니처)와 보존해야 할 단정 목록은 그대로 유지했다.
- **MINOR-8 (409 문구 없음)** — 위 §7대로 "의도적 수용"으로 확정. 테스트로 못박음.
- **MINOR-9 (복귀 동선 공백)** — 배너 활성 문구를 이력으로 안내하도록 조정(§2). 새 링크·컴포넌트 없음.
- **step 번호 혼동은 해소됨** — 리더 확인 결과 `step0.md`의 제목은 현재 `# Step 0`이고 scope 표도 0~3으로 정정됐다. 내가 보고한 불일치는 rename 직전 시점을 읽은 탓이었다. 이 파일의 제목 `# Step 3`이 맞다.
