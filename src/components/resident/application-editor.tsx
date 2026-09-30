"use client";

import ApplicationDetails from "./application-details";

const onBusy = (_busy: boolean) => { void _busy; };

export default function ApplicationEditor({
  societyId, unitId, requestId,
}: {
  requestId: string;
  societyId: string;
  unitId: string;
}) {
  return <ApplicationDetails requestId={requestId} societyId={societyId} unitId={unitId} onBusy={onBusy} />;
}
