-- Premium 리포트 캐시를 원자적으로 병합하는 함수.
-- 기존 upsertPremiumReport는 premium_reports를 읽어 JS에서 spread한 뒤 통째로 UPDATE했다.
-- 읽기와 쓰기 사이에 LLM 생성이 6~21초 걸려, 카드를 연달아 누르면 나중 쓰기가 앞선 결과를 지웠다.
-- jsonb || 연산자를 쓰는 단일 UPDATE는 행 락 안에서 원자적으로 실행되므로 경쟁이 성립하지 않는다.
create or replace function public.merge_premium_report(
  p_analysis_id uuid,
  p_user_id uuid,
  p_report_type text,
  p_report jsonb
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.analyses
     set premium_reports =
           -- 컬럼 기본값이 null이므로 coalesce 없이는 null || {...} = null 이 되어 첫 리포트가 유실된다.
           coalesce(premium_reports, '{}'::jsonb)
           || jsonb_build_object(p_report_type, p_report)
   where id = p_analysis_id
     -- 소유권 검증을 SQL 술어에 둔다. 소유자가 아니면 0행이 갱신되고 함수는 null을 반환한다.
     and user_id = p_user_id
  returning true;
$$;

-- Supabase는 함수를 PostgREST RPC로 자동 노출하고, 함수 default ACL이 anon/authenticated에
-- EXECUTE를 부여한다. 쓰기 경로를 service-role로 한정하기 위해 권한을 명시적으로 회수한다.
revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from public;
revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from anon;
revoke all on function public.merge_premium_report(uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.merge_premium_report(uuid, uuid, text, jsonb) to service_role;
