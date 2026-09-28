"use client";
import { useEffect, useState } from "react";
import {
  CITY_CATALOGUE, makeCity, type LocationCity,
} from "@/lib/locations/cities";
import { INDIAN_STATES_AND_UTS } from "@/lib/validation/society";

export default function CityPicker({
  onSelect, allowCustom = false,
}: {
  onSelect: (city: LocationCity) => void;
  allowCustom?: boolean;
}) {
  const [cities, setCities] = useState(CITY_CATALOGUE);
  const [query, setQuery] = useState("");
  const [customState, setCustomState] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/locations/cities", {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("City list unavailable");
      const body = await response.json();
      if (!controller.signal.aborted) {
        setCities(body.items);
        setNotice("");
      }
    }).catch(() => {
      if (!controller.signal.aborted) {
        setNotice("Showing the standard catalogue. Additional cities could not be loaded.");
      }
    });
    return () => controller.abort();
  }, [retry]);

  const term = query.trim().toLowerCase();
  const matches = cities.filter((city) =>
    city.name.toLowerCase().includes(term) ||
    city.state.toLowerCase().includes(term) ||
    city.aliases.some((alias) => alias.includes(term)));
  const popular = matches.filter((city) => city.popular);
  const other = matches.filter((city) => !city.popular);

  return <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-800">LeaseIQ societies</p>
    <h2 className="mt-2 text-2xl font-semibold">Choose your city</h2>
    <p className="mt-2 text-sm text-slate-600">Choose the city where the society is located.</p>
    <label className="mt-6 block text-sm font-medium">
      Search for your city
      <input value={query} onChange={(event) => setQuery(event.target.value)}
        maxLength={100} placeholder="City name"
        className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 focus:outline-emerald-700" />
    </label>
    {notice && <p role="status" className="mt-3 text-sm text-slate-600">
      {notice} <button type="button" className="underline"
        onClick={() => setRetry((value) => value + 1)}>Retry</button>
    </p>}
    {popular.length > 0 && <>
      <h3 className="mt-7 text-xs font-semibold uppercase tracking-wider text-slate-500">Popular cities</h3>
      <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-3">
        {popular.map((city) => <button key={city.id} type="button"
          onClick={() => onSelect(city)}
          className="flex min-w-0 min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 px-1 py-2 hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700">
          <svg aria-hidden="true" viewBox="0 0 64 64" fill="none"
            stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
            className="h-9 w-9 sm:h-11 sm:w-11 text-emerald-800">
            <path d={city.art} />
          </svg>
          <span className="w-full break-words text-center text-[10px] font-semibold leading-tight sm:text-xs">{city.name}</span>
        </button>)}
      </div>
    </>}
    {other.length > 0 && <>
      <h3 className="mt-7 text-xs font-semibold uppercase tracking-wider text-slate-500">Other cities</h3>
      <ul className="mt-3 divide-y divide-slate-200">
        {other.map((city) => <li key={city.id}>
          <button type="button" onClick={() => onSelect(city)}
            className="w-full rounded-lg px-2 py-4 text-left hover:bg-emerald-50">
            {city.name}<span className="ml-2 text-sm text-slate-500">{city.state}</span>
          </button>
        </li>)}
      </ul>
    </>}
    {!matches.length && <p role="status" className="mt-5">No matching city found.</p>}
    {allowCustom && query.trim().length >= 2 && <div className="mt-6 rounded-xl bg-slate-50 p-4">
      <p className="text-sm">City missing? Confirm its state to use “{query.trim()}”.</p>
      <label className="mt-3 block text-sm">State / union territory
        <select value={customState} onChange={(event) => setCustomState(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3">
          <option value="">Select state</option>
          {INDIAN_STATES_AND_UTS.map((state) => <option key={state}>{state}</option>)}
        </select>
      </label>
      <button type="button" disabled={!customState}
        className="mt-3 rounded-lg bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50"
        onClick={() => {
          const existing = cities.find((city) =>
            city.state === customState && city.aliases.includes(term));
          onSelect(existing ?? makeCity(query.trim(), customState));
        }}>Use this city</button>
    </div>}
  </section>;
}
