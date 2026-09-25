"use client";

import { useId, useState } from "react";
import {
  residentialLayoutSchema, STANDARD_UNIT_KEYS,
  type StandardUnitKey, type ResidentialLayoutInput, type ResidentialLayoutData,
} from "@/lib/validation/residential-layout";

export const unitLabels: Record<StandardUnitKey, string> = {
  studioUnits: "Studio / 1 RK", oneBhkUnits: "1 BHK", twoBhkUnits: "2 BHK",
  threeBhkUnits: "3 BHK", fourPlusBhkUnits: "4+ BHK",
};
type Mix = Record<StandardUnitKey, string> & { customUnits: { name: string; count: string }[] };
type Group = { floors: string; mix: Mix };
type Wing = { name: string; groups: Group[] };
const emptyMix = (): Mix => ({ studioUnits: "", oneBhkUnits: "", twoBhkUnits: "", threeBhkUnits: "", fourPlusBhkUnits: "", customUnits: [] });
const emptyWing = (name: string): Wing => ({ name, groups: [{ floors: "", mix: emptyMix() }] });
const fromMix = (mix: Extract<ResidentialLayoutInput, { mode: "manual" }>["units"]): Mix => ({
  studioUnits: String(mix.studioUnits || ""), oneBhkUnits: String(mix.oneBhkUnits || ""),
  twoBhkUnits: String(mix.twoBhkUnits || ""), threeBhkUnits: String(mix.threeBhkUnits || ""),
  fourPlusBhkUnits: String(mix.fourPlusBhkUnits || ""),
  customUnits: mix.customUnits.map(item => ({ name: item.name, count: String(item.count) })),
});
const number = (value: string) => value.trim() === "" ? 0 : Number(value);
const toMix = (mix: Mix) => ({
  studioUnits: number(mix.studioUnits), oneBhkUnits: number(mix.oneBhkUnits),
  twoBhkUnits: number(mix.twoBhkUnits), threeBhkUnits: number(mix.threeBhkUnits),
  fourPlusBhkUnits: number(mix.fourPlusBhkUnits),
  // Blank custom counts mean zero too. Negative/invalid counts remain for validation.
  customUnits: mix.customUnits.filter(item => number(item.count) !== 0)
    .map(item => ({ name: item.name, count: number(item.count) })),
});
const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-2 focus:outline-emerald-700 focus:placeholder:text-transparent";
const buttonClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50";

function MixFields({ value, onChange }: { value: Mix; onChange: (value: Mix) => void }) {
  const id = useId();
  return <div>
    <div className="grid gap-4 sm:grid-cols-3">
      {STANDARD_UNIT_KEYS.map(key => <label key={key} htmlFor={`${id}-${key}`} className="text-sm font-medium">
        {unitLabels[key]}<input id={`${id}-${key}`} type="text" inputMode="numeric" placeholder="0" value={value[key]}
          onChange={event => onChange({ ...value, [key]: event.target.value })} className={inputClass} />
      </label>)}
    </div>
    {value.customUnits.map((item, index) => <div key={index} className="mt-4 grid items-end gap-3 sm:grid-cols-[1fr_120px_auto]">
      <label className="text-sm font-medium">Custom residential type
        <input value={item.name} maxLength={200} placeholder="e.g. Duplex" className={inputClass}
          onChange={event => onChange({ ...value, customUnits: value.customUnits.map((row, i) => i === index ? { ...row, name: event.target.value } : row) })} />
      </label>
      <label className="text-sm font-medium">Count
        <input type="text" inputMode="numeric" placeholder="0" value={item.count} className={inputClass}
          onChange={event => onChange({ ...value, customUnits: value.customUnits.map((row, i) => i === index ? { ...row, count: event.target.value } : row) })} />
      </label>
      <button type="button" aria-label={`Remove custom type ${index + 1}`} className={buttonClass}
        onClick={() => onChange({ ...value, customUnits: value.customUnits.filter((_, i) => i !== index) })}>Remove</button>
    </div>)}
    <button type="button" className={`${buttonClass} mt-4`} disabled={value.customUnits.length >= 20}
      onClick={() => onChange({ ...value, customUnits: [...value.customUnits, { name: "", count: "" }] })}>+ Add custom unit type</button>
  </div>;
}

export default function ResidentialCalculator({ initial, onCalculated }: {
  initial?: ResidentialLayoutInput; onCalculated: (value: ResidentialLayoutData | null) => void;
}) {
  const [mode, setMode] = useState<"manual" | "layout">(initial?.mode ?? "manual");
  const [manual, setManual] = useState<Mix>(() => initial?.mode === "manual" ? fromMix(initial.units) : emptyMix());
  const [wingCount, setWingCount] = useState(initial?.mode === "manual" ? String(initial.wingCount) : "");
  const [buildingType, setBuildingType] = useState<"wings" | "standalone">(initial?.mode === "layout" ? initial.buildingType : "wings");
  const [wings, setWings] = useState<Wing[]>(() => initial?.mode === "layout"
    ? initial.wings.map(wing => ({ name: wing.name, groups: wing.floorGroups.map(group => ({ floors: group.floors.join(", "), mix: fromMix(group.unitsPerFloor) })) }))
    : [emptyWing("A")]);
  const [result, setResult] = useState<ResidentialLayoutData | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [changed, setChanged] = useState(false);
  function invalidate() { setResult(null); setErrors([]); setChanged(true); onCalculated(null); }
  function updateWing(index: number, wing: Wing) { invalidate(); setWings(wings.map((item, i) => i === index ? wing : item)); }
  function calculate() {
    const input = mode === "manual"
      ? { mode, wingCount: number(wingCount), units: toMix(manual) }
      : { mode, buildingType, wings: (buildingType === "standalone" ? wings.slice(0, 1) : wings).map(wing => ({
          name: wing.name, floorGroups: wing.groups.map(group => ({
            floors: group.floors.trim() ? group.floors.split(",").map(floor => floor.trim()) : [], unitsPerFloor: toMix(group.mix),
          })),
        })) };
    const parsed = residentialLayoutSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map(issue => {
        const path = issue.path.map(part => typeof part === "number" ? part + 1 : String(part)).join(" → ");
        return `${path}: ${issue.message}`;
      }));
      setResult(null); onCalculated(null); return;
    }
    setErrors([]); setResult(parsed.data); setChanged(false); onCalculated(parsed.data);
  }
  return <section aria-label="Residential unit calculator" className="space-y-5">
    <fieldset className="flex flex-wrap gap-4 rounded-xl bg-emerald-50 p-4">
      <legend className="px-1 text-sm font-semibold">How would you like to enter your units?</legend>
      {([['manual', 'Enter totals manually'], ['layout', 'Calculate from building layout']] as const).map(([value, label]) =>
        <label key={value} className="flex items-center gap-2 text-sm font-semibold">
          <input type="radio" name="unit-entry-mode" value={value} checked={mode === value}
            onChange={() => { invalidate(); setMode(value); }} />{label}
        </label>)}
    </fieldset>
    <p className="text-sm text-slate-600">Blank apartment counts count as zero. Custom types with a positive count require a name.</p>
    {mode === "manual" ? <div className="space-y-5">
      <label className="block max-w-xs text-sm font-medium">Number of wings (blank means standalone)
        <input type="text" inputMode="numeric" value={wingCount} placeholder="0" className={inputClass}
          onChange={event => { invalidate(); setWingCount(event.target.value); }} />
      </label>
      <p className="text-sm font-semibold">Enter the society-wide count for each type</p>
      <MixFields value={manual} onChange={value => { invalidate(); setManual(value); }} />
    </div> : <div className="space-y-5">
      <label className="block max-w-xs text-sm font-medium">Building arrangement
        <select value={buildingType} className={inputClass} onChange={event => { invalidate(); setBuildingType(event.target.value as "wings" | "standalone"); }}>
          <option value="wings">Society with wings</option><option value="standalone">Standalone building</option>
        </select>
      </label>
      <p className="text-sm font-semibold">{buildingType === "standalone" ? "One standalone building" : `Number of wings: ${wings.length}`}</p>
      {(buildingType === "standalone" ? wings.slice(0, 1) : wings).map((wing, wi) => <section key={wi} className="space-y-4 rounded-xl border border-slate-200 p-4">
        <div className="flex items-end gap-3">
          <label className="flex-1 text-sm font-semibold">{buildingType === "standalone" ? "Building name" : `Wing ${wi + 1} name`}
            <input value={wing.name} maxLength={60} className={inputClass} onChange={event => updateWing(wi, { ...wing, name: event.target.value })} />
          </label>
          {buildingType === "wings" && wings.length > 1 && <button type="button" className={buttonClass}
            onClick={() => { invalidate(); setWings(wings.filter((_, i) => i !== wi)); }}>Remove wing</button>}
        </div>
        {wing.groups.map((group, gi) => <fieldset key={gi} className="space-y-4 rounded-xl bg-slate-50 p-4">
          <legend className="px-1 text-sm font-semibold">Floor group {gi + 1}</legend>
          <label className="block text-sm font-medium">Residential floor labels, separated by commas
            <input value={group.floors} placeholder="G, 1, 2, 3" className={inputClass}
              onChange={event => updateWing(wi, { ...wing, groups: wing.groups.map((item, i) => i === gi ? { ...item, floors: event.target.value } : item) })} />
          </label>
          <p className="text-xs text-slate-600">List only floors with identical layouts. Enter each floor separately, not a range. Add another group when the layout changes.</p>
          <p className="text-sm font-semibold">Units per floor in this group</p>
          <MixFields value={group.mix} onChange={mix => updateWing(wi, { ...wing, groups: wing.groups.map((item, i) => i === gi ? { ...item, mix } : item) })} />
          {wing.groups.length > 1 && <button type="button" className={buttonClass}
            onClick={() => updateWing(wi, { ...wing, groups: wing.groups.filter((_, i) => i !== gi) })}>Remove floor group</button>}
        </fieldset>)}
        <button type="button" className={buttonClass} disabled={wing.groups.length >= 100}
          onClick={() => updateWing(wi, { ...wing, groups: [...wing.groups, { floors: "", mix: emptyMix() }] })}>+ Add floor group</button>
      </section>)}
      {buildingType === "wings" && <button type="button" className={buttonClass} disabled={wings.length >= 1000}
        onClick={() => { invalidate(); setWings([...wings, emptyWing("")]); }}>+ Add wing</button>}
    </div>}
    {errors.length > 0 && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800"><p className="font-semibold">Please correct these details:</p><ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div>}
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
      <button type="button" onClick={calculate} className="rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white hover:bg-emerald-900">Calculate totals</button>
      <label className="mt-4 block text-sm font-semibold">Total residential units
        <input readOnly value={result?.totals.totalUnits ?? ""} placeholder="Calculate to see total" className={`${inputClass} text-2xl font-semibold`} />
      </label>
      <div role="status" className="mt-3 text-sm text-emerald-950">
        {result ? <><p>Calculated successfully. You can continue.</p><dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STANDARD_UNIT_KEYS.map(key => <div key={key}><dt>{unitLabels[key]}</dt><dd className="font-semibold">{result.totals[key]}</dd></div>)}
          <div><dt>Custom residential units</dt><dd className="font-semibold">{result.totals.otherResidentialUnits}</dd></div>
        </dl></> : <p>{changed ? "Details changed. Calculate totals before continuing." : "Enter your details, then calculate totals."}</p>}
      </div>
    </div>
  </section>;
}
