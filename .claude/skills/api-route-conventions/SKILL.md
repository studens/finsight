---
name: api-route-conventions
description: "finsight의 API Route(src/app/api/*)와 middleware.ts 작성 규칙 — 소유권 검증, 페이월 게이팅(403/404/502 에러 코드 계약), 읽기/쓰기 경계 분리 패턴. app/api 하위 라우트 핸들러를 새로 만들거나 수정할 때, 인증/구독 상태 분기를 다룰 때 반드시 이 스킬을 먼저 로드한다."
---

# API Route 작성 규칙

> **사용 방식:** api-routes 에이전트가 이 내용을 직접 구현하지 않는다. 아래 원칙을 `phase-planning` 스킬 형식에 맞춰 Codex가 실행할 step의 작업 지시문·Acceptance Criteria로 옮겨 적는 데 사용한다.

finsight의 API Route는 서비스 계층(core-services)과 DB(db-schema)를 조합해 실제 비즈니스 규칙 — 소유권, 페이월, 에러 계약 — 을 강제하는 유일한 계층이다. 여기서 검증을 빼먹으면 RLS도, 서비스 계층도 그 구멍을 대신 막아주지 않는다.

## 소유권 검증은 서비스 호출 전에, 코드로 직접

`services/supabase-admin`으로 쓰기 전에 반드시 `user_id` 일치를 코드에서 확인한다. service-role 클라이언트는 RLS를 우회하므로, 여기서 확인하지 않으면 다른 사용자의 레코드를 수정/조회할 수 있게 된다.

```typescript
// GET /api/reports/[analysisId]/[reportType]
const analysis = await getAnalysisById(analysisId); // lib/supabase/server.ts, RLS 적용 읽기
if (!analysis || analysis.user_id !== session.user.id) {
  return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
}
```

RLS 적용 클라이언트로 조회했다면 애초에 다른 사용자의 레코드는 안 보이므로 `null`이 곧 "존재하지 않거나 내 것이 아님"이 된다 — 이 경우도 404로 통일해, "존재하지만 남의 것"이라는 정보를 노출하지 않는다.

## 페이월 게이팅: 확인 → 캐시 → 생성 순서를 반드시 지킨다

```
1. 소유권 확인 (실패 시 404)
2. 구독 상태 확인 — RLS 적용 클라이언트로 조회 (미구독 시 403 PAYWALL_REQUIRED, 여기서 종료)
3. 캐시된 리포트 존재 확인 (있으면 즉시 반환, llm 호출 없음)
4. 캐시 없으면 llm 서비스로 생성 → supabase-admin으로 upsert → 반환
```

2번과 3번의 순서를 바꾸면 안 된다 — "캐시가 있으니 일단 보여주고 구독 체크는 나중에"가 되면 미구독 사용자가 한 번이라도 생성된 캐시를 볼 수 있는 구멍이 생긴다. 구독 확인이 항상 먼저다.

## 에러 코드 계약

| 상황 | HTTP | code |
|---|---|---|
| 리소스 없음/소유권 불일치 | 404 | `NOT_FOUND` |
| 미구독 사용자의 Premium 요청 | 403 | `PAYWALL_REQUIRED` |
| LLM 생성 실패 | 502 | `GENERATION_FAILED` |

이 코드는 frontend가 그대로 분기해서 에러 모달을 띄우는 계약이다. 새 에러 케이스를 추가할 때도 이 패턴(HTTP 상태 + 명확한 `code` 필드)을 따르고, 변경 시 frontend 담당자에게 반드시 알린다.

## 읽기/쓰기 경계

- 읽기: `lib/supabase/server.ts` (세션 기반, RLS 적용) — Server Component와 API Route의 조회 모두 이걸 쓴다
- 쓰기: `services/supabase-admin` → `lib/supabase/service.ts` (service-role) — API Route에서만, 그리고 반드시 이 서비스 경유로만
- 라우트 핸들러 안에서 `lib/supabase/service.ts`를 직접 import하지 않는다 — 항상 `services/supabase-admin`이 감싸고, 그 안에서 소유권 검증 로직을 함께 캡슐화한다

## 계약 문서 작성

각 엔드포인트 구현 완료 시 `_workspace/*_api-routes_contract.md`에 실제 요청/응답 JSON 예시를 남긴다. frontend와 qa가 코드를 다시 읽지 않고도 이 문서만으로 shape을 신뢰할 수 있어야 한다. 예시:

```markdown
### GET /api/reports/:analysisId/:reportType
성공(200): { "reportType": "mom_comparison", "data": { ... } }
미구독(403): { "code": "PAYWALL_REQUIRED" }
소유권 불일치(404): { "code": "NOT_FOUND" }
생성 실패(502): { "code": "GENERATION_FAILED" }
```
