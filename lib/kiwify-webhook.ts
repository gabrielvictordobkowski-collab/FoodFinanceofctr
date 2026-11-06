import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type KiwifyEvent = {
  orderId: string;
  eventType: string;
  orderStatus: string;
  subscriptionId: string | null;
  buyerEmail: string | null;
  productId: string | null;
  accessUntil: string | null;
  hasAccess: boolean | null;
};

export type KiwifySale = {
  id?: unknown;
  status?: unknown;
  product?: { id?: unknown } | null;
  customer?: { email?: unknown } | null;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function verifyKiwifySignature(rawBody: Uint8Array, signature: string | null, token: string) {
  if (!signature || !/^[a-f0-9]{40}$/i.test(signature) || !token) return false;
  const expected = createHmac("sha1", token).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function sha256Hex(rawBody: Uint8Array) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function createKiwifyEventKey(orderId: string, eventType: string, payloadHash: string) {
  return createHash("sha256").update(`${orderId}:${eventType}:${payloadHash}`).digest("hex");
}

export function parseKiwifyPlanProducts(configuration: string | undefined) {
  const plans = new Map<string, string>();
  for (const pair of configuration?.split(",") ?? []) {
    const separator = pair.lastIndexOf("=");
    if (separator <= 0) continue;
    const productId = pair.slice(0, separator).trim();
    const planKey = pair.slice(separator + 1).trim().toLowerCase();
    if (productId && ["bronze", "essencial", "gestao", "rede"].includes(planKey)) plans.set(productId, planKey);
  }
  return plans;
}

export function parseKiwifyEvent(payload: unknown): KiwifyEvent | null {
  const root = record(payload);
  const subscription = record(root.Subscription ?? root.subscription);
  const customerAccess = record(subscription.customer_access ?? root.customer_access);
  const customer = record(root.Customer ?? root.customer);
  const product = record(root.Product ?? root.product);
  const plan = record(subscription.plan ?? root.plan);
  const orderId = stringValue(root.order_id);
  const eventType = stringValue(root.webhook_event_type);
  if (!orderId || !eventType) return null;

  const accessUntil = stringValue(customerAccess.access_until);
  const parsedAccessUntil = accessUntil && Number.isFinite(Date.parse(accessUntil))
    ? new Date(accessUntil).toISOString()
    : null;

  return {
    orderId,
    eventType,
    orderStatus: stringValue(root.order_status) ?? "",
    subscriptionId: stringValue(root.subscription_id) ?? stringValue(subscription.id),
    buyerEmail: (stringValue(customer.email) ?? stringValue(root.customer_email) ?? stringValue(root.email))?.toLowerCase() ?? null,
    productId: stringValue(root.product_id)
      ?? stringValue(product.product_id)
      ?? stringValue(product.id)
      ?? stringValue(plan.product_id),
    accessUntil: parsedAccessUntil,
    hasAccess: typeof customerAccess.has_access === "boolean" ? customerAccess.has_access : null,
  };
}

export function isConfirmedKiwifySale(sale: KiwifySale, orderId: string, productId: string, buyerEmail: string | null) {
  const saleId = stringValue(sale.id);
  const status = stringValue(sale.status)?.toLowerCase();
  const confirmedProductId = stringValue(sale.product?.id);
  const confirmedEmail = stringValue(sale.customer?.email)?.toLowerCase();
  return saleId === orderId
    && status === "paid"
    && confirmedProductId === productId
    && Boolean(buyerEmail && confirmedEmail === buyerEmail.toLowerCase());
}

let cachedKiwifyToken: { value: string; expiresAt: number } | null = null;

async function getKiwifyAccessToken() {
  if (cachedKiwifyToken && cachedKiwifyToken.expiresAt > Date.now()) return cachedKiwifyToken.value;

  const clientId = process.env.KIWIFY_CLIENT_ID;
  const clientSecret = process.env.KIWIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Kiwify API credentials are not configured");

  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  const response = await fetch("https://public-api.kiwify.com/v1/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Kiwify OAuth returned ${response.status}`);

  const result = await response.json() as { access_token?: string; expires_in?: number | string };
  if (!result.access_token) throw new Error("Kiwify OAuth response did not contain an access token");
  const expiresIn = Number(result.expires_in) || 86_400;
  cachedKiwifyToken = { value: result.access_token, expiresAt: Date.now() + Math.max(expiresIn - 60, 60) * 1_000 };
  return result.access_token;
}

export async function confirmKiwifyPaidSale(orderId: string, productId: string, buyerEmail: string | null) {
  const accountId = process.env.KIWIFY_ACCOUNT_ID;
  if (!accountId) throw new Error("Kiwify account ID is not configured");

  const accessToken = await getKiwifyAccessToken();
  const response = await fetch(`https://public-api.kiwify.com/v1/sales/${encodeURIComponent(orderId)}`, {
    headers: { authorization: `Bearer ${accessToken}`, "x-kiwify-account-id": accountId },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Kiwify sale lookup returned ${response.status}`);

  const sale = await response.json() as KiwifySale;
  return isConfirmedKiwifySale(sale, orderId, productId, buyerEmail);
}