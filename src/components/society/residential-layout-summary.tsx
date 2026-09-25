import { displayFloor } from "@/lib/formatters/floor-label";
import {
  residentialLayoutSchema,
  STANDARD_UNIT_KEYS,
  type ResidentialLayoutInput,
  type ResidentialTotals,
  type StandardUnitKey,
} from "@/lib/validation/residential-layout";

const unitLabels: Record<StandardUnitKey, string> = {
  studioUnits: "Studio / 1 RK",
  oneBhkUnits: "1 BHK",
  twoBhkUnits: "2 BHK",
  threeBhkUnits: "3 BHK",
  fourPlusBhkUnits: "4+ BHK",
};


function UnitTotals({ totals }: { totals: ResidentialTotals }) {
  return (
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      {STANDARD_UNIT_KEYS.map((key) => (
        <div key={key}>
          <dt className="text-sm text-slate-500">
            {unitLabels[key]}
          </dt>

          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {totals[key]}
          </dd>
        </div>
      ))}

      {totals.customUnits.map((item) => (
        <div key={item.name}>
          <dt className="break-words text-sm text-slate-500">
            {item.name}
            <span className="ml-1 text-xs">(custom)</span>
          </dt>

          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {item.count}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ResidentialLayoutSummary({
  layout,
}: {
  layout: ResidentialLayoutInput | null;
}) {
  if (!layout) return null;

  const parsed = residentialLayoutSchema.safeParse(layout);

  if (!parsed.success) {
    return (
      <p className="mt-4 text-sm text-red-700">
        Saved residential layout could not be displayed.
      </p>
    );
  }

  const data = parsed.data;

  if (data.mode === "manual") {
    return (
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold">
          Society-wide residential units
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Entered manually. Wing-wise counts were not provided.
        </p>

        <UnitTotals totals={data.totals} />

        <p className="mt-6 border-t border-slate-100 pt-5 text-xl font-semibold">
          Total residential units: {data.totals.totalUnits}
        </p>
      </section>
    );
  }

  const standalone = data.buildingType === "standalone";

  return (
    <section
      aria-label="Residential units by wing"
      className="mt-6 space-y-5"
    >
      <h2 className="text-xl font-semibold text-slate-900">
        {standalone
          ? "Building residential units"
          : "Wing-wise residential units"}
      </h2>

      {data.wings.map((wing) => {
        // Reuse the same validated calculator for each wing.
        const wingResult = residentialLayoutSchema.parse({
          mode: "layout",
          buildingType: data.buildingType,
          wings: [wing],
        });

        const floors = wing.floorGroups
          .flatMap((group) => group.floors)
          .map((floor) =>
            displayFloor(wing.name, floor, standalone),
          )
          .sort((a, b) =>
            a.localeCompare(b, "en-IN", {
              numeric: true,
              sensitivity: "base",
            }),
          );

        return (
          <article
            key={wing.name}
            className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"
          >
            <h3 className="text-xl font-semibold text-slate-900">
              {standalone ? wing.name : `Wing ${wing.name}`}
            </h3>

            <p className="mt-2 text-sm text-slate-600">
              {floors.length} residential{" "}
              {floors.length === 1 ? "floor" : "floors"}
            </p>

            <ul
              aria-label={`Floors in ${wing.name}`}
              className="mt-4 flex flex-wrap gap-2"
            >
              {floors.map((floor, index) => (
                <li
                  key={`${floor}-${index}`}
                  className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900"
                >
                  {floor}
                </li>
              ))}
            </ul>

            <UnitTotals totals={wingResult.totals} />

            <p className="mt-6 border-t border-slate-100 pt-5 text-xl font-semibold text-slate-900">
              {standalone
                ? "Total building units"
                : `Total units in Wing ${wing.name}`}
              : {wingResult.totals.totalUnits}
            </p>
          </article>
        );
      })}
    </section>
  );
}