import { NextResponse } from "next/server";
import { defaultPreferences } from "@/lib/sunwise/data";
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
    const forecast = await getForecastForLocation(preferences.location, { supabase });
    const result = await generateRecommendations(preferences, forecast);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unable to generate recommendations" }, { status: 400 });
  }
}
