import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideProfileAccess,
  isValidProfileMapping,
  type ProfileMapping,
} from "../src/lib/auth-policy";

const adminProfile: ProfileMapping = {
  authUserId: "auth-admin",
  role: "admin",
  staffId: 1,
  customerId: null,
};

const staffProfile: ProfileMapping = {
  authUserId: "auth-staff",
  role: "staff",
  staffId: 2,
  customerId: null,
};

const customerProfile: ProfileMapping = {
  authUserId: "auth-customer",
  role: "customer",
  staffId: null,
  customerId: 9,
};

test("validates admin, staff and customer profile mappings", () => {
  assert.equal(isValidProfileMapping(adminProfile), true);
  assert.equal(isValidProfileMapping(staffProfile), true);
  assert.equal(isValidProfileMapping(customerProfile), true);
});

test("rejects profile mappings with mismatched role links", () => {
  assert.equal(
    isValidProfileMapping({ ...adminProfile, staffId: null, customerId: 4 }),
    false,
  );
  assert.equal(
    isValidProfileMapping({ ...customerProfile, staffId: 2 }),
    false,
  );
  assert.equal(
    isValidProfileMapping({ ...staffProfile, staffId: 0 }),
    false,
  );
});

test("rejects an unauthenticated identity", () => {
  assert.deepEqual(
    decideProfileAccess(null, adminProfile, ["admin"]),
    { kind: "unauthenticated" },
  );
});

test("rejects an authenticated user without a profile", () => {
  assert.deepEqual(
    decideProfileAccess({ id: "auth-user" }, null, ["admin", "staff"]),
    { kind: "missing-profile" },
  );
});

test("rejects a profile belonging to another auth identity", () => {
  assert.deepEqual(
    decideProfileAccess({ id: "another-user" }, adminProfile, ["admin"]),
    { kind: "missing-profile" },
  );
});

test("forbids a customer from internal admin and staff routes", () => {
  assert.deepEqual(
    decideProfileAccess(
      { id: customerProfile.authUserId },
      customerProfile,
      ["admin", "staff"],
    ),
    { kind: "forbidden", profile: customerProfile },
  );
});

test("allows admin and staff on internal routes", () => {
  assert.equal(
    decideProfileAccess({ id: adminProfile.authUserId }, adminProfile, ["admin", "staff"]).kind,
    "authorized",
  );
  assert.equal(
    decideProfileAccess({ id: staffProfile.authUserId }, staffProfile, ["admin", "staff"]).kind,
    "authorized",
  );
});

test("allows customers on customer-enabled routes", () => {
  assert.equal(
    decideProfileAccess({ id: customerProfile.authUserId }, customerProfile, ["admin", "staff", "customer"]).kind,
    "authorized",
  );
});
