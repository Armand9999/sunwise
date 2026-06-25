import type { Preferences } from "@/lib/sunwise/types";

export type ProviderEvent = {
  provider: "ticketmaster";
  providerEventId: string;
  title: string;
  url: string;
  startAt: string;
  localDate: string;
  localTime: string | null;
  timezone: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  classifications: string[];
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  imageUrl: string | null;
  venueType: "indoor" | "outdoor" | "mixed" | "unknown";
  payload: unknown;
};

type TicketmasterEvent = {
  id: string;
  name: string;
  url?: string;
  distance?: number;
  units?: string;
  images?: Array<{ url?: string; ratio?: string; width?: number; fallback?: boolean }>;
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string;
      dateTime?: string;
    };
    timezone?: string;
  };
  priceRanges?: Array<{ min?: number; max?: number; currency?: string }>;
  classifications?: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>;
  _embedded?: {
    venues?: Array<{
      name?: string;
      city?: { name?: string };
      state?: { name?: string };
      country?: { countryCode?: string };
      location?: { latitude?: string; longitude?: string };
    }>;
  };
};

const base32 = "0123456789bcdefghjkmnpqrstuvwxyz";

function geohash(latitude: number, longitude: number, precision = 7) {
  let latitudeRange = [-90, 90];
  let longitudeRange = [-180, 180];
  let hash = "";
  let bit = 0;
  let value = 0;
  let useLongitude = true;

  while (hash.length < precision) {
    const range = useLongitude ? longitudeRange : latitudeRange;
    const coordinate = useLongitude ? longitude : latitude;
    const midpoint = (range[0] + range[1]) / 2;

    if (coordinate >= midpoint) {
      value = value * 2 + 1;
      range[0] = midpoint;
    } else {
      value *= 2;
      range[1] = midpoint;
    }

    useLongitude = !useLongitude;
    bit += 1;

    if (bit === 5) {
      hash += base32[value];
      bit = 0;
      value = 0;
    }
  }

  return hash;
}

function inferVenueType(event: TicketmasterEvent): ProviderEvent["venueType"] {
  const text = [
    event.name,
    event._embedded?.venues?.[0]?.name,
    ...(event.classifications ?? []).flatMap((classification) => [
      classification.segment?.name,
      classification.genre?.name,
      classification.subGenre?.name
    ])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(park|outdoor|festival|fair|market|garden|beach|race|marathon)/.test(text)) {
    return "outdoor";
  }
  if (/(arena|theatre|theater|hall|centre|center|museum|club|cinema|auditorium)/.test(text)) {
    return "indoor";
  }
  return "unknown";
}

function bestImage(event: TicketmasterEvent) {
  return [...(event.images ?? [])]
    .filter((image) => image.url && !image.fallback)
    .sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0]?.url ?? null;
}

function normalizeEvent(event: TicketmasterEvent): ProviderEvent | null {
  const start = event.dates?.start;
  const localDate = start?.localDate;
  if (!localDate || !event.url) {
    return null;
  }

  const venue = event._embedded?.venues?.[0];
  const classificationNames = (event.classifications ?? [])
    .flatMap((classification) => [
      classification.segment?.name,
      classification.genre?.name,
      classification.subGenre?.name
    ])
    .filter((value): value is string => Boolean(value));
  const price = event.priceRanges?.[0];
  const startAt = start.dateTime ?? `${localDate}T${start.localTime || "00:00:00"}`;
  const distanceKm =
    typeof event.distance === "number"
      ? event.units === "miles"
        ? event.distance * 1.60934
        : event.distance
      : null;

  return {
    provider: "ticketmaster",
    providerEventId: event.id,
    title: event.name,
    url: event.url,
    startAt,
    localDate,
    localTime: start.localTime ?? null,
    timezone: event.dates?.timezone ?? null,
    venueName: venue?.name ?? null,
    city: venue?.city?.name ?? null,
    region: venue?.state?.name ?? null,
    countryCode: venue?.country?.countryCode ?? null,
    latitude: venue?.location?.latitude ? Number(venue.location.latitude) : null,
    longitude: venue?.location?.longitude ? Number(venue.location.longitude) : null,
    distanceKm,
    classifications: Array.from(new Set(classificationNames)),
    priceMin: price?.min ?? null,
    priceMax: price?.max ?? null,
    currency: price?.currency ?? null,
    imageUrl: bestImage(event),
    venueType: inferVenueType(event),
    payload: event
  };
}

function dateTimeRange(days: number) {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return {
    start: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    end: end.toISOString().replace(/\.\d{3}Z$/, "Z")
  };
}

export async function searchTicketmasterEvents(preferences: Preferences, radiusKm = 50) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    return [];
  }

  const range = dateTimeRange(7);
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("startDateTime", range.start);
  url.searchParams.set("endDateTime", range.end);
  url.searchParams.set("size", "30");
  url.searchParams.set("includeTBA", "no");
  url.searchParams.set("includeTBD", "no");
  url.searchParams.set("locale", "en,*");
  url.searchParams.set("preferredCountry", "ca");

  if (Number.isFinite(preferences.latitude) && Number.isFinite(preferences.longitude)) {
    url.searchParams.set("geoPoint", geohash(preferences.latitude!, preferences.longitude!));
    url.searchParams.set("radius", String(radiusKm));
    url.searchParams.set("unit", "km");
    url.searchParams.set("sort", "distance,date,asc");
  } else {
    url.searchParams.set("city", preferences.location.split(",")[0].trim());
    url.searchParams.set("sort", "date,asc");
  }

  const response = await fetch(url, { next: { revalidate: 1800 } });
  if (!response.ok) {
    throw new Error(`Ticketmaster returned ${response.status}`);
  }

  const payload = (await response.json()) as { _embedded?: { events?: TicketmasterEvent[] } };
  return (payload._embedded?.events ?? [])
    .map(normalizeEvent)
    .filter((event): event is ProviderEvent => Boolean(event));
}
