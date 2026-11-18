// libpq treats PGDATABASE as a name, not a URI. Split the URI into env fields, never argv.
import { spawnSync } from "node:child_process";
const [command, ...args] = process.argv.slice(2);
const u = new URL(process.env.DATABASE_URL);
if (!["postgres:", "postgresql:"].includes(u.protocol))
  throw new Error("PostgreSQL URI required.");
const env = {
  ...process.env,
  PGHOST: u.hostname,
  PGPORT: u.port || "5432",
  PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
  PGUSER: decodeURIComponent(u.username),
  PGPASSWORD: decodeURIComponent(u.password),
};
const options = {
  sslmode: "PGSSLMODE",
  sslrootcert: "PGSSLROOTCERT",
  sslcert: "PGSSLCERT",
  sslkey: "PGSSLKEY",
  channel_binding: "PGCHANNELBINDING",
  connect_timeout: "PGCONNECT_TIMEOUT",
  application_name: "PGAPPNAME",
};
for (const [key, value] of u.searchParams) {
  if (!Object.hasOwn(options, key))
    throw new Error(
      "Unsupported backup URI option; review connection settings.",
    );
  env[options[key]] = value;
}
const result = spawnSync(command, args, { env, stdio: "inherit" });
process.exitCode = result.status ?? 1;
