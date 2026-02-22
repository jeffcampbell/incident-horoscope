-- Migration: Add incidents table for logging and validation system
-- This table tracks actual incidents that occurred on specific dates
-- to compare against horoscope predictions for validation purposes

CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    category VARCHAR(50) NOT NULL CHECK (category IN ('deployment', 'infrastructure', 'communication', 'monitoring', 'other')),
    duration_minutes INTEGER,
    description TEXT NOT NULL,
    team_id INTEGER DEFAULT 1, -- Default to team 1 for single-team demo mode
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_incidents_date ON incidents(date);
CREATE INDEX IF NOT EXISTS idx_incidents_team_id ON incidents(team_id);
CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
