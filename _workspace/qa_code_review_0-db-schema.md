# QA 코드 검증 — 0-db-schema phase

- 검증 시각: 2026-07-20
- 브랜치: feat-db-schema
- Supabase project_id: peewjgbhqpkysitzqjum
- 결론: **전체 통과** (블로킹 이슈 없음, 관찰 사항 1건)

## 1. 마이그레이션 파일 ↔ step AC 대조

### analyses (step0.md)
`supabase/migrations/20260720164500_create_analyses.sql`

| AC | 결과 | 근거 |
|---|---|---|
| 마이그레이션 파일 존재 + DDL/RLS 동일 파일 포함 | 통과 | 파일 L1-18, 테이블+RLS+정책 단일 파일 |
| 컬럼이 정확히 id/user_id/created_at/masked_transactions/free_summary/premium_reports, 그 외 없음 | 통과 | L1-8, 6개 컬럼만 |
| 원본 PII 전용 컬럼 없음 | 통과 | 카드/계좌/이름/전화/원본텍스트 컬럼 없음. jsonb 3개는 마스킹된 요약/집계용 |
| user_id FK → auth.users(id) on delete cascade | 통과 | L3 + 원격 delete_rule=CASCADE 확인 |
| (user_id, created_at desc) 복합 인덱스 | 통과 | L10-11 + 원격 `analyses_user_id_created_at_idx ... (user_id, created_at DESC)` |
| RLS 활성 + authenticated SELECT using(auth.uid()=user_id) 정확히 1개 | 통과 | L13-18 + 원격 정책 1건 |
| INSERT/UPDATE/DELETE 정책 0개 | 통과 | 원격 pg_policies에 SELECT 1건만 |

### subscriptions (step1.md)
`supabase/migrations/20260720164534_create_subscriptions.sql`

| AC | 결과 | 근거 |
|---|---|---|
| 마이그레이션 파일 존재 + DDL/RLS 동일 파일 | 통과 | L1-14 |
| 컬럼이 정확히 id/user_id/status/created_at/updated_at, 그 외 없음 | 통과 | L1-7, 5개 컬럼만 |
| Polar 전용 컬럼(customer_id 등) 없음 (ADR-006) | 통과 | 해당 컬럼 없음 |
| status check(active/inactive) + default 'inactive' | 통과 | L4 + 원격 check 확인 |
| user_id FK + unique + on delete cascade | 통과 | L3 + 원격 unique 인덱스 `subscriptions_user_id_key` + CASCADE |
| RLS 활성 + authenticated SELECT 정확히 1개 | 통과 | L9-14 + 원격 정책 1건 |
| INSERT/UPDATE/DELETE 정책 0개 | 통과 | 원격 SELECT 1건만 |

## 2. 원격 스키마 ↔ 마이그레이션 정합성
`list_tables(verbose)` 결과가 두 마이그레이션 파일과 완전 일치. 컬럼명/타입/nullable/default/check/FK/unique 모두 동일. rls_enabled=true.

## 3. 보안 advisors
`get_advisors(security)` = `{"lints":[]}` — RLS 미적용 등 경고 0건.

## 4. RLS 정책 원격 재확인
`pg_policies` 직접 조회: analyses/subscriptions 각각 SELECT 정책 1건, roles={authenticated}, qual=(auth.uid()=user_id), with_check=null. 쓰기 정책 없음 → service-role 경유 쓰기 강제 불변식 성립. (step2 AC 통과)

## 5. 원본 PII 컬럼 부재
두 테이블 모두 마스킹되지 않은 카드/계좌/이름/전화 전용 컬럼, 원본 CSV 텍스트 컬럼 없음. analyses의 jsonb 컬럼은 마스킹된 거래·집계용으로 설계됨(step0 정의). CLAUDE.md CRITICAL "마스킹된 요약 데이터만 저장" 위반 없음.

## 6. src/types/database.ts
생성됨. analyses Row에 masked_transactions/free_summary/premium_reports(Json|null) 포함, subscriptions Row에 status 포함. 원본 PII 전용 필드 없음. 실제 스키마와 일치. (step2 AC 통과)

## 7. git 커밋
step0/1/2 feat + chore output 커밋 정상 존재, phase completed 마킹 커밋 존재.

## 관찰 사항 (비블로킹)
- git log에 step 0 feat 커밋이 4건(`4e6a78e`, `7568ca0`, `bb7ada6`, `a88c903`) 존재 — Codex 재시도 흔적으로 보임. 최종 스키마 상태는 정확하므로 기능적 문제 없음. 히스토리 노이즈일 뿐이며 스쿼시 여부는 리더 판단.

## 미검증 항목
없음 — 모든 AC를 파일+원격 상태 양쪽으로 확인 완료.
