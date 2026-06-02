import { NextResponse } from "next/server";
import { runDailyDigestDelivery } from "@/lib/sunwise/delivery";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProfileRow = {
  id: string;
  display_name: string | null;
  location: string;
  phone_e164: string | null;
  sms_enabled: boolean;
  daily_send_time: string;
  timezone: string;
  created_at: string;
};

type DigestRunRow = {
  id: string;
  trigger_source: string;
  status: string;
  window_minutes: number;
  checked: number;
  due: number;
  sent: number;
  dry_run: number;
  skipped: number;
  failed: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

function isAuthorized(request: Request) {
  const secret = process.env.ADMIN_SECRET || process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

function normalizeTime(time: string) {
  return time.slice(0, 5);
}

function minutesFromTime(time: string) {
  const [hour, minute] = normalizeTime(time).split(":").map(Number);
  return hour * 60 + minute;
}

function localDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  const hour = value("hour") === "24" ? "00" : value("hour");

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${hour}:${value("minute")}`
  };
}

function maskPhone(phone: string | null) {
  if (!phone) {
    return "";
  }
  return `${phone.slice(0, 3)}...${phone.slice(-2)}`;
}

function profileStatus(profile: ProfileRow, now: Date, windowMinutes: number) {
  const local = localDateTimeParts(now, profile.timezone);
  const delta = minutesFromTime(local.time) - minutesFromTime(profile.daily_send_time);
  const due = profile.sms_enabled && Boolean(profile.phone_e164) && delta >= 0 && delta < windowMinutes;
  return {
    ...profile,
    phone_e164: maskPhone(profile.phone_e164),
    due,
    localDate: local.date,
    localTime: local.time
  };
}

async function getAdminDigestStatus(request: Request) {
  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role credentials are not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const windowMinutes = Number(url.searchParams.get("windowMinutes")) || 15;
  const now = new Date();

  const [profilesResponse, deliveriesResponse, recommendationsResponse, runsResponse] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, location, phone_e164, sms_enabled, daily_send_time, timezone, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("daily_digest_deliveries")
      .select("id, user_id, delivery_date, status, provider, error, recommendation_id, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("daily_recommendations")
      .select("id, user_id, recommendation_date, source, sms_copy, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("daily_digest_runs")
      .select("id, trigger_source, status, window_minutes, checked, due, sent, dry_run, skipped, failed, error, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(10)
  ]);

  if (profilesResponse.error || deliveriesResponse.error || recommendationsResponse.error || runsResponse.error) {
    return NextResponse.json(
      {
        error:
          profilesResponse.error?.message ||
          deliveriesResponse.error?.message ||
          recommendationsResponse.error?.message ||
          runsResponse.error?.message ||
          "Could not load admin status"
      },
      { status: 500 }
    );
  }

  const profiles = ((profilesResponse.data ?? []) as ProfileRow[]).map((profile) =>
    profileStatus(profile, now, windowMinutes)
  );
  const deliveries = deliveriesResponse.data ?? [];
  const sent = deliveries.filter((delivery) => delivery.status === "sent").length;
  const failed = deliveries.filter((delivery) => delivery.status === "failed").length;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    windowMinutes,
    summary: {
      users: profiles.length,
      smsEnabled: profiles.filter((profile) => profile.sms_enabled).length,
      due: profiles.filter((profile) => profile.due).length,
      recentSent: sent,
      recentFailed: failed
    },
    dueUsers: profiles.filter((profile) => profile.due),
    users: profiles,
    runs: (runsResponse.data ?? []) as DigestRunRow[],
    deliveries,
    recommendations: recommendationsResponse.data ?? []
  });
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return getAdminDigestStatus(request);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role credentials are not configured" }, { status: 500 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number; windowMinutes?: number };
    const result = await runDailyDigestDelivery(supabase, {
      limit: body.limit ?? 25,
      windowMinutes: body.windowMinutes ?? 15,
      triggerSource: "admin"
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Digest run failed" },
      { status: 500 }
    );
  }
}
