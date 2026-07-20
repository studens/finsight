# Step 3: POST /api/upload — 파싱/마스킹/컬럼매핑 추론

## 작업
`src/app/api/upload/route.ts`에 `POST` 핸들러를 TDD로 구현한다. 이 라우트는 업로드된 CSV를 **메모리에서만** 파싱·마스킹하고, 마스킹된 샘플로 컬럼 매핑을 추론해 반환한다. DB에 아무것도 쓰지 않는다. **테스트를 먼저 작성**한다.

요청: `multipart/form-data`, 필드 `file`(CSV 파일).

처리 순서(core-services `_workspace/02_core-services_interface.md`의 파이프라인 순서 준수):
1. `getSessionUser()`로 인증 확인. 없으면 `401 { code: "UNAUTHORIZED" }` 즉시 반환.
2. `file`을 `Buffer`로 읽는다(`await file.arrayBuffer()`). 없거나 비어 있으면 `400 { code: "BAD_REQUEST" }`.
3. `parseCsv(buffer)` → `ParsedCsv`.
4. `maskPii(parsed)` → `MaskedDataset`. (카드/계좌 뒤 4자리 마스킹, 이름/전화 컬럼 제외 — 이 경계를 거친 데이터만 llm으로 간다.)
5. `inferColumnMapping({ headers: masked.headers, sampleRows: masked.rows.slice(0, N) })` → `ColumnMapping`. 샘플은 **마스킹된 행**만 넘긴다.
6. 응답 `200`으로 `{ mapping, sample }` 반환. `sample`은 프론트 매핑 확인 UI가 보여줄 마스킹된 미리보기(`headers`, 앞 N행 `rows`, `excludedColumns`, `maskedColumns`).

응답 후 원본/파싱 데이터는 폐기한다(변수 스코프 종료로 GC). 어떤 경로로도 원본을 디스크/Storage/로그에 남기지 않는다.

계약 인용 (core-services):
- `parseCsv(input: Buffer | Uint8Array): ParsedCsv` — 인메모리 파싱, 출력은 **원본** `RawRow[]`.
- `maskPii(parsed: ParsedCsv): MaskedDataset` — `{ headers, rows: MaskedRow[], excludedColumns, maskedColumns }`.
- `inferColumnMapping(input: { headers: string[]; sampleRows: MaskedRow[] }): Promise<ColumnMapping>` — `ColumnMapping = { date, merchant, amount, category, confidence }`.

CRITICAL 규칙 (CLAUDE.md — 이 step에서 반드시 지킴):
- 외부 API 호출(llm/Supabase)은 `src/services/`를 통해서만. 라우트에서 Claude/Supabase를 직접 호출하지 않는다.
- CSV의 카드/계좌번호는 `maskPii`를 거쳐 뒤 4자리만 남긴 뒤에만 llm에 전달한다. `inferColumnMapping`에 넘기는 `sampleRows`는 반드시 `maskPii` 출력(`MaskedRow[]`)이어야 한다.
- 원본 CSV는 요청 처리 중 메모리에서만 다루고, 응답 후 폐기. 영구 저장 금지.

## Acceptance Criteria
- [ ] 인증된 요청이 유효한 CSV를 올리면 `200`과 `{ mapping, sample }`을 반환하고, `mapping`이 `ColumnMapping` shape(`date/merchant/amount/category/confidence`)인 테스트가 통과한다.
- [ ] (파이프라인 순서 CRITICAL) `inferColumnMapping`에 전달되는 `sampleRows`가 `maskPii`의 출력임을 확인하는 테스트가 통과한다 — `parseCsv`의 원본 `RawRow[]`가 llm 함수(`inferColumnMapping`)로 직접 전달되는 경로가 없다(mock 호출 인자 검증).
- [ ] 세션이 없으면 `parseCsv`/`maskPii`/`inferColumnMapping`을 호출하지 않고 `401 { code: "UNAUTHORIZED" }`를 즉시 반환하는 테스트가 통과한다.
- [ ] `file` 필드가 없거나 빈 요청이면 `400 { code: "BAD_REQUEST" }`를 반환하는 테스트가 통과한다.
- [ ] (원본 미보관 CRITICAL) 라우트 코드에 원본 CSV/파싱 결과를 디스크·Storage·로그에 남기는 호출(`fs.write*`, Storage 업로드, `console.log(원본)` 등)이 없음을 grep으로 확인한다. DB 쓰기도 없다(이 라우트는 읽기/쓰기 모두 DB에 접근하지 않음).
- [ ] (서비스 경유 CRITICAL) 라우트가 Claude SDK나 Supabase 클라이언트를 직접 import하지 않고, `services/*`(csv-parser, pii-masking, llm)와 `lib/supabase/server.ts`(세션 확인)만 사용함을 확인한다.
