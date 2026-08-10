# PROJECT HANDOFF

_최종 갱신: 2026-08-10_

## CURRENT STATE

**브랜치:** `feat-6-polar-billing` (main `f83cb0d`보다 **14커밋 앞섬, 미머지**). 이 문서(`handoff.md`) 자체도 아직 미커밋(untracked).

**검증 실측(2026-08-10 재실행):** `npm run typecheck` 통과 / `npm run lint` **0 errors**(warning 2건은 `eslint.config.mjs`·`postcss.config.mjs`의 기존 익명 default export) / `npm run test` **49 files, 409 tests 전부 통과**. `npm run test:e2e`는 package.json에 스크립트 자체가 없음.

**phase 진행:** `phases/index.json`의 0~6 전부 `completed`.

```
0-db-schema → 1-core-services → 2-api-routes → 3-frontend
→ 4-pdf-statement → 5-logout → 6-polar-billing
```

**파이프라인 (업로드 → 리포트)**

```
CSV/PDF 업로드
  → POST /api/upload   : 파일 판별, PDF는 pdf-parser(비밀번호 지원)
  → pii-masking        : 카드/계좌 뒤 4자리만, 이름·전화 컬럼은 제외
  → LLM 컬럼 매핑(사용자 확인 화면)
  → POST /api/analyze  : Free 요약 계산·저장 (원본 파일 미저장, 메모리에서만)
  → /dashboard         : 이력 목록
  → /dashboard/[id]    : Free 카드 + Premium 잠금 카드
  → GET /api/reports/[analysisId]/[reportType]
       구독 active면 최초 조회 시 생성 후 analyses.premium_reports에 캐시(lazy)
       미구독이면 403 PAYWALL_REQUIRED (생성 시도 안 함)
```

**결제 파이프라인 (6-polar-billing)**

```
PremiumSection CTA
  → POST /api/checkout        : 세션 검증 → 이미 active면 409 → Polar 체크아웃 URL 반환
  → Polar Hosted Checkout
  → /dashboard?checkout=success (서버 렌더 배너 1회, history.replaceState로 쿼리 정리)

Polar 웹훅
  → polar listen(로컬 터널) → POST /api/webhooks/polar
  → services/polar: validateEvent 서명 검증 → resolveUserId → 상태 매핑
  → services/supabase-admin: upsertSubscriptionStatus(onConflict: user_id)
```

**LLM 프로바이더:** `src/services/llm/provider.ts` — primary `anthropic`/`claude-opus-4-8`, 실패 시 fallback `openai`/`gpt-5.1`. 두 키 모두 유효 확인. `maxOutputTokens` 미설정(ISSUES 6).

**환경변수(`.env.local`, 전부 설정 완료):** Supabase 3개, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Polar 5개(`POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` / `POLAR_PRODUCT_ID=bf1600f8-7e5c-45cb-843c-728ec579cce4` / `POLAR_SERVER=sandbox` / `NEXT_PUBLIC_APP_URL`). `.env.example`에 문서화됨.

**Polar 샌드박스:** CLI v1.3.9(`/usr/local/bin/polar`). 로컬 웹훅은 `polar listen http://localhost:3000/api/webhooks/polar`로 터널링. **결제 → 웹훅 → `subscriptions` 갱신 end-to-end 확인 완료.** 대시보드 엔드포인트 등록은 Vercel 배포 후 작업. 프로덕션 조직 미생성(심사 24~72시간~2주).

---

## DONE

**`6-polar-billing` phase 전체 (계획 → 실행 → QA 검증)**

- 계획 팀(core-services / api-routes / frontend / db-schema / qa)으로 step 계획 작성 → QA 1차에서 BLOCKER 2 + MAJOR 5 → 전부 수정 → 재검증 통과(BLOCKER 0, MAJOR 0)
- `execute.py`로 5개 step 실행, 전부 `completed`
  - step 0: `src/services/polar/{client,checkout,webhook,subscription-status,errors,index}.ts` + 테스트
  - step 1: `POST /api/checkout`
  - step 2: `/api/webhooks/polar` 501 스텁 → 서명 검증 + `subscriptions` upsert, `upsertSubscriptionStatus`/`isUnknownUserError` 추가
  - step 3: `PremiumSection` 체크아웃 CTA + `CheckoutSuccessBanner`
  - step 4: 웹훅 payload 파싱 실패를 5xx로 분리 (QA 코드검증 M-1)
- QA 코드 검증 **CRITICAL 0건**. `.next/static/`에 `POLAR_*`·service-role·`polar-sh` 참조 0건 실측

**샌드박스 결제 end-to-end 확인 완료 — 머지 차단 해제**

`subscriptions` 행이 `2026-08-10T07:04:34.552+00:00`에 `status='active'`로 갱신됨(DB 실측). 매핑상 `'active'`를 만드는 이벤트는 `subscription.active`/`subscription.uncanceled` **둘뿐**이므로, 이 행이 곧 **`subscription.active`가 실제로 도착했다는 증거**다. 서명 검증 → `externalCustomerId` 역참조 → upsert 전 구간 동작 확인. 우려했던 "`created`만 오고 `active`는 안 옴" 시나리오가 아니었고 **매핑 추가는 불필요**. `subscriptions` 실제 컬럼은 `id/user_id/status/created_at/updated_at` 5개로 `polar_subscription_id`는 없다(ADR-006 개정과 일치).

**문서 갱신** — `docs/ADR.md` ADR-006에 개정 블록 추가(마이그레이션·`polar_webhook_events`가 불필요해졌음을 명시. 이 문서는 `execute.py`가 Codex에 주입하므로 정정이 필수였음), `.env.example`에 Polar 5키 문서화.

**Premium 리포트 미생성 원인 특정(수정은 미착수)**

- 배제한 원인: 모델 ID 유효 / 구독 active / LLM 출력 10회 전부 정상(펜스·잘림·인덱스 위반 0) / OpenAI 폴백 유효 / 타임아웃 아님
- 생성 지연 실측: `mom_comparison` 2.6s / `anomaly_detection` 6.1s / `savings_suggestions` 20.9s / `budget_recommendation` 16.3s
- 근본 원인 = `premium_reports` 덮어쓰기 경쟁(ISSUES 1)

---

## IN PROGRESS

- **`feat-6-polar-billing` → main 머지 — 조건 충족, 실행만 남음.** 사용자 조건이던 샌드박스 수동 테스트가 통과했다(DONE 참조). 머지를 막는 항목은 더 이상 없다.
- **Premium 리포트 경쟁 상태 수정 미착수.** 원인·위치·수정 방향까지 확정됐으나 사용자가 중단 요청("멈춰줘"). 코드는 그대로라 재발 예정. 이 결함들은 **main에 이미 존재**하며 `feat-6-polar-billing`은 `src/app/api/reports/**`를 건드리지 않는다 → 머지와 독립적으로 처리 가능.

---

## TODO

우선순위 순.

1. **`route.ts:78`의 `catch {}` 제거** — 에러 코드/스택 없이 502만 반환해 프로덕션 진단이 불가능. 2번보다 먼저 하면 재발 시 즉시 원인 파악 가능.
2. **`premium_reports` 덮어쓰기 경쟁 수정** — 읽고-쓰기(`supabase-admin/index.ts:29-61`)를 원자적 jsonb 병합(`premium_reports = premium_reports || $1` RPC)으로 교체. 클라이언트 동시 클릭 차단은 보조 방어선.
3. **`upsertPremiumReport` 호출을 try/catch 안으로**(`route.ts:82`) — 현재 DB 쓰기 실패가 처리되지 않은 500으로 나가고 생성 결과가 유실된다.
4. **main 머지** — 선행 조건(샌드박스 결제 확인) 충족됨. `handoff.md` 커밋 여부도 이때 결정. 1~3번과 순서 무관(reports 경로는 이 브랜치에 없음).
5. **`provider.ts`에 `maxOutputTokens` 설정** — 출력 잘림 방어.
6. **`CLAUDE.md` / `AGENTS.md` 스테일 문장 정리** — "이번 phase는 `subscriptions` 스키마만 준비하고 실제 체크아웃/웹훅은 후속 `polar-billing` phase에서" 괄호가 이제 거짓. `AGENTS.md`는 Codex에 주입되므로 다음 phase에서 오해를 유발.
7. **웹훅 순서 역전 방어(QA M-2)** — `last_event_at` 가드 컬럼. 마이그레이션이 정당화되는 유일한 시점.
8. **Playwright E2E 셋업** — `playwright.config.*` 없음, package.json에 `test:e2e` 스크립트 없음. `docs/BROWSER-TEST-SCENARIOS.md`를 스펙으로 사용.
9. **Vercel 배포 + Polar 대시보드 웹훅 엔드포인트 등록**(Format `Raw`, 이벤트 5종) → 이후 프로덕션 Polar 조직 생성·심사.

---

## IMPORTANT DECISIONS

**1. 구독 해제는 `subscription.revoked` 하나로만 일어난다 (ADR-006 준수)**

| 이벤트 | status |
|---|---|
| `subscription.active`, `subscription.uncanceled` | `'active'` |
| `subscription.revoked` | `'inactive'` |
| `subscription.canceled`, `subscription.past_due` | **무시**(상태 변경 없음), 200 |

초안은 `canceled`/`past_due`도 `'inactive'`로 뒤집었으나 **ADR-006 위배**("취소해도 결제된 기간이 끝날 때까지 Premium 유지"). Polar에서 `canceled`는 해지 *예약*이고 실제 종료는 `revoked`, `past_due`는 dunning 중이라 유예가 맞다. **되돌리지 마라** — `subscription-status.ts` 상수 키가 정확히 3개임을 단정하는 테스트 + 독립 회귀 테스트로 고정.

**2. DB 마이그레이션 없음 (ADR-006 개정)**

Polar 고객 ↔ Supabase 사용자 매핑은 체크아웃 시 `externalCustomerId`에 `user.id`를 실어 보내고 웹훅에서 역참조. 쓰기가 `user_id` 유니크 키 upsert 1회라 구조적으로 멱등 → Polar 최대 10회 재시도에도 안전. `polar_subscription_id`에 unique를 걸면 해지 후 재구독 시 충돌하는 새 실패 모드가 생긴다. `polar_webhook_events` dedup 테이블도 불필요.

**3. `@polar-sh/sdk` 옵션은 `environment`가 아니라 `server`, 기본값이 `production`**

`config.js:24`에 `const server = options.server ?? ServerProduction;`이 실재. `POLAR_SERVER`를 안 읽거나 오타 나면 **샌드박스 토큰으로 프로덕션 결제 API를 때린다.** 두 값 중 하나가 아니면 throw하는 규약 유지.

**4. 서명 검증은 SDK `validateEvent()`만 사용. 직접 HMAC 구현 금지**

Polar은 Standard Webhooks 사양이고 SDK 내부에서 secret을 base64 인코딩한다. 프로덕션 코드가 또 base64하면 전부 실패(`webhook.ts`에 `toString("base64")` 0건이 AC).

**5. `Headers` 인스턴스를 그대로 `validateEvent`에 넘기면 정상 요청도 검증 실패**

`normalizeHeaders()`로 평범한 객체로 변환하는 것이 load-bearing(대소문자는 `standardwebhooks`가 자체 처리). 지우면 프로덕션에서 **모든 웹훅이 403**.

**6. 웹훅 응답 코드 계약 — Polar은 실패 시 최대 10회 지수 백오프 재시도**

재시도로 해결 불가능한 상황에 5xx를 주면 무한 재시도가 된다.

| 상황 | 응답 |
|---|---|
| 서명 검증 실패 | 403 `INVALID_SIGNATURE` (본문에 사유 금지) |
| 설정 누락 `PolarConfigError` | 500 (403으로 뭉개지 말 것) |
| 미지원 이벤트 / user_id 해석 불가 / 미지 사용자 | **200 무시** |
| 처리 대상 이벤트의 payload 파싱 실패 | **5xx** (step 4에서 추가) |
| 일시적 DB 오류 | 5xx |

step 4 근거: SDK는 "알 수 없는 타입"과 "알고 있는 타입의 스키마 파싱 실패"를 똑같이 `SDKValidationError`로 던지고 깨진 JSON은 `SyntaxError`로 온다 → 에러 클래스만으로 분류 불가. 그래서 raw body의 `type`을 읽어 분류하되 **"처리 대상이 아님을 적극적으로 확인했을 때만 200"**, 확인 불가면 던진다. `route.ts`는 이미 검증 에러가 아닌 모든 throw를 500으로 떨어뜨리므로 **무수정**이며, 그 catch-all이 이제 계약이라 `route.test.ts`에 고정돼 있다.

**7. 이미 구독 중인 사용자의 체크아웃은 409로 차단**

MVP는 단일 상품이라 두 번째 체크아웃은 이중 청구뿐. `subscriptions.user_id`가 unique + `status` 2값이라 활성 구독 2개는 스키마상 표현 불가. 취소·환불 UI가 범위 밖이라 사용자가 되돌릴 방법이 없다. 차단의 최악은 "버튼이 안 눌린다", 허용의 최악은 "돈 낸 고객에게 또 청구".

**8. 결제 복귀는 서버 렌더 배너 1회. 폴링·자동 refresh 없음**

`docs/ARCHITECTURE.md`에 "폴링·Realtime 구독 없음" 전제. 쿼리 정리는 `history.replaceState` — `router.replace`를 쓰면 서버 재렌더로 **배너 자신이 사라진다**. 409도 새 에러 UI 없이 `useApiError` 기본 문구로 처리.

**9. 쓰기 경계 유지 — `subscriptions`에 INSERT/UPDATE RLS 정책을 추가하지 않는다**

쓰기 정책을 열면 브라우저에서 사용자가 자기 `status`를 `'active'`로 바꿔 페이월을 우회한다. 쓰기는 `services/supabase-admin`의 service-role 경로로만. `getSubscriptionStatus`(읽기) 수정 금지.

**10. `_workspace/`는 Codex에 주입되지 않는다**

`execute.py` 프리앰블은 `AGENTS.md` + `docs/*.md`만 붙인다. 규약 문서 중 Codex가 알아야 할 내용은 `step{N}.md` 본문에 복사해 넣어야 한다.

---

## ISSUES / RISKS

**1. [높음] `premium_reports` 덮어쓰기 경쟁 — 미수정, 재발 예정**

`src/services/supabase-admin/index.ts:29-61`이 `premium_reports`를 읽어 spread한 뒤 통째로 UPDATE한다. jsonb 병합도 낙관적 락도 없는데 그 사이 LLM 생성이 6~21초 걸린다.

`src/components/PremiumSection.tsx:186`의 `loading`이 **단일 `ReportType | null`**이라 같은 카드 재클릭만 막는다(`:216`). 다른 카드를 누르면 두 요청이 나란히 달리고 **나중 쓰기가 앞선 결과를 지운다.**

실제 DB 증거 — `27aaa9b7`: 4/4 캐시, `cb0eefa6`: 2/4(`anomaly_detection`·`budget_recommendation` 유실), `deffb84a`: 0/4. 카드를 하나씩 누르면 정상이라 간헐적으로 보인다.

**2. [높음] `route.ts:78`의 `catch {}`가 진단을 불가능하게 만든다**

```ts
} catch {
  return NextResponse.json({ code: "GENERATION_FAILED" }, { status: 502 })
}
```

에러 종류·스택·컨텍스트가 전부 사라진다. 1번 원인 특정에 LLM 재호출 10회 + DB 조회 + 지연 측정이 필요했던 이유.

**3. [중간] `upsertPremiumReport`가 try/catch 밖 (`route.ts:82`)** — DB 쓰기 실패 시 처리되지 않은 500이 나가고, 생성은 성공했는데 결과가 유실된다.

**4. [중간] 웹훅 순서 역전 (QA M-2)** — `revoked`가 DB 장애로 지연 재시도되는 동안 사용자가 재구독하면, 뒤늦게 도착한 `revoked`가 `active`를 덮어써 **결제 중인 사용자가 Premium을 잃는다.** upsert 멱등성은 중복 배달만 막고 순서는 못 막는다. `last_event_at` 가드 컬럼 필요.

**5. [해소] ~~활성화 시 실제로 오는 이벤트를 코드로 검증 불가~~** — 샌드박스 결제로 `subscription.active` 수신 및 `status='active'` 갱신 확인(DONE 참조). 매핑 변경 불필요.

**6. [낮음] `provider.ts`에 `maxOutputTokens` 미설정** — 거래가 많아 이상거래 목록이 길어지면 출력이 잘려 `JSON.parse`가 깨진다. 현재 데이터(24건)에서는 미재현.

**7. [낮음] 리포트 파서가 `every()`로 전부 또는 전무** — `anomaly-detection.ts:37`, `savings-suggestions.ts:35`. 항목 하나가 검증에 실패하면 리포트 전체를 버린다. 유효 항목만 남기는 편이 견고.

**8. [낮음] 스테일 문서** — `CLAUDE.md`/`AGENTS.md`의 "스키마만, 실제 연동은 후속 phase에서" 괄호가 거짓(`AGENTS.md`는 Codex 주입 대상이라 실질 위험). `_workspace/02_db-schema_polar-mapping.md`에 재번호 전 step 표기 잔존(주입 대상 아님).

**9. [낮음] 미머지 브랜치 3개** — `feat-6-polar-billing`(14커밋 앞), `feat-4-pdf-statement`, `feat-5-logout`. 후자 둘은 이미 main에 반영된 내용일 가능성이 높으나 정리되지 않았다.

**10. [정보] `.mcp.json`이 커밋됨** — Supabase MCP 서버 설정(URL만, 시크릿 없음). 사용자 결정으로 저장소에 커밋.
