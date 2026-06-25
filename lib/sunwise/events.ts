import type { Forecast, Hobby, LocalEvent, Preferences } from "./types";
import { searchTicketmasterEvents, type ProviderEvent } from "./events/providers/ticketmaster";

const hobbyTerms: Record<Hobby, string[]> = {
  Cycling: ["cycling", "bike", "bicycle", "race", "sports"],
  Picnics: ["festival", "fair", "food", "family", "park"],
  Swimming: ["swimming", "aquatics", "water", "sports"],
  Climbing: ["climbing", "outdoor", "sports", "adventure"],
  Gardening: ["garden", "flower", "home", "nature", "fair"],
  Markets: ["market", "food", "festival", "fair", "trade"]
};

function eventHour(event: ProviderEvent) {
  if (!event.localTime) {
    return null;
  }
  return Number(event.localTime.slice(0, 2));
}

function hourlyWeather(forecast: Forecast, hour: number | null) {
  if (hour === null || !forecast.hourly?.length) {
    return null;
  }
  return forecast.hourly.reduce((closest, point) => {
    const pointHour = Number(point.time.match(/\d+/)?.[0] ?? 0) % 12 + (point.time.includes("PM") ? 12 : 0);
    const closestHour =
      Number(closest.time.match(/\d+/)?.[0] ?? 0) % 12 + (closest.time.includes("PM") ? 12 : 0);
    return Math.abs(pointHour - hour) < Math.abs(closestHour - hour) ? point : closest;
  });
}

function eventInterestScore(event: ProviderEvent, preferences: Preferences) {
  const text = `${event.title} ${event.classifications.join(" ")}`.toLowerCase();
  const matches = preferences.hobbies.filter((hobby) =>
    hobbyTerms[hobby].some((term) => text.includes(term))
  ).length;
  return Math.min(30, matches * 15);
}

function weatherEvaluation(event: ProviderEvent, forecast: Forecast) {
  if (event.localDate !== forecast.forecastDate) {
    return { score: 6, fit: "unknown" as const, reason: "Weather forecast will be checked closer to the event." };
  }

  const point = hourlyWeather(forecast, eventHour(event));
  const rain = point?.rainChance ?? forecast.rainChance;
  const uv = point?.uvIndex ?? forecast.uvIndex;
  const feelsLike = point?.feelsLikeC ?? forecast.feelsLikeC;
  const wind = point?.windKph ?? forecast.windKph;

  if (event.venueType === "indoor") {
    const bonus = rain >= 50 || uv >= 8 || feelsLike >= 32 ? 12 : 9;
    return {
      score: bonus,
      fit: bonus >= 11 ? ("great" as const) : ("good" as const),
      reason: rain >= 50 || uv >= 8 || feelsLike >= 32
        ? "Indoor venue is a strong weather-safe option."
        : "Indoor venue keeps the plan weather-flexible."
    };
  }

  if (event.venueType === "outdoor") {
    let score = 12;
    const concerns: string[] = [];
    if (rain >= 60) {
      score -= 9;
      concerns.push(`${rain}% rain risk`);
    } else if (rain >= 35) {
      score -= 5;
      concerns.push(`${rain}% rain chance`);
    }
    if (uv >= 8) {
      score -= 4;
      concerns.push(`UV ${uv}`);
    }
    if (feelsLike >= 32) {
      score -= 5;
      concerns.push(`feels like ${feelsLike}C`);
    }
    if (wind >= 30) {
      score -= 4;
      concerns.push(`${wind} km/h wind`);
    }
    const clamped = Math.max(0, score);
    return {
      score: clamped,
      fit: clamped <= 3 ? ("caution" as const) : clamped >= 10 ? ("great" as const) : ("good" as const),
      reason: concerns.length
        ? `${concerns.slice(0, 2).join(" and ")} near event time.`
        : "Outdoor conditions look favorable near event time."
    };
  }

  return { score: 7, fit: "unknown" as const, reason: "Venue exposure is not specified." };
}

function rankEvent(event: ProviderEvent, preferences: Preferences, forecast: Forecast): LocalEvent {
  const interestScore = eventInterestScore(event, preferences);
  const distanceScore =
    event.distanceKm === null
      ? 8
      : event.distanceKm <= 5
        ? 20
        : event.distanceKm <= 15
          ? 15
          : event.distanceKm <= 30
            ? 9
            : 4;
  const daysAway = Math.max(
    0,
    Math.round((new Date(`${event.localDate}T12:00:00`).getTime() - Date.now()) / 86_400_000)
  );
  const timingScore = daysAway <= 1 ? 18 : daysAway <= 3 ? 14 : 9;
  const priceScore =
    event.priceMin === null ? 7 : event.priceMin <= preferences.budget ? 15 : event.priceMin <= preferences.budget * 1.5 ? 8 : 1;
  const weather = weatherEvaluation(event, forecast);
  const score = Math.min(98, 25 + interestScore + distanceScore + timingScore + priceScore + weather.score);
  const reasons = [
    event.distanceKm !== null ? `${event.distanceKm.toFixed(1)} km away` : null,
    interestScore > 0 ? "matches your interests" : null,
    event.priceMin !== null ? `${event.currency || ""} ${event.priceMin.toFixed(0)}+` : null,
    weather.reason
  ].filter(Boolean);

  return {
    id: `${event.provider}:${event.providerEventId}`,
    provider: event.provider,
    title: event.title,
    url: event.url,
    startAt: event.startAt,
    localDate: event.localDate,
    localTime: event.localTime,
    venueName: event.venueName,
    city: event.city,
    region: event.region,
    distanceKm: event.distanceKm,
    classifications: event.classifications,
    priceMin: event.priceMin,
    priceMax: event.priceMax,
    currency: event.currency,
    imageUrl: event.imageUrl,
    venueType: event.venueType,
    score,
    weatherFit: weather.fit,
    reason: reasons.join(". ")
  };
}

function dedupeKey(event: ProviderEvent) {
  const normalizedTitle = event.title
    .toLowerCase()
    .replace(/^(gold|silver|bronze|platinum|vip)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalizedTitle}|${event.localDate}|${event.venueName || ""}`;
}

export async function discoverLocalEvents(preferences: Preferences, forecast: Forecast) {
  try {
    let events = await searchTicketmasterEvents(preferences);
    if (
      events.length === 0 &&
      Number.isFinite(preferences.latitude) &&
      Number.isFinite(preferences.longitude)
    ) {
      events = await searchTicketmasterEvents(preferences, 100);
    }
    const uniqueEvents = Array.from(
      new Map(events.map((event) => [dedupeKey(event), event])).values()
    );
    return uniqueEvents
      .map((event) => rankEvent(event, preferences, forecast))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);
  } catch {
    return [];
  }
}
