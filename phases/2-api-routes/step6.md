# Step 6: POST /api/webhooks/polar — 스텁 (polar-billing phase에서 구현)

## 작업
`src/app/api/webhooks/polar/route.ts`에 `POST` 핸들러 **스텁만** TDD로 구현한다. 이번 phase는 `subscriptions` 엔타이틀먼트 스키마만 준비하는 단계이고(CLAUDE.md / ADR-006), 실제 서명 검증·구독 상태 갱신은 **`polar-billing` phase**에서 구현한다. 이 step은 라우트 자리만 잡고, 아직 아무 부수효과도 없음을 보장한다.

구현:
- `POST` 핸들러는 `501 { code: "NOT_IMPLEMENTED" }`를 반환한다.
- 구독 상태를 갱신하지 않는다 — `services/supabase-admin`이나 어떤 DB 쓰기도 호출하지 않는다.
- 파일 상단에 후속 구현 범위를 명시하는 짧은 주석 1줄만 남긴다(예: `// polar-billing phase: 서명 검증 후 subscriptions 갱신`). 서명 검증/웹훅 처리 로직은 작성하지 않는다.

CRITICAL 규칙 (이 스텁이 미리 위반하지 않도록):
- Polar 웹훅은 반드시 서명을 검증한 뒤에만 구독 상태를 갱신한다. 이 step은 검증 로직이 없으므로, **어떤 상태도 갱신하지 않는 것**이 유일하게 안전한 동작이다. 서명 검증 없이 구독을 갱신하는 코드를 절대 넣지 않는다.

## Acceptance Criteria
- [ ] `POST /api/webhooks/polar` 요청이 `501 { code: "NOT_IMPLEMENTED" }`를 반환하는 테스트가 통과한다.
- [ ] (부수효과 없음 CRITICAL) 이 라우트가 `services/supabase-admin` 및 어떤 DB 쓰기/`subscriptions` 갱신도 호출하지 않음을 grep/코드 검증으로 확인한다.
- [ ] 라우트 파일에 서명 검증·구독 갱신 실제 로직이 없고(스텁), 후속 phase 범위를 알리는 주석만 있음을 확인한다.
