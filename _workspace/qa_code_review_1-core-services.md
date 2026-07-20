# QA 코드 검증 리포트 — phase 1-core-services

- 검증자: qa-3
- 브랜치: feat-core-services
- 일시: 2026-07-20
- 대상: src/types/pipeline.ts, src/services/{csv-parser, pii-masking, llm/**}
- 결과: **PASS** (7/7 step completed, 테스트 30/30 통과, tsc --noEmit exit 0)

## 종합 판정
계획(step0~6.md) 및 인터페이스 계약(_workspace/02_core-services_interface.md)과 실제 코드가 일치한다.
보안 CRITICAL 불변식 위반 없음. 블로커 없음. 관찰 사항 1건(비블로커) 하단 기록.

## 검증 실행 근거 (자기보고에 의존하지 않음)
- `npx vitest run` → Test Files 10 passed, Tests 30 passed.
- `npx tsc --noEmit` → exit 0. 이로써 `.test-d.ts`의 모든 `@ts-expect-error`가 실제로 발화됨을 확인
  (미발화 시 unused directive로 tsc가 실패하므로, 타입 레벨 경계가 진짜로 강제됨).

## 1. 브랜디드 MaskedRow 경계 — PASS
- 프로덕션 코드에서 `MaskedRow` 브랜드를 부여하는 지점은 pii-masking/index.ts:74 `return processedRow as MaskedRow` **단 한 곳**.
  grep 결과 그 외 `as MaskedRow` / `as unknown as MaskedRow`는 전부 `*.test.ts`/`*.test-d.ts`의 픽스처 생성용으로,
  프로덕션 경로에서 브랜드를 위조하는 코드 없음.
- llm 진입점 전부 MaskedRow/AnalysisRecord만 인자로 받음(column-mapping.ts:42-45, free-summary.ts:54-57,
  reports/*.ts 및 index.ts:11-15). RawRow를 받는 오버로드 없음.
- 타입 레벨 강제 확인(tsc 통과로 검증됨):
  - pipeline.test-d.ts:5 — RawRow → MaskedRow 대입 거부
  - column-mapping.test-d.ts:9 — RawRow[]를 inferColumnMapping에 전달 거부
  - free-summary.test-d.ts:7 — RawRow[]를 generateFreeSummary에 전달 거부
  - reports.test-d.ts:17,20 — AnalysisRecord.maskedTransactions에 RawRow 주입 거부
  → 원본이 Claude로 가는 경로가 타입상 존재하지 않음.

## 2. pii-masking 정확성 — PASS
- 카드/계좌 뒤 4자리만 남김: 구분자 있음/없음 두 케이스 모두 테스트 커버.
  - 카드: index.test.ts:16-29 ("1234-5678-9012-3456"→"****-****-****-3456", "1234567890123456"→"************3456")
  - 계좌: index.test.ts:31-44 (구분자 유/무 모두)
- 이름/전화 등 신원 컬럼은 마스킹이 아니라 **키 자체 제거**: index.test.ts:46-59에서
  `"이름" in result.rows[0] === false`, `excludedColumns` 포함으로 명시 검증.
- 짧은/빈/null 셀 안전 처리 + 헤더 키워드 없이도 13~16자리 숫자 감지: index.test.ts:61-107.
- 입력 원본 불변(비파괴) 확인: index.test.ts:109-119 (input.rows[0].card 원본 유지, 결과는 새 객체).

## 3. 원본 미보관 — PASS
- `src/services/`, `src/types/pipeline.ts` 대상 grep: `fs.`/`writeFile`/`Storage`/`storage.`/원본행 `console.log`
  프로덕션 코드에 **없음**.
- csv-parser는 Buffer/Uint8Array를 인메모리 디코딩·파싱만 수행(디스크/로그 기록 없음, index.ts:6-34).

## 4. Premium 리포트 4종 — PASS
- reportType 리터럴 = ReportType(pipeline.ts:45-49) = premium_reports jsonb 키
  (_workspace/02_db-schema_schema.md:20 `mom_comparison, anomaly_detection, savings_suggestions, budget_recommendation`)
  → 3자 정확히 일치.
- 디스패처 reports/index.ts:18-27 switch가 4종 전부 처리, exhaustive.
- **역할 침범 없음(설계상 의도 준수)**: 각 리포트 함수에 구독 상태 확인/DB 조회 코드 없음.
  인자로 받은 current/previous(AnalysisRecord)만 사용하고 결과만 반환 → 페이월·DB는 api-routes 책임으로 올바르게 분리.
- 계산 위임 원칙 준수: mom-comparison은 수치를 코드로 계산하고 Claude엔 해석 문장만 요청(mom-comparison.ts:37-60),
  free-summary는 카테고리 미매핑 시에만 Claude 분류 호출(free-summary.ts:59-61, 테스트 free-summary.test.ts:56-57,115-116으로
  "매핑 시 Claude 미호출 / 미매핑 시 1회 호출" 검증).

## 5. 경계면 정합성 (core-services ↔ db-schema/api-routes 계약) — PASS
- 파이프라인 순서 parseCsv(RawRow) → maskPii(MaskedDataset) → llm(MaskedRow/AnalysisRecord)가
  타입으로 강제됨(위 1항). maskPii를 건너뛴 데이터가 llm에 도달하는 경로 없음.
- FreeSummary shape이 analyses.free_summary jsonb와 일치(interface.md:24-29).
- 리포트 결과 타입(pipeline.ts:58-108)이 premium_reports 캐시에 그대로 저장 가능한 순수 JSON 구조.

## 관찰 사항 (비블로커, 리더 참고)
- **PII 컬럼 제외가 헤더 키워드 매칭 기반**(pii-masking/index.ts:8-17, 50-53).
  전화번호는 한국 기준 11자리라 `isObviousSensitiveNumber`의 13~16자리 임계값(index.ts:31)에 걸리지 않는다.
  따라서 헤더에 알려진 키워드(이름/전화/name/phone 등)가 없는 **비표준 헤더의 전화번호 컬럼**은
  제외되지도, 값 감지로 마스킹되지도 않아 LLM에 전달될 수 있다.
  - 성격: 설계상 "컬럼 제외 = 헤더 키워드 기반"이라는 인터페이스 계약(interface.md:54)에 부합하므로 step AC 위반은 아님.
    다만 실제 은행/카드사 CSV 헤더 다양성을 고려하면 잔여 리스크. 향후 컬럼 매핑(inferColumnMapping) 결과를 활용해
    "매핑되지 않은 미지 컬럼은 LLM 전달에서 배제" 같은 방어를 api-routes/후속 phase에서 검토 권장.
  - 카드/계좌(13~16자리)는 키워드+값 감지 이중으로 커버되므로 이 리스크는 전화·주민번호류 식별자에 한정.
