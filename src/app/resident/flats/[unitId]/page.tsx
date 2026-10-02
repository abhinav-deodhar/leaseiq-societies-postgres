import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";
import { loadResidentDashboard } from "@/lib/server/services/resident-dashboard.service";
import ResidentDashboard from "@/components/resident/resident-dashboard";
import FlatWorkspace from "@/components/resident/flat-workspace";

export default async function ResidentFlatPage({
  params,
}: {
  params: Promise<{ unitId: string }>;
}) {
  const session = await requirePortalSession("resident");
  const { unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const dashboard = await loadResidentDashboard(session.userId);
  if (!dashboard.homes.some(home => home.unitId === unitId)) notFound();

  return <ResidentDashboard
    fullName={session.fullName}
    initialView="flat"
    initialUnit={unitId}
    workspace={<FlatWorkspace key={unitId} unitId={unitId} />}
  />;
}
