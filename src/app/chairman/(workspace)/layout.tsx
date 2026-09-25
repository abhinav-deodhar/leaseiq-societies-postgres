import type { ReactNode } from "react";
import WorkspaceNavigation from "@/components/chairman/workspace-navigation";
import { requirePortalSession } from "@/lib/server/auth/require-portal-session";

export default async function ChairmanWorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requirePortalSession("chairman");

  return (
    <div className="min-h-screen bg-[#f3f6f8] font-sans text-slate-900">
      <WorkspaceNavigation fullName={session.fullName} />
      <div id="workspace-content" tabIndex={-1} className="min-w-0 lg:ml-64">
        {children}
      </div>
    </div>
  );
}
