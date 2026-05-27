import type { Activity, Forecast, Preferences, RankedActivity } from "./types";

export function scoreActivity(activity: Activity, preferences: Preferences, forecast: Forecast): RankedActivity {
  const hobbyScore = activity.hobbies.filter((hobby) => preferences.hobbies.includes(hobby)).length * 22;
  const intensityScore = activity.intensity === preferences.intensity ? 18 : activity.intensity === "Balanced" ? 10 : 4;
  const venueScore = activity.venue === preferences.venue || preferences.venue === "Mixed" ? 14 : 2;
  const budgetScore = activity.cost <= preferences.budget ? 12 : -8;
  const rainPenalty = forecast.rainChance > 45 && activity.venue === "Outdoor" ? -24 : 0;
  const uvPenalty = preferences.sunSensitive && forecast.uvIndex >= 7 && activity.venue === "Outdoor" ? -10 : 0;
  const heatPenalty = preferences.heatSensitive && forecast.heatRisk === "high" && activity.venue === "Outdoor" ? -18 : 0;
  const accessibilityPenalty = preferences.accessibility && activity.accessibilityNotes.includes("Call ahead") ? -6 : 0;
  const rawScore = 50 + hobbyScore + intensityScore + venueScore + budgetScore + rainPenalty + uvPenalty + heatPenalty + accessibilityPenalty;
  const safetyNotes = buildSafetyNotes(activity, preferences, forecast);

  return {
    ...activity,
    score: Math.max(35, Math.min(98, rawScore)),
    weatherFit: safetyNotes.some((note) => note.includes("Avoid")) ? "avoid" : safetyNotes.length > 1 ? "caution" : rawScore > 95 ? "great" : "good",
    safetyNotes
  };
}

export function buildSafetyNotes(activity: Activity, preferences: Preferences, forecast: Forecast) {
  const notes: string[] = [];
  if (forecast.uvIndex >= 7 && activity.venue === "Outdoor") {
    notes.push("High UV: prefer shade, SPF, sunglasses, and morning timing.");
  }
  if (forecast.rainChance >= 50 && activity.venue === "Outdoor") {
    notes.push("Avoid uncovered outdoor plans if rain probability keeps rising.");
  }
  if (preferences.heatSensitive && forecast.feelsLikeC >= 30 && activity.venue === "Outdoor") {
    notes.push("Heat sensitive profile: keep outdoor plans short and hydrate.");
  }
  if (preferences.accessibility) {
    notes.push(activity.accessibilityNotes);
  }
  return notes;
}

export function rankActivities(activities: Activity[], preferences: Preferences, forecast: Forecast) {
  return activities
    .map((activity) => scoreActivity(activity, preferences, forecast))
    .filter((activity) => activity.weatherFit !== "avoid")
    .sort((a, b) => b.score - a.score);
}

export function outfitFor(preferences: Preferences, forecast: Forecast) {
  const base =
    preferences.style === "Sporty"
      ? "moisture-wicking tee, running shorts, cap"
      : preferences.style === "Polished"
        ? "linen button-up, light chinos, leather sandals"
        : "linen shirt, breathable shorts, sunglasses";
  const sun = preferences.sunSensitive || forecast.uvIndex >= 7 ? ", SPF 50, wide-brim hat" : ", polarized sunglasses";
  const heat = preferences.heatSensitive || forecast.feelsLikeC >= 30 ? ", refillable water bottle" : ", light overshirt for evening";
  return `${base}${sun}${heat}`;
}
