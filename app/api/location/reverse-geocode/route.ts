import { NextResponse } from "next/server";

type NominatimResponse = {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
  };
};

function isCoordinate(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function readableLabel(data: NominatimResponse) {
  const address = data.address ?? {};
  const locality =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county;
  const parts = [locality, address.state, address.country].filter(Boolean);

  return parts.length ? Array.from(new Set(parts)).join(", ") : data.display_name || null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("latitude"));
  const longitude = Number(url.searchParams.get("longitude"));

  if (!isCoordinate(latitude, -90, 90) || !isCoordinate(longitude, -180, 180)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const endpoint = new URL("https://nominatim.openstreetmap.org/reverse");
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("lat", latitude.toFixed(5));
  endpoint.searchParams.set("lon", longitude.toFixed(5));
  endpoint.searchParams.set("zoom", "10");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("layer", "address");

  const response = await fetch(endpoint, {
    headers: {
      "Accept-Language": request.headers.get("accept-language") || "en",
      Referer: "https://sunwise-anzeyangs-projects.vercel.app",
      "User-Agent": "Sunwise/1.0 (https://sunwise-anzeyangs-projects.vercel.app)"
    },
    next: { revalidate: 86400 }
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Location name lookup failed" }, { status: 502 });
  }

  const data = (await response.json()) as NominatimResponse;
  const label = readableLabel(data);

  if (!label) {
    return NextResponse.json({ error: "No location name found" }, { status: 404 });
  }

  return NextResponse.json({
    label,
    attribution: "OpenStreetMap contributors"
  });
}
