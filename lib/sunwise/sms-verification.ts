import { createHash, randomInt } from "crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const SMS_CONSENT_TEXT =
  "I agree to receive recurring automated daily Sunwise weather and activity text messages. Message and data rates may apply. Reply STOP to opt out.";

export function isValidE164(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

export function createVerificationCode() {
  return randomInt(100000, 1000000).toString();
}

export function hashVerificationCode(userId: string, phone: string, code: string) {
  const secret = process.env.SMS_VERIFICATION_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHash("sha256").update(`${userId}:${phone}:${code}:${secret}`).digest("hex");
}

export async function getAuthenticatedUser(request: Request): Promise<{
  supabase: SupabaseClient;
  user: User;
} | null> {
  const supabase = createSupabaseServerClient();
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

  if (!supabase || !token) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return null;
  }

  return { supabase, user: data.user };
}
