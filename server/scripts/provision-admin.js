/**
 * Local ADMIN provisioning CLI (#89). Development-only; see
 * provision-admin-lib.js for the safety boundary.
 *
 *   ALLOW_DEV_ADMIN_PROVISIONING=true \
 *   MONGO_URI=mongodb://127.0.0.1:27017/aquaveda_v2_dev \
 *   ADMIN_BOOTSTRAP_EMAIL=admin@example.test \
 *   ADMIN_BOOTSTRAP_PASSWORD=<your local password> \
 *   npm run provision:admin
 *
 * Variables may live in the git-ignored server/.env. Output never contains
 * the password, its hash, or any token.
 */
import { connectDB, disconnectDB } from "../src/config/db.js"; // loads .env
import { runProvisioning } from "./provision-admin-lib.js";

async function main() {
  // Refuses before any DB work, then connects to exactly the validated MONGO_URI.
  const result = await runProvisioning(process.env, { connect: (uri) => connectDB({ uri }) });

  if (result.outcome === "created") {
    console.log(`[provision-admin] created ADMIN ${result.email}`);
  } else {
    console.log(`[provision-admin] ADMIN ${result.email} already exists; nothing changed`);
    if (result.passwordMatchesConfig === false) {
      console.warn(
        "[provision-admin] note: the existing password differs from ADMIN_BOOTSTRAP_PASSWORD " +
          "(not modified; reset the account in your dev database if you need to).",
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(`[provision-admin] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
