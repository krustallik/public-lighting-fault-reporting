export function parseCoordSearchParam(value: string | null): number | null {
  if (value == null || value.trim() === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
}

export function isValidReportCoordinates(
  latitude: number | null,
  longitude: number | null
): boolean {
  if (latitude == null || longitude == null) {
    return false;
  }

  return (
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}
