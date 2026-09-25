import "server-only";
import type { ChairmanDashboard } from "@/lib/contracts/chairman-dashboard";
import { withChairmanUnitAccess } from "./units.service";

type SummaryRow = {
  societyName: string;
  serviceStatus: "inactive" | "active";
  approvedUnits: number;
  studio: number;
  oneBhk: number;
  twoBhk: number;
  threeBhk: number;
  fourPlusBhk: number;
  other: number;
  counts: Array<{ category: string; count: number }>;
};

export async function getChairmanDashboard(
  userId: string,
  societyId: string,
): Promise<ChairmanDashboard> {
  return withChairmanUnitAccess(userId, societyId, async (client) => {
    // One statement gives all dashboard figures the same database snapshot.
    const result = await client.query<SummaryRow>(
      `SELECT
         s.name AS "societyName",
         s.service_status AS "serviceStatus",
         s.total_units AS "approvedUnits",
         s.studio_units AS studio,
         s.one_bhk_units AS "oneBhk",
         s.two_bhk_units AS "twoBhk",
         s.three_bhk_units AS "threeBhk",
         s.four_plus_bhk_units AS "fourPlusBhk",
         s.other_residential_units AS other,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'category', grouped.category,
                 'count', grouped.count
               )
             )
             FROM (
               SELECT
                 COALESCE(t.category, 'unassigned') AS category,
                 COUNT(*)::integer AS count
               FROM society_units u
               LEFT JOIN society_unit_types t
                 ON t.id = u.unit_type_id
                 AND t.society_id = u.society_id
               WHERE u.society_id = s.id
               GROUP BY COALESCE(t.category, 'unassigned')
             ) grouped
           ),
           '[]'::jsonb
         ) AS counts
       FROM societies s
       WHERE s.id = $1`,
      [societyId],
    );

    const row = result.rows[0];
    if (!row) throw new Error("Dashboard society could not be read.");

    const counts = new Map(
      row.counts.map((entry) => [entry.category, entry.count]),
    );

    const definitions: Array<[string, string, number]> = [
      ["studio", "Studio / 1 RK", row.studio],
      ["one_bhk", "1 BHK", row.oneBhk],
      ["two_bhk", "2 BHK", row.twoBhk],
      ["three_bhk", "3 BHK", row.threeBhk],
      ["four_plus_bhk", "4+ BHK", row.fourPlusBhk],
      ["custom", "Other residential", row.other],
    ];

    const registeredUnits = row.counts.reduce(
      (total, entry) => total + entry.count,
      0,
    );

    return {
      societyId,
      societyName: row.societyName,
      serviceStatus: row.serviceStatus,
      approvedUnits: row.approvedUnits,
      registeredUnits,
      remainingUnits: Math.max(0, row.approvedUnits - registeredUnits),
      excessUnits: Math.max(0, registeredUnits - row.approvedUnits),
      unassignedUnits: counts.get("unassigned") ?? 0,
      categories: definitions.map(([category, label, approved]) => {
        const registered = counts.get(category) ?? 0;
        return {
          category,
          label,
          approved,
          registered,
          remaining: Math.max(0, approved - registered),
          excess: Math.max(0, registered - approved),
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  });
}
