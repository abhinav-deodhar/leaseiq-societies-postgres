import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeSearchLike, searchWordPatterns } from "../src/lib/locations/search-words";

test("every word becomes an independent match", () => {
  assert.deepEqual(searchWordPatterns("green society"), ["%green%", "%society%"]);
});

test("whitespace, repeated words and case are normalised", () => {
  assert.deepEqual(searchWordPatterns("  GREEN   society green "), ["%green%", "%society%"]);
});

test("user wildcard characters are treated literally", () => {
  assert.equal(escapeSearchLike("100%_A\\B"), "100\\%\\_A\\\\B");
  assert.deepEqual(searchWordPatterns("A_B"), ["%a\\_b%"]);
});

test("empty input has no search words", () => {
  assert.deepEqual(searchWordPatterns("   "), []);
});

test("full flat identifiers retain leading zeros", () => {
  assert.deepEqual(searchWordPatterns("004"), ["%004%"]);
  assert.deepEqual(searchWordPatterns("2004"), ["%2004%"]);
});
