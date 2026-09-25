import { redirect } from "next/navigation";
import NewApplicationForm from "@/components/chairman/new-application-form";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { getChairmanApplication } from "@/lib/server/services/chairman-application.service";

export default async function NewSocietyApplicationPage() {
  const session = await requirePortalSession("chairman");
  const existingApplication = await getChairmanApplication(session.userId);

  if (existingApplication) {
    redirect("/chairman/society");
  }

  return (
    <main className="min-h-screen bg-[#f3f6f4] px-5 py-10 font-sans text-slate-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold text-emerald-800">
          Chairman portal
        </p>

        <h1 className="mt-3 text-3xl font-semibold">
          Register your society
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-600">
          Provide your society’s address and residential unit details.
          Review everything before sending it to the administrator.
        </p>

        <NewApplicationForm />
      </div>
    </main>
  );
}