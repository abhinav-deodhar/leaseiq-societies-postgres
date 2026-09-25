-- Up Migration
ALTER TABLE societies ADD COLUMN residential_layout JSONB;
ALTER TABLE societies ADD CONSTRAINT residential_layout_is_object CHECK (
  residential_layout IS NULL OR jsonb_typeof(residential_layout) = 'object'
);
-- Down Migration
ALTER TABLE societies DROP CONSTRAINT residential_layout_is_object;
ALTER TABLE societies DROP COLUMN residential_layout;
