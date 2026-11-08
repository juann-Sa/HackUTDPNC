import { config } from "dotenv";
import express from "express";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid/legacy";
import { createConnectBankRouter } from "./connectBank";
import { DbConnection } from "./spacetime_bindings";

config({ path: ".env.local" });
config();

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const plaidClient = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments.sandbox,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": requiredEnv("PLAID_CLIENT_ID"),
        "PLAID-SECRET": requiredEnv("PLAID_SECRET"),
      },
    },
  }),
);

const spacetimeUri = requiredEnv("SPACETIMEDB_URI");
const spacetimeDatabase = requiredEnv("SPACETIMEDB_DB_NAME");
const spacetimeToken = requiredEnv("SPACETIMEDB_TOKEN");
const apiKey = requiredEnv("BANK_CONNECT_API_KEY");
if (apiKey.length < 32)
  throw new Error("BANK_CONNECT_API_KEY must be at least 32 characters");

function connectToSpacetimeDB(): Promise<DbConnection> {
  return new Promise((resolve, reject) => {
    let connection: DbConnection;
    connection = DbConnection.builder()
      .withUri(spacetimeUri)
      .withDatabaseName(spacetimeDatabase)
      .withToken(spacetimeToken)
      .withAutomaticReconnect()
      .onConnect(() => resolve(connection))
      .onConnectError((_context, error) => reject(error))
      .build();
  });
}

const connection = await connectToSpacetimeDB();
const app = express();
app.use(express.json({ limit: "16kb" }));
app.use(
  "/api",
  createConnectBankRouter({
    plaid: {
      exchangePublicToken: async (publicToken) =>
        (
          await plaidClient.itemPublicTokenExchange({
            public_token: publicToken,
          })
        ).data.access_token,
      getAccounts: async (accessToken) =>
        (await plaidClient.accountsGet({ access_token: accessToken })).data
          .accounts,
    },
    apiKey,
    addAccounts: async (rows) => {
      await connection.reducers.upsertPlaidAccounts({
        rows: rows.map((row) => ({
          accountId: row.account_id,
          customerId: row.customer_id,
          institution: row.institution,
          nickname: row.nickname,
          accountType: row.account_type,
          balanceCents: row.balance_cents,
          aprPct: row.apr_pct,
          annualYieldPct: row.annual_yield_pct,
          monthlyPaymentCents: row.monthly_payment_cents,
        })),
      });
    },
  }),
);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = error instanceof SyntaxError ? 400 : 500;
    console.error(
      `[api] Request failed (${error instanceof Error ? error.name : "UnknownError"})`,
    );
    res.status(status).json({
      error:
        status === 400 ? "Invalid JSON request body" : "Internal server error",
    });
  },
);

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("API_PORT must be a valid TCP port");
const server = app.listen(port, () => {
  console.log(`Bank connection API listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    connection.disconnect();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
