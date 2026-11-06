import assert from "node:assert/strict";
import test from "node:test";
import {
  createKiwifyEventKey,
  isConfirmedKiwifySale,
  parseKiwifyEvent,
  parseKiwifyPlanProducts,
  sha256Hex,
  verifyKiwifySignature,
} from "../lib/kiwify-webhook.ts";

const officialBody = Buffer.from('{"order_id":"9b1c2d3e-0000-4000-8000-000000000001","order_status":"paid","webhook_event_type":"order_approved"}');

test("verifies Kiwify's official HMAC-SHA1 test vector", () => {
  assert.equal(verifyKiwifySignature(officialBody, "bf18f352a4f981b91dfa3f6d8742a81080ab8c86", "kiwify-token-de-teste"), true);
});

test("rejects malformed or altered webhook signatures", () => {
  assert.equal(verifyKiwifySignature(officialBody, "bad", "kiwify-token-de-teste"), false);
  assert.equal(verifyKiwifySignature(Buffer.from(`${officialBody.toString()} `), "bf18f352a4f981b91dfa3f6d8742a81080ab8c86", "kiwify-token-de-teste"), false);
});

test("deduplicates byte-identical deliveries while keeping changed payloads distinct", () => {
  const firstHash = sha256Hex(officialBody);
  const repeatedHash = sha256Hex(Buffer.from(officialBody));
  const changedHash = sha256Hex(Buffer.from(`${officialBody.toString()} `));
  assert.equal(createKiwifyEventKey("order-1", "order_approved", firstHash), createKiwifyEventKey("order-1", "order_approved", repeatedHash));
  assert.notEqual(createKiwifyEventKey("order-1", "order_approved", firstHash), createKiwifyEventKey("order-1", "order_approved", changedHash));
});

test("extracts the documented subscription payload and rejects missing identifiers", () => {
  const event = parseKiwifyEvent({
    order_id: "order-1",
    order_status: "paid",
    webhook_event_type: "subscription_renewed",
    subscription_id: "subscription-1",
    Customer: { email: "OWNER@example.com" },
    product_id: "product-1",
    Subscription: { customer_access: { has_access: true, access_until: "2027-01-01T00:00:00.000Z" } },
  });
  assert.equal(event?.buyerEmail, "owner@example.com");
  assert.equal(event?.subscriptionId, "subscription-1");
  assert.equal(event?.hasAccess, true);
  assert.equal(event?.accessUntil, "2027-01-01T00:00:00.000Z");
  assert.equal(parseKiwifyEvent({ order_status: "paid" }), null);
});

test("accepts only configured plan names for product mapping", () => {
  const plans = parseKiwifyPlanProducts("prod-a=bronze, prod-b=essencial,prod-c=owner");
  assert.equal(plans.get("prod-a"), "bronze");
  assert.equal(plans.get("prod-b"), "essencial");
  assert.equal(plans.has("prod-c"), false);
});

test("confirms only the matching paid Kiwify order and buyer", () => {
  const sale = { id: "order-1", status: "paid", product: { id: "prod-1" }, customer: { email: "owner@example.com" } };
  assert.equal(isConfirmedKiwifySale(sale, "order-1", "prod-1", "OWNER@example.com"), true);
  assert.equal(isConfirmedKiwifySale({ ...sale, status: "refunded" }, "order-1", "prod-1", "owner@example.com"), false);
  assert.equal(isConfirmedKiwifySale(sale, "fake-order", "prod-1", "owner@example.com"), false);
  assert.equal(isConfirmedKiwifySale(sale, "order-1", "other-product", "owner@example.com"), false);
  assert.equal(isConfirmedKiwifySale(sale, "order-1", "prod-1", "other@example.com"), false);
});