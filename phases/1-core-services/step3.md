# Step 3: llm 프로바이더 추상화 + 컬럼 매핑 추론

## 작업
`src/services/llm/`을 시작한다. TDD로 (1) Vercel AI SDK 기반 프로바이더 추상화와 (2) 컬럼 매핑 추론 함수를 구현한다. **테스트를 먼저 작성**하고 통과하는 구현을 작성한다.

### (1) 프로바이더 추상화 (`src/services/llm/provider.ts`)
- Vercel AI SDK의 provider 인터페이스로 Claude 하나만 감싼다. 분석 모델은 Opus 4.8(`claude-opus-4-8`).
- ADR-002 범위: **모델 선택 UI, 폴백, 여러 프로바이더 동시 지원을 만들지 않는다.** Claude 단일 연결만. 나중에 프로바이더 추가가 코드 몇 줄로 가능하도록 얇게 감싸기만 한다.
- 테스트에서 실제 Claude API를 호출하지 않도록, AI SDK 호출부를 주입/모킹 가능한 형태로 둔다(예: 모델 인스턴스를 반환하는 함수를 export). 유닛 테스트는 AI SDK를 모킹한다.

### (2) 컬럼 매핑 추론 (`src/services/llm/column-mapping.ts`)
공개 함수(정확한 시그니처):
```typescript
export function inferColumnMapping(input: {
  headers: string[];
  sampleRows: MaskedRow[];
}): Promise<ColumnMapping>;
```
- 입력은 **반드시 `MaskedRow[]`**(마스킹된 샘플 행)만 받는다. 원본 `RawRow[]`는 타입상 들어올 수 없다.
- 전체 행이 아니라 **샘플 행 일부만** Claude에 보낸다.
- date/merchant/amount/category 컬럼명과 `confidence`(0~1)를 추론한다.
- 프롬프트에 **"확신이 없으면 낮은 confidence를 반환하라"**를 명시해 억지 매핑을 만들지 않게 한다. 낮은 confidence는 에러가 아니라 정상 반환(사용자 확인 UI가 처리) — 함수는 낮은 confidence여도 throw하지 않는다.

## Acceptance Criteria
- [ ] (원본 미전달 CRITICAL — 타입) `inferColumnMapping`의 `sampleRows` 파라미터 타입이 `MaskedRow[]`이며, `RawRow[]`를 넘기면 컴파일 에러가 남을 `// @ts-expect-error` 테스트로 확인한다. 원본 값이 이 함수(및 프롬프트)에 도달하는 경로가 타입상 존재하지 않는다.
- [ ] AI SDK를 모킹한 상태에서, Claude가 반환한 매핑 JSON을 `ColumnMapping`으로 파싱해 반환하는 Vitest 테스트가 통과한다(date/merchant/amount/category/confidence 필드 확인).
- [ ] 낮은 confidence(예: 0.2)를 Claude가 반환한 경우에도 throw하지 않고 그대로 `confidence`에 담아 반환하는 테스트가 통과한다.
- [ ] 프롬프트 문자열에 헤더와 샘플 행만 포함되고, 마스킹 전 원본 값이나 전체 행이 포함되지 않음을 테스트/코드로 확인한다.
- [ ] (프로바이더 범위) provider 코드에 폴백 로직, 복수 프로바이더 분기, 모델 선택 파라미터 노출이 없음을 확인한다(ADR-002: 범위 밖).
- [ ] 유닛 테스트가 실제 외부 Claude API를 호출하지 않는다(AI SDK 모킹).
