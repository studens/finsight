// polar-billing phase: 서명 검증 후 subscriptions 갱신
import { NextResponse } from "next/server"

export async function POST(_request: Request): Promise<NextResponse> {
  return NextResponse.json({ code: "NOT_IMPLEMENTED" }, { status: 501 })
}
