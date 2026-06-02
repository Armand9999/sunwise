import { NextResponse } from "next/server";
import { runDailyDigestDelivery } from "@/lib/sunwise/delivery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret && process.env.NODE_ENV !== "production") {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const cronSecret = request.headers.get("x-cron-secret");
  return authorization === `Bearer ${secret}` || cronSecret === secret;
}

async function runDigestRequest(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role credentials are not configured" }, { status: 500 });
  }

  try {
    const url = new URL(request.url);
    const body = (await request.json().catch(() => ({}))) as { limit?: number; windowMinutes?: number };
    const queryLimit = Number(url.searchParams.get("limit")) || undefined;
    const queryWindowMinutes = Number(url.searchParams.get("windowMinutes")) || undefined;
    const limit = body.limit ?? queryLimit;
    const windowMinutes = body.windowMinutes ?? queryWindowMinutes;
    const triggerSource = request.headers.get("x-vercel-cron-schedule") ? "cron" : "api";
    const result = await runDailyDigestDelivery(supabase, {
      limit,
      windowMinutes,
      triggerSource
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Daily digest delivery failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return runDigestRequest(request);
}

export async function GET(request: Request) {
  return runDigestRequest(request);
}
