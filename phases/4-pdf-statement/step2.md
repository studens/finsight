# Step 2: 레댁션 게이트 — LLM 전달 직전 PII 차단 (INV-3, 차단형)

## 작업

표 조각을 Claude에 보내기 직전 **남은 PII 패턴을 검사해 예외를 던져 요청을 중단**시키는 게이트를 만든다.
**TDD 필수 — 테스트를 먼저 작성하고 통과하는 구현을 작성한다.** 이 step에서 LLM을 호출하지 않는다(게이트를 실제로 호출하는 곳은 step 3).

### 프로젝트 CRITICAL 규칙 (이 step이 지켜야 하는 문장)

- "CSV의 카드/계좌번호는 `src/services/pii-masking/`을 거쳐 뒤 4자리만 남기고 마스킹한 뒤에만 LLM에 전달한다. 이름·전화번호 등 신원 식별 컬럼은 마스킹이 아니라 컬럼 자체를 LLM 요청에서 제외한다. **원본 값을 프롬프트에 절대 포함하지 않는다.**"
- "원본 CSV/PDF 파일은 어떤 형태로도(Storage, 디스크, 로그 등) 영구 저장하지 않는다."

게이트는 **경고가 아니라 차단**이다. 위반을 발견하면 `console.warn` 후 진행하는 코드는 금지이며, 반드시 예외를 던져 LLM 호출 자체가 일어나지 않게 한다.

### 2-1. 위치와 공개 API — `src/services/pii-masking/redaction-gate.ts` (신규)

PII 판별 로직은 `pii-masking` 서비스에 둔다(CRITICAL 규칙이 지목하는 서비스이며, 의존 방향이 `llm → pii-masking`으로 자연스럽다).

```typescript
export type RedactionFindingKind =
  | "subtotal_context"  // 소계/합계/성명/예금주 키워드 — 실명이 붙어 나오는 행
  | "korean_name"       // 괄호 안 한글 2~4자 — 소계(M614)(홍길동)
  | "masked_account"    // 123********99 형태
  | "card_number"       // 구분자(-, 공백) 포함 13~16자리
  | "postal_address"    // 우편번호 5자리 + 주소 키워드
  | "phone_number"      // 010-1234-5678 / 02-1234-5678 형태

export class RedactionGateError extends Error {
  readonly code = "REDACTION_GATE_BLOCKED" as const
  /** 걸린 패턴 종류만 담는다. 매칭된 원문 값은 절대 담지 않는다. */
  readonly findings: RedactionFindingKind[]
}

/** 문자열 하나에서 발견된 패턴 종류 목록 (중복 제거) */
export function findPiiPatterns(value: string): RedactionFindingKind[]

/** LLM에 보낼 예정인 문자열 전체를 검사. 하나라도 걸리면 RedactionGateError를 던진다 */
export function assertRedacted(values: string[]): void
```

### 2-2. 패턴 정의 (정확히 이대로)

| kind | 판정 규칙 | 반드시 걸려야 하는 예 | 절대 걸리면 안 되는 예 |
|---|---|---|---|
| `subtotal_context` | `/(소계|합계|성명|예금주|카드주)/` | `소계(M614)(홍길동)바른카드`, `합계` | `이용기간 : [일시불/할부] ...` |
| `korean_name` | `/\(([가-힣]{2,4})\)/` 중 괄호 안 값이 허용목록에 **없을 때**. 허용목록: `할인, 면제, 무이자, 취소, 승인, 일시불, 할부, 해외, 포인트, 적립, 국내, 연체, 정상` | `(홍길동)` | `53(할인)`, `922(면제)` |
| `masked_account` | `/\d{2,4}\*{3,}\d{2,}/` | `123********99` | 금액 문자열 |
| `card_number` | `/(?<!\d)\d[\d -]{11,18}\d(?!\d)/g` 로 후보를 찾고, 후보의 **숫자만 센 개수가 13~16**일 때. **쉼표는 구분자로 인정하지 않는다** | `1234-5678-9012-3456`, `1234567890123456`, `1234 5678 9012 3456` | `1,200,00012/3100,0000900,000` (join된 금액 런 — 쉼표를 구분자로 인정하면 14자리로 오탐한다) |
| `postal_address` | `/(?<!\d)\d{5}\s/` 가 매칭되고 **동시에** `/(특별시|광역시|시|군|구|읍|면|동|로|길|번지)/` 도 매칭될 때 | `주소04524 서울특별시 중구 세종대로 110` | `06/13테스트마트 강변점4,50053(할인)4,4470` (`50053` 뒤가 공백이 아니라 `(`) |
| `phone_number` | `/(?<!\d)0\d{1,2}-\d{3,4}-\d{4}(?!\d)/` 또는 `/(?<!\d)01[016789]\d{7,8}(?!\d)/` | `010-1234-5678`, `02-1234-5678` | join된 금액 런 (하이픈이 없다) |

**쉼표를 카드번호 구분자로 인정하면 안 되는 이유:** 금액 아이템을 join하면 `1,200,000` + `12/3` + `100,000` + `0` + `900,000` = `1,200,00012/3100,0000900,000` 이 되고, 쉼표를 구분자로 허용할 경우 숫자 14개가 연속으로 세어져 **정상 거래행이 카드번호로 오탐되어 업로드 전체가 422로 막힌다.**

### 2-3. 에러 규칙 (CRITICAL)

- `RedactionGateError.message`는 **고정 문자열 + `findings` 종류 라벨만** 담는다. 매칭된 원문 값(실명, 계좌, 주소, 전화번호)을 message·stack·프로퍼티 어디에도 담지 않는다.
- 게이트는 `console.*`로 아무것도 출력하지 않는다. 위반 내용을 로그로 남기는 것 자체가 원본 PII를 로그에 쓰는 행위다.
- `assertRedacted`는 첫 위반에서 바로 던져도 되고 전부 모아서 던져도 되지만, **위반이 있으면 반드시 던진다.** boolean을 반환하고 호출자가 무시할 수 있는 형태로 만들지 않는다.

## Acceptance Criteria

- [ ] (TDD) `src/services/pii-masking/redaction-gate.test.ts`가 먼저 작성되고 통과한다.
- [ ] (차단형 — 경고가 아님) `assertRedacted`가 위반 시 `RedactionGateError`를 **throw**하고, 반환값으로 위반 여부를 알려주는 시그니처가 아님을 타입과 테스트로 확인한다. `redaction-gate.ts`에 `console.` 호출이 **0건**임을 grep으로 확인한다.
- [ ] (6가지 패턴 전부 개별 검증) `findPiiPatterns`에 대해 kind별로 최소 1개씩 **양성** 테스트가 통과한다: `소계(M614)(홍길동)바른카드` → `subtotal_context`와 `korean_name` 둘 다 / `123********99` → `masked_account` / `1234-5678-9012-3456`와 `1234567890123456` **두 케이스 모두** → `card_number` / `주소04524 서울특별시 중구 세종대로 110` → `postal_address` / `010-1234-5678`와 `02-1234-5678` → `phone_number`.
- [ ] (오탐 금지 — 이게 없으면 정상 업로드가 전부 422로 막힌다) 다음 문자열들에서 `findPiiPatterns`가 **빈 배열**을 반환하는 테스트가 통과한다: `06/13테스트마트 강변점4,50053(할인)4,4470`, `03/20테스트페이_강의140,252922(면제)6/423,375046,750`, `04/15테스트전자스토어1,200,00012/3100,0000900,000`, `02/28테스트폰코리아360,00012/530,0000210,000`, `이용기간 : [일시불/할부] 2026.06.11 ~ 2026.07.10`, `이용일가맹점이용금액할인금액할부회차이번달청구금액포인트할부잔여`, `[해외이용]`.
- [ ] (픽스처 통합 — 실제 라인으로 검증) `nh-statement-sample.pdf`를 step0/step1로 처리한 뒤:
      (1) `layout.transactionLines` 34개의 `text`와 각 아이템 `text` 전체를 `assertRedacted`에 넣으면 **예외가 발생하지 않는다.**
      (2) 소계 2개 라인의 `text`를 각각 `assertRedacted`에 넣으면 **`RedactionGateError`가 발생**하고 `findings`에 `subtotal_context`와 `korean_name`이 포함된다.
      (3) page1의 `성명`/`주소`/`연락처`/`결제계좌` 라인을 각각 넣으면 모두 `RedactionGateError`가 발생하고, 각각 `korean_name` / `postal_address` / `phone_number` / `masked_account`가 findings에 포함된다.
- [ ] (에러에 원문 미포함 CRITICAL) 위 (2)(3)에서 잡은 에러에 대해 `error.message`와 `JSON.stringify(error.findings)`에 `홍길동`, `123********99`, `세종대로`, `010-1234-5678` 문자열이 **하나도 포함되지 않는다**고 단정하는 테스트가 통과한다.
- [ ] (기존 마스킹 서비스 무회귀) `src/services/pii-masking/index.ts`의 `maskPii` 동작과 기존 테스트를 변경하지 않는다. 게이트는 새 파일로 추가되며 `maskPii`의 시그니처·결과가 그대로다.
- [ ] `npm run test`, `npm run typecheck`, `npm run lint`가 통과하고 기존 CSV 파이프라인 테스트가 하나도 깨지지 않는다(INV-5).
