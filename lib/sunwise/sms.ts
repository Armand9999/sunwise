export type SmsResult = {
  status: "sent" | "dry_run" | "failed";
  provider: "twilio" | "dry_run";
  providerMessageId?: string;
  error?: string;
};

export function smsCredentialsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_PHONE);
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
