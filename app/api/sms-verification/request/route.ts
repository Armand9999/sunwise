import { NextResponse } from "next/server";
import {
  createVerificationCode,
  getAuthenticatedUser,
  hashVerificationCode,
  isValidE164
} from "@/lib/sunwise/sms-verification";
import { sendSms } from "@/lib/sunwise/sms";

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { phone?: string };
  const phone = body.phone?.trim() ?? "";

  if (!isValidE164(phone)) {
    return NextResponse.json({ error: "Use E.164 format, like +14165550123." }, { status: 400 });
  }

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await auth.supabase
    .from("sms_verification_codes")
    .select("id")
    .eq("user_id", auth.user.id)
    .gte("created_at", since);

  if (recent.error) {
    return NextResponse.json({ error: recent.error.message }, { status: 500 });
  }

  if ((recent.data?.length ?? 0) >= 3) {
    return NextResponse.json({ error: "Too many verification attempts. Try again in a few minutes." }, { status: 429 });
  }

  const code = createVerificationCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const insertResponse = await auth.supabase.from("sms_verification_codes").insert({
    user_id: auth.user.id,
    phone_e164: phone,
    code_hash: hashVerificationCode(auth.user.id, phone, code),
    expires_at: expiresAt
  });

  if (insertResponse.error) {
    return NextResponse.json({ error: insertResponse.error.message }, { status: 500 });
  }

  await auth.supabase
    .from("profiles")
    .update({
      phone_e164: phone,
      sms_enabled: false,
      sms_verified_at: null,
      sms_verified_phone_e164: null,
      sms_consent_at: null,
      sms_consent_text: null
    })
    .eq("id", auth.user.id);

  const smsResult = await sendSms(phone, `Sunwise verification code: ${code}. It expires in 10 minutes.`);
  if (smsResult.status === "failed") {
    return NextResponse.json({ error: smsResult.error || "Could not send verification code." }, { status: 502 });
  }

  return NextResponse.json({
    expiresAt,
    deliveryStatus: smsResult.status
  });
}
