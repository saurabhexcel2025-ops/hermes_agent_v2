export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Registration is disabled" }, { status: 403 });
}
