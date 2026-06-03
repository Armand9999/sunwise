import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { twiml, validateTwilioSignature } from "@/lib/sunwise/sms";

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

const STOP_RESPONSE = "Sunwise: you are unsubscribed and will no longer receive daily texts. Sign in to Sunwise to re-enable messages.";
const HELP_RESPONSE = "Sunwise: daily weather and activity texts. Reply STOP to opt out. For help, contact Sunwise support from the app.";
const START_RESPONSE = "Sunwise: to resume daily texts, sign in to Sunwise and verify your phone/consent again.";
const DEFAULT_RESPONSE = "Sunwise received your message. Reply HELP for help or STOP to opt out.";

type ProfileMatch = {
  id: string;
};

function canonicalUrl(request: Request) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");

  if (forwardedProto) {
    url.protocol = `${forwardedProto}:`;
  }

  if (forwardedHost) {
    url.host = forwardedHost;
  }

  return url.toString();
}

function normalizeBody(body: string) {
  return body.trim().toUpperCase();
}

function classify(body: string) {
  const normalized = normalizeBody(body);
  const keyword = normalized.split(/\s+/)[0] || "";

  if (STOP_KEYWORDS.has(keyword)) {
    return { action: "stop" as const, keyword, responseBody: STOP_RESPONSE };
  }

  if (HELP_KEYWORDS.has(keyword)) {
    return { action: "help" as const, keyword, responseBody: HELP_RESPONSE };
  }

  if (START_KEYWORDS.has(keyword)) {
    return { action: "start" as const, keyword, responseBody: START_RESPONSE };
  }

  return { action: "unknown" as const, keyword: keyword || null, responseBody: DEFAULT_RESPONSE };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const signatureValid = validateTwilioSignature(
    canonicalUrl(request),
    params,
    request.headers.get("x-twilio-signature")
  );

  if (!signatureValid) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role credentials are not configured" }, { status: 500 });
  }

  const from = params.get("From") || "";
  const to = params.get("To") || null;
  const body = params.get("Body") || "";
  const providerMessageId = params.get("MessageSid") || params.get("SmsSid");
  const { action, keyword, responseBody } = classify(body);
  const normalized = normalizeBody(body);

  const profileResponse = await supabase
    .from("profiles")
    .select("id")
    .eq("phone_e164", from)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<ProfileMatch>();

  if (profileResponse.error) {
    return NextResponse.json({ error: profileResponse.error.message }, { status: 500 });
  }

  const userId = profileResponse.data?.id ?? null;

  if (action === "stop" && userId) {
    await supabase
      .from("profiles")
      .update({
        sms_enabled: false,
        sms_opted_out_at: new Date().toISOString(),
        sms_opt_out_keyword: keyword
      })
      .eq("id", userId);
  }

  await supabase.from("sms_inbound_messages").insert({
    user_id: userId,
    from_phone_e164: from,
    to_phone_e164: to,
    body,
    normalized_body: normalized,
    keyword,
    action,
    provider_message_id: providerMessageId,
    signature_valid: signatureValid,
    response_body: responseBody
  });

  return new NextResponse(twiml(responseBody), {
    headers: {
      "Content-Type": "text/xml"
    }
  });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "twilio-inbound" });
}
