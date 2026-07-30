import { createServerClient } from "@supabase/ssr"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { cookies } from "next/headers"

import type { Database, Tables } from "../../types/database"
import type { AnalysisRecord, FreeSummary, MaskedRow } from "../../types/pipeline"

type AnalysisRow = Tables<"analyses">

/** PostgREST가 `iat`이 자기 시계보다 미래인 토큰을 거부할 때 쓰는 코드. */
const JWT_CLOCK_SKEW_CODE = "PGRST303"
const JWT_CLOCK_SKEW_RETRY_MS = 1_000

function isJwtClockSkewError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === JWT_CLOCK_SKEW_CODE
  )
}

/**
 * 토큰을 발급하는 GoTrue와 검증하는 PostgREST는 서로 다른 노드라 시계가 1초 미만
 * 어긋날 수 있다. 그러면 갓 발급된 토큰이 PGRST303으로 거부되어 로그인 직후 첫 조회가
 * 실패한다. 시계가 따라잡을 시간을 준 뒤 한 번만 재시도한다.
 */
async function withJwtClockSkewRetry<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (!isJwtClockSkewError(error)) throw error

    await new Promise((resolve) => setTimeout(resolve, JWT_CLOCK_SKEW_RETRY_MS))
    return read()
  }
}

export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        },
      },
    },
  )
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
}

export async function signOut(): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) throw error
}

export async function getAnalysisById(analysisId: string): Promise<{
  id: string
  user_id: string
  created_at: string
  masked_transactions: unknown
  free_summary: FreeSummary
  premium_reports: Record<string, unknown> | null
} | null> {
  return withJwtClockSkewRetry(async () => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("analyses")
      .select("id, user_id, created_at, masked_transactions, free_summary, premium_reports")
      .eq("id", analysisId)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      ...data,
      free_summary: data.free_summary as FreeSummary,
      premium_reports: data.premium_reports as Record<string, unknown> | null,
    }
  })
}

export async function getSubscriptionStatus(
  userId: string,
): Promise<"active" | "inactive"> {
  return withJwtClockSkewRetry(async () => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle()

    if (error) throw error
    return data?.status === "active" ? "active" : "inactive"
  })
}

export async function getPreviousAnalysis(
  userId: string,
  beforeCreatedAt: string,
): Promise<AnalysisRecord | null> {
  return withJwtClockSkewRetry(async () => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("analyses")
      .select("id, created_at, masked_transactions, free_summary")
      .eq("user_id", userId)
      .lt("created_at", beforeCreatedAt)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    return {
      id: data.id,
      createdAt: data.created_at,
      maskedTransactions: data.masked_transactions as unknown as MaskedRow[],
      freeSummary: data.free_summary as FreeSummary,
    }
  })
}

export async function listUserAnalyses(): Promise<
  { id: string; createdAt: string; freeSummary: FreeSummary }[]
> {
  return withJwtClockSkewRetry(async () => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("analyses")
      .select("id, created_at, free_summary")
      .order("created_at", { ascending: false })

    if (error) throw error

    return (data ?? []).map((row: Pick<AnalysisRow, "id" | "created_at" | "free_summary">) => ({
      id: row.id,
      createdAt: row.created_at,
      freeSummary: row.free_summary as FreeSummary,
    }))
  })
}
