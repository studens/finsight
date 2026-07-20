# Step 1: csv-parser 서비스 — 인코딩 감지 + 인메모리 파싱

## 작업
`src/services/csv-parser/`에 CSV 파싱 서비스를 TDD로 구현한다. **테스트를 먼저 작성**하고, 통과하는 구현을 작성한다.

공개 함수(정확한 시그니처):
```typescript
// src/services/csv-parser/index.ts
export function parseCsv(input: Buffer | Uint8Array): ParsedCsv;
```
- `ParsedCsv`는 `src/types/pipeline.ts`(step 0)의 타입을 import해서 쓴다: `{ headers: string[]; rows: RawRow[]; rowCount: number }`.
- 반환하는 `rows`는 아직 마스킹되지 않은 `RawRow[]`다(마스킹은 step 2 pii-masking 책임).

동작:
- **인코딩 감지 후 UTF-8로 정규화**: 국내 카드사 CSV는 EUC-KR/CP949가 흔하다. 바이트 버퍼를 받아 인코딩을 감지하고 UTF-8 문자열로 디코딩한 뒤 파싱한다.
- 첫 행을 헤더로, 나머지를 데이터 행으로 파싱한다. 각 행은 `{ [헤더명]: 셀값(string) }` 형태의 `RawRow`.
- **완전 인메모리 처리**: 함수는 버퍼를 인자로 받아 파싱 결과 객체만 반환한다. 파일을 디스크/Storage에 쓰지 않고, 파일 경로나 행 내용을 로그로 남기지 않는다.

## Acceptance Criteria
- [ ] `parseCsv`가 UTF-8 CSV 버퍼를 받아 `headers`, `rows`(RawRow[]), `rowCount`를 올바르게 반환하는 Vitest 테스트가 통과한다.
- [ ] EUC-KR/CP949로 인코딩된 한글 헤더/값 CSV 버퍼를 넣어도 UTF-8 문자열로 정규화되어 한글이 깨지지 않고 파싱되는 테스트가 통과한다.
- [ ] 빈 파일, 헤더만 있고 데이터 행이 없는 파일에 대해 크래시 없이 `rows: []`, `rowCount: 0`을 반환하는 테스트가 통과한다.
- [ ] 셀 값에 쉼표가 포함된 따옴표 감싼 필드(예: `"서울, 강남"`)가 하나의 값으로 파싱되는 테스트가 통과한다.
- [ ] (원본 미보관 CRITICAL) `src/services/csv-parser/` 코드에 파일을 디스크/Storage에 쓰는 호출(`fs.writeFile`, `writeFileSync`, storage upload 등)이 없고, 행 내용·파일 경로를 출력하는 로깅(`console.log`(rows/파일) 등)이 없음을 grep으로 확인한다. 함수는 버퍼 입력 → 결과 객체 반환만 한다.
- [ ] `parseCsv`의 반환 타입이 `ParsedCsv`이며 `rows`는 `MaskedRow[]`가 **아니다**(csv-parser는 마스킹하지 않는다 — 원본을 그대로 반환하고, 마스킹은 다음 단계 책임임을 타입으로 드러낸다).
