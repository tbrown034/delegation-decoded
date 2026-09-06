import assert from "node:assert/strict";
import test from "node:test";
import { classifyBiographyFact, stripLeadingHonorific } from "../lib/biography-classify";

test("a leading title is how the site names the person, not the fact's subject", () => {
  assert.equal(
    stripLeadingHonorific("Congressman Al Green co-founded and co-managed the law firm of Green, Wilson, Dewberry, and Fitch."),
    "co-founded and co-managed the law firm of Green, Wilson, Dewberry, and Fitch."
  );
  assert.equal(
    classifyBiographyFact("Congressman Al Green co-founded and co-managed the law firm of Green, Wilson, Dewberry, and Fitch.").type,
    "career"
  );
  assert.equal(
    classifyBiographyFact("he was elected Justice of the Peace in Harris County, Texas, where he served for 26 years").type,
    "public_service"
  );
  assert.equal(classifyBiographyFact("began his eleventh term in the United States House of Representatives").type, "public_service");
  assert.equal(classifyBiographyFact("where he earned his Juris Doctorate in 1973").type, "education");
});
