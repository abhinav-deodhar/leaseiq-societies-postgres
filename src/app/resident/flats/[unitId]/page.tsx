import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getDatabase } from "@/lib/server/db";

export default async function ResidentFlatPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const session = await requirePortalSession("resident");
  const { unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const result = await getDatabase().query<{
    societyName: string;
    city: string;
    wing: string;
    floor: string | null;
    flatNumber: string;
    relationship: "owner" | "tenant";
    sourceRequestId: string;
  }>(
    `SELECT s.name AS "societyName", s.city,
            u.wing, u.floor_label AS floor, u.flat_number AS "flatNumber",
            m.relationship, m.source_request_id AS "sourceRequestId"
     FROM resident_unit_memberships m
     JOIN society_units u ON u.id = m.unit_id AND u.society_id = m.society_id
     JOIN societies s ON s.id = m.society_id
     WHERE m.user_id = $1 AND m.unit_id = $2 AND m.status = 'active'
     LIMIT 1`,
    [session.userId, unitId],
  );
  const flat = result.rows[0];
  if (!flat) notFound();

  return <main className="min-h-screen bg-[#f3f6f4] px-5 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href="/resident" className="font-semibold text-emerald-800">
        ← Resident dashboard
      </Link>
      <p className="mt-8 text-sm font-semibold text-emerald-700">My home</p>
      <h1 className="mt-2 text-3xl font-semibold">{flat.societyName}</h1>
      <p className="mt-2 text-slate-600">{flat.city}</p>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <span className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-900">
          Registered {flat.relationship}
        </span>
        <dl className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3">
          {[
            ["Wing", flat.wing || "No wing"],
            ["Floor", flat.floor || "Not specified"],
            ["Flat number", flat.flatNumber],
          ].map(([label, value]) => <div key={label}>
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="mt-1 text-lg font-semibold">{value}</dd>
          </div>)}
        </dl>
        <div className="mt-6 flex flex-wrap gap-4 border-t border-slate-100 pt-5">
          <Link href={`/resident/applications?application=${flat.sourceRequestId}`}
            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">
            View approved application
          </Link>
          <Link href="/resident/onboarding"
            className="inline-flex min-h-11 items-center font-semibold text-emerald-800 underline">
            Connect another flat
          </Link>
        </div>
      </section>
    </div>
  </main>;
}
