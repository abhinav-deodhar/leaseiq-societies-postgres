import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import ApplicationEditor from "@/components/resident/application-editor";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getDatabase } from "@/lib/server/db";

export default async function EditApplicationPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const session = await requirePortalSession("resident");
  const { requestId } = await params;
  if (!z.uuid().safeParse(requestId).success) notFound();

  const result = await getDatabase().query<{
    societyId: string; unitId: string; status: string;
    reviewNote: string | null; societyName: string;
    wing: string; floor: string | null; flatNumber: string;
  }>(
    `SELECT r.society_id AS "societyId", r.unit_id AS "unitId",
            r.status, r.review_note AS "reviewNote",
            s.name AS "societyName", u.wing, u.floor_label AS floor,
            u.flat_number AS "flatNumber"
     FROM resident_unit_requests r
     JOIN societies s ON s.id = r.society_id
     JOIN society_units u ON u.id = r.unit_id AND u.society_id = r.society_id
     WHERE r.id = $1 AND r.user_id = $2 AND r.deleted_at IS NULL`,
    [requestId, session.userId],
  );
  const application = result.rows[0];
  if (!application) notFound();
  const editable = ["draft", "changes_requested"].includes(application.status);

  return <main className="min-h-screen bg-[#f3f6f4] px-5 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <Link href={`/resident/applications?application=${requestId}`}
        className="font-semibold text-emerald-800">← Back to application</Link>
      <h1 className="mt-6 text-3xl font-semibold">
        {application.status === "changes_requested" ? "Correct your application" : "Edit application"}
      </h1>
      <p className="mt-3 text-slate-600">
        {application.societyName} · Wing {application.wing || "—"} ·
        Floor {application.floor || "—"} · Flat {application.flatNumber}
      </p>
      {application.reviewNote && <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h2 className="font-semibold">Review feedback</h2>
        <p className="mt-2 whitespace-pre-wrap">{application.reviewNote}</p>
      </section>}
      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-8">
        {editable
          ? <ApplicationEditor key={requestId} requestId={requestId} societyId={application.societyId} unitId={application.unitId} />
          : <p>This application is no longer editable. Return to its status page.</p>}
      </section>
    </div>
  </main>;
}
