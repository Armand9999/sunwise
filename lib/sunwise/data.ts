import type { Activity, Forecast, Hobby, Preferences } from "./types";

export const hobbyOptions: Hobby[] = ["Cycling", "Picnics", "Swimming", "Climbing", "Gardening", "Markets"];

export const defaultPreferences: Preferences = {
  location: "Toronto",
  latitude: null,
  longitude: null,
  locationAccuracyM: null,
  locationSource: "manual",
  smsEnabled: true,
  sendTime: "08:00",
  hobbies: ["Cycling", "Picnics", "Markets"],
  intensity: "Balanced",
  venue: "Mixed",
  heatSensitive: true,
  sunSensitive: true,
  budget: 35,
  accessibility: false,
  style: "Breezy"
};

export const defaultForecast: Forecast = {
  location: "Toronto",
  summary: "Partly sunny",
  temperatureC: 27,
  feelsLikeC: 30,
  uvIndex: 7,
  rainChance: 20,
  windKph: 18,
  humidity: 62,
  heatRisk: "moderate",
  bestWindow: "9:30 AM - 12:00 PM",
  hourly: [
    { time: "8 AM", temp: 22, feelsLikeC: 22, rainChance: 5, uvIndex: 1, windKph: 9, humidity: 68, icon: "sun" },
    { time: "10 AM", temp: 25, feelsLikeC: 26, rainChance: 10, uvIndex: 4, windKph: 12, humidity: 64, icon: "sun" },
    { time: "12 PM", temp: 27, feelsLikeC: 29, rainChance: 15, uvIndex: 7, windKph: 15, humidity: 62, icon: "cloud" },
    { time: "2 PM", temp: 29, feelsLikeC: 32, rainChance: 20, uvIndex: 8, windKph: 18, humidity: 60, icon: "sun" },
    { time: "4 PM", temp: 28, feelsLikeC: 31, rainChance: 55, uvIndex: 4, windKph: 22, humidity: 67, icon: "rain" },
    { time: "6 PM", temp: 25, feelsLikeC: 27, rainChance: 35, uvIndex: 1, windKph: 16, humidity: 70, icon: "cloud" }
  ]
};

export const activities: Activity[] = [
  {
    id: "lakefront-bike-ride",
    title: "Lakefront bike ride",
    time: "9:30 AM - 12:00 PM",
    forecast: "Dry paths, low wind, shaded cafe stops nearby.",
    intensity: "Active",
    venue: "Outdoor",
    cost: 12,
    hobbies: ["Cycling", "Markets"],
    reason: "Best before the humid afternoon. The west wind stays light along the water.",
    weatherTags: ["dry", "breezy", "morning", "sun"],
    accessibilityNotes: "Mostly flat paved route with frequent rest stops."
  },
  {
    id: "shaded-picnic",
    title: "Shaded picnic",
    time: "11:00 AM - 1:30 PM",
    forecast: "Warm with a steady breeze and clear tree cover.",
    intensity: "Easy",
    venue: "Outdoor",
    cost: 24,
    hobbies: ["Picnics", "Gardening"],
    reason: "Comfortable if you bring water and settle under canopy cover.",
    weatherTags: ["shade", "warm", "low-wind", "social"],
    accessibilityNotes: "Choose parks with paved entry paths and accessible tables."
  },
  {
    id: "indoor-climbing",
    title: "Indoor climbing",
    time: "3:00 PM - 5:00 PM",
    forecast: "Peak UV and humidex outside.",
    intensity: "Active",
    venue: "Indoor",
    cost: 38,
    hobbies: ["Climbing"],
    reason: "A strong backup when the afternoon feels sticky or sun exposure is a concern.",
    weatherTags: ["indoor", "heat-safe", "rain-safe", "afternoon"],
    accessibilityNotes: "Call ahead for adaptive climbing options and accessible facilities."
  },
  {
    id: "market-loop",
    title: "Neighborhood market loop",
    time: "8:30 AM - 10:30 AM",
    forecast: "Cooler morning, no rain expected.",
    intensity: "Balanced",
    venue: "Mixed",
    cost: 18,
    hobbies: ["Markets", "Cycling", "Picnics"],
    reason: "Short outdoor bursts with air-conditioned stops keep the day flexible.",
    weatherTags: ["morning", "mixed", "shade", "low-cost"],
    accessibilityNotes: "Pick a market with curb cuts, seating, and short block distances."
  }
];

export const hourly = defaultForecast.hourly;
