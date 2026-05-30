-- Add timestamp when address was resolved from coordinates (one-time geocoding)
ALTER TABLE light_points
    ADD COLUMN IF NOT EXISTS address_geocoded_at TIMESTAMPTZ;
