import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultForecast } from "./data";
import type { Forecast } from "./types";

type GeocodeResult = {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  admin1?: string;
  country?: string;
};

type OpenMeteoForecast = {
  timezone?: string;
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    apparent_temperature_max?: number[];
    uv_index_max?: number[];
    precipitation_probability_max?: number[];
    wind_speed_10m_max?: number[];
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    precipitation_probability?: number[];
    relative_humidity_2m?: number[];
    wind_speed_10m?: number[];
    uv_index?: number[];
  };
};

const weatherCodeSummaries: Record<number, string> = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate showers",
  82: "Heavy showers",
  95: "Thunderstorm"
};

function toNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.round(value!) : fallback;
}

function average(values: Array<number | undefined>, fallback: number) {
  const clean = values.filter((value): value is number => Number.isFinite(value));
  if (clean.length === 0) {
    return fallback;
  }
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function heatRisk(feelsLikeC: number): Forecast["heatRisk"] {
  if (feelsLikeC >= 34) {
    return "high";
  }
  if (feelsLikeC >= 29) {
    return "moderate";
  }
  return "low";
}

function bestOutdoorWindow(data: OpenMeteoForecast) {
  const times = data.hourly?.time ?? [];
  const temperatures = data.hourly?.apparent_temperature ?? data.hourly?.temperature_2m ?? [];
  const rain = data.hourly?.precipitation_probability ?? [];
  const uv = data.hourly?.uv_index ?? [];
  const candidates = times
    .map((time, index) => {
      const hour = Number(time.slice(11, 13));
      if (hour < 7 || hour > 20) {
        return null;
      }
      const score =
        Math.abs((temperatures[index] ?? 24) - 24) * -2 -
        (rain[index] ?? 0) * 0.8 -
        Math.max(0, (uv[index] ?? 0) - 5) * 4 +
        (hour < 12 ? 8 : 0);
      return { hour, score };
    })
    .filter((candidate): candidate is { hour: number; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score);
  const start = candidates[0]?.hour ?? 9;
  const end = Math.min(start + 3, 21);
  return `${formatHour(start)} - ${formatHour(end)}`;
}

function iconForWeather(code: number | undefined, rainChance: number): "sun" | "cloud" | "rain" {
  if (rainChance >= 45 || (code && code >= 51)) {
    return "rain";
  }
  if (code === 0 || code === 1) {
    return "sun";
  }
  return "cloud";
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:00 ${suffix}`;
}

async function geocodeLocation(location: string): Promise<GeocodeResult | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { results?: GeocodeResult[] };
  return data.results?.[0] ?? null;
}

function hourlyDisplay(data: OpenMeteoForecast) {
  const times = data.hourly?.time ?? [];
  const temperatures = data.hourly?.temperature_2m ?? [];
  const apparentTemperatures = data.hourly?.apparent_temperature ?? [];
  const rain = data.hourly?.precipitation_probability ?? [];
  const uv = data.hourly?.uv_index ?? [];
  const wind = data.hourly?.wind_speed_10m ?? [];
  const humidity = data.hourly?.relative_humidity_2m ?? [];
  const code = data.daily?.weather_code?.[0];
  const preferredHours = new Set([8, 10, 12, 14, 16, 18]);
  const cells = times
    .map((time, index) => {
      const hour = Number(time.slice(11, 13));
      if (!preferredHours.has(hour)) {
        return null;
      }
      return {
        time: formatHour(hour).replace(":00", ""),
        temp: toNumber(temperatures[index], defaultForecast.temperatureC),
        feelsLikeC: toNumber(apparentTemperatures[index], temperatures[index] ?? defaultForecast.feelsLikeC),
        rainChance: toNumber(rain[index], defaultForecast.rainChance),
        uvIndex: toNumber(uv[index], defaultForecast.uvIndex),
        windKph: toNumber(wind[index], defaultForecast.windKph),
        humidity: toNumber(humidity[index], defaultForecast.humidity),
        icon: iconForWeather(code, rain[index] ?? 0)
      };
    })
    .filter(
      (
        cell
      ): cell is {
        time: string;
        temp: number;
        feelsLikeC: number;
        rainChance: number;
        uvIndex: number;
        windKph: number;
        humidity: number;
        icon: "sun" | "cloud" | "rain";
      } => Boolean(cell)
    );

  return cells.length ? cells : defaultForecast.hourly;
}

function forecastFromOpenMeteo(location: string, data: OpenMeteoForecast, forecastDate?: string): Forecast {
  const daily = data.daily ?? {};
  const hourly = data.hourly ?? {};
  const temperatureC = toNumber(daily.temperature_2m_max?.[0], defaultForecast.temperatureC);
  const feelsLikeC = toNumber(daily.apparent_temperature_max?.[0], defaultForecast.feelsLikeC);
  const rainChance = toNumber(daily.precipitation_probability_max?.[0], defaultForecast.rainChance);
  const uvIndex = toNumber(daily.uv_index_max?.[0], defaultForecast.uvIndex);
  const windKph = toNumber(daily.wind_speed_10m_max?.[0], defaultForecast.windKph);
  const humidity = average((hourly.relative_humidity_2m ?? []).slice(8, 20), defaultForecast.humidity);
  const weatherCode = daily.weather_code?.[0] ?? 2;

  return {
    location,
    provider: "open-meteo",
    forecastDate: forecastDate ?? daily.time?.[0],
    summary: weatherCodeSummaries[weatherCode] ?? "Forecast available",
    temperatureC,
    feelsLikeC,
    uvIndex,
    rainChance,
    windKph,
    humidity,
    heatRisk: heatRisk(feelsLikeC),
    bestWindow: bestOutdoorWindow(data),
    hourly: hourlyDisplay(data)
  };
}

type Coordinates = {
  latitude: number;
  longitude: number;
};

function coordinateCacheKey(coordinates: Coordinates) {
  return `geo:${coordinates.latitude.toFixed(3)},${coordinates.longitude.toFixed(3)}`;
}

export async function fetchLiveForecast(
  location: string,
  coordinates?: Coordinates
): Promise<{ forecast: Forecast; payload: unknown } | null> {
  const geocode: GeocodeResult | null = coordinates
    ? {
        name: location,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude
      }
    : await geocodeLocation(location);
  if (!geocode) {
    return null;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(geocode.latitude));
  url.searchParams.set("longitude", String(geocode.longitude));
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("timezone", geocode.timezone || "auto");
  url.searchParams.set("hourly", "temperature_2m,apparent_temperature,precipitation_probability,relative_humidity_2m,wind_speed_10m,uv_index");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,apparent_temperature_max,uv_index_max,precipitation_probability_max,wind_speed_10m_max");

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as OpenMeteoForecast;
  const label = coordinates ? location : [geocode.name, geocode.admin1, geocode.country].filter(Boolean).join(", ");
  return {
    forecast: forecastFromOpenMeteo(label || location, payload, payload.daily?.time?.[0]),
    payload: { geocode, forecast: payload }
  };
}

export async function getForecastForLocation(
  location: string,
  options: { supabase?: SupabaseClient | null; date?: string; coordinates?: Coordinates } = {}
) {
  const forecastDate = options.date ?? new Date().toISOString().slice(0, 10);
  const cacheLocation = options.coordinates ? coordinateCacheKey(options.coordinates) : location;
  const cached = options.supabase
    ? await options.supabase
        .from("daily_forecasts")
        .select("id, payload, summary, temperature_c, feels_like_c, uv_index, rain_chance, wind_kph, humidity, heat_risk, best_window")
        .eq("location", cacheLocation)
        .eq("forecast_date", forecastDate)
        .eq("provider", "open-meteo")
        .maybeSingle()
    : null;

  if (cached?.data) {
    return {
      location,
      forecastId: cached.data.id,
      provider: "open-meteo",
      forecastDate,
      summary: cached.data.summary,
      temperatureC: Math.round(Number(cached.data.temperature_c)),
      feelsLikeC: Math.round(Number(cached.data.feels_like_c)),
      uvIndex: Math.round(Number(cached.data.uv_index)),
      rainChance: Math.round(Number(cached.data.rain_chance)),
      windKph: Math.round(Number(cached.data.wind_kph)),
      humidity: Math.round(Number(cached.data.humidity)),
      heatRisk: cached.data.heat_risk as Forecast["heatRisk"],
      bestWindow: cached.data.best_window,
      hourly: forecastFromOpenMeteo(location, (cached.data.payload as { forecast?: OpenMeteoForecast }).forecast ?? {}, forecastDate).hourly
    };
  }

  const live = await fetchLiveForecast(location, options.coordinates);
  if (!live) {
    return { ...defaultForecast, location };
  }

  if (options.supabase) {
    const upsert = await options.supabase
      .from("daily_forecasts")
      .upsert({
        location: cacheLocation,
        forecast_date: forecastDate,
        provider: "open-meteo",
        payload: live.payload,
        summary: live.forecast.summary,
        temperature_c: live.forecast.temperatureC,
        feels_like_c: live.forecast.feelsLikeC,
        uv_index: live.forecast.uvIndex,
        rain_chance: live.forecast.rainChance,
        wind_kph: live.forecast.windKph,
        humidity: live.forecast.humidity,
        heat_risk: live.forecast.heatRisk,
        best_window: live.forecast.bestWindow
      })
      .select("id")
      .single();

    if (!upsert.error) {
      live.forecast.forecastId = upsert.data.id as string;
    }
  }

  return live.forecast;
}
