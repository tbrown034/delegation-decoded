import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCandidateName } from "../scripts/lib/fec-names";

test("FEC names flip around the comma and keep Mc and hyphen casing", () => {
  assert.equal(normalizeCandidateName("ANDREWS, ANNIE"), "Annie Andrews");
  assert.equal(normalizeCandidateName("MCCAUL, MICHAEL T"), "Michael T McCaul");
  assert.equal(normalizeCandidateName("DE LA CRUZ, MONICA"), "Monica De La Cruz");
  assert.equal(normalizeCandidateName("OCASIO-CORTEZ, ALEXANDRIA"), "Alexandria Ocasio-Cortez");
});

test("FEC suffixes trail the surname instead of splitting the name", () => {
  assert.equal(normalizeCandidateName("HINOJOSA, ALFREDO JR."), "Alfredo Hinojosa Jr.");
  assert.equal(normalizeCandidateName("CAIN, BRISCOE ROWELL III"), "Briscoe Rowell Cain III");
  assert.equal(normalizeCandidateName("CARL, JERRY LEE, JR."), "Jerry Lee Carl Jr.");
  assert.equal(normalizeCandidateName("CLEAVER II, EMANUEL"), "Emanuel Cleaver II");
});

test("FEC titles a filer put in their own name are dropped", () => {
  assert.equal(normalizeCandidateName("MARKEY, EDWARD SEN."), "Edward Markey");
  assert.equal(normalizeCandidateName("INHOFE, JAMES M. SEN."), "James M. Inhofe");
  assert.equal(normalizeCandidateName("SMITH, DR. JOHN"), "John Smith");
  assert.equal(normalizeCandidateName("CORNYN, JOHN SEN"), "John Cornyn");
});
