import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  createKiwifyEventKey,
  confirmKiwifyPaidSale,
  parseKiwifyEvent,
  parseKiwifyPlanProducts,
  sha256Hex,
  verifyKiwifySignature,
} from "@/lib/kiwify-webhook";

const MAX_BODY_BYTES = 1_000_000;
const supportedEvents = new Set([
  "order_approved",
  "order_rejected",
  "order_refunded",
  "chargeback",
  "subscription_renewed",
  "subscription_late",
  "subscription_canceled",
]);

async function readBody(request: NextRequest) {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("Webhook payload exceeds the allowed size");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

export async function POST(request: NextRequest) {
  const webhookToken = process.env.KIWIFY_WEBHOOK_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!webhookToken || webhookToken.length < 32 || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Webhook server configuration is incomplete" }, { status: 503 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let rawBody: Buffer;
  try {
    rawBody = await readBody(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof RangeError ? error.message : "Unable to read payload" }, { status: error instanceof RangeError ? 413 : 400 });
  }

  const signature = request.nextUrl.searchParams.get("signature");
  if (!verifyKiwifySignature(rawBody, signature, webhookToken)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const event = parseKiwifyEvent(payload);
  if (!event) return NextResponse.json({ error: "Missing event identifiers" }, { status: 400 });
  if (!supportedEvents.has(event.eventType)) return NextResponse.json({ received: true, result: "ignored" });

  const plans = parseKiwifyPlanProducts(process.env.KIWIFY_PLAN_PRODUCTS);
  const planKey = event.productId ? plans.get(event.productId) ?? null : null;
  const grantsAccess = event.eventType === "order_approved" || event.eventType === "subscription_renewed";
  if (grantsAccess && (!event.subscriptionId || event.orderStatus !== "paid" || !event.hasAccess || !event.accessUntil || !event.productId)) {
    return NextResponse.json({ error: "A paid subscription period is required" }, { status: 422 });
  }
  if (grantsAccess && !planKey) {
    return NextResponse.json({ error: "Kiwify product is not mapped to a FoodFinance plan" }, { status: 503 });
  }
  if (grantsAccess) {
    let confirmedSale = false;
    try {
      confirmedSale = await confirmKiwifyPaidSale(event.orderId, event.productId!, event.buyerEmail);
    } catch (error) {
      console.error("Kiwify sale verification failed", { eventType: event.eventType, message: error instanceof Error ? error.message : "unknown" });
      return NextResponse.json({ error: "Unable to verify the Kiwify sale" }, { status: 503 });
    }
    if (!confirmedSale) return NextResponse.json({ received: true, result: "sale_not_confirmed" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const payloadHash = sha256Hex(rawBody);
  const { data, error } = await supabase.rpc("process_kiwify_event", {
    event_key: createKiwifyEventKey(event.orderId, event.eventType, payloadHash),
    event_type: event.eventType,
    order_id: event.orderId,
    subscription_id: event.subscriptionId,
    buyer_email: event.buyerEmail,
    product_id: event.productId,
    plan_key: planKey,
    order_status: event.orderStatus,
    access_until: event.accessUntil,
    has_access: event.hasAccess,
    payload_sha256: payloadHash,
  });

  if (error) {
    console.error("Kiwify webhook processing failed", { eventType: event.eventType, code: error.code });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  const result = (data as { result?: string } | null)?.result ?? "received";
  if (result === "unmatched") {
    return NextResponse.json({ error: "No FoodFinance account matches the Kiwify customer email" }, { status: 503 });
  }

  return NextResponse.json({ received: true, result });
}