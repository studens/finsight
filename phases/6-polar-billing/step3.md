# Step 3: PremiumSection 업그레이드 CTA 연결 + 결제 복귀 배너

## 배경

앞 step에서 결제의 서버 쪽이 모두 완성됐다.

- step 0: `src/services/polar/` — `createCheckoutSession()`, `verifyPolarWebhook()` 등 SDK 래퍼
- step 1: `POST /api/checkout` — **로그인 세션 기반, 요청 본문 없음.** 성공 시 Polar Hosted Checkout URL을 JSON으로 반환
- step 2: `/api/webhooks/polar` — 서명 검증 후 `subscriptions.status`를 `'active'`/`'inactive'`로 갱신

**이 step은 그 마지막 한 칸, 화면 쪽만 연결한다.** 지금 `src/components/PremiumSection.tsx`의 미구독 분기는 이렇게 되어 있다:

```tsx
<Button className="mt-6 gap-2" type="button">
  <LockIcon />
  Premium으로 보기
</Button>
```

`onClick`이 없다. 눌러도 아무 일도 일어나지 않는다. 이 버튼에 체크아웃을 붙이고, 결제를 마치고 돌아온 사용자에게 안내를 보여주는 것이 이 step의 전부다.

`src/services/`, `src/app/api/`, `src/middleware.ts`는 **건드리지 마라.** 이 step에서 만지는 파일은 아래 6개뿐이다.

| 파일 | 상태 |
|---|---|
| `src/components/PremiumSection.tsx` | 수정 |
| `src/components/PremiumSection.test.tsx` | 수정(기존 테스트 1개 분해 — 아래 3-4 참고) |
| `src/components/CheckoutSuccessBanner.tsx` | 신규 |
| `src/components/CheckoutSuccessBanner.test.tsx` | 신규 |
| `src/app/(app)/dashboard/page.tsx` | 수정(searchParams 수신 + 배너 렌더) |
| `src/components/DashboardPages.test.tsx` | 수정(호출 시그니처 변경 반영) |

추가로 문서 2개(`docs/BROWSER-TEST-SCENARIOS.md`, `docs/ARCHITECTURE.md`)를 갱신한다.

**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.**

### 결제 복귀의 타이밍 함정 (이 step의 핵심 판단)

체크아웃 성공 시 Polar은 사용자를 `${NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`로 돌려보낸다(리더 확정 사항, `successUrl` 생성은 step 0의 `createCheckoutSession`이 이미 담당한다).

문제는 **두 경로가 경쟁한다**는 것이다:

```
경로 A(브라우저):  Polar 결제 확인 화면 → 302 → 브라우저 → GET /dashboard → 서버 렌더(getSubscriptionStatus 조회)
경로 B(서버-서버):  Polar → POST /api/webhooks/polar → 서명 검증 → subscriptions.status = 'active'
```

경로 B가 먼저 끝나면 `/dashboard`는 `isSubscribed=true`로 렌더된다. **하지만 경로 A가 먼저 끝나면 방금 돈을 낸 사용자가 잠금 화면을 본다.**

**채택한 처리: 서버가 `?checkout=success`를 보고 안내 배너를 1회 렌더한다. 폴링·자동 재검증·refresh 버튼은 넣지 않는다.**
배너 문구는 서버가 이미 계산해 둔 `isSubscribed` 값에 따라 두 가지로 갈린다.

- `isSubscribed === true` (웹훅이 먼저 도착한 정상 케이스): "결제가 완료됐어요. 아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요."
- `isSubscribed === false` (경합에서 진 케이스): "결제가 완료됐어요. 구독 반영까지 몇 초 걸릴 수 있어요. Premium 리포트가 아직 잠겨 있다면 잠시 후 페이지를 새로고침해 주세요."

활성 문구가 "아래 업로드 이력에서 분석을 열면"이라고 말하는 이유: Polar 복귀 지점은 `/dashboard`인데 Premium 잠금 카드는 `/dashboard/[analysisId]`에 있다. 배너 바로 아래에 `HistoryList`가 렌더되므로 도달 경로는 이미 존재하고, 문구가 그 한 칸을 가리켜 준다. **링크·버튼을 새로 만들지 마라** — 문구로 충분하다.

근거 — 다른 선택지를 버린 이유:

1. **폴링/`setInterval` 재검증**: `docs/ARCHITECTURE.md`의 "폴링·Realtime 구독 없음 — 모든 처리가 요청/응답 안에서 끝나는 동기 모델이라 불필요"라는 명시적 아키텍처 전제를 이 화면 하나 때문에 깨게 된다. 타이머 + 재시도 횟수 + 포기 조건이라는 상태 기계가 새로 생기고, 테스트는 fake timer에 의존하게 된다. MVP 범위 밖이다.
2. **자동 `router.refresh()`**: 배너는 서버가 `searchParams`를 보고 렌더하는데, 아래 3-2에서 URL의 `?checkout=success`를 지우므로 refresh가 돌면 배너 자신이 사라진다. "읽고 있던 안내가 몇 초 뒤 사라지고, 그런데도 여전히 잠겨 있는" 상태가 만들어진다 — 안 하느니만 못하다.
3. **"구독 상태 새로고침" 버튼**: 2번과 같은 이유로 클릭 후 배너가 사라진다. 게다가 버튼이 하는 일이 브라우저 새로고침과 같아서, 문구 한 줄로 대체 가능한 UI를 새로 만드는 셈이다.
4. **배너만 두는 방식의 실패 모드는 유계(bounded)이고 자가 치유된다**: 사용자가 새로고침하거나 다른 화면으로 이동하면 서버가 다시 조회해 정확한 상태를 렌더한다. 잘못된 상태가 눌러앉는 경로가 없다.

또한 실제로는 대부분 경로 B가 먼저 끝난다. 경로 B는 Polar 서버 → 우리 서버 직통이고, 경로 A는 브라우저가 Polar 확인 화면을 거쳐 왕복하기 때문이다. 즉 `isSubscribed === false` 분기는 "드물게 발생하는 경합에 대한 정직한 안내"이지 상시 경로가 아니다.

## 작업

### 3-0. `POST /api/checkout` 확정 계약

api-routes가 확정한 계약이다(`_workspace/03_api-routes_polar-contract.md` §3). 아래를 그대로 따른다.

```
POST /api/checkout        (요청 본문 없음, 세션 쿠키로 인증)

성공 200: { "url": "https://sandbox.polar.sh/checkout/polar_c_XXXXXXXX" }
          ← 정확히 이 한 필드. checkoutId는 응답에 없다.

에러 (본문은 언제나 code 한 필드뿐, message 없음):
  401 { "code": "UNAUTHORIZED" }        세션 없음
  403 { "code": "FORBIDDEN" }           교차 출처 POST 거부
  409 { "code": "ALREADY_SUBSCRIBED" }  이미 구독 중 — 이중 청구 방지로 라우트가 차단
  502 { "code": "CHECKOUT_FAILED" }     Polar API 호출 실패
  500 { "code": "INTERNAL_ERROR" }      서버 오설정 또는 예상치 못한 오류
```

**그래도 구현 전에 `src/app/api/checkout/route.ts`(step 1에서 이미 만들어져 있다)를 한 번 열어 성공 응답 필드명이 `url`인지 눈으로 대조하라.** 계약과 코드가 어긋나면 **리포지토리에 실제로 존재하는 코드가 최종 근거다** — 그 필드명으로 구현하고 테스트도 같은 이름으로 쓴다. 필드명을 추측하지 마라.

`403 FORBIDDEN`은 교차 출처 POST 방어용이라 브라우저에서 같은 출처로 호출하는 이 컴포넌트에서는 발생하지 않는다. `409 ALREADY_SUBSCRIBED`도 정상 흐름에서는 나오지 않는다 — 업그레이드 CTA는 `isSubscribed === false`일 때만 렌더되기 때문이다. 다른 탭에서 결제를 마친 뒤 이 화면이 stale한 상태로 남아 클릭했을 때만 나오는 방어적 경로다. **두 경우 모두 기존 `ErrorModal` 기본 문구로 처리한다**(아래 3-1(b) 참고).

요청은 반드시 이 형태다:

```ts
await fetch("/api/checkout", { method: "POST" })
```

- 본문이 없으므로 `body`도 `Content-Type` 헤더도 붙이지 않는다.
- `GET`으로 부르지 마라. 브라우저 프리페치로 체크아웃 세션이 생성되면 안 되기 때문에 라우트는 `POST`만 export한다.
- `analysisId`, `userId`, 제품 ID 같은 것을 body/query에 실어 보내지 마라. 라우트가 서버 세션에서 사용자를 얻는다.

### 3-1. `src/components/PremiumSection.tsx` — 잠금 CTA에 체크아웃 연결

기존 Client Component를 그대로 쓴다. `"use client"`, props(`{ analysisId, isSubscribed }`), 구독자 분기(`loadReport`), `useApiError`/`ErrorModal` 구성은 **손대지 않는다.**

**(a) 상태 추가** — 4개 카드가 공유하는 단일 플래그다. 카드별로 만들지 마라. 체크아웃은 한 번에 하나만 시작할 수 있어야 하므로, 어느 카드를 누르든 4개 CTA가 전부 비활성화된다.

```tsx
const [isStartingCheckout, setIsStartingCheckout] = useState(false);
```

**(b) 핸들러 추가**

```tsx
async function startCheckout() {
  if (isStartingCheckout) return;          // 중복 클릭 방지 (1차: 즉시 반환)
  setIsStartingCheckout(true);

  try {
    const response = await fetch("/api/checkout", { method: "POST" });
    if (await handleResponse(response)) {  // 기존 useApiError 관례 그대로
      setIsStartingCheckout(false);
      return;
    }

    const { url } = (await response.json()) as { url: string };
    if (typeof url !== "string" || url === "") {
      await handleResponse(new Response("", { status: 500 }));
      setIsStartingCheckout(false);
      return;
    }

    window.location.href = url;
    // 성공 경로에서는 로딩 상태를 풀지 않는다 — 브라우저가 Polar로 이동하는 중이며,
    // 여기서 버튼을 되살리면 이동 대기 중에 두 번째 체크아웃을 만들 수 있다.
  } catch {
    await handleResponse(new Response("", { status: 500 }));
    setIsStartingCheckout(false);
  }
}
```

- **`finally { setIsStartingCheckout(false) }`를 쓰지 마라.** 같은 파일의 `loadReport`는 `finally`를 쓰지만 그건 화면에 머무는 요청이고, 이쪽은 성공 시 페이지를 떠난다. 실패 경로에서만 개별적으로 되돌린다.
- `window.location.assign(url)`이 아니라 **`window.location.href = url`** 로 쓴다(테스트에서 `vi.stubGlobal("location", ...)`로 대체하기 때문 — 3-4 참고).
- **새로운 에러 UI를 만들지 마라.** 실패는 전부 기존 `useApiError().handleResponse` → 이미 이 컴포넌트 하단에 렌더돼 있는 `<ErrorModal>`로 표시된다. `alert()`, 토스트, 인라인 빨간 문구, 새 모달 컴포넌트 전부 금지.
- **`src/hooks/useApiError.ts`를 수정하지 마라.** 체크아웃 에러 코드 5종(`UNAUTHORIZED`/`FORBIDDEN`/`ALREADY_SUBSCRIBED`/`CHECKOUT_FAILED`/`INTERNAL_ERROR`)은 전부 `ERROR_MESSAGES`에 없으므로 기본 문구 "문제가 발생했어요. 잠시 후 다시 시도해 주세요."로 떨어진다. **이것은 의도된 동작이다**(api-routes 계약과 합의된 사항). MVP에서 이걸로 충분하고, 코드별 문구를 추가하면 기존 `useApiError` 테스트와 어긋날 위험만 커진다.
- **`409 ALREADY_SUBSCRIBED`를 자동 새로고침으로 처리하지 마라.** 계약 문서가 "에러 모달 대신 페이지 새로고침이 자연스럽다"고 언급하지만, 사용자가 누른 버튼의 결과가 예고 없는 새로고침이면 무슨 일이 일어났는지 알 수 없고, 이 step이 배너 쪽에서 자동 refresh를 기각한 것과 같은 이유(화면이 사용자 의사와 무관하게 갈아엎힘)로 일관되지 않는다. 다른 코드와 똑같이 기본 문구 모달로 안내하고, 사용자가 스스로 새로고침하면 CTA가 사라진다(구독자에게는 CTA가 렌더되지 않으므로).
- 사용자에게 HTTP 상태 숫자나 `code` 문자열을 노출하지 않는다(기존 관례).

**(c) 미구독 분기 렌더 변경** — 현재의 `<Button className="mt-6 gap-2" type="button">`을 아래로 바꾼다.

```tsx
<Button
  className="mt-6 gap-2"
  disabled={isStartingCheckout}
  onClick={() => void startCheckout()}
  type="button"
>
  {isStartingCheckout ? (
    "이동 중..."
  ) : (
    <>
      <LockIcon />
      Premium으로 보기
    </>
  )}
</Button>
```

- **평상시 접근 가능한 이름은 정확히 `Premium으로 보기`로 유지한다.** `LockIcon`은 이미 `aria-hidden="true"`다. 이 이름은 기존 테스트와 `docs/BROWSER-TEST-SCENARIOS.md` UC-08이 의존한다 — 바꾸지 마라.
- 진행 중 라벨은 `이동 중...`(같은 파일의 `불러오는 중...`, `UploadFlow`의 `분석 중...`과 같은 어투).
- `disabled`가 중복 클릭 방지의 2차 방어다(1차는 핸들러 첫 줄의 early return).

**(d) `CoinSpinner` 재사용 검토 결과: 쓰지 않는다.** 판단 근거를 남긴다 —
`src/components/CoinSpinner.tsx`는 `mt-4 flex ... role="status"`인 **블록 요소**로, 카드 아래에 붙어 수 초짜리 파일 파싱/분석을 안내하도록 만들어졌다(`UploadFlow`의 두 자리). 이걸 `h-14`짜리 pill 버튼 안에 넣으면 레이아웃이 깨지고, 버튼 내부에 `role="status"` 영역이 중첩된다. 카드 아래에 별도로 붙이면 같은 컴포넌트 안의 형제 버튼(`불러오는 중...` 텍스트 교체)과 로딩 표현이 두 갈래로 갈린다. 체크아웃은 짧은 왕복 후 곧바로 페이지를 떠나므로, **같은 컴포넌트에 이미 있는 텍스트 교체 방식**을 따르는 것이 일관적이다. `PremiumSection.tsx`에 `CoinSpinner`를 import하지 마라.

**(e) 유지해야 하는 불변식 — 잠금 카드에 Premium 데이터가 새지 않는다.**
미구독 카드는 여전히 **리포트 이름 + 한 줄 설명 + CTA 버튼**뿐이다. CTA에 동작이 생겼다고 해서:

- 실제/가짜 Premium 수치를 흐리게 깔지 않는다. `backdrop-blur`, `backdrop-filter`, `blur-`, `opacity`로 데이터를 가리는 어떤 표현도 금지.
- 미리보기·티저·샘플 리포트를 렌더하지 않는다. **미구독자의 Premium 리포트는 서버가 애초에 생성하지 않으므로(CLAUDE.md: "Premium 인사이트는 Free 사용자에 대해 애초에 생성하지 않는다") 흐리게 보여줄 값 자체가 존재하지 않는다.**
- 미구독 상태에서 `GET /api/reports/...`를 호출하지 않는다. 클릭 시 호출되는 것은 오직 `POST /api/checkout` 하나다.

### 3-2. `src/components/CheckoutSuccessBanner.tsx` (신규) — 결제 복귀 배너

Client Component다. `"use client"`를 붙인다(URL 정리를 위해 `useEffect`가 필요하기 때문이며, 그 외 클라이언트 로직은 없다).

```tsx
"use client";

import React, { useEffect } from "react";

export interface CheckoutSuccessBannerProps {
  isSubscribed: boolean;
}

export function CheckoutSuccessBanner({ isSubscribed }: CheckoutSuccessBannerProps) {
  useEffect(() => {
    // ?checkout=success를 URL에서 지운다. 새로고침해도 배너가 다시 뜨지 않게 하기 위함이다.
    // history.replaceState는 Next 라우터 재렌더를 트리거하지 않으므로 이 배너는 화면에 그대로 남는다.
    // (router.replace를 쓰면 서버가 searchParams 없이 다시 렌더해 배너가 즉시 사라진다 — 쓰지 마라.)
    window.history.replaceState(null, "", "/dashboard");
  }, []);

  return (
    <section
      className={`rounded-[24px] border-l-4 bg-[#16181c] p-8 ${
        isSubscribed ? "border-[#05b169]" : "border-[#5b8bff]"
      }`}
      data-testid="checkout-success-banner"
      role="status"
    >
      <h2 className="text-xl font-semibold text-white">결제가 완료됐어요</h2>
      <p className="mt-3 text-sm leading-relaxed text-[#a8acb3]">
        {isSubscribed
          ? "아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요."
          : "구독 반영까지 몇 초 걸릴 수 있어요. Premium 리포트가 아직 잠겨 있다면 잠시 후 페이지를 새로고침해 주세요."}
      </p>
    </section>
  );
}
```

규칙:

- **`useRouter`/`useSearchParams`를 쓰지 않는다.** `?checkout=success` 판정은 Server Component가 하고(3-3), 이 컴포넌트는 결과만 props로 받는다. `next/navigation`을 import하지 마라 — `DashboardPages.test.tsx`가 `next/navigation`을 `{ notFound }`만으로 mock하고 있어서, 여기서 다른 export를 쓰면 그 테스트가 깨진다.
- `history.replaceState`의 두 번째 인자는 빈 문자열, 세 번째는 `"/dashboard"` 고정이다. 이 배너는 `/dashboard`에서만 렌더되므로 경로를 동적으로 계산할 필요가 없다.
- 타이머(`setTimeout`/`setInterval`), 폴링, 자동 새로고침, 재시도 로직을 넣지 마라. 위 "타이밍 함정" 절의 결정 사항이다.

스타일(`ui-design` 값 그대로):

- 카드 = `rounded-[24px] bg-[#16181c] p-8` (다크 표면끼리는 border 없이 배경색 차이로 구분. `border-[#dee1e6]` 같은 라이트 토큰 금지 — 인증 후 화면은 **다크모드 고정**이다).
- 좌측 강조선은 정보 전달 목적으로만 쓴다: 활성화 완료 = Opportunity `#05b169`, 반영 대기 = Hygiene/정보 `#5b8bff`. 장식용 색을 추가하지 마라.
- 본문 텍스트 `text-sm leading-relaxed text-[#a8acb3]`, 제목 `text-white`.
- **금지(ui-design 안티패턴)**: `backdrop-blur`/`backdrop-filter`(glass morphism), `bg-clip-text`(gradient-text), `blur-3xl` 배경 orb, `animate-pulse`/글로우 애니메이션, 보라·인디고·바이올렛 계열 색, "Powered by AI" 류 배지. 포인트 컬러는 `#0052ff` 계열만 쓴다.
- 새 버튼/배지/카드 프리미티브를 만들지 마라. 필요하면 `src/components/ui`의 기존 `Button`/`Badge`/`Card`를 그대로 쓴다.
- 애니메이션을 넣는다면 기존 `animate-fade-in` 하나만 허용한다.

### 3-3. `src/app/(app)/dashboard/page.tsx` — 배너 연결

이 페이지는 Server Component다. 그대로 유지하고 `searchParams`만 받는다(Next 15에서 `searchParams`는 Promise다).

```tsx
interface DashboardPageProps {
  searchParams: Promise<{ checkout?: string | string[] }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { checkout } = await searchParams;
  // ...기존 getSessionUser / getSubscriptionStatus / listUserAnalyses 로직 그대로...

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-12 text-left">
      {checkout === "success" ? <CheckoutSuccessBanner isSubscribed={isSubscribed} /> : null}
      <UploadFlow isSubscribed={isSubscribed} />
      <HistoryList analyses={history} />
    </main>
  );
}
```

- 배너는 `<main>`의 **맨 위**에 온다. 기존 `space-y-8`이 간격을 처리하므로 별도 마진을 주지 마라.
- `checkout === "success"`인 경우에만 렌더한다. 다른 값이나 배열(`?checkout=a&checkout=b`)은 전부 무시된다(문자열 비교라 자동으로 걸러진다).
- **`/dashboard/[analysisId]` 페이지는 건드리지 마라.** Polar의 복귀 URL은 `/dashboard` 하나뿐이다.
- 이 페이지에서 구독 상태를 다시 조회하거나 `services/*`를 호출하지 마라. 기존 `getSubscriptionStatus(user.id)` 결과(`isSubscribed`)를 그대로 배너에 넘긴다.

### 3-4. 테스트 (먼저 작성한다)

**파일 확장자 주의.** `vitest.config.ts`는 프로젝트가 둘로 갈려 있다: `node`는 `src/**/*.test.ts`, `components`는 `src/components/**/*.test.tsx`(jsdom + `vitest.setup.ts`)만 포함한다. 이 step의 테스트는 **전부 `src/components/` 아래 `.tsx`** 여야 한다. `.ts`로 만들면 jsdom 프로젝트에 안 걸려 **조용히 실행되지 않는다.**

**네트워크 금지.** 모든 테스트에서 `vi.stubGlobal("fetch", vi.fn())`로 `fetch`를 목킹한다. 실제 요청이 나가면 안 된다.

**`window.location` 목킹 방법(검증된 방식이니 그대로 써라).** jsdom에서 `vi.spyOn(window.location, "assign")`은 `assign does not exist`로 실패한다. 아래는 이 리포지토리의 jsdom/vitest 조합에서 동작을 확인한 방식이다:

```tsx
vi.stubGlobal("location", { href: "" });
// ...클릭...
expect(window.location.href).toBe("https://sandbox.polar.sh/checkout/abc");
```

`PremiumSection.test.tsx`에는 이미 `afterEach(() => { vi.unstubAllGlobals(); })`가 있으므로 정리는 자동이다.

#### (a) `src/components/PremiumSection.test.tsx` — 기존 테스트 1개를 분해한다

현재 첫 번째 테스트 `"renders four static locked CTA cards without fetching or blurred data"`는 다음 5가지를 한꺼번에 보장하고 있다:

1. 4종 리포트 제목 + `PREMIUM` 배지 4개 + `Premium으로 보기` 버튼 4개가 렌더된다
2. 설명 문구가 `text-[#a8acb3]`다
3. **CTA를 클릭해도 `fetch`가 한 번도 호출되지 않는다** ← 이 단정만 이번 변경과 충돌한다
4. DOM 어디에도 `backdrop-blur`/`backdrop-filter`가 없다
5. `role="list"` 요소가 없다(= 실제 Premium 데이터가 렌더되지 않았다)

3번은 이제 성립하지 않는다(클릭 시 `POST /api/checkout`이 나간다). **1·2·4·5는 보안·디자인 불변식이므로 문구 한 줄도 약화시키지 말고 그대로 살린다.** 다음과 같이 나눈다:

- 기존 테스트를 `"renders four static locked CTA cards without premium data"`로 이름만 바꾸고, **클릭 부분(`fireEvent.click` + `expect(fetchMock).not.toHaveBeenCalled()`)을 삭제**한다. 대신 "**렌더만으로는** fetch가 호출되지 않는다"를 단정한다(`expect(fetchMock).not.toHaveBeenCalled()`를 클릭 없이 유지). 나머지 단정(1·2·4·5)은 한 글자도 바꾸지 않는다.
- 새 테스트 `"never requests a premium report from a locked card"`를 추가한다: `isSubscribed={false}`로 렌더 → 4개 CTA를 **전부** 클릭 → `fetch`에 넘어간 모든 경로에 `/api/reports/`를 포함하는 것이 **0건**임을 단정한다.

추가할 새 테스트(모두 `isSubscribed={false}`):

- `"starts checkout and redirects to the hosted checkout url"` — `fetch` mock이 `{ url: "https://sandbox.polar.sh/checkout/abc" }`를 200으로 반환. CTA 클릭 후 (1) `fetch`가 정확히 `("/api/checkout", { method: "POST" })`로 **1회** 호출됐고, (2) `window.location.href`가 그 URL이 됐음을 단정한다. 요청 인자에 `body`가 없음도 확인한다.
- `"blocks duplicate checkout clicks while one is in flight"` — 응답을 수동으로 resolve할 수 있는 pending Promise로 두고, 같은 버튼을 2번 + 다른 카드 버튼을 1번, 총 3번 클릭 → `fetch` 호출은 **1회**. 그리고 4개 CTA가 전부 `disabled`이며 진행 중 라벨 `이동 중...`이 보임을 단정한다.
- `"keeps the CTA disabled after a successful checkout response"` — 성공 응답 처리 후에도 버튼이 다시 활성화되지 않음을 단정한다(브라우저가 이동 중이므로).
- `"shows the shared error modal when checkout fails"` — `it.each`로 계약의 에러 5종을 돌린다: `[401, "UNAUTHORIZED"]`, `[403, "FORBIDDEN"]`, `[409, "ALREADY_SUBSCRIBED"]`, `[502, "CHECKOUT_FAILED"]`, `[500, "INTERNAL_ERROR"]`. 각 케이스에서 `role="dialog"`가 뜨고 공용 기본 문구 `문제가 발생했어요. 잠시 후 다시 시도해 주세요.`가 보이며, 그 안에 코드 문자열과 상태 숫자가 **없고**, `window.location.href`가 변하지 않았으며(`""` 유지), CTA가 다시 활성화돼 재시도 가능함을 단정한다. 특히 `409`에서 **페이지가 자동으로 새로고침되지 않음**(`window.location.href` 불변)도 여기서 함께 걸린다.
- `"shows the shared error modal when checkout rejects"` — `fetch`가 reject(네트워크 실패) → 동일하게 모달이 뜨고 이동이 없으며 버튼이 되살아난다.

기존 나머지 4개 테스트(구독자 경로, 에러 모달, 반경 구분)는 **수정하지 않는다.** 수정이 필요하다고 느껴지면 구현이 잘못된 것이다.

#### (b) `src/components/CheckoutSuccessBanner.test.tsx` (신규)

- `isSubscribed` true/false 각각에서 제목 `결제가 완료됐어요`와 해당 분기 문구가 렌더되는지.
- `role="status"`로 노출되는지.
- 마운트 후 `window.location.search`가 빈 문자열이 되는지. (테스트 시작 시 `window.history.replaceState(null, "", "/dashboard?checkout=success")`로 URL을 세팅한 뒤 렌더 → `expect(window.location.search).toBe("")`. jsdom에서 동작 확인됨.) 또한 `window.history.length`가 늘지 않았음을 단정해 `pushState`가 아님을 못박는다.
- 카드 클래스가 `rounded-[24px]`, `bg-[#16181c]`, `p-8`을 포함하고, 강조선이 구독 상태에 따라 `border-[#05b169]` / `border-[#5b8bff]`로 갈리는지.

#### (c) `src/components/DashboardPages.test.tsx` (기존 파일 수정)

이 파일은 `render(await DashboardPage())`처럼 **인자 없이** 호출하고 있다. 페이지가 `searchParams`를 받게 되면 `tsconfig.json`이 `src/**/*.tsx`를 포함하므로 `npm run typecheck`가 여기서 깨진다. 다음을 수정한다:

- 기존 호출을 `render(await DashboardPage({ searchParams: Promise.resolve({}) }))`로 바꾼다. 이 테스트의 기존 단정은 하나도 바꾸지 않는다(배너가 렌더되지 않는 상태가 기본이어야 한다).
- 테스트 1개를 추가한다: `searchParams: Promise.resolve({ checkout: "success" })`로 호출 → `data-testid="checkout-success-banner"`가 존재하고, `getSubscriptionStatus`가 `"inactive"`일 때 대기 안내 문구가, `"active"`일 때 즉시 확인 문구가 나오는지.
- `searchParams: Promise.resolve({ checkout: "cancelled" })`처럼 다른 값일 때 배너가 **없음**도 확인한다.
- `AnalysisPage`(`/dashboard/[analysisId]`) 관련 테스트는 손대지 않는다.

### 3-5. 문서 갱신

**`docs/BROWSER-TEST-SCENARIOS.md`**

- UC-08(미구독자가 Premium 리포트를 시도한다)의 기대 결과에 한 줄 추가: `Premium으로 보기` 클릭 시 `POST /api/checkout`이 호출되고 Polar Hosted Checkout으로 이동하며, **`/api/reports/...` 요청은 여전히 발생하지 않는다.** 기존 항목(4개 카드 + `PREMIUM` 배지, 리포트 본문 없음, API 직접 호출 시 403)은 삭제하지 말고 그대로 둔다.
- 섹션 C 뒤에 새 유스케이스를 추가한다: **UC-11. 미구독자가 업그레이드하고 대시보드로 복귀한다.**
  - 단계: 잠금 카드의 `Premium으로 보기` 클릭(진행 중 `이동 중...`, 4개 버튼 비활성) → Polar 샌드박스 체크아웃에서 결제 → `/dashboard?checkout=success`로 복귀
  - 기대 결과: `결제가 완료됐어요` 배너 노출 / 주소창에서 `?checkout=success`가 사라짐(새로고침해도 배너가 다시 뜨지 않음) / 웹훅이 이미 처리됐으면 "아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요.", 아직이면 "구독 반영까지 몇 초 걸릴 수 있어요..." 문구가 보이고 새로고침 후 Premium 잠금이 풀림
  - 로컬 확인 조건: `polar listen http://localhost:3000/api/webhooks/polar`가 떠 있어야 웹훅이 도달한다
  - 실패 시: 체크아웃 생성 실패는 페이지 이동 없이 공용 ErrorModal(`문제가 발생했어요. 잠시 후 다시 시도해 주세요.`)로 표시

**`docs/ARCHITECTURE.md`**

- "4) 구독 결제" 데이터 흐름 절에 **프론트 복귀 처리 한 줄만 덧붙인다**: 체크아웃 성공 후 `/dashboard?checkout=success`로 복귀하면 서버가 그 쿼리를 보고 `CheckoutSuccessBanner`를 1회 렌더하며, 웹훅이 아직 도착하지 않았을 수 있으므로 문구로 안내한다(폴링 없음). 앞 step들이 이미 이 절을 갱신했을 수 있으니 **기존 문장을 지우지 말고 추가**한다.
- 같은 문서의 "폴링·Realtime 구독 없음" 문장은 **그대로 유지된다.** 이 step은 그 전제를 깨지 않는다.

## Acceptance Criteria

- [ ] (계약 일치) `src/components/PremiumSection.tsx`가 `fetch("/api/checkout", { method: "POST" })`로 호출하며 `body`·`Content-Type`을 보내지 않는다. 응답에서 읽는 URL 필드명이 `src/app/api/checkout/route.ts`가 실제로 반환하는 필드명과 **일치**하고, 테스트의 mock 응답 본문도 같은 필드명을 쓴다(두 파일을 열어 대조했음을 확인한다).
- [ ] (CTA 동작) `isSubscribed={false}`에서 `Premium으로 보기` 클릭 시 `fetch`가 `/api/checkout`으로 정확히 1회 호출되고, 응답 URL이 `window.location.href`에 대입됨을 단정하는 RTL 테스트가 통과한다. 테스트는 `vi.stubGlobal("location", { href: "" })`로 이동을 목킹하며 **실제 네트워크 요청과 실제 페이지 이동이 일어나지 않는다.**
- [ ] (중복 클릭 방지) 응답이 pending인 상태에서 CTA를 3번(같은 버튼 2회 + 다른 카드 1회) 클릭해도 `fetch` 호출이 **1회**이고, 그동안 4개 CTA가 모두 `disabled`이며 라벨이 `이동 중...`임을 단정하는 테스트가 통과한다. 성공 응답 처리 후에도 버튼이 다시 활성화되지 않는다.
- [ ] (에러 처리 통일) 체크아웃 실패(401 JSON 응답 / `fetch` reject) 시 `role="dialog"`인 기존 `ErrorModal`이 뜨고, 그 안에 HTTP 상태 숫자와 `code` 문자열이 **노출되지 않으며**, `window.location.href`가 변하지 않고, 버튼이 다시 활성화돼 재시도 가능함을 단정하는 테스트가 통과한다.
- [ ] (새 에러 UI 금지) `src/hooks/useApiError.ts`와 `src/components/ErrorModal.tsx`가 **수정되지 않았다**(`git diff --name-only`에 두 파일이 없다). `PremiumSection.tsx`에 `alert(`, `confirm(`, `toast` 문자열이 0건이다.
- [ ] (⭐ Premium 데이터 미노출 — CLAUDE.md "Premium 인사이트는 Free 사용자에 대해 애초에 생성하지 않는다") `isSubscribed={false}` 렌더 결과에 `role="list"` 요소가 없고, `document.body.innerHTML`에 `backdrop-blur`/`backdrop-filter`가 **0건**이며, 카드 내용이 리포트 제목·한 줄 설명·`PREMIUM` 배지·CTA 버튼뿐임을 단정하는 테스트가 통과한다(기존 단정을 약화시키지 않고 유지).
- [ ] (⭐ 페이월) `isSubscribed={false}`에서 4개 CTA를 모두 클릭해도 `fetch` 인자에 `/api/reports/`를 포함하는 호출이 **0건**임을 단정하는 테스트가 통과한다.
- [ ] (⭐ 시크릿 격리 — CLAUDE.md) 클라이언트 컴포넌트에 Polar 시크릿·SDK 참조가 없다. `grep -rn "POLAR_" src/components/ src/hooks/`가 **0건**, `grep -rn "@polar-sh" src/components/ src/hooks/`가 **0건**, `grep -rn "services/polar" src/components/`가 **0건**이다. 클라이언트는 `/api/checkout` 호출만 하고 제품 ID·토큰·Polar 도메인을 하드코딩하지 않는다(`grep -rn "polar.sh" src/components/`는 **테스트 파일의 mock URL 외에는 0건**).
- [ ] (services 직접 호출 금지) `PremiumSection.tsx`와 `CheckoutSuccessBanner.tsx`가 `services/`, `lib/supabase/`, `@anthropic-ai`, `@supabase` 를 import하지 않는다(grep 0건). 데이터는 오직 `fetch('/api/...')`와 props로만 얻는다.
- [ ] (복귀 배너 렌더) `/dashboard`에 `?checkout=success`로 접근했을 때만 `data-testid="checkout-success-banner"`가 렌더되고, `?checkout=cancelled`나 쿼리 없음에서는 렌더되지 않음을 `DashboardPages.test.tsx`에서 단정한다. 배너 문구가 `isSubscribed`에 따라 두 갈래(`아래 업로드 이력에서 분석을 열면 Premium 리포트를 확인할 수 있어요.` / `구독 반영까지 몇 초 걸릴 수 있어요.`…)로 갈림도 단정한다.
- [ ] (URL 정리) `CheckoutSuccessBanner` 마운트 후 `window.location.search`가 `""`가 되고 `window.history.length`가 증가하지 않음(= `replaceState`이지 `pushState`가 아님)을 단정하는 테스트가 통과한다. 배너 자체는 URL 정리 후에도 화면에 남아 있다.
- [ ] (과설계 금지) `CheckoutSuccessBanner.tsx`에 `setTimeout`, `setInterval`, `router.refresh`, `router.replace`, `useRouter`, `useSearchParams`, `next/navigation` 문자열이 **0건**이다. 구독 상태를 재조회하는 폴링 코드가 없다. `docs/ARCHITECTURE.md`의 "폴링·Realtime 구독 없음" 문장이 그대로 남아 있다.
- [ ] (디자인 토큰 — ui-design) 배너가 `rounded-[24px] bg-[#16181c] p-8`을 쓰고, 강조선이 `border-[#05b169]`(활성) / `border-[#5b8bff]`(대기)로만 갈림을 단정하는 테스트가 통과한다. `src/components/CheckoutSuccessBanner.tsx`에 `backdrop-blur`, `backdrop-filter`, `bg-clip-text`, `blur-3xl`, `animate-pulse`, `purple`, `indigo`, `violet`, `bg-white`, `#dee1e6` 문자열이 **0건**이다(인증 후 화면은 다크모드 고정).
- [ ] (프리미티브 재사용) `src/components/ui/` 아래 파일이 **수정되지 않았고**(`git diff --name-only`에 없음), `Button`에 새 variant가 추가되지 않았다. 새 카드/배지/버튼 컴포넌트를 만들지 않았다.
- [ ] (테스트 파일 위치) 새 테스트가 `src/components/CheckoutSuccessBanner.test.tsx`(`src/components/` 아래 **`.tsx`**)이고, `npm run test` 출력의 테스트 파일 목록에 이 경로가 **실제로 나타난다.**
- [ ] (회귀 없음) `npm run test`가 **전부** 통과한다. 기준은 절대 수치가 아니라 **step 2 완료 시점 대비**다 — 이 step은 phase의 마지막 step이고 step 0~2가 테스트 파일을 여러 개 추가하므로, phase 시작 전 수치(43 파일 / 311 테스트)는 이 시점에 이미 낡았다. 따라서 (1) 이 step 작업 전에 `npm run test`를 한 번 돌려 파일 수·테스트 수를 기록하고, (2) 작업 후 같은 명령의 실패가 **0건**이며 테스트 수가 기록값보다 **줄어들지 않았음**(≥ 기록값, 새 테스트만큼 증가)을 확인한다. 변경이 허용된 테스트는 `PremiumSection.test.tsx`의 첫 테스트 분해와 `DashboardPages.test.tsx`의 호출 시그니처 수정뿐이며, 두 파일 모두 기존 단정 내용(배지 4개·설명 색·backdrop 금지·list 부재·구독자 경로·에러 모달·반경 구분)이 그대로 남아 있다.
- [ ] (문서) `docs/BROWSER-TEST-SCENARIOS.md`에 UC-11(업그레이드 → 결제 → `/dashboard?checkout=success` 복귀 → 배너 → 웹훅 반영) 시나리오가 추가됐고, UC-08에 "클릭 시 `POST /api/checkout` 호출 / `/api/reports` 미호출" 한 줄이 추가됐다(기존 UC-08 항목은 삭제되지 않았다). `docs/ARCHITECTURE.md`의 구독 결제 흐름에 복귀 배너 한 줄이 추가됐다.
- [ ] `npm run typecheck`, `npm run lint`가 통과하고 `npm run build`가 성공한다.
