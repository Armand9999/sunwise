import { activities, defaultForecast } from "./data";
import { outfitFor, rankActivities } from "./guardrails";
import { enhanceWithOpenAI } from "./openai";
import type { Forecast, Preferences, RecommendationResult } from "./types";

export async function generateRecommendations(preferences: Preferences, forecast: Forecast = defaultForecast): Promise<RecommendationResult> {
  const normalizedForecast = {
    ...forecast,
    location: preferences.location || forecast.location
  };
  const ranked = rankActivities(activities, preferences, normalizedForecast);
  const localOutfit = outfitFor(preferences, normalizedForecast);
  const enhanced = await enhanceWithOpenAI({
    preferences,
    forecast: normalizedForecast,
    candidates: ranked,
    localOutfit
  });

  return {
    source: enhanced.source,
    generatedAt: new Date().toISOString(),
    forecast: normalizedForecast,
    recommendations: enhanced.recommendations,
    outfit: enhanced.outfit,
    smsCopy: enhanced.smsCopy,
    guardrailsApplied: [
      "Activity-window weather scoring",
      "Hourly rain, UV, heat, wind, and humidity checks",
      "Budget, hobby, venue, and intensity scoring",
      "Accessibility note propagation"
    ]
  };
}
