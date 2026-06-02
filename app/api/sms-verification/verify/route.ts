import { NextResponse } from "next/server";
import {
  SMS_CONSENT_TEXT,
  getAuthenticatedUser,
  hashVerificationCode,
  isValidE164
} from "@/lib/sunwise/sms-verification";

type VerificationRow = {
  id: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
};

function requestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { phone?: string; code?: string; consent?: boolean };
  const phone = body.phone?.trim() ?? "";
  const code = body.code?.trim() ?? "";

  if (!isValidE164(phone)) {
    return NextResponse.json({ error: "Use E.164 format, like +14165550123." }, { status: 400 });
  }

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Enter the 6-digit verification code." }, { status: 400 });
  }

  if (!body.consent) {
    return NextResponse.json({ error: "Consent is required before daily text messages can be enabled." }, { status: 400 });
  }

  const verificationResponse = await auth.supabase
    .from("sms_verification_codes")
    .select("id, code_hash, attempts, expires_at")
    .eq("user_id", auth.user.id)
    .eq("phone_e164", phone)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<VerificationRow>();

  if (verificationResponse.error) {
    return NextResponse.json({ error: verificationResponse.error.message }, { status: 500 });
  }

  if (!verificationResponse.data) {
    return NextResponse.json({ error: "Verification code expired. Request a new code." }, { status: 400 });
  }

  if (verificationResponse.data.attempts >= 5) {
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }

  const codeHash = hashVerificationCode(auth.user.id, phone, code);
  if (codeHash !== verificationResponse.data.code_hash) {
    await auth.supabase
      .from("sms_verification_codes")
      .update({ attempts: verificationResponse.data.attempts + 1 })
      .eq("id", verificationResponse.data.id);

    return NextResponse.json({ error: "That code does not match." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const [codeResponse, profileResponse] = await Promise.all([
    auth.supabase
      .from("sms_verification_codes")
      .update({ consumed_at: now, attempts: verificationResponse.data.attempts + 1 })
      .eq("id", verificationResponse.data.id),
    auth.supabase
      .from("profiles")
      .update({
        phone_e164: phone,
        sms_enabled: true,
        sms_verified_at: now,
        sms_verified_phone_e164: phone,
        sms_consent_at: now,
        sms_consent_text: SMS_CONSENT_TEXT,
        sms_consent_ip: requestIp(request),
        sms_consent_user_agent: request.headers.get("user-agent")
      })
      .eq("id", auth.user.id)
  ]);

  if (codeResponse.error || profileResponse.error) {
    return NextResponse.json(
      { error: codeResponse.error?.message || profileResponse.error?.message || "Could not verify phone." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    phone,
    smsVerifiedAt: now,
    smsConsentAt: now,
    consentText: SMS_CONSENT_TEXT
  });
}
