import { getLocationCities } from "@/lib/server/services/location-cities.service";
import { jsonNoStore } from "@/lib/server/http/json";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonNoStore({ items: await getLocationCities() });
  } catch {
    return jsonNoStore({ message: "Unable to load cities. Please retry." }, 503);
  }
}
