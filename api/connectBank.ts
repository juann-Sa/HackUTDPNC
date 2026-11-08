import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { AccountSubtype, AccountType, type AccountBase } from "plaid/legacy";

interface PlaidProvider {
  exchangePublicToken: (publicToken: string) => Promise<string>;
  getAccounts: (accessToken: string) => Promise<AccountBase[]>;
}

export interface PlaidExternalAccount {
  account_id: string;
  customer_id: string;
  institution: string;
  nickname: string;
  account_type: string;
  balance_cents: number;
  apr_pct: number;
  annual_yield_pct: number;
  monthly_payment_cents: number;
}

interface ConnectBankDependencies {
  plaid: PlaidProvider;
  addAccounts: (rows: PlaidExternalAccount[]) => Promise<void>;
  apiKey: string;
}

interface ConnectBankBody {
  public_token: string;
  customer_id: string;
}

function isConnectBankBody(body: unknown): body is ConnectBankBody {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return false;
  const record = body as Record<string, unknown>;
  return (
    typeof record.public_token === "string" &&
    record.public_token.length > 0 &&
    record.public_token.length <= 4096 &&
    typeof record.customer_id === "string" &&
    record.customer_id.trim().length > 0 &&
    record.customer_id.trim().length <= 128
  );
}

function mapAccountType(account: AccountBase): string | undefined {
  const subtype = account.subtype;
  switch (account.type) {
    case AccountType.Depository:
      if (subtype === AccountSubtype.Checking) return "checking";
      if (
        subtype === AccountSubtype.Savings ||
        subtype === AccountSubtype.MoneyMarket
      )
        return "savings";
      if (subtype === AccountSubtype.Cd) return "cd";
      return undefined;
    case AccountType.Credit:
      return "credit_card";
    case AccountType.Loan:
      if (subtype === AccountSubtype.Auto) return "auto_loan";
      if (subtype === AccountSubtype.Mortgage) return "mortgage";
      if (
        subtype === AccountSubtype.Consumer ||
        subtype === AccountSubtype.Student ||
        subtype === AccountSubtype.Loan
      )
        return "personal_loan";
      return undefined;
    case AccountType.Investment:
      if (
        subtype === AccountSubtype.Ira ||
        subtype === AccountSubtype.SepIra ||
        subtype === AccountSubtype.Roth
      )
        return "ira";
      return undefined;
    default:
      return undefined;
  }
}

function mapPlaidAccount(
  account: AccountBase,
  customerId: string,
): PlaidExternalAccount | undefined {
  const accountType = mapAccountType(account);
  const balance = account.balances.current;
  if (
    !accountType ||
    account.balances.iso_currency_code !== "USD" ||
    typeof balance !== "number" ||
    !Number.isFinite(balance)
  ) {
    return undefined;
  }

  const balanceCents = Math.round(balance * 100);
  if (!Number.isSafeInteger(balanceCents)) return undefined;

  return {
    account_id: account.account_id,
    customer_id: customerId,
    institution: "Plaid",
    nickname: account.name.slice(0, 60),
    account_type: accountType,
    balance_cents: balanceCents,
    apr_pct: 0,
    annual_yield_pct: 0,
    monthly_payment_cents: 0,
  };
}

function authorized(req: Request, apiKey: string): boolean {
  const providedKey = req.get("x-api-key");
  if (!providedKey) return false;
  const providedDigest = createHash("sha256").update(providedKey).digest();
  const expectedDigest = createHash("sha256").update(apiKey).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function createConnectBankRouter({
  plaid,
  addAccounts,
  apiKey,
}: ConnectBankDependencies) {
  const router = Router();

  router.post("/connect-bank", async (req: Request, res: Response) => {
    if (!authorized(req, apiKey)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!isConnectBankBody(req.body)) {
      res
        .status(400)
        .json({ error: "A public_token and customer_id are required" });
      return;
    }

    const customerId = req.body.customer_id.trim();
    try {
      const accessToken = await plaid.exchangePublicToken(
        req.body.public_token,
      );
      const accounts = await plaid.getAccounts(accessToken);
      const rows = accounts
        .map((plaidAccount) => mapPlaidAccount(plaidAccount, customerId))
        .filter(
          (account): account is PlaidExternalAccount => account !== undefined,
        );

      if (rows.length === 0) {
        res.status(422).json({
          error:
            "Plaid returned no supported USD accounts with usable balances",
        });
        return;
      }

      await addAccounts(rows);
      res.status(200).json({
        linked_accounts: rows.length,
        skipped_accounts: accounts.length - rows.length,
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(
        `[connect-bank] Plaid or SpacetimeDB request failed (${errorName})`,
      );
      res
        .status(502)
        .json({ error: "Unable to retrieve or save bank accounts" });
    }
  });

  return router;
}
