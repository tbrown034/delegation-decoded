import assert from "node:assert/strict";
import test from "node:test";
import { firstNameForms, initialismSurname } from "../lib/member-names";

// The roster stores legal names from @unitedstates, so 193 of 537 sitting
// members carry a middle initial and several go by a nickname in public. A
// lookup miss surfaced in /ask as "no sitting member matches", which reads as a
// factual claim about the roster rather than a search failure.

test("firstNameForms keeps the typed token first", () => {
  assert.deepEqual(firstNameForms("charles"), ["charles"]);
  assert.equal(firstNameForms("chuck")[0], "chuck");
});

test("firstNameForms maps the nicknames readers actually type", () => {
  assert.deepEqual(firstNameForms("chuck"), ["chuck", "charles"]);
  assert.deepEqual(firstNameForms("bernie"), ["bernie", "bernard"]);
  assert.deepEqual(firstNameForms("liz"), ["liz", "elizabeth"]);
});

test("firstNameForms offers every legal form for ambiguous nicknames", () => {
  // "Steve" can be Steven or Stephen; both must be searchable.
  assert.deepEqual(firstNameForms("steve"), ["steve", "steven", "stephen"]);
  assert.deepEqual(firstNameForms("ted"), ["ted", "theodore", "edward"]);
});

test("firstNameForms normalizes case and a trailing initial period", () => {
  assert.deepEqual(firstNameForms("CHUCK"), ["chuck", "charles"]);
  assert.deepEqual(firstNameForms("  Bernie  "), ["bernie", "bernard"]);
  assert.deepEqual(firstNameForms("J."), ["j"]);
});

test("firstNameForms returns nothing for an empty token", () => {
  assert.deepEqual(firstNameForms(""), []);
  assert.deepEqual(firstNameForms("   "), []);
});

test("firstNameForms leaves unknown names untouched rather than guessing", () => {
  // A wrong alias would silently redirect a reader to a different lawmaker.
  assert.deepEqual(firstNameForms("hakeem"), ["hakeem"]);
  assert.deepEqual(firstNameForms("alexandria"), ["alexandria"]);
});

test("initialismSurname resolves the initialisms readers use as names", () => {
  assert.equal(initialismSurname("AOC"), "ocasio-cortez");
  assert.equal(initialismSurname("aoc"), "ocasio-cortez");
  assert.equal(initialismSurname("A.O.C."), "ocasio-cortez");
});

test("initialismSurname returns null for ordinary names", () => {
  assert.equal(initialismSurname("Schiff"), null);
  assert.equal(initialismSurname("Adam Schiff"), null);
  assert.equal(initialismSurname(""), null);
});
