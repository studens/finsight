# Step 0: describeError를 `src/lib/log.ts`로 승격하고 `code` 포맷 가드를 추가한다

## 배경

현재 `describeError()`는 `src/app/api/reports/[analysisId]/[reportType]/route.ts`의 module-private 함수다(31~44행). 이 프로젝트에서 **에러 로깅 허용 목록은 라우트 하나의 사정이 아니라 프로젝트 전역 불변식**이다:

> 에러 객체 자체·`message`·`stack`·`details`·`hint`를 로그에 남기지 않는다. Vercel AI SDK의 `APICallError.requestBodyValues`/`.responseBody`에는 **프롬프트 전문(= 마스킹된 거래 데이터)** 이 실리고, `PostgrestError.details`에는 위반한 **행 값**이 실린다. 에러를 통째로 로깅하면 "원본 CSV를 어떤 형태로도 영구 저장하지 않는다"는 CRITICAL 규칙이 로그를 통해 새는 우회로가 된다.

함수가 한 라우트에 갇혀 있으면 다른 라우트(`/api/upload`, `/api/analyze`, `/api/checkout`, `/api/webhooks/polar`)가 나중에 로깅을 추가할 때 이 규율을 재사용할 수 없고, `console.error("...", error)`로 통째로 찍는 코드가 들어올 여지가 생긴다.

또한 현재 `code` 처리는 32자 절단만 하고 **형식 검증을 하지 않는다**(`route.ts:42`). `code`는 라이브러리에 따라 임의의 문자열이 들어올 수 있는 필드이므로, 절단만으로는 프롬프트·리포트 본문 조각이 32자만큼 로그에 남을 수 있다.

## 작업

1. **`src/lib/log.ts` 신설.** `describeError(error: unknown)`를 이 파일로 옮기고 `export`한다. 반환 타입은 현재와 동일하게 `{ errorName: string; statusCode?: number; code?: string }`을 유지한다.

2. **`code` 포맷 가드 추가.** `code`는 다음을 **모두** 만족할 때만 결과에 포함한다:
   - `typeof code === "string"`
   - 정규식 `/^[A-Za-z0-9_.-]{1,32}$/`에 **완전히** 일치 (부분 일치 금지 — `^`/`$` 앵커 필수)

   즉 절단(`slice`)으로 통과시키지 말고 **형식에 맞지 않으면 `code` 키 자체를 생략**한다. 32자를 넘는 문자열은 절단해서 넣는 것이 아니라 탈락시킨다. 공백·따옴표·줄바꿈·한글·`{`·`:` 등이 섞인 값은 전부 탈락한다.

   `statusCode`는 현재 동작(`typeof statusCode === "number"`일 때만 포함)을 그대로 유지한다.

3. **`src/lib/log.ts.test.ts`가 아니라 `src/lib/log.test.ts`** 로 유닛 테스트를 작성한다(주변 파일 규칙: `src/lib/file-type.test.ts`, `src/lib/pdf-error.test.ts`).

4. **라우트를 import로 교체.** `route.ts`의 로컬 `describeError` 정의를 삭제하고 `src/lib/log.ts`에서 import한다. 두 호출 지점(리포트 생성 실패, 캐시 저장 실패)의 로그 인자 구성은 **바꾸지 않는다** — `analysisId`(64자 절단), `reportType`, 그리고 `describeError()` 전개 결과만 남는 현재 형태를 유지한다.

5. 기존 라우트 테스트가 깨지지 않아야 한다. 라우트 테스트가 로그 형태를 검증하고 있다면 그 기대값은 유지된다(동작이 바뀌는 것은 `code` 포맷 가드뿐).

## Acceptance Criteria

- [ ] `src/lib/log.ts`가 존재하고 `describeError`를 named export한다.
- [ ] `src/app/api/reports/[analysisId]/[reportType]/route.ts`에 `describeError`의 **함수 정의가 남아 있지 않고**(`function describeError` 문자열이 0회 등장), `src/lib/log`에서 import해 사용한다.
- [ ] `src/lib/log.test.ts`에서 다음이 각각 통과한다:
  - `Error`가 아닌 값(예: 문자열, `null`, 숫자, 평범한 객체)을 넣으면 정확히 `{ errorName: "UnknownError" }`를 반환한다(다른 키가 없다).
  - `errorName`은 `error.name`을 그대로 반환한다.
  - `statusCode`가 number면 포함되고, string이면(`"429"`) 포함되지 않는다.
  - `code`가 `"PGRST202"`, `"22023"`, `"invalid_parameter_value"`처럼 `/^[A-Za-z0-9_.-]{1,32}$/`에 맞으면 그대로 포함된다.
  - **`code`가 33자 이상이면 절단되지 않고 `code` 키 자체가 결과에서 빠진다.**
  - **`code`에 공백·줄바꿈·따옴표·`{`·`:`·한글이 섞여 있으면 `code` 키가 빠진다.** 최소한 프롬프트 조각을 모사한 케이스 1개(예: `'{"transactions":[{"desc":"스타벅스"'`)를 명시적으로 포함한다.
- [ ] `describeError`의 반환 객체 키가 `errorName`, `statusCode`, `code` **3개를 절대 넘지 않는다**는 것을 검증하는 테스트가 있다. `message`·`stack`·`details`·`hint`·`requestBodyValues`·`responseBody`를 모두 가진 에러 객체를 넣고, 반환 객체의 `Object.keys()`가 이 3개의 부분집합임을 단정한다.
- [ ] `npm run typecheck` 통과, `npm run lint` 소스 코드 0 errors, `npm run test` 기존 테스트 전부 통과(회귀 없음).
