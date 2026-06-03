import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/sunwise/sms-verification";

type ProfileRow = {
  phone_e164: string | null;
  sms_enabled: boolean;
  sms_verified_at: string | null;
  sms_verified_phone_e164: string | null;
  sms_consent_at: string | null;
  sms_opted_out_at: string | null;
  daily_send_time: string;
  timezone: string;
};

type DeliveryRow = {
  delivery_date: string;
  status: string;
  provider: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type DigestRunRow = {
  trigger_source: string;
  status: string;
  checked: number;
  due: number;
  sent: number;
  failed: number;
  started_at: string;
  finished_at: string | null;
};

function normalizeTime(time: string) {
  return time.slice(0, 5);
}

function nextSendAt(sendTime: string, timeZone: string) {
  const [hour, minute] = normalizeTime(sendTime).split(":").map(Number);
  const now = new Date();
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const value = (type: string) => localParts.find((part) => part.type === type)?.value || "00";
  const localHour = value("hour") === "24" ? 0 : Number(value("hour"));
  const localMinute = Number(value("minute"));
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  const addDay = localHour * 60 + localMinute >= hour * 60 + minute ? 1 : 0;
  const localMidnight = new Date(`${localDate}T00:00:00`);
  localMidnight.setDate(localMidnight.getDate() + addDay);

  return {
    date: localMidnight.toISOString().slice(0, 10),
    time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
    timezone: timeZone
  };
}

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [profileResponse, deliveryResponse, runResponse] = await Promise.all([
    auth.supabase
      .from("profiles")
      .select("phone_e164, sms_enabled, sms_verified_at, sms_verified_phone_e164, sms_consent_at, sms_opted_out_at, daily_send_time, timezone")
      .eq("id", auth.user.id)
      .maybeSingle<ProfileRow>(),
    auth.supabase
      .from("daily_digest_deliveries")
      .select("delivery_date, status, provider, error, created_at, updated_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<DeliveryRow>(),
    auth.supabase
      .from("daily_digest_runs")
      .select("trigger_source, status, checked, due, sent, failed, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<DigestRunRow>()
  ]);

  if (profileResponse.error || deliveryResponse.error || runResponse.error) {
    return NextResponse.json(
      {
        error:
          profileResponse.error?.message ||
          deliveryResponse.error?.message ||
          runResponse.error?.message ||
          "Could not load SMS status"
      },
      { status: 500 }
    );
  }

  const profile = profileResponse.data;
  const verified = Boolean(
    profile?.phone_e164 &&
      profile.sms_verified_phone_e164 === profile.phone_e164 &&
      profile.sms_verified_at &&
      profile.sms_consent_at
  );
  const eligible = Boolean(profile?.sms_enabled && verified && !profile.sms_opted_out_at);

  return NextResponse.json({
    phone: profile?.phone_e164 ?? null,
    enabled: Boolean(profile?.sms_enabled),
    verified,
    consented: Boolean(profile?.sms_consent_at),
    optedOut: Boolean(profile?.sms_opted_out_at),
    smsVerifiedAt: profile?.sms_verified_at ?? null,
    smsConsentAt: profile?.sms_consent_at ?? null,
    smsOptedOutAt: profile?.sms_opted_out_at ?? null,
    nextSend: profile ? nextSendAt(profile.daily_send_time, profile.timezone) : null,
    eligible,
    latestDelivery: deliveryResponse.data,
    latestRun: runResponse.data
  });
}
