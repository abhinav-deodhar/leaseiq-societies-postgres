import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY_CATALOGUE, findCity, mergeCities } from "../src/lib/locations/cities";

test("cities exist without any registered societies", () => {
  const cities = mergeCities([]);
  assert.ok(cities.some((city) => city.name === "Hyderabad"));
  assert.ok(cities.some((city) => city.name === "Pune"));
  assert.equal(cities.filter((city) => city.popular).length, 10);
});

test("popular cities have distinct landmark drawings", () => {
  const popular = CITY_CATALOGUE.filter((city) => city.popular);
  assert.equal(new Set(popular.map((city) => city.art)).size, popular.length);
});

test("legacy aliases resolve to the canonical city", () => {
  const cities = mergeCities([{ city: "Bangalore", state: "Karnataka" }]);
  assert.equal(findCity(cities, "bangalore")?.name, "Bengaluru");
  assert.equal(cities.filter((city) => city.name === "Bangalore").length, 0);
});

test("same-name cities in different states retain distinct identifiers", () => {
  const cities = mergeCities([
    { city: "Example Town", state: "Maharashtra" },
    { city: "Example Town", state: "Telangana" },
  ]);
  const matches = cities.filter((city) => city.name === "Example Town");
  assert.equal(matches.length, 2);
  assert.notEqual(matches[0].id, matches[1].id);
});

test("unknown selections are rejected and canonical IDs resolve", () => {
  const city = CITY_CATALOGUE[0];
  assert.equal(findCity(CITY_CATALOGUE, city.id)?.name, city.name);
  assert.equal(findCity(CITY_CATALOGUE, "not-a-city"), undefined);
});
