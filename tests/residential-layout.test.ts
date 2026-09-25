import assert from "node:assert/strict";
import { test } from "node:test";
import { residentialLayoutSchema } from "../src/lib/validation/residential-layout";

function mix(
  values: Partial<{
    studioUnits: number;
    oneBhkUnits: number;
    twoBhkUnits: number;
    threeBhkUnits: number;
    fourPlusBhkUnits: number;
    customUnits: Array<{ name: string; count: number }>;
  }> = {},
) {
  return {
    studioUnits: 0,
    oneBhkUnits: 0,
    twoBhkUnits: 0,
    threeBhkUnits: 0,
    fourPlusBhkUnits: 0,
    customUnits: [],
    ...values,
  };
}

function exampleLayout() {
  return {
    mode: "layout",
    buildingType: "wings",
    wings: [
      {
        name: "A",
        floorGroups: [
          {
            floors: ["1", "2", "3", "4", "5"],
            unitsPerFloor: mix({
              oneBhkUnits: 2,
              twoBhkUnits: 3,
              threeBhkUnits: 1,
            }),
          },
        ],
      },
    ],
  };
}

test("calculates totals for identical floors", () => {
  const { totals } = residentialLayoutSchema.parse(exampleLayout());

  assert.equal(totals.wingCount, 1);
  assert.equal(totals.totalUnits, 30);
  assert.equal(totals.oneBhkUnits, 10);
  assert.equal(totals.twoBhkUnits, 15);
  assert.equal(totals.threeBhkUnits, 5);
});

test("calculates different floor layouts across multiple wings", () => {
  const input = exampleLayout();

  input.wings[0].floorGroups.push({
    floors: ["6"],
    unitsPerFloor: mix({
      threeBhkUnits: 2,
      customUnits: [{ name: "Penthouse", count: 1 }],
    }),
  });

  input.wings.push({
    name: "B",
    floorGroups: [
      {
        floors: ["G", "1"],
        unitsPerFloor: mix({
          studioUnits: 4,
          fourPlusBhkUnits: 1,
          customUnits: [{ name: "penthouse", count: 1 }],
        }),
      },
    ],
  });

  const { totals } = residentialLayoutSchema.parse(input);

  assert.equal(totals.wingCount, 2);
  assert.equal(totals.totalUnits, 45);
  assert.equal(totals.studioUnits, 8);
  assert.equal(totals.threeBhkUnits, 7);
  assert.equal(totals.fourPlusBhkUnits, 2);
  assert.equal(totals.otherResidentialUnits, 3);
  assert.deepEqual(totals.customUnits, [
    { name: "Penthouse", count: 3 },
  ]);
});

test("manual entry calculates totals including custom types", () => {
  const { totals } = residentialLayoutSchema.parse({
    mode: "manual",
    wingCount: 0,
    units: mix({
      oneBhkUnits: 10,
      twoBhkUnits: 15,
      threeBhkUnits: 5,
      customUnits: [{ name: "Residential duplex", count: 2 }],
    }),
  });

  assert.equal(totals.wingCount, 0);
  assert.equal(totals.totalUnits, 32);
  assert.equal(totals.otherResidentialUnits, 2);
});

test("standalone layout calculates units with zero named wings", () => {
  const input = exampleLayout();
  input.buildingType = "standalone";

  const { totals } = residentialLayoutSchema.parse(input);

  assert.equal(totals.wingCount, 0);
  assert.equal(totals.totalUnits, 30);
});

test("rejects duplicate floors across groups", () => {
  const input = exampleLayout();

  input.wings[0].floorGroups.push({
    floors: ["01"],
    unitsPerFloor: mix({ studioUnits: 2 }),
  });

  assert.equal(residentialLayoutSchema.safeParse(input).success, false);
});

test("rejects duplicate wing names ignoring case and spaces", () => {
  const input = exampleLayout();

  input.wings.push({
    name: " a ",
    floorGroups: [
      {
        floors: ["1"],
        unitsPerFloor: mix({ oneBhkUnits: 1 }),
      },
    ],
  });

  assert.equal(residentialLayoutSchema.safeParse(input).success, false);
});

test("rejects invalid, empty, and fractional unit counts", () => {
  for (const value of [-1, 1.5, "2", undefined, Infinity]) {
    assert.equal(
      residentialLayoutSchema.safeParse({
        mode: "manual",
        wingCount: 1,
        units: {
          ...mix({ twoBhkUnits: 1 }),
          oneBhkUnits: value,
        },
      }).success,
      false,
    );
  }

  assert.equal(
    residentialLayoutSchema.safeParse({
      mode: "manual",
      wingCount: 0,
      units: mix(),
    }).success,
    false,
  );
});

test("requires custom unit descriptions and rejects duplicates", () => {
  for (const customUnits of [
    [{ name: "", count: 1 }],
    [{ name: "Duplex", count: 0 }],
    [
      { name: "Duplex", count: 1 },
      { name: " duplex ", count: 2 },
    ],
  ]) {
    assert.equal(
      residentialLayoutSchema.safeParse({
        mode: "manual",
        wingCount: 0,
        units: mix({ customUnits }),
      }).success,
      false,
    );
  }
});

test("rejects missing floors and missing wings", () => {
  const input = exampleLayout();
  input.wings[0].floorGroups[0].floors = [];

  assert.equal(residentialLayoutSchema.safeParse(input).success, false);

  assert.equal(
    residentialLayoutSchema.safeParse({
      mode: "layout",
      buildingType: "wings",
      wings: [],
    }).success,
    false,
  );
});

test("rejects calculated society totals above the limit", () => {
  const input = exampleLayout();

  input.wings[0].floorGroups[0].unitsPerFloor = mix({
    oneBhkUnits: 100000,
  });

  assert.equal(residentialLayoutSchema.safeParse(input).success, false);
});

test("rejects client-supplied totals", () => {
  assert.equal(
    residentialLayoutSchema.safeParse({
      ...exampleLayout(),
      totals: { totalUnits: 1 },
    }).success,
    false,
  );
});
test("rejects ambiguous floor ranges instead of counting them as one floor", () => {
  const input = exampleLayout();
  input.wings[0].floorGroups[0].floors = ["1-5"];
  assert.equal(residentialLayoutSchema.safeParse(input).success, false);
});
