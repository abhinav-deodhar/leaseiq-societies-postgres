
import InvoiceDraftForm from "@/components/chairman/invoice-draft-form";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";
import { listUnitsForChairman } from "@/lib/server/services/units.service";

export default async function NewInvoicePage() {
  const session = await requirePortalSession("chairman");
  const application = await getChairmanApplication(session.userId);
  let register: Awaited<ReturnType<typeof listUnitsForChairman>> | null = null;

  if (
    application?.status === "approved" &&
    application.serviceStatus !== "suspended"
  ) {
    try {
      register = await listUnitsForChairman(
        session.userId,
        application.societyId,
        { page: 1, search: "" },
      );
    } catch {
      // Keep protected form data unavailable if access or loading fails.
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
      
      <h1 className="mt-6 text-3xl font-bold">Create invoice draft</h1>
      <p className="mt-3 text-slate-600">
        Prepare charges for one flat or a selected unit type.
      </p>

      {application && register ? (
        register.total > 0 ? (
          <InvoiceDraftForm societyId={application.societyId} initialRegister={register} />
        ) : (
          <p className="mt-7 rounded-xl bg-white p-6">
            Add flats to the unit register before preparing invoices.
          </p>
        )
      ) : (
        <p role="alert" className="mt-7 rounded-xl bg-white p-6">
          Invoice preparation is unavailable. Check society approval and access,
          or reload to try again.
        </p>
      )}
    </main>
  );
}
