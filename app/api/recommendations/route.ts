import { NextResponse } from "next/server";
import { defaultPreferences } from "@/lib/sunwise/data";
import { discoverLocalEvents } from "@/lib/sunwise/events";
import { generateRecommendations } from "@/lib/sunwise/recommendations";
import type { Preferences } from "@/lib/sunwise/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getForecastForLocation } from "@/lib/sunwise/weather";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{ preferences: Preferences }>;
    const preferences = {
      ...defaultPreferences,
      ...body.preferences
    };
    const supabase = createSupabaseServerClient();
    const coordinates =
      Number.isFinite(preferences.latitude) && Number.isFinite(preferences.longitude)
        ? { latitude: preferences.latitude!, longitude: preferences.longitude! }
        : undefined;
    const forecast = await getForecastForLocation(preferences.location, { supabase, coordinates });
    const events = await discoverLocalEvents(preferences, forecast);
    const result = await generateRecommendations(preferences, forecast, events);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unable to generate recommendations" }, { status: 400 });
  }
}
