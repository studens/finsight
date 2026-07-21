# QA 코드 검증 — phase 3-frontend

브랜치: `feat-frontend` · 검증 시점: Codex 8 step 완료 후 · 검증자: qa
사전 확인: `npx vitest run`(118/118), `npx tsc --noEmit`(clean) 리더가 실행 확인.

## 결론: PASS (보안 CRITICAL 위반 0건, 경계면 정합성 일치)

blocker 없음. 아래 minor 2건은 이번 phase 범위상 의도된 것이라 수정 불필요(참고용).

---

## 1. API 계약 ↔ 실제 소비 — PASS

실제 라우트 코드(`src/app/api/*/route.ts`)를 소스로 삼아 대조.

| 경계 | 라우트 반환 shape | 프론트 소비 | 판정 |
|---|---|---|---|
| `POST /api/upload` | `{ mapping, sample:{headers,rows,excludedColumns,maskedColumns} }` (upload/route.ts:31-39) | `UploadResponse` 동일 파싱 (UploadFlow.tsx:23-26,62-64) | 일치 |
| `POST /api/analyze` | `{ analysisId, freeSummary }` (analyze/route.ts:94-97) | `AnalyzeResponse` 동일 (UploadFlow.tsx:28-31,103) | 일치 |
| `GET /api/reports/:id/:type` | `{ reportType, data }` (reports route.ts:61,89) | `result.data` 사용 (PremiumSection.tsx:201-205) | 일치 |
| `listUserAnalyses()` → `{id,createdAt,freeSummary}` | dashboard에서 `freeSummary.totalSpent/transactionCount`로 변환 → HistoryList props (dashboard/page.tsx:18-23) | 일치 |
| `FreeSummary` | totalSpent/transactionCount/categoryTotals/topMerchants | FreeSummaryCards.tsx 전부 소비 | 일치 |

- **원본 File 재전송 설계 반영 확인 (핵심)**: UploadFlow가 1단계 `upload()`에서 선택 파일을 `setFile(selectedFile)`로 브라우저 메모리에 보관(UploadFlow.tsx:54,45), 2단계 `analyze()`에서 `body.append("file", file)`로 **원본 File을 재전송**(UploadFlow.tsx:96). 클라이언트는 마스킹하지 않고 원본을 그대로 넘겨 서버가 `parseCsv→maskPii` 재실행 — 계약 설계 결정 그대로.

## 2. 에러 처리 (401/404/403/502) — PASS

- 모든 fetch가 `useApiError.handleResponse(response)`를 거침(UploadFlow.tsx:61,102 / PremiumSection.tsx:197).
- `handleResponse`는 `body.code`를 사람이 읽는 한국어 메시지로만 매핑하고, 매핑 없으면 안전한 기본 메시지로 축약(useApiError.ts:7-12,30-41). **raw code/HTTP status는 사용자에게 절대 노출 안 됨**.
- 코드별 매핑: PAYWALL_REQUIRED/NOT_FOUND/GENERATION_FAILED/BAD_REQUEST 모두 존재. 401 UNAUTHORIZED와 500(네트워크 catch)은 기본 메시지로 흡수 — 401은 미들웨어가 이미 `/login`으로 보내는 방어적 케이스라 정상.
- 표시는 `ErrorModal` 하나로 통일(UploadFlow.tsx:208, PremiumSection.tsx:255), 페이지 이동 없음. code/숫자 미출력 확인.

## 3. Premium 잠금 카드 — PASS

- 미구독(`!isSubscribed`): 정적 CTA 버튼("Premium으로 보기")만 렌더, 실제/더미 데이터 없음, `GET /api/reports` 미호출(PremiumSection.tsx:246-250).
- `loadReport`는 `!isSubscribed`면 즉시 return(PremiumSection.tsx:190) — 미구독 경로에서 fetch가 발생하는 코드 경로 없음.
- 블러/backdrop-filter 없음(grep에서 프로덕션 코드 0건, 테스트 단언에만 등장). ui-design "빈 상태 + CTA" 규칙 준수.

## 4. ui-design 규칙 — PASS

- 금지 패턴 grep: backdrop-blur/backdrop-filter, bg-gradient/bg-clip-text/text-transparent, purple/indigo/violet, blur-3xl/orb, "Powered by AI" **모두 프로덕션 코드 0건**.
- 애니메이션: `animate-fade-in`, `slide-up`만 사용(globals.css의 fade-in 0.4s / slide-up 0.5s). 글로우/바운스/무한반복 없음.
- 색상 토큰: 페이지 `#0a0b0d`, 카드 `#16181c`, 중첩 `#0a0b0d`, primary `#0052ff`/hover `#003ecc`, 텍스트 `#ffffff`/`#a8acb3`, 시맨틱(risk `#cf202f`/opp `#05b169`/hygiene `#5b8bff`) — 가이드와 정확히 일치.
- 반경 역할 구분: 카드 `rounded-[24px]`, 리스트아이템 `rounded-2xl`, 배지/버튼 `rounded-full`, 입력 `rounded-xl` — 역할별로 다르게 적용됨.
- ui 프리미티브(Button/Badge/Card/IconBadge) 클래스가 SKILL.md 컴포넌트 스펙과 문자 단위로 일치.

## 5. 파일경로 ↔ 링크 — PASS

route group 제거 반영해 대조:

| 링크/리다이렉트 | 대상 URL | 실제 파일 | 판정 |
|---|---|---|---|
| marketing `href="/login"` ×2 | `/login` | `src/app/login/page.tsx` | OK |
| GoogleSignInButton `redirectTo .../dashboard` | `/dashboard` | `src/app/(app)/dashboard/page.tsx` | OK |
| HistoryList `href={/dashboard/${id}}` | `/dashboard/:id` | `src/app/(app)/dashboard/[analysisId]/page.tsx` | OK |
| marketing 페이지 자체 | `/` | `src/app/(marketing)/page.tsx` | OK |

깨진 링크 없음.

## 6. middleware ↔ 실제 페이지 — PASS

- 비로그인 + `/dashboard`|`/dashboard/*` → `/login` 리다이렉트(middleware.ts:14-16), `/login` 페이지 존재.
- 로그인 + `/` → `/dashboard` 리다이렉트(middleware.ts:18-20), `/dashboard` 페이지 존재.
- matcher가 `api`, `_next`, 정적자산 제외(middleware.ts:26-28) — 정상.
- 양방향 리다이렉트 성립 확인.

## 7. services/ 직접 호출 금지 — PASS

- 컴포넌트/앱 페이지에서 `services/supabase-admin`, `lib/supabase/service`, `@anthropic`, `polar`, `SERVICE_ROLE` 직접 import: grep 0건.
- 서버 페이지 읽기는 `lib/supabase/server.ts`(세션 RLS) 경유(dashboard/page.tsx, [analysisId]/page.tsx) — 읽기 경계 준수.
- GoogleSignInButton만 `lib/supabase/client.ts`(브라우저, auth 전용) 사용 — 계약대로.

## 8. 원본 미보관 — PASS

- UploadFlow는 원본 File을 `useState`(메모리)에만 보관(UploadFlow.tsx:45). localStorage/sessionStorage/indexedDB/Storage upload/fs.write: grep 0건.
- `console.*`로 파일/행을 남기는 코드 없음(UploadFlow.tsx grep 0건).
- service-role 키 노출/`NEXT_PUBLIC_` 유출: 컴포넌트·훅에서 grep 0건.

---

## Minor (수정 불필요 — 참고)

1. **UploadFlow `UploadSample.rows` 타입이 `RawRow[]`** (UploadFlow.tsx:18). 실제 서버는 마스킹된 행을 보내므로 의미상 `MaskedRow`가 더 정확하나, 렌더는 `row[header]` 문자열 출력뿐이라 런타임 영향 없음. 원본 유출 아님(서버가 마스킹해서 전송).
2. **미구독 "Premium으로 보기" 버튼에 onClick 없음**(PremiumSection.tsx:247-249) — 클릭 시 동작 없는 정적 버튼. 체크아웃 연동은 `polar-billing` phase 범위라 의도된 상태.
