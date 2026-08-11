# PROJECT HANDOFF

_최종 갱신: 2026-08-11 16:10_

## CURRENT STATE

**브랜치:** `main`만 존재하며 **`origin/main`과 동기화됨**(`6251895`). `feat-7-premium-report-fix`는 `--no-ff` 머지(`3d6e6fb`) 후 삭제. 로컬 feature 브랜치 4개(`feat-4-pdf-statement` `feat-5-logout` `feat-6-polar-billing` `feat-7-premium-report-fix`) 전부 main 포함을 확인하고 삭제했다. **원격에는 `origin/feat-4-pdf-statement`(main보다 2커밋 뒤처진 스테일)와 `origin/docs/finsight-mvp-planning`이 아직 남아 있다.**

**검증 실측(2026-08-11 16:11 재실행):** `npm run typecheck` 통과 / `npm run test` **49 files, 412 tests 전부 통과** / `npm run lint` **0 errors, 2 warnings**(warning은 `eslint.config.mjs`·`postcss.config.mjs`의 기존 익명 default export). 이전에 보였던 716 errors / 7622 warnings는 `eslint.config.mjs` ignores에 `private/**`를 추가해 사라졌다 — 다만 디스크의 168M은 아직 남아 있다(ISSUES 1).

**phase 진행:** `phases/index.json` 0~7 전부 `completed`, **8-qa-minor는 `pending`(계획 작성 완료, 아직 실행 안 됨)**.

```
0-db-schema → 1-core-services → 2-api-routes → 3-frontend
→ 4-pdf-statement → 5-logout → 6-polar-billing → 7-premium-report-fix(completed)
→ 8-qa-minor(pending, 4 steps)
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
       구독 active면 최초 조회 시 생성 → merge_premium_report RPC로 원자적 캐시(lazy)
       미구독이면 403 PAYWALL_REQUIRED (생성 시도 안 함)
```

**결제 파이프라인 (6-polar-billing, 샌드박스 end-to-end 확인 완료)**

```
PremiumSection CTA → POST /api/checkout(이미 active면 409) → Polar Hosted Checkout
  → /dashboard?checkout=success (서버 렌더 배너 1회, history.replaceState로 쿼리 정리)
Polar 웹훅 → polar listen(로컬 터널) → POST /api/webhooks/polar
  → services/polar: validateEvent 서명 검증 → resolveUserId → 상태 매핑
  → services/supabase-admin: upsertSubscriptionStatus(onConflict: user_id)
```

**LLM 프로바이더:** `src/services/llm/provider.ts` — primary `anthropic`/`claude-opus-4-8`, 실패 시 fallback `openai`/`gpt-5.1`. `maxOutputTokens` 미설정(ISSUES 5).

**환경변수(`.env.local`, 전부 설정 완료):** Supabase 3개, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Polar 5개(`POLAR_ACCESS_TOKEN` / `POLAR_WEBHOOK_SECRET` / `POLAR_PRODUCT_ID=bf1600f8-7e5c-45cb-843c-728ec579cce4` / `POLAR_SERVER=sandbox` / `NEXT_PUBLIC_APP_URL`).

---

## DONE

**`7-premium-report-fix` step 0~3 — Premium 리포트 유실 버그 3건 수정 + 실 DB 검증 완료**

- **step 0** `supabase/migrations/20260810173000_create_merge_premium_report.sql` — `merge_premium_report(uuid,uuid,text,jsonb)` RPC 신설. 단일 UPDATE 안에서 `coalesce(premium_reports,'{}') || jsonb_build_object(...)`로 병합해 행 락 안에서 원자적으로 처리. 원격 적용 후 AC 전부 실측 검증(argnames 4개 / boolean / volatile / secdef false / `search_path=""`, anon·authenticated EXECUTE 없음·service_role만 true, `analyses` RLS는 SELECT 1건 유지, 롤백 do-block에서 병합·교체·타 사용자 차단·무변경 전부 확인, 프로덕션 지문 `0b2a572bd52e16f808b21d4250cc3215` 전후 동일 n=3). `src/types/database.ts`에 `Functions.merge_premium_report` 반영. Codex 세션에 Supabase MCP가 없어 blocked였던 것을 오케스트레이터가 MCP로 직접 수행.
- **step 1** `src/services/supabase-admin/index.ts` — `upsertPremiumReport`의 select→JS 병합→update를 소유권 스코프 RPC 단일 호출로 교체. `error`면 throw, `data !== true`면 `"Analysis not found"`. `from()` 미호출 회귀 테스트 추가.
- **step 2** `src/app/api/reports/[analysisId]/[reportType]/route.ts` — `catch {}` 제거. 리포트 **생성 실패(502)** 와 **캐시 쓰기 실패(로그만, 200 반환)** 를 분리. `describeError()` 허용 목록(`errorName`, `statusCode?`, `code?` 32자 절단)으로 프롬프트·리포트 본문 유출 차단.
- **step 3 (2026-08-11 16:10, 사용자 브라우저 수행 + 오케스트레이터 MCP 대조)** — 실 DB 스모크 통과. 대상 `deffb84a-a249-4ff6-ac4b-9c4880a51a84`의 `cached_keys`가 `(none)` → **정확히 4개**(`anomaly_detection,budget_recommendation,mom_comparison,savings_suggestions`)로 변경, **대상 외 두 행은 실행 전과 동일**. 각 키 `pg_column_size` 2284/1856/108/6074 bytes 전부 `object`(`mom_comparison`이 108바이트인 것은 전월 데이터가 없어 `hasPrevious:false`로 내려온 정상 응답). 서버 로그에 `[reports] 리포트 캐시 저장 실패` **0건**, `PGRST202` 없음, 전 요청 200(생성 1663/10122/12247/26105ms → 이후 100~200ms 캐시 히트). **이 행은 `premium_reports`가 null이었고 첫 쓰기가 살아남아 `coalesce(...,'{}')` 수정도 실측 검증됐다.** 이로써 ISSUES 2(브라우저→라우트→RPC 왕복 미검증)가 해소됐다. **단, 잔여 미확정 1건** — Next dev 로그에 타임스탬프가 없어 4개 쓰기가 시간상 실제로 겹쳤는지는 판별 불가. 순차 클릭이었다면 수정 전 코드로도 통과하는 경로이므로, **경쟁 상태 자체의 HTTP 레벨 재현은 여전히 step 0의 SQL 롤백 do-block 검증에만 근거한다**(ISSUES 2 참고).

**검증:** typecheck 통과 / lint 0 errors, 2 warnings / 412 tests 통과.

**`6-polar-billing` → main 머지 완료** (`46c9a13`). 샌드박스 결제 → 웹훅 → `subscriptions.status='active'` end-to-end 확인 후 머지.

---

## IN PROGRESS

- **없음.** phase 0~7이 모두 완료돼 main에 머지됐다. 다음 작업은 TODO에서 고른다.
- **QA 코드 검증 리포트 유실.** `_workspace/qa_code_review_7-premium-report-fix.md`를 QA가 쓰던 중 디스크가 가득 차 저장 실패. 트랜스크립트 복구를 시도했으나 찾아낸 것은 *계획* 리뷰였고 코드 리뷰는 아직 미복구.

---

## TODO

우선순위 순.

1. **`private/` 삭제** — 168M 빌드 산출물. lint는 ignore로 막았지만 디스크는 그대로다. `rm -rf`는 훅이 차단하므로 사용자가 `! rm -rf /Users/heonamsu/workspace/courses/finsight/private` 로 직접 실행.
2. **원격 스테일 브랜치 정리** — `origin/feat-4-pdf-statement`(내용은 main에 전부 포함됨), `origin/docs/finsight-mvp-planning`. 원격 삭제는 사용자 확인 후.
3. **QA MINOR 5건 → `phases/8-qa-minor/` 계획 수립 완료, 실행 대기.** step 0 `describeError`를 `src/lib/log.ts`로 승격 + `code` 포맷 가드(절단이 아니라 형식 불일치 시 키 탈락) / step 1 `merge_premium_report` `Returns`를 `boolean | null`로 정정 / step 2 `p_report_type` 화이트리스트 마이그레이션 **작성만**(원격 적용은 오케스트레이터가 MCP로 — Codex에 MCP가 없어 phase 7 step 0이 blocked된 전례를 계획에 반영) / step 3 service-role 클라이언트 누출 회귀 가드(`'use client'` 파일을 동적 수집해 import 그래프 도달성 검사, `next build` 금지).
4. **리포트 요청 중복 제거** — step 3 로그에서 같은 `reportType`이 2~4회씩 재요청됐다(캐시 히트라 무해하나 불필요). 클라이언트가 진행 중/완료 요청을 dedupe하지 않는다. 경쟁 상태의 보조 방어선이기도 하다.
5. **`provider.ts`에 `maxOutputTokens` 설정** — 출력 잘림 방어.
6. **웹훅 순서 역전 방어(QA M-2)** — `last_event_at` 가드 컬럼.
7. **Playwright E2E 셋업 / Vercel 배포 + Polar 대시보드 웹훅 등록**(Format `Raw`, 이벤트 5종) → 이후 프로덕션 Polar 조직 생성·심사.

---

## IMPORTANT DECISIONS

**1. 경쟁 상태는 애플리케이션이 아니라 DB에서 막는다 — `merge_premium_report` RPC**

읽기와 쓰기 사이에 LLM 생성이 6~21초 걸린다. 그 사이 다른 카드의 응답이 도착하면 나중 쓰기가 앞선 결과를 지웠다. JS spread를 아무리 고쳐도 read-modify-write인 한 창은 남는다. `jsonb ||`를 쓰는 **단일 UPDATE**는 행 락 안에서 실행되므로 경쟁이 성립하지 않는다. 클라이언트 동시 클릭 차단은 보조 방어선일 뿐 근본 해결이 아니다.

**2. RPC 작성 시 반드시 지켜야 할 3가지**

- `coalesce(premium_reports, '{}'::jsonb)` **필수** — 컬럼 기본값이 null이고 `null || {...} = null`이라 없으면 **첫 리포트가 유실**된다.
- 소유권(`user_id`)을 SQL 술어에 둔다 — 소유자가 아니면 0행 갱신 → 함수가 null 반환 → 호출부가 `"Analysis not found"`로 처리.
- **권한 회수 필수** — Supabase는 함수를 PostgREST RPC로 자동 노출하고 함수 default ACL이 anon/authenticated에 EXECUTE를 준다. `revoke ... from public/anon/authenticated` 후 `grant ... to service_role`만 남긴다. 이걸 빠뜨리면 브라우저에서 임의 사용자가 남의 리포트를 덮어쓸 수 있다.

**3. step 3 스모크 대상은 `deffb84a-a249-4ff6-ac4b-9c4880a51a84` 하나뿐**

실행 전 실측(2026-08-10, service-role REST):

| analysis id | created_at | cached_keys |
|---|---|---|
| `cb0eefa6-01cf-4f5d-ba7f-b8cc74157106` | 2026-08-10T07:03:22Z | 4개 전부 |
| `deffb84a-a249-4ff6-ac4b-9c4880a51a84` | 2026-07-30T10:03:52Z | **(none)** |
| `27aaa9b7-6d6e-4881-aad6-4e26a002a044` | 2026-07-21T10:38:57Z | 4개 전부 |

나머지 둘은 이미 4키라 눌러도 캐시 히트만 나고 병합 경로를 타지 않는다. **이 행이 더는 비어 있지 않다면 `premium_reports`를 비우지 말고** 새 CSV/PDF를 업로드해 새 분석을 만들고 새 id와 실행 전 `cached_keys=(none)`을 기록한다. 기존 사용자 데이터를 검증 편의로 지우지 않는다.

**4. 로그 허용 키는 5개뿐 — `analysisId`(절단), `reportType`, `errorName`, `statusCode?`, `code?`**

에러 객체 자체·`message`·`stack`·`details`·`hint` 금지. `APICallError.requestBodyValues`/`.responseBody`에 **프롬프트 전문(=마스킹 거래 데이터)** 이, `PostgrestError.details`에 행 값이 들어온다. 에러를 통째로 로깅하면 CSV 원본 미저장 원칙이 로그로 새는 우회로가 된다.

**5. 캐시 쓰기 실패는 200으로 내려준다**

리포트 생성(6~21초, 유료 LLM 호출)은 성공했는데 DB 쓰기만 실패한 경우, 500을 주면 사용자는 결과를 못 보고 비용만 나간다. 생성 실패(502)와 캐시 실패(로그 후 200)를 분리한 이유.

**6. 진단 시 `errorName`만으로 판단하지 않는다**

`PostgrestError.name`은 **항상** `"PostgrestError"`다. 분류는 `code`로 한다. 특히 `code=PGRST202`는 PostgREST가 함수를 못 찾은 것 → step 0의 스키마 캐시 리로드(`notify pgrst`) 또는 RPC 파라미터명 불일치를 점검.

**7. 구독 해제는 `subscription.revoked` 하나로만 (ADR-006 준수)**

| 이벤트 | status |
|---|---|
| `subscription.active`, `subscription.uncanceled` | `'active'` |
| `subscription.revoked` | `'inactive'` |
| `subscription.canceled`, `subscription.past_due` | **무시**(상태 변경 없음), 200 |

`canceled`는 해지 *예약*이고 실제 종료는 `revoked`, `past_due`는 dunning 유예. **되돌리지 마라** — 상수 키가 정확히 3개임을 단정하는 테스트로 고정.

**8. 쓰기 경계 유지 — `analyses`/`subscriptions`에 INSERT/UPDATE RLS 정책을 추가하지 않는다**

쓰기 정책을 열면 브라우저에서 사용자가 자기 `status`를 `'active'`로 바꿔 페이월을 우회한다. 쓰기는 `services/supabase-admin`의 service-role 경로로만.

**9. 웹훅 규약(6-polar-billing) 요약**

서명 검증은 SDK `validateEvent()`만(직접 HMAC 금지, secret 이중 base64 유발). `Headers` 인스턴스는 `normalizeHeaders()`로 평범한 객체 변환 필수(안 하면 전 웹훅 403). SDK 옵션은 `environment`가 아니라 **`server`**, 기본값 `production`(오타 시 샌드박스 토큰으로 프로덕션 결제 API 호출). 응답 코드: 서명 실패 403 / 설정 누락 500 / 미지원·미지 사용자 200 / 처리 대상 payload 파싱 실패 5xx.

**10. `_workspace/`는 Codex에 주입되지 않는다**

`execute.py` 프리앰블은 `AGENTS.md` + `docs/*.md`만 붙인다. Codex가 알아야 할 규약은 `step{N}.md` 본문에 복사해 넣어야 한다.

---

## ISSUES / RISKS

**1. [낮음, 부분 해소] `private/` 168M이 디스크에 남아 있다**

`private/tmp/claude-501/.../scratchpad/nextqa/**`의 Next 빌드 산출물(minified JS + 생성 타입). **lint 마비는 해소됐다** — `.gitignore`에 `private/`, `eslint.config.mjs` ignores에 `private/**`를 추가해 716 errors / 7622 warnings가 0 errors / 2 warnings가 됐다. 남은 문제는 디스크 168M뿐. `rm -rf`는 `scripts/hooks/dangerous-command-guard.sh`가 차단하므로 사용자가 직접 삭제해야 한다(TODO 2).

**2. [낮음, 부분 해소] 경쟁 상태의 HTTP 레벨 재현은 여전히 미확인**

step 3에서 **브라우저 → 라우트 → RPC 왕복은 실측 통과**했다(4키 병합, `coalesce` null 경로, PostgREST 스키마 캐시·파라미터명 정합성 전부 확인). 하지만 Next dev 로그에 타임스탬프가 없어 **4개 쓰기가 시간상 실제로 겹쳤는지는 판별하지 못했다.** 순차 클릭이었다면 수정 전 코드로도 4키가 저장되므로 그 경로는 회귀를 못 잡는다. 따라서 원자성 근거는 아직 step 0의 SQL 롤백 do-block뿐이다. 확실히 하려면 새 분석을 만들어 카드를 겹치게 눌러 재현하거나, 라우트에 요청 시작 시각 로그를 추가한다.

**3. [중간] QA 코드 검증 리포트 부재** — 디스크 풀로 저장 실패. MINOR 5건은 대화 기록에서 복원했으나(TODO 6) 전체 리포트는 없다.

**4. [중간] 웹훅 순서 역전 (QA M-2)** — `revoked`가 DB 장애로 지연 재시도되는 동안 사용자가 재구독하면 뒤늦게 도착한 `revoked`가 `active`를 덮어써 **결제 중인 사용자가 Premium을 잃는다.** upsert 멱등성은 중복 배달만 막고 순서는 못 막는다.

**5. [낮음] `provider.ts`에 `maxOutputTokens` 미설정** — 거래가 많아지면 출력이 잘려 `JSON.parse`가 깨진다. 현재 데이터(24건)에서는 미재현.

**6. [낮음] 리포트 파서가 `every()`로 전부 또는 전무** — `anomaly-detection.ts:37`, `savings-suggestions.ts:35`. 항목 하나가 검증에 실패하면 리포트 전체를 버린다.

**7. [정보, 해소] 브랜치 정리 완료** — 로컬 feature 브랜치 4개는 main 포함을 확인한 뒤 전부 삭제했다. 원격의 `origin/feat-4-pdf-statement`·`origin/docs/finsight-mvp-planning`만 스테일로 남아 있다(TODO 2).

**8. [정보, 해소] 스테일 문서 정리 완료** — `CLAUDE.md`/`AGENTS.md`의 "스키마만, 실제 연동은 후속 phase에서" 괄호를 제거하고 `6-polar-billing` 머지 완료 사실 + `validateEvent()` 전용 + `revoked` 단일 이벤트 규약으로 교체했다. `AGENTS.md`는 `execute.py`가 Codex 프롬프트에 주입하는 파일이므로 phase 8 실행 전에 처리했다.

**9. [정보] main이 origin보다 26커밋 앞섬** — push는 아직 요청받지 않았다.
