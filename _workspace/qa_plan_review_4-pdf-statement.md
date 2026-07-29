# 계획 검증 리포트 — phase `4-pdf-statement`

**검증자:** 리더(오케스트레이터) 직접 수행
**사유:** qa 에이전트가 API 세션 한도로 조기 종료(15:50 리셋). 실행 전 검증을 생략하지 않기 위해 리더가 대행했다.
**방법:** 9개 step 파일에 대한 타겟 grep 기반 경계면·AC 정밀 검증 (전문 정독이 아닌 항목별 교차 확인)
**판정:** ✅ **승인 — 실행 차단(blocker) 없음**

> 한계 명시: 이 검증은 grep 기반 항목 확인이며, qa 에이전트가 수행할 전문 정독 수준의
> AC 품질 리뷰(모호성·오탐 위험 전수 조사)는 대체하지 않는다. 실행 후 코드 검증(1단계)은
> 세션 한도 회복 후 qa 에이전트로 반드시 수행할 것.

## A. step 커버리지·순서·정합성

| 항목 | 결과 |
|---|---|
| step 파일 9개(step0~8) 존재 | ✅ 1,621행 |
| `index.json` step 수·번호 일치 | ✅ 9개, `[0..8]` 연속, 공백 없음 |
| 전 step `status: "pending"` | ✅ |
| step 필드가 `{step, name, status}`만 | ✅ (execute.py가 나머지를 실행 중 기록) |
| `phase` 필드 ↔ 디렉토리 슬러그 일치 | ✅ 둘 다 `4-pdf-statement` → 브랜치 `feat-4-pdf-statement` |
| `phases/index.json`에 등록 | ✅ 5번째 항목, `pending` |
| scope의 step 배정표와 일치 | ✅ core-services 0~4 / api-routes 5~6 / frontend 7~8 |
| 의존 순서 | ✅ 게이트(step2)가 LLM 판정(step3)보다 앞 |

**경미:** step5(261행)·step6(275행)·step0(241행)이 크다. 다만 각각 단일 라우트/단일 서비스 경계에
집중돼 있고 AC가 개별 항목으로 분해돼 있어 분할하지 않았다. Codex가 3회 재시도 내에 실패하면
그때 분할을 검토한다.

## B. 보안 CRITICAL 규칙 반영

| 규칙 | AC 위치 | 결과 |
|---|---|---|
| INV-3 레댁션 게이트 = 차단형(예외 throw) | step2 전반, step3 | ✅ |
| 게이트 미통과 텍스트가 LLM에 미전달 | step3 (`generateAnalysisText` 미호출 단정) | ✅ |
| 게이트 **오탐 금지**(정상 업로드가 422로 막히는 사고 방지) | step2 (쉼표를 카드번호 구분자로 인정 금지) | ✅ |
| 비밀번호 로그·응답·에러메시지 미기록 | step0/2/5/6/7/8 (`console.` 검사 포함) | ✅ 6개 step 전부 |
| 실제 PII·실제 비밀번호 미커밋 | step0:229 | ✅ `git grep` 0건: `[REDACTED_REAL_NAME]` / `[REDACTED_REAL_ADDRESS]` / `[REDACTED_REAL_ACCOUNT]` / **`000000`** |
| 픽스처 비밀번호를 별도 값으로 | step0 | ✅ `000000` |
| 원본 PDF 미보관 | step0/5/6 | ✅ |
| 내부 진단 라벨 응답 유출 차단 | step5:243, step6:253 | ✅ `JSON.stringify(body)`에 `pdf_open_failed` 미포함 |

## C. 골든값·회귀 방지 AC

| 항목 | AC 위치 | 결과 |
|---|---|---|
| **거래 34건 / 합계 882,646** | step4:96 | ✅ `rowCount===34` + 합 882,646 + **픽스처 `합계` 행과 교차 단정**(오차 0) |
| **fuzzy y tolerance 회귀** | step1:147~149 | ✅ 동일 테스트에서 (0.5 → 34/882,646) **및** (`yTolerance:0` → <34 && ≠882,646) 양방향 단정 + `Math.round(y` grep 0건 |
| **D2 할부 = 청구액만** | step4:97 | ✅ `2026-03-20` 행 `청구금액==="23375"`, **`"140252"` 행 0개** |
| **해외 중복계상 방지** | step4:98 | ✅ `"36719"` 정확히 1개, `룩셈부르크` 포함 행 0개, 별도 dedup 로직 부재 확인 |
| right-edge 하드코딩 금지 | step1:151 | ✅ `275.5/407/445.5/558.5` 리터럴 0건, 허용 상수는 tolerance 2개뿐 |
| right-edge 동적 발견 | step1:150 | ✅ rowCount 34/32/34/4 클러스터 존재 검증 |
| INV-5 CSV 무회귀 | step5:257~258 | ✅ 기존 3케이스 단정 **약화 없이** 유지 + `toEqual({mapping,sample})` 전체 동등 비교가 `pdfColumnSchema` 부재를 보장 |
| 소계/합계 배제 | step4 | ✅ `866646`/`882646`/`16000` 행 0개 |
| 연도 추론 12월→1월 + 할부 원거래 | step4 | ✅ 양쪽 모두 |

## D. 플래너 간 경계면 정합성 (최중요)

세 플래너가 독립 계획했으므로 seam을 교차 검증했다. **7개 항목 전부 통과.**

| # | seam | 결과 |
|---|---|---|
| 1 | `passwordCase`(core) ↔ `reason`(api) | ✅ step5:163이 `passwordCase`를 **실제로 읽고** 그대로 `reason`에 매핑. 값 집합 `"missing"\|"incorrect"` 동일. 이름 불일치로 폴백에만 의존하는 사고 없음 |
| 2 | `reason` 필드 의미 충돌(내부 진단 ↔ 비밀번호 분류) | ✅ step5:166이 스프레드·필드 이전을 명시 금지, 422 body를 **리터럴로 새로 생성**. 양쪽에 유출 검증 AC |
| 3 | `PdfColumnSchema` 타입 일치 | ✅ core가 확정, api/frontend는 **필드를 발명하지 않음**(grep 0건). 양쪽 모두 **opaque 왕복**으로 명시 |
| 4 | `isPdfBuffer` 소유권 | ✅ step0이 export, step5:35/69가 재구현 명시 금지. `src/lib/file-type.ts`엔 `claimsPdf`만 |
| 5 | `useApiError.ts` 수정 소유권 | ✅ step7:43 금지 + step8 담당 명시, **양방향 교차 참조**로 단독 실행 시 혼동 방지 |
| 6 | `password` upload/analyze 양쪽 | ✅ step5·step6 각각 폼필드 수용, step8이 analyze까지 전달(최우선 AC) |
| 7 | INV-2 LLM 재판정 금지 | ✅ step6:227 `toHaveBeenCalledTimes(0)` + "이 단정이 없으면 이 step은 미완료다" 명시 |

**추가 확인:** step5:50이 `vi.mock` 전체 모킹 시 에러 클래스가 대체되어 `instanceof` 판별이 깨지는
함정을 잡고 `importOriginal`로 에러 클래스·`isPdfBuffer`는 실제 구현 유지를 지시하고 있다.
이건 테스트가 **거짓 통과**할 수 있는 종류의 결함이라 중요하다.

## E. AC 품질

- 모호한 AC(`"잘 파싱한다"` 류)는 발견되지 않았다. 금액·건수가 숫자째로 박혀 있다.
- 오탐 위험 AC 존재 확인: 레댁션 게이트가 정상 거래행(`1,200,00012/3100,0000900,000` 같은 연속 숫자)을
  카드번호로 오탐하면 정상 업로드가 전부 422로 막히는데, step2가 **쉼표를 구분자로 인정 금지**를
  규칙으로 못 박고 정상 거래행 7개에 대한 **findings 빈 배열** AC를 두었다.
- frontend가 "PDF에서 기존 UI가 정상적으로 조용해지는 부분(`confidence:1`, 빈 `excludedColumns`)을
  Codex가 버그로 오인해 개조하지 말 것"을 step8에 명시한 것은 좋은 방어다.

## 실행 전 사용자에게 알릴 사항 (blocker 아님)

1. **미커밋 변경이 Codex 커밋에 휩쓸릴 수 있다.** `package-lock.json`에 153줄 삭제가 세션 시작 시점부터
   미커밋 상태로 있고, `.bkit/`이 untracked다. execute.py는 `feat-4-pdf-statement` 브랜치를 만들어
   커밋하므로, 실행 전 이 변경들을 정리(커밋/스태시/복원)할지 사용자에게 확인해야 한다.
2. **브랜치명이 이전 phase와 규칙이 다르다.** 기존은 `feat-db-schema`(phase 필드가 `db-schema`),
   이번은 `feat-4-pdf-statement`. phase-planning 스킬이 "`phase` 필드와 디렉토리 슬러그를 일치시켜라"라고
   지시하므로 이번 것이 스킬 준수이지만, 기존 규칙과 다르다는 점은 알려야 한다.

## 잔존 후속 과제 (이번 phase 범위 밖)

- **이력 상세 화면에 D2('이번 달 청구액 기준') 표기 불가.** `analyses` 테이블에 출처(CSV/PDF) 플래그가
  없어 Server Component가 PDF 여부를 알 수 없다. 이번 phase는 DB 변경 없음이 확정이므로
  업로드 직후 결과 화면에만 표기했다. `source` 컬럼 추가는 db-schema 후속 phase 과제.
- `구분: "해외"`는 NH 골든 출력에 나타나지 않는다(해외 상세 행이 청구금액 컬럼 부재로 자동 탈락).
  타입에 리터럴은 유지하고 분류기 단위테스트로만 검증한다 — 의도된 설계다.
