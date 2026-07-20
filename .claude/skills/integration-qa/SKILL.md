---
name: integration-qa
description: "finsight의 phase/step 계획 검증 + Codex(scripts/execute.py) 실행 완료 후 코드의 통합 정합성·보안 불변식 점검 방법론. 계획 리뷰('이 step 계획 검토해줘'), 실행 후 코드 검증('통합 확인', 'QA', '경계면 점검') 요청 시 이 스킬을 먼저 로드한다."
---

# finsight 통합 정합성 검증 방법론

qa 에이전트는 두 시점에 이 스킬을 사용한다: (1) Codex 실행 **전**, 플래너가 쓴 step 계획이 충분한지 검증할 때, (2) Codex 실행 **후**, 실제 코드가 경계면 정합성과 보안 불변식을 지켰는지 검증할 때.

## 0. 계획 검증 (Codex 실행 전)

계획 단계의 결함은 코드 단계보다 훨씬 싸게 고칠 수 있다 — 여기서 놓치면 Codex가 잘못된 것을 그대로 구현해버린다.

- **AC가 검증 가능한 문장인가**: "잘 처리하라"류는 반려. "구분자 유무 두 케이스 모두 테스트 통과" 같은 구체적 조건으로 재작성 요청
- **CRITICAL 규칙이 step 파일 자체에 인용되어 있는가**: `docs/ADR.md`나 CLAUDE.md를 참조만 걸어둔 step은 위험하다. Codex는 그 step 파일과 자동 주입되는 AGENTS.md/docs만 보고 판단하므로, 이번 step에서 지켜야 할 규칙의 핵심 문장이 AC에 직접 옮겨져 있어야 한다
- **step 순서가 실제 의존성을 반영하는가**: `phases/{dir}/index.json`의 step 번호 순서가 csv-parser→pii-masking→llm, db-schema→api-routes 같은 실제 선행 관계와 맞는지
- **플래너 간 인터페이스 일치**: db-schema의 `_workspace/*_schema.md`, core-services의 `_interface.md`, api-routes의 `_contract.md`를 동시에 읽고, 서로 다른 플래너가 같은 데이터를 다르게 가정하고 있지 않은지 대조

## 1. 코드 검증 (Codex 실행 후)

두 컴포넌트가 각자 "올바르게" 구현되어도 연결 지점(경계면)에서 계약이 어긋나는 결함은 개별 검증으로 잡히지 않는다. 반드시 **양쪽을 동시에 읽어** 교차 비교한다. `npm run build` 통과는 타입 캐스팅이나 `any`가 있으면 여전히 런타임 실패를 숨길 수 있으므로, 빌드 성공을 정합성의 증거로 삼지 않는다. Codex가 `index.json`에 `completed`로 표시했다는 사실도 그대로 신뢰하지 않고, 실제 코드로 AC 충족 여부를 재확인한다.

### 경계면별 검증 절차

#### DB ↔ API
1. db-schema가 만든 테이블/컬럼명(`_workspace/*_db-schema_schema.md`)을 읽는다
2. api-routes의 `services/supabase-admin` 쿼리 코드를 읽는다
3. 컬럼명·타입이 정확히 일치하는지 확인한다 (snake_case ↔ camelCase 변환이 있다면 그 변환이 일관되게 적용되는지)

#### API ↔ 프론트
1. api-routes의 `NextResponse.json()` 호출부에서 실제 반환 shape을 추출한다 (계약 문서가 아니라 실제 코드 기준으로 재확인 — 문서가 코드보다 먼저 작성되고 나중에 코드가 바뀌었을 수 있다)
2. frontend의 fetch/훅 코드에서 기대하는 타입을 확인한다
3. 다음을 특히 주의: 래핑 여부(`{ data: [...] }`인데 훅이 배열을 직접 기대), 403/404/502 각각에 대한 프론트 분기 존재 여부, 즉시 응답과 지연 생성 응답의 shape 차이

#### core-services ↔ api-routes
1. 서비스 함수 시그니처(`_workspace/*_core-services_interface.md`)를 읽는다
2. 라우트의 실제 호출부를 읽는다
3. 인자/반환 타입 일치 확인 + **호출 순서**를 코드 흐름으로 추적: csv-parser 결과가 pii-masking을 거치지 않고 llm 서비스에 바로 전달되는 경로가 없는지

#### 파일 경로 ↔ 링크/미들웨어
1. `src/app/` 하위 page 파일 경로에서 실제 URL을 추출한다 (`(marketing)`, `(app)` 같은 route group은 URL에서 제거됨을 감안)
2. 코드 내 모든 `href`, `router.push`, `redirect` 값과 `middleware.ts`의 리다이렉트 조건을 대조한다
3. 로그인 상태별 양방향 리다이렉트(비로그인 시 `/dashboard`→`/login`, 로그인 시 `/`→`/dashboard`)가 실제로 성립하는지 확인

### 보안 CRITICAL 불변식 (개별 코드 리뷰가 아니라 흐름 추적으로 확인)

grep/코드 읽기로 다음을 직접 확인한다 — 존재 여부가 아니라 **위반 사례가 없음**을 확인하는 것이 목표다.

| 확인 항목 | 방법 |
|---|---|
| 원본 값이 LLM 프롬프트에 안 들어감 | `llm` 서비스 호출부로 전달되는 인자의 타입이 마스킹 완료 타입(`MaskedRow` 등)인지, 원본 타입을 받는 오버로드가 없는지 |
| 원본 CSV 미저장 | `fs.write`, Supabase Storage 업로드 호출, 원본 행을 통째로 `console.log`하는 코드가 없는지 grep |
| service-role 키 미노출 | `SUPABASE_SERVICE_ROLE_KEY` 참조가 `'use client'` 파일이나 `NEXT_PUBLIC_` 접두어 변수에 없는지 grep |
| 쓰기 경로 단일화 | 모든 `.insert(`/`.update(` 호출이 `services/supabase-admin` 내부에서만 발생하는지, 그 함수들이 소유권 검증 코드를 포함하는지 |
| Premium 지연 생성 준수 | `llm`의 Premium 생성 함수 호출부 앞에 구독 상태 확인 분기가 항상 존재하는지, 미구독 경로에서 호출되는 코드 경로가 없는지 |

### 점진적 검증 원칙

phase가 하나 실행될 때마다 그 즉시 관련된 경계만 먼저 검증한다. 예: `0-db-schema` phase 실행 완료 직후 스키마 자체(RLS 누락 등)를 점검, `2-api-routes` phase 완료 직후 DB↔API와 core-services↔api-routes 경계를 점검, `3-frontend` phase 완료 직후 API↔프론트와 파일경로↔링크 경계를 점검. 모든 phase 실행이 끝난 뒤 한 번에 몰아서 하면 초기 불일치가 후속 phase에 전파되어 수정 비용이 커진다.

## 리포트 작성

발견 사항은 추측이 아니라 파일:라인(계획 검증이면 phase-dir/step 번호) + 재현 조건 + 수정 방법을 함께 적는다. 통과/실패/미검증(대상 phase 미실행으로 아직 확인 불가) 세 상태를 구분해 누락 없이 기록한다.
