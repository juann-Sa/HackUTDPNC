import { createServer, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSubtype, AccountType, type AccountBase } from "plaid/legacy";
import { createConnectBankRouter } from "./connectBank";
import type { PlaidExternalAccount } from "./connectBank";

const apiKey = "hackathon-test-api-key-that-is-at-least-32-chars";

const plaidAccount: AccountBase = {
  account_id: "plaid-checking-id",
  balances: {
    available: 100.12,
    current: 123.45,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    limit: null,
  },
  mask: "1234",
  name: "Checking",
  official_name: null,
  type: AccountType.Depository,
  subtype: AccountSubtype.Checking,
};

const servers: Server[] = [];

async function listen(
  app: express.Express,
): Promise<{ server: Server; url: string }> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server did not bind a TCP port");
  return { server, url: `http://127.0.0.1:${address.port}/api/connect-bank` };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

describe("POST /api/connect-bank", () => {
  it("exchanges the public token, maps USD accounts, and calls the reducer bridge", async () => {
    const exchangePublicToken = vi.fn(async () => "plaid-access-token");
    const getAccounts = vi.fn(async () => [plaidAccount]);
    const addAccounts = vi.fn(async (_rows: PlaidExternalAccount[]) => {});
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createConnectBankRouter({
        plaid: { exchangePublicToken, getAccounts },
        addAccounts,
        apiKey,
      }),
    );
    const { url } = await listen(app);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        public_token: "public-sandbox-token",
        customer_id: "C001",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      linked_accounts: 1,
      skipped_accounts: 0,
    });
    expect(exchangePublicToken).toHaveBeenCalledWith("public-sandbox-token");
    expect(getAccounts).toHaveBeenCalledWith("plaid-access-token");
    expect(addAccounts).toHaveBeenCalledWith([
      {
        account_id: "plaid-checking-id",
        customer_id: "C001",
        institution: "Plaid",
        nickname: "Checking",
        account_type: "checking",
        balance_cents: 12345,
        apr_pct: 0,
        annual_yield_pct: 0,
        monthly_payment_cents: 0,
      },
    ]);
  });

  it("rejects callers without the server API key before contacting Plaid", async () => {
    const exchangePublicToken = vi.fn(async () => "plaid-access-token");
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      createConnectBankRouter({
        plaid: {
          exchangePublicToken,
          getAccounts: vi.fn(async () => [plaidAccount]),
        },
        addAccounts: vi.fn(async (_rows: PlaidExternalAccount[]) => {}),
        apiKey,
      }),
    );
    const { url } = await listen(app);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        public_token: "public-sandbox-token",
        customer_id: "C001",
      }),
    });

    expect(response.status).toBe(401);
    expect(exchangePublicToken).not.toHaveBeenCalled();
  });
});
