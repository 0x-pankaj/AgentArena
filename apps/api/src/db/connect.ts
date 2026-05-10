import dns from "node:dns/promises";
import postgres, { type Options, type Sql } from "postgres";

export async function buildPostgresClient(
  connectionString: string,
  overrides: Options<{}> = {},
): Promise<Sql> {
  const url = new URL(connectionString);
  const hostname = url.hostname;
  const port = Number(url.port || 5432);
  const database = url.pathname.replace(/^\//, "").split("?")[0];
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  const sslmode = url.searchParams.get("sslmode");
  const sslEnabled = sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full";

  // Pre-resolve to an IPv4 address. Bun's postgres-js otherwise iterates through
  // unreachable IPv6 records and fails before reaching the working IPv4 ones.
  const { address } = await dns.lookup(hostname, { family: 4 });

  return postgres({
    host: address,
    port,
    database,
    username,
    password,
    ssl: sslEnabled ? { servername: hostname } : false,
    ...overrides,
  });
}
