import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultPreferences } from "./data";
import { discoverLocalEvents } from "./events";
import { generateRecommendations } from "./recommendations";
import { sendSms } from "./sms";
import type { Hobby, Intensity, Preferences, RecommendationResult, Style, Venue } from "./types";
import { getForecastForLocation } from "./weather";

type ProfileRow = {
  id: string;
  display_name: string | null;
  location: string;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  location_source: "manual" | "browser";
  phone_e164: string | null;
  sms_enabled: boolean;
  sms_verified_at: string | null;
  sms_verified_phone_e164: string | null;
  sms_consent_at: string | null;
  sms_opted_out_at: string | null;
  daily_send_time: string;
  timezone: string;
};

type PreferenceRow = {
  hobbies: Hobby[] | null;
  intensity: Intensity | null;
  venue: Venue | null;
  heat_sensitive: boolean | null;
  sun_sensitive: boolean | null;
  budget: number | null;
  accessibility: boolean | null;
  outfit_style: Style | null;
};

export type DailyDigestRunResult = {
  runId?: string;
  checked: number;
  due: number;
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
  results: Array<{
    userId: string;
    deliveryDate: string;
    status: "sent" | "dry_run" | "skipped" | "failed";
    reason?: string;
  }>;
};

function normalizeTime(time: string) {
  return time.slice(0, 5);
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

function minutesFromTime(time: string) {
  const [hour, minute] = normalizeTime(time).split(":").map(Number);
  return hour * 60 + minute;
}

function isProfileDue(profile: ProfileRow, now: Date, windowMinutes: number) {
  if (
    !profile.sms_enabled ||
    !profile.phone_e164 ||
    profile.sms_verified_phone_e164 !== profile.phone_e164 ||
    !profile.sms_verified_at ||
    !profile.sms_consent_at ||
    profile.sms_opted_out_at
  ) {
    return false;
  }

  const local = localDateTimeParts(now, profile.timezone);
  const delta = minutesFromTime(local.time) - minutesFromTime(profile.daily_send_time);
  return delta >= 0 && delta < windowMinutes;
}

function rowsToPreferences(profile: ProfileRow, preference: PreferenceRow | null): Preferences {
  return {
    ...defaultPreferences,
    location: profile.location || defaultPreferences.location,
    latitude: profile.latitude,
    longitude: profile.longitude,
    locationAccuracyM: profile.location_accuracy_m,
    locationSource: profile.location_source,
    smsEnabled: profile.sms_enabled,
    sendTime: normalizeTime(profile.daily_send_time),
    hobbies: preference?.hobbies?.length ? preference.hobbies : defaultPreferences.hobbies,
    intensity: preference?.intensity || defaultPreferences.intensity,
    venue: preference?.venue || defaultPreferences.venue,
    heatSensitive: preference?.heat_sensitive ?? defaultPreferences.heatSensitive,
    sunSensitive: preference?.sun_sensitive ?? defaultPreferences.sunSensitive,
    budget: preference?.budget ?? defaultPreferences.budget,
    accessibility: preference?.accessibility ?? defaultPreferences.accessibility,
    style: preference?.outfit_style || defaultPreferences.style
  };
}

async function insertRecommendation(
  supabase: SupabaseClient,
  userId: string,
  deliveryDate: string,
  result: RecommendationResult
) {
  const { data, error } = await supabase
    .from("daily_recommendations")
    .insert({
      user_id: userId,
      forecast_id: result.forecast.forecastId ?? null,
      recommendation_date: deliveryDate,
      source: result.source,
      model: result.source === "openai" ? process.env.OPENAI_RECOMMENDATION_MODEL || null : null,
      recommendations: result.recommendations,
      outfit: result.outfit,
      sms_copy: result.smsCopy,
      guardrails_applied: result.guardrailsApplied
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data.id as string;
}

export async function runDailyDigestDelivery(
  supabase: SupabaseClient,
  options: { now?: Date; windowMinutes?: number; limit?: number; triggerSource?: "cron" | "manual" | "admin" | "api" } = {}
): Promise<DailyDigestRunResult> {
  const now = options.now ?? new Date();
  const windowMinutes = options.windowMinutes ?? 15;
  const limit = options.limit ?? 100;
  const summary: DailyDigestRunResult = {
    checked: 0,
    due: 0,
    sent: 0,
    dryRun: 0,
    skipped: 0,
    failed: 0,
    results: []
  };
  let runId: string | undefined;

  try {
    const runResponse = await supabase
      .from("daily_digest_runs")
      .insert({
        trigger_source: options.triggerSource ?? "api",
        status: "running",
        window_minutes: windowMinutes,
        limit_count: limit
      })
      .select("id")
      .single();

    if (runResponse.error) {
      throw new Error(runResponse.error.message);
    }

    runId = runResponse.data.id as string;
    summary.runId = runId;

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, location, latitude, longitude, location_accuracy_m, location_source, phone_e164, sms_enabled, sms_verified_at, sms_verified_phone_e164, sms_consent_at, sms_opted_out_at, daily_send_time, timezone")
      .eq("sms_enabled", true)
      .not("phone_e164", "is", null)
      .not("sms_verified_at", "is", null)
      .not("sms_consent_at", "is", null)
      .is("sms_opted_out_at", null)
      .limit(limit);

    if (profileError) {
      throw new Error(profileError.message);
    }

    summary.checked = profiles?.length ?? 0;

    for (const profile of (profiles ?? []) as ProfileRow[]) {
      if (!isProfileDue(profile, now, windowMinutes)) {
        continue;
      }

      summary.due += 1;
      const deliveryDate = localDateTimeParts(now, profile.timezone).date;
      const pendingDelivery = await supabase
        .from("daily_digest_deliveries")
        .insert({
          user_id: profile.id,
          delivery_date: deliveryDate,
          channel: "sms",
          status: "pending"
        })
        .select("id")
        .single();

      if (pendingDelivery.error) {
        summary.skipped += 1;
        summary.results.push({
          userId: profile.id,
          deliveryDate,
          status: "skipped",
          reason: pendingDelivery.error.message
        });
        continue;
      }

      try {
        const { data: preference } = await supabase
          .from("preference_profiles")
          .select("hobbies, intensity, venue, heat_sensitive, sun_sensitive, budget, accessibility, outfit_style")
          .eq("user_id", profile.id)
          .maybeSingle<PreferenceRow>();
        const preferences = rowsToPreferences(profile, preference);
        const coordinates =
          Number.isFinite(preferences.latitude) && Number.isFinite(preferences.longitude)
            ? { latitude: preferences.latitude!, longitude: preferences.longitude! }
            : undefined;
        const forecast = await getForecastForLocation(preferences.location, {
          supabase,
          date: deliveryDate,
          coordinates
        });
        const events = await discoverLocalEvents(preferences, forecast);
        const recommendation = await generateRecommendations(preferences, forecast, events);
        const recommendationId = await insertRecommendation(supabase, profile.id, deliveryDate, recommendation);
        const smsResult = await sendSms(profile.phone_e164!, recommendation.smsCopy);

        await supabase
          .from("daily_digest_deliveries")
          .update({
            recommendation_id: recommendationId,
            status: smsResult.status,
            provider: smsResult.provider,
            provider_message_id: smsResult.providerMessageId ?? null,
            error: smsResult.error ?? null,
            updated_at: new Date().toISOString()
          })
          .eq("id", pendingDelivery.data.id);

        if (smsResult.status === "sent") {
          summary.sent += 1;
        } else if (smsResult.status === "dry_run") {
          summary.dryRun += 1;
        } else {
          summary.failed += 1;
        }

        summary.results.push({
          userId: profile.id,
          deliveryDate,
          status: smsResult.status,
          reason: smsResult.error
        });
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : "Unknown delivery error";
        await supabase
          .from("daily_digest_deliveries")
          .update({
            status: "failed",
            error: message,
            updated_at: new Date().toISOString()
          })
          .eq("id", pendingDelivery.data.id);
        summary.results.push({
          userId: profile.id,
          deliveryDate,
          status: "failed",
          reason: message
        });
      }
    }

    await supabase
      .from("daily_digest_runs")
      .update({
        status: "completed",
        checked: summary.checked,
        due: summary.due,
        sent: summary.sent,
        dry_run: summary.dryRun,
        skipped: summary.skipped,
        failed: summary.failed,
        finished_at: new Date().toISOString()
      })
      .eq("id", runId);

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Daily digest delivery failed";

    if (runId) {
      await supabase
        .from("daily_digest_runs")
        .update({
          status: "failed",
          checked: summary.checked,
          due: summary.due,
          sent: summary.sent,
          dry_run: summary.dryRun,
          skipped: summary.skipped,
          failed: summary.failed,
          error: message,
          finished_at: new Date().toISOString()
        })
        .eq("id", runId);
    }

    throw error;
  }
}
