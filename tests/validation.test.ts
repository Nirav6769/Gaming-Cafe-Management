import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidCustomerEmail } from "../src/lib/validation";

test("accepts expected student and common email addresses", () => {
  for (const email of [
    "test@example.com",
    "nirav@gmail.com",
    "tushar.student@pes.edu",
  ]) {
    assert.equal(isValidCustomerEmail(email), true, email);
  }
});

test("rejects malformed email addresses", () => {
  for (const email of [
    "",
    "plainaddress",
    "@example.com",
    "person@",
    "person@example",
    "person name@example.com",
    "person@@example.com",
  ]) {
    assert.equal(isValidCustomerEmail(email), false, email);
  }
});
