import "server-only";
import { getDatabase } from "@/lib/server/db";
import { mergeCities } from "@/lib/locations/cities";

export async function getLocationCities() {
  const result = await getDatabase().query<{city: string; state: string}>(
    `SELECT DISTINCT btrim(s.city) AS city,
            btrim(s.state_or_union_territory) AS state
     FROM societies s
     WHERE s.service_status IN ('inactive', 'active')
       AND EXISTS (
         SELECT 1 FROM society_applications a
         WHERE a.society_id = s.id AND a.status = 'approved'
       )
     ORDER BY city, state`,
  );
  return mergeCities(result.rows);
}
