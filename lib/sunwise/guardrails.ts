import type { Activity, Forecast, Preferences, RankedActivity } from "./types";

type HourlyPoint = NonNullable<Forecast["hourly"]>[number];

type WindowConditions = {
  label: string;
  feelsLikeC: number;
  rainChance: number;
  uvIndex: number;
  windKph: number;
  humidity: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseClock(value: string) {
  const match = value.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") {
    hour += 12;
  }
  return hour * 60 + Number(match[2] || 0);
}

function activityMinutes(time: string) {
  const [startText, endText] = time.split(/\s+-\s+/);
  const start = parseClock(startText);
  const end = parseClock(endText);
  return start === null || end === null ? null : { start, end };
}

function pointMinutes(point: HourlyPoint) {
  return parseClock(point.time);
}

function average(values: number[], fallback: number) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function conditionsForActivity(activity: Activity, forecast: Forecast): WindowConditions {
  const points = forecast.hourly ?? [];
  const window = activityMinutes(activity.time);
  let selected = window
    ? points.filter((point) => {
        const minutes = pointMinutes(point);
        return minutes !== null && minutes >= window.start && minutes <= window.end;
      })
    : [];

  if (!selected.length && window && points.length) {
    const midpoint = (window.start + window.end) / 2;
    selected = [
      points.reduce((closest, point) => {
        const pointTime = pointMinutes(point) ?? midpoint;
        const closestTime = pointMinutes(closest) ?? midpoint;
        return Math.abs(pointTime - midpoint) < Math.abs(closestTime - midpoint) ? point : closest;
      })
    ];
  }

  return {
    label: selected.length ? selected.map((point) => point.time).join(" to ") : activity.time,
    feelsLikeC: Math.round(
      average(
        selected.map((point) => point.feelsLikeC ?? point.temp),
        forecast.feelsLikeC
      )
    ),
    rainChance: Math.round(
      selected.length
        ? Math.max(...selected.map((point) => point.rainChance ?? forecast.rainChance))
        : forecast.rainChance
    ),
    uvIndex: Math.round(
      selected.length ? Math.max(...selected.map((point) => point.uvIndex ?? forecast.uvIndex)) : forecast.uvIndex
    ),
    windKph: Math.round(
      selected.length ? Math.max(...selected.map((point) => point.windKph ?? forecast.windKph)) : forecast.windKph
    ),
    humidity: Math.round(
      average(
        selected.map((point) => point.humidity ?? forecast.humidity),
        forecast.humidity
      )
    )
  };
}

function weatherEvaluation(activity: Activity, preferences: Preferences, conditions: WindowConditions) {
  const exposure = activity.venue === "Outdoor" ? 1 : activity.venue === "Mixed" ? 0.55 : 0;
  let penalty = 0;
  const concerns: string[] = [];
  const positives: string[] = [];

  if (exposure > 0) {
    const rainPenalty =
      conditions.rainChance >= 70
        ? 28
        : conditions.rainChance >= 50
          ? 20
          : conditions.rainChance >= 30
            ? 10
            : conditions.rainChance >= 20
              ? 4
              : 0;
    penalty += rainPenalty * exposure;
    if (conditions.rainChance >= 30) {
      concerns.push(`${conditions.rainChance}% rain risk`);
    } else {
      positives.push("low rain risk");
    }

    const uvBase =
      conditions.uvIndex >= 9 ? 14 : conditions.uvIndex >= 7 ? 9 : conditions.uvIndex >= 5 ? 4 : 0;
    penalty += uvBase * exposure * (preferences.sunSensitive ? 1.35 : 1);
    if (conditions.uvIndex >= 6) {
      concerns.push(`UV ${conditions.uvIndex}`);
    }

    const heatBase =
      conditions.feelsLikeC >= 36
        ? 25
        : conditions.feelsLikeC >= 32
          ? 16
          : conditions.feelsLikeC >= 29
            ? 8
            : conditions.feelsLikeC <= 5
              ? 14
              : conditions.feelsLikeC <= 10
                ? 7
                : 0;
    penalty += heatBase * exposure * (preferences.heatSensitive && conditions.feelsLikeC >= 29 ? 1.35 : 1);
    if (conditions.feelsLikeC >= 29) {
      concerns.push(`feels like ${conditions.feelsLikeC}C`);
    } else if (conditions.feelsLikeC >= 15 && conditions.feelsLikeC <= 27) {
      positives.push(`comfortable ${conditions.feelsLikeC}C`);
    }

    const windMultiplier = activity.hobbies.includes("Cycling") ? 1.35 : activity.hobbies.includes("Picnics") ? 1.15 : 1;
    const windBase =
      conditions.windKph >= 40 ? 24 : conditions.windKph >= 30 ? 15 : conditions.windKph >= 22 ? 7 : 0;
    penalty += windBase * exposure * windMultiplier;
    if (conditions.windKph >= 25) {
      concerns.push(`${conditions.windKph} km/h wind`);
    } else if (conditions.windKph <= 18) {
      positives.push("light wind");
    }

    if (conditions.humidity >= 78 && conditions.feelsLikeC >= 28) {
      penalty += 5 * exposure;
      concerns.push("humid conditions");
    }
  } else if (
    conditions.rainChance >= 50 ||
    conditions.feelsLikeC >= 32 ||
    conditions.uvIndex >= 8 ||
    conditions.windKph >= 30
  ) {
    positives.push("weather-safe indoor option");
  }

  const weatherScore = Math.round(clamp(30 - penalty, 0, 30));
  const weatherFit: RankedActivity["weatherFit"] =
    weatherScore <= 7 ? "avoid" : weatherScore <= 17 ? "caution" : weatherScore >= 27 ? "great" : "good";
  const details = concerns.length ? concerns.slice(0, 2) : positives.slice(0, 2);
  const weatherReason = details.length
    ? `${details.join(" and ")} during ${conditions.label}.`
    : `Generally suitable conditions during ${conditions.label}.`;

  return { weatherScore, weatherFit, weatherReason };
}

export function scoreActivity(activity: Activity, preferences: Preferences, forecast: Forecast): RankedActivity {
  const conditions = conditionsForActivity(activity, forecast);
  const weather = weatherEvaluation(activity, preferences, conditions);
  const hobbyMatches = activity.hobbies.filter((hobby) => preferences.hobbies.includes(hobby)).length;
  const hobbyScore = Math.min(30, hobbyMatches * 15);
  const intensityScore = activity.intensity === preferences.intensity ? 14 : activity.intensity === "Balanced" ? 8 : 3;
  const venueScore = activity.venue === preferences.venue || preferences.venue === "Mixed" ? 12 : 3;
  const budgetScore = activity.cost <= preferences.budget ? 10 : -10;
  const accessibilityPenalty = preferences.accessibility && activity.accessibilityNotes.includes("Call ahead") ? -6 : 0;
  const indoorSafetyBonus =
    activity.venue === "Indoor" &&
    (conditions.rainChance >= 50 || conditions.feelsLikeC >= 32 || conditions.uvIndex >= 8)
      ? 5
      : 0;
  const rawScore =
    5 +
    hobbyScore +
    intensityScore +
    venueScore +
    budgetScore +
    weather.weatherScore +
    indoorSafetyBonus +
    accessibilityPenalty;
  const safetyNotes = buildSafetyNotes(activity, preferences, forecast, conditions);

  return {
    ...activity,
    score: Math.round(clamp(rawScore, 25, 98)),
    weatherScore: weather.weatherScore,
    weatherFit: weather.weatherFit,
    weatherReason: weather.weatherReason,
    safetyNotes
  };
}

export function buildSafetyNotes(
  activity: Activity,
  preferences: Preferences,
  forecast: Forecast,
  providedConditions?: WindowConditions
) {
  const conditions = providedConditions ?? conditionsForActivity(activity, forecast);
  const notes: string[] = [];

  if (activity.venue !== "Indoor" && conditions.uvIndex >= 7) {
    notes.push(`UV ${conditions.uvIndex} during this window: use shade, SPF, sunglasses, and sun-protective clothing.`);
  }
  if (activity.venue !== "Indoor" && conditions.rainChance >= 50) {
    notes.push(`${conditions.rainChance}% rain risk during this activity: choose cover or keep an indoor backup.`);
  }
  if (activity.venue !== "Indoor" && preferences.heatSensitive && conditions.feelsLikeC >= 29) {
    notes.push(`Feels like ${conditions.feelsLikeC}C: shorten outdoor time, hydrate, and take cooling breaks.`);
  }
  if (activity.venue !== "Indoor" && conditions.windKph >= 30) {
    notes.push(`${conditions.windKph} km/h wind may affect exposed routes and lightweight gear.`);
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
  const rain = forecast.rainChance >= 45 ? ", compact rain shell" : "";
  return `${base}${sun}${heat}${rain}`;
}
