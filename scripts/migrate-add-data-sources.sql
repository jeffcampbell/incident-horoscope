-- Migration script to add data source tracking columns to existing databases
-- Run this script on production databases to enable data source warnings

-- Add the new columns if they don't already exist
DO $$ 
BEGIN
    -- Add using_fallback_data column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ephemeris_data' 
        AND column_name = 'using_fallback_data'
    ) THEN
        ALTER TABLE ephemeris_data ADD COLUMN using_fallback_data BOOLEAN DEFAULT FALSE;
        RAISE NOTICE 'Added using_fallback_data column';
    ELSE
        RAISE NOTICE 'using_fallback_data column already exists';
    END IF;

    -- Add data_sources column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ephemeris_data' 
        AND column_name = 'data_sources'
    ) THEN
        ALTER TABLE ephemeris_data ADD COLUMN data_sources JSONB;
        RAISE NOTICE 'Added data_sources column';
    ELSE
        RAISE NOTICE 'data_sources column already exists';
    END IF;
END $$;

-- Set default values for existing records
UPDATE ephemeris_data 
SET 
    using_fallback_data = FALSE,
    data_sources = '{"legacy": "unknown"}'::jsonb
WHERE using_fallback_data IS NULL OR data_sources IS NULL;

RAISE NOTICE 'Migration completed successfully';
