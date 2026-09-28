"use client";

import { useState } from "react";
import CityPicker from "@/components/society/city-picker";
import SearchPicker from "@/components/resident/search-picker";
import ApplicationDetails from "@/components/resident/application-details";

type Option = { id: string; label: string };

export default function OnboardingForm() {
  const [city, setCity] = useState<Option | null>(null);
  const [society, setSociety] = useState<Option | null>(null);
  const [wing, setWing] = useState<Option | null>(null);
  const [floor, setFloor] = useState<Option | null>(null);
  const [flat, setFlat] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);

  if (!city) return <CityPicker onSelect={setCity} />;

  function changeHome() {
    if (busy) return;
    if (flat && !window.confirm("Change your home selection? Unsaved application details will be lost.")) return;
    setFlat(null);
  }

  return <section data-form-panel className="rounded-2xl border border-slate-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
          Resident application
        </p>
        <h2 className="mt-1 text-lg font-semibold">
          {flat ? "Your home and household" : "Find your home"}
        </h2>
      </div>
      <button type="button" disabled={busy}
        className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
        onClick={() => {
          if (flat && !window.confirm("Change city? Unsaved application details will be lost.")) return;
          setCity(null); setSociety(null); setWing(null); setFloor(null); setFlat(null);
        }}>
        {city.label} · Change city
      </button>
    </header>

    <div className="p-5 sm:p-6">
      {flat && society ? <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <div className="min-w-0">
            <p className="font-semibold text-emerald-950">{society.label}</p>
            <p className="mt-1 text-sm text-emerald-900">
              Wing {wing?.label} · Floor {floor?.label} · Flat {flat.label}
            </p>
          </div>
          <button type="button" disabled={busy} onClick={changeHome}
            className="min-h-11 px-3 text-sm font-semibold text-emerald-900 underline disabled:opacity-50">
            Edit home
          </button>
        </div>
        <ApplicationDetails key={`${society.id}:${flat.id}`}
          societyId={society.id} unitId={flat.id} onBusy={setBusy}
          onChooseFlat={() => setFlat(null)} />
      </> : <div className="space-y-5">
        <p className="text-sm leading-6 text-slate-500">
          Find your society, then select your flat from its registered layout.
        </p>
        <SearchPicker disabled={busy} key={`society:${city.id}`}
          label="Society" kind="societies" city={city.id} selected={society}
          onSelect={(value) => {
            setSociety(value); setWing(null); setFloor(null); setFlat(null);
          }} />

        {society && <div className="grid items-start gap-4 sm:grid-cols-3">
          <SearchPicker disabled={busy} key={`wing:${society.id}`}
            label="Wing" kind="wings" societyId={society.id} selected={wing}
            onSelect={(value) => { setWing(value); setFloor(null); setFlat(null); }} />

          {wing ? <SearchPicker disabled={busy}
            key={JSON.stringify(["floor", society.id, wing.id])}
            label="Floor" kind="floors" societyId={society.id} wing={wing.id}
            selected={floor}
            onSelect={(value) => { setFloor(value); setFlat(null); }} />
            : <label className="block text-sm font-semibold">Floor
              <input disabled placeholder="Select wing first"
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-normal" />
            </label>}

          {wing && floor ? <SearchPicker disabled={busy}
            key={JSON.stringify(["flat", society.id, wing.id, floor.id])}
            label="Flat number" kind="flats" societyId={society.id}
            wing={wing.id} floor={floor.id} selected={flat} onSelect={setFlat} />
            : <label className="block text-sm font-semibold">Flat number
              <input disabled placeholder="Select floor first"
                className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-normal" />
            </label>}
        </div>}
      </div>}
    </div>
  </section>;
}
