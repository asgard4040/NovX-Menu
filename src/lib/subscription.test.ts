import test from "node:test";
import assert from "node:assert/strict";
import { calculateSubscriptionEnd, getSubscriptionAccess } from "./subscription";
import { verifyGeofence } from "./geofence";

test("subscription active, exact-boundary expired, suspended and grace", () => {
  const end = Date.parse("2026-02-01T00:00:00.000Z");
  assert.equal(getSubscriptionAccess({ status: "active", endDate: end, gracePeriodDays: 0 }, end - 1).allowed, true);
  assert.equal(getSubscriptionAccess({ status: "active", endDate: end, gracePeriodDays: 0 }, end).reason, "expired");
  assert.equal(getSubscriptionAccess({ status: "suspended", endDate: end + 1000, gracePeriodDays: 0 }, end).reason, "inactive");
  assert.equal(getSubscriptionAccess({ status: "active", endDate: end, gracePeriodDays: 1 }, end).allowed, true);
});

test("calendar renewals handle month end and leap year", () => {
  assert.equal(calculateSubscriptionEnd("2024-01-31T00:00:00Z", "month").toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(calculateSubscriptionEnd("2023-01-31T00:00:00Z", "month").toISOString(), "2023-02-28T00:00:00.000Z");
  assert.equal(calculateSubscriptionEnd("2024-02-29T00:00:00Z", "year").toISOString(), "2025-02-28T00:00:00.000Z");
});

test("renewal restores access while failed or pending states never grant it", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const renewedEnd = calculateSubscriptionEnd(now, "month");
  assert.equal(getSubscriptionAccess({ status: "active", startDate: now, endDate: renewedEnd, gracePeriodDays: 0 }, now).allowed, true);
  assert.equal(getSubscriptionAccess({ status: "failed", endDate: renewedEnd }, now).allowed, false);
  assert.equal(getSubscriptionAccess({ status: "pending", endDate: renewedEnd }, now).allowed, false);
});

test("geofence accepts inside/boundary and rejects outside/inaccurate/unavailable values", () => {
  const base = { restaurantLatitude: 33.3152, restaurantLongitude: 44.3661, radiusMeters: 150 };
  assert.equal(verifyGeofence({ ...base, customerLatitude: 33.3152, customerLongitude: 44.3661, accuracyMeters: 10 }).reason, "inside");
  const boundaryLatitude = 33.3152 + (150 / 111_195);
  assert.ok((verifyGeofence({ ...base, customerLatitude: boundaryLatitude, customerLongitude: 44.3661, accuracyMeters: 10 }).distanceMeters || 0) <= 151);
  assert.equal(verifyGeofence({ ...base, customerLatitude: 33.32, customerLongitude: 44.3661, accuracyMeters: 10 }).reason, "outside");
  assert.equal(verifyGeofence({ ...base, customerLatitude: 33.3152, customerLongitude: 44.3661, accuracyMeters: 139 }).reason, "inside");
  assert.equal(verifyGeofence({ ...base, customerLatitude: 33.3152, customerLongitude: 44.3661, accuracyMeters: 150 }).reason, "inside");
  assert.equal(verifyGeofence({ ...base, customerLatitude: 33.3152, customerLongitude: 44.3661, accuracyMeters: 151 }).reason, "inaccurate_location");
  assert.equal(verifyGeofence({ ...base, radiusMeters: 100, customerLatitude: 33.3152, customerLongitude: 44.3661, accuracyMeters: 139 }).reason, "inaccurate_location");
  assert.equal(verifyGeofence({ ...base, customerLatitude: NaN, customerLongitude: 44.3661 }).reason, "invalid_coordinates");
});
