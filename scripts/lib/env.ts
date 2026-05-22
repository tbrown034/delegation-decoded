// Loads .env.local for local dev. In CI, the file doesn't exist and
// process.env is populated by the workflow's env: block — this is a no-op
// in that case. Never overrides existing process.env values, so secrets
// passed through env: always win over anything in a stray .env.local.
//
// Import once at the top of any script that needs env config:
//   import "./lib/env"; (or "../lib/env", etc.)

import { existsSync } from "fs";
import path from "path";
import { config } from "dotenv";

const envPath = path.resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  config({ path: envPath, override: false });
}
