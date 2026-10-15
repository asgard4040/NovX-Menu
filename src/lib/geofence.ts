export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;
export const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = 150;

export function acceptableGpsAccuracyMeters(radiusMeters?: number) {
  const radius = Number(radiusMeters);
  return Math.min(
    MAX_ACCEPTABLE_GPS_ACCURACY_METERS,
    Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_GEOFENCE_RADIUS_METERS,
  );
}

export function getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (degrees: number) => degrees * Math.PI / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function verifyGeofence(input: {
  customerLatitude: number;
  customerLongitude: number;
  restaurantLatitude: number;
  restaurantLongitude: number;
  accuracyMeters?: number;
  radiusMeters?: number;
}) {
  const values = [input.customerLatitude, input.customerLongitude, input.restaurantLatitude, input.restaurantLongitude];
  if (values.some((value) => !Number.isFinite(value))) return { allowed: false, reason: "invalid_coordinates", distanceMeters: null } as const;
  if (Math.abs(input.customerLatitude) > 90 || Math.abs(input.restaurantLatitude) > 90
    || Math.abs(input.customerLongitude) > 180 || Math.abs(input.restaurantLongitude) > 180) {
    return { allowed: false, reason: "invalid_coordinates", distanceMeters: null } as const;
  }
  if (input.accuracyMeters !== undefined
    && (!Number.isFinite(input.accuracyMeters) || input.accuracyMeters <= 0
      || input.accuracyMeters > acceptableGpsAccuracyMeters(input.radiusMeters))) {
    return { allowed: false, reason: "inaccurate_location", distanceMeters: null } as const;
  }
  const distanceMeters = getDistanceInMeters(
    input.customerLatitude,
    input.customerLongitude,
    input.restaurantLatitude,
    input.restaurantLongitude,
  );
  const radiusMeters = Math.max(1, Number(input.radiusMeters) || DEFAULT_GEOFENCE_RADIUS_METERS);
  return { allowed: distanceMeters <= radiusMeters, reason: distanceMeters <= radiusMeters ? "inside" : "outside", distanceMeters } as const;
}
