import { createHmac, timingSafeEqual } from "crypto";

export type SmsResult = {
  status: "sent" | "dry_run" | "failed";
  provider: "twilio" | "dry_run";
  providerMessageId?: string;
  error?: string;
};

export function smsCredentialsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_PHONE);
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function validateTwilioSignature(url: string, params: URLSearchParams, signature: string | null) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) {
    return false;
  }

  const sorted = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right));
  const payload = sorted.reduce((value, [key, paramValue]) => `${value}${key}${paramValue}`, url);
  const expected = createHmac("sha1", authToken).update(payload).digest("base64");

  return constantTimeEqual(expected, signature);
}

export function twiml(message: string) {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!smsCredentialsConfigured()) {
    return {
      status: "dry_run",
      provider: "dry_run"
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_PHONE!;
  const payload = new URLSearchParams({ To: to, From: from, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });

  const data = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };

  if (!response.ok) {
    return {
      status: "failed",
      provider: "twilio",
      error: data.message || `Twilio returned ${response.status}`
    };
  }

  return {
    status: "sent",
    provider: "twilio",
    providerMessageId: data.sid
  };
}
