import { redirect } from "next/navigation";
import EditApplicationForm from "@/components/chairman/edit-application-form";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";

export default async function EditSocietyApplicationPage() {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);

  if (!application || application.status !== "changes_requested") {
    redirect("/chairman/society");
  }

  const initialValues = {
    residentialLayout: application.residentialLayout,
    name: application.name,
    addressLine1: application.addressLine1,
    addressLine2: application.addressLine2,
    city: application.city,
    state: application.state,
    pinCode: application.pinCode,
    wingCount: application.wingCount,
    totalUnits: application.totalUnits,
    studioUnits: application.studioUnits,
    oneBhkUnits: application.oneBhkUnits,
    twoBhkUnits: application.twoBhkUnits,
    threeBhkUnits: application.threeBhkUnits,
    fourPlusBhkUnits: application.fourPlusBhkUnits,
    otherResidentialUnits: application.otherResidentialUnits,
    otherResidentialDescription: application.otherResidentialDescription,
  };

  return (
    <main className="min-h-screen bg-[#f3f6f4] px-6 py-10 font-sans text-slate-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold text-emerald-800">
          Chairman portal · Revision {application.revision}
        </p>

        <h1 className="mt-3 text-3xl font-semibold">
          Edit society application
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          Update the details requested by the administrator, then
          resubmit your application.
        </p>

        <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-semibold text-blue-900">
            Administrator’s correction note
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-blue-900">
            {application.reviewNote}
          </p>
        </section>

        <EditApplicationForm
          key={`${application.id}:${application.revision}`}
          applicationId={application.id}
          revision={application.revision}
          initialValues={initialValues}
        />
      </div>
    </main>
  );
}