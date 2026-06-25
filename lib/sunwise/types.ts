export type Hobby = "Cycling" | "Picnics" | "Swimming" | "Climbing" | "Gardening" | "Markets";
export type Intensity = "Easy" | "Balanced" | "Active";
export type Venue = "Outdoor" | "Mixed" | "Indoor";
export type Style = "Breezy" | "Sporty" | "Polished";

export type Preferences = {
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracyM?: number | null;
  locationSource?: "manual" | "browser";
  smsEnabled: boolean;
  sendTime: string;
  hobbies: Hobby[];
  intensity: Intensity;
  venue: Venue;
  heatSensitive: boolean;
  sunSensitive: boolean;
  budget: number;
  accessibility: boolean;
  style: Style;
};

export type Activity = {
  id: string;
  title: string;
  time: string;
  forecast: string;
  intensity: Intensity;
  venue: Venue;
  cost: number;
  hobbies: Hobby[];
  reason: string;
  weatherTags: string[];
  accessibilityNotes: string;
};

export type Forecast = {
  forecastId?: string;
  location: string;
  provider?: string;
  forecastDate?: string;
  summary: string;
  temperatureC: number;
  feelsLikeC: number;
  uvIndex: number;
  rainChance: number;
  windKph: number;
  humidity: number;
  heatRisk: "low" | "moderate" | "high";
  bestWindow: string;
  hourly?: Array<{
    time: string;
    temp: number;
    feelsLikeC?: number;
    rainChance?: number;
    uvIndex?: number;
    windKph?: number;
    humidity?: number;
    icon: "sun" | "cloud" | "rain";
  }>;
};

export type RankedActivity = Activity & {
  score: number;
  weatherScore: number;
  weatherFit: "great" | "good" | "caution" | "avoid";
  weatherReason: string;
  safetyNotes: string[];
  aiReason?: string;
};

export type LocalEvent = {
  id: string;
  provider: "ticketmaster";
  title: string;
  url: string;
  startAt: string;
  localDate: string;
  localTime: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  distanceKm: number | null;
  classifications: string[];
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  imageUrl: string | null;
  venueType: "indoor" | "outdoor" | "mixed" | "unknown";
  score: number;
  weatherFit: "great" | "good" | "caution" | "unknown";
  reason: string;
};

export type RecommendationResult = {
  source: "openai" | "local";
  generatedAt: string;
  forecast: Forecast;
  recommendations: RankedActivity[];
  events: LocalEvent[];
  outfit: string;
  smsCopy: string;
  guardrailsApplied: string[];
};
