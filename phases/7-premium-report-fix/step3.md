# Step 3: 실 DB 스모크 검증 — RPC 왕복과 4키 동시 병합 확인

## 왜 이 step이 필요한가

step 0의 검증은 전부 `execute_sql`(직접 SQL, `postgres` 권한)로 이뤄지고, step 1의 테스트는 `supabase.rpc`를 통째로 목킹한다. 따라서 **supabase-js → PostgREST → 함수** 실호출 경로는 앞선 어떤 AC로도 검증되지 않는다. 스키마 캐시 미갱신이나 파라미터명 불일치로 인한 `PGRST202`가 여기에 숨는다.

여기에 step 2가 결합하면 위험해진다. step 2는 캐시 쓰기 실패를 catch → log → **200 반환**으로 바꾸므로, RPC가 영구히 실패해도:

- 사용자는 매번 200과 리포트를 받고(생성 자체는 성공하므로),
- `premium_reports`는 **영원히 비어 있고**(= 이 phase가 고치려는 증상 그대로),
- 5xx도 나지 않고, 앞선 3개 step은 전부 `completed`로 마킹된다.

즉 **"고쳤다고 표시되지만 실제로는 안 고쳐진" 상태가 성립 가능하다.** 이 step은 그 구멍을 막는 유일한 관문이다.

## 작업

**대상 Supabase 프로젝트**: `project_id: peewjgbhqpkysitzqjum`

1. **실행 전 상태 기록.** `execute_sql`로 다음을 실행하고 결과를 그대로 이 step의 `summary`(또는 `blocked_reason`)에 남긴다. 키 **개수가 아니라 이름**까지 남겨야 이후 대조가 가능하다.
   ```sql
   select id, created_at,
          coalesce(
            (select string_agg(k, ',' order by k)
               from jsonb_object_keys(coalesce(premium_reports, '{}'::jsonb)) k),
            '(none)') as cached_keys
     from public.analyses
    order by created_at desc;
   ```

2. **대상 분석을 올바르게 고른다 — 이 step에서 가장 틀리기 쉬운 부분.**

   > **`order by created_at desc limit 1`로 고르지 마라.** 현재 DB에서 **가장 최근 분석(`cb0eefa6`)이 이미 4키를 모두 갖고 있다.** 이미 캐시가 찬 행을 고르면 카드 4개가 전부 `route.ts:59-62`의 캐시 히트로 끝나 `generateReport`도 `upsertPremiumReport`도 호출되지 않는다. **RPC 경로를 한 번도 타지 않는데 아래 AC가 전부 자동 통과하고**, 화면에도 카드가 정상 렌더되어 사람 눈에도 이상이 보이지 않는다. 이 step이 막으려던 "고쳤다고 표시되지만 안 고쳐진" 상태가 그대로 재성립한다.

   따라서 대상은 1번 결과에서 **`cached_keys`가 `(none)`인 행**에서 고른다. 그런 행이 없으면 **기존 행의 `premium_reports`를 비우지 말고**(그건 사용자 데이터 파괴다) 새 CSV/PDF를 업로드해 새 분석을 만들어 그것을 대상으로 삼는다. 선택한 분석 id와 그 행의 실행 전 `cached_keys`가 `(none)`이었다는 사실을 반드시 기록한다.

3. **브라우저 스모크 테스트.** 구독이 `active`인 계정으로 `npm run dev` 후 `/dashboard/{2번에서 고른 분석 id}`에 들어가, Premium 카드 **4개를 서로 다른 카드로 연달아(앞 카드의 로딩이 끝나기 전에)** 누른다. 이것이 원래 유실을 재현시키던 조작이다.

4. **결과 확인.** 1번과 같은 쿼리를 다시 실행해, **대상 분석 행**의 `cached_keys`가 정확히 `anomaly_detection,budget_recommendation,mom_comparison,savings_suggestions` **4개 전부**인지 확인한다. **하나라도 없으면 이 phase는 실패다.** 다른 행들의 `cached_keys`는 실행 전과 동일해야 한다.
5. 서버 콘솔에 `[reports] 리포트 캐시 저장 실패`가 찍혔는지 확인한다. 찍혔다면 RPC 왕복이 깨진 것이므로 그 로그의 `errorName`과 **`code`**를 기록한다. `code`가 `PGRST202`면 함수를 찾지 못한 것이므로 step 0의 스키마 캐시 리로드(`notify pgrst`)나 파라미터명 불일치 문제다 — `PostgrestError`는 `name`이 항상 `'PostgrestError'`라서 `errorName`만으로는 구분되지 않으므로 `code`를 반드시 본다.

## Codex가 이 step을 수행할 수 없는 경우

**브라우저 조작은 Codex가 수행할 수 없다.** 개발 서버 기동과 클릭이 불가능하면 이 step을 `blocked`로 표시하고, `blocked_reason`에 다음을 적는다:

- 1번에서 기록한 **실행 전 상태**(분석 id와 각 행의 캐시 키 이름 목록)
- 위 **2~5번** 확인 절차 전문 — 특히 5번(서버 로그의 `[reports] 리포트 캐시 저장 실패` 및 `code` 확인)을 빠뜨리지 마라. 그게 `PGRST202` 진단 경로다.
- "사용자가 브라우저에서 직접 수행해야 함"

**절대 `completed`로 임의 마킹하지 마라.** 이 step의 목적은 자동화된 AC가 구조적으로 놓치는 것을 사람이 확인하는 것이므로, 확인 없이 완료 처리하면 step 자체가 무의미해진다.

수행 가능한 대체 검증이 있다면(예: 실제 Supabase 클라이언트로 RPC를 왕복 호출하는 통합 스크립트를 임시로 실행) 그것을 먼저 시도하고 결과를 `summary`에 남겨도 된다. 단, 그 경우에도 **임시로 만든 데이터는 반드시 원상복구**하고, 기존 `analyses` 행의 `premium_reports`를 변경하지 않는다.

### blocked 이후 마무리 절차 (리더/사용자용 메모)

`execute.py`의 `_check_blockers`는 `blocked` 상태 step을 만나면 그 자리에서 멈춘다(exit code 2). 그래서 이 step이 `blocked`로 끝난 뒤 사람이 브라우저 확인을 마쳤다면, **`execute.py`를 다시 돌리지 말고** 손으로 다음 세 가지를 정리한다. `pending`으로 되돌려 재실행하면 Codex가 브라우저를 조작할 수 없어 다시 `blocked`가 되어 무한 루프가 된다.

1. `phases/7-premium-report-fix/index.json`의 step 3 상태를 `completed`로 바꾸고 `summary`에 확인 결과(대상 분석 id, 실행 전/후 `cached_keys`)를 적는다.
2. **최상위 `phases/index.json`의 `7-premium-report-fix` 항목도** `completed`로 바꾼다. `_update_top_index`가 blocked 시 거기에도 `blocked`와 `blocked_at`을 쓰므로 그냥 두면 영구히 남는다(전례: `phases/index.json`의 `0-db-schema`에 `blocked_at`과 `completed_at`이 둘 다 남아 있다).
3. blocked로 종료되면 `_commit_step`이 호출되지 않아 위 두 파일의 변경이 **커밋되지 않은 상태로 남는다.** 직접 커밋한다.

## Acceptance Criteria

- [ ] 실행 전 `analyses`의 행별 캐시 **키 이름 목록**이 기록되어 있다(개수만으로는 부족하다).
- [ ] **대상 분석의 실행 전 `cached_keys`가 `(none)`이었고, 그 분석 id가 기록되어 있다.** 이미 캐시가 찬 행을 대상으로 삼은 경우 이 step은 무효다(캐시 히트로 RPC를 타지 않으므로).
- [ ] 대상 분석 행의 `premium_reports`에 `mom_comparison`, `anomaly_detection`, `savings_suggestions`, `budget_recommendation` **4개 키가 모두** 존재함이 실제 DB 조회로 확인되었다. (또는 확인 불가 사유와 함께 `blocked`로 표시되었다.)
- [ ] 카드를 **동시에** 눌렀는데도 앞선 결과가 유실되지 않았다 — 이 phase가 고치려던 증상이 재현되지 않는다.
- [ ] 대상 분석을 제외한 다른 `analyses` 행의 `cached_keys`가 실행 전과 동일하다.
- [ ] 서버 로그에 `[reports] 리포트 캐시 저장 실패`가 **없다**. 있었다면 그 `errorName`과 `code`가 기록되고 원인이 규명되었다.
- [ ] 이 step 수행 과정에서 기존 `analyses` 행의 `premium_reports`를 임의로 삭제·덮어쓰지 않았다(정상적인 리포트 생성으로 채워지는 것은 제외).
