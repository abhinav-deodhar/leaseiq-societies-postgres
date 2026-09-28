"use client";

import ApplicationDetails from "./application-details";

const onBusy = (_busy: boolean) => { void _busy; };

export default function ApplicationEditor({
  societyId, unitId,
}: {
  societyId: string;
  unitId: string;
}) {
  return <ApplicationDetails societyId={societyId} unitId={unitId} onBusy={onBusy} />;
}
