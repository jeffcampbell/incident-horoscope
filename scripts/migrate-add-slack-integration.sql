-- Migration: Add Slack integration tables
-- This migration adds tables for Slack workspace installations, channel configurations,
-- and on-call schedules for personalized horoscopes

-- Table to track Slack workspace installations
CREATE TABLE IF NOT EXISTS slack_workspaces (
    id SERIAL PRIMARY KEY,
    team_id VARCHAR(255) UNIQUE NOT NULL, -- Slack team/workspace ID
    enterprise_id VARCHAR(255), -- Slack enterprise ID (for grid orgs)
    team_name VARCHAR(255) NOT NULL,
    bot_token TEXT NOT NULL, -- Encrypted in production
    bot_user_id VARCHAR(255) NOT NULL,
    scope TEXT, -- OAuth scopes granted
    authed_user_id VARCHAR(255), -- User who installed the app
    is_active BOOLEAN DEFAULT true,
    installed_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Table to store channel configurations for daily horoscopes
CREATE TABLE IF NOT EXISTS slack_channel_configs (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
    channel_id VARCHAR(255) NOT NULL,
    channel_name VARCHAR(255),
    daily_horoscope_enabled BOOLEAN DEFAULT true,
    daily_horoscope_time TIME DEFAULT '09:00:00', -- Default 9 AM
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(workspace_id, channel_id)
);

-- Table to track on-call engineers for personalized horoscopes
CREATE TABLE IF NOT EXISTS slack_on_call_schedule (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
    slack_user_id VARCHAR(255) NOT NULL,
    slack_user_name VARCHAR(255),
    birth_sign VARCHAR(50), -- For personalized horoscope alignment
    start_date DATE NOT NULL,
    end_date DATE,
    is_current BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_slack_workspaces_team_id ON slack_workspaces(team_id);
CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_workspace_id ON slack_channel_configs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_slack_on_call_schedule_workspace_id ON slack_on_call_schedule(workspace_id);
CREATE INDEX IF NOT EXISTS idx_slack_on_call_schedule_dates ON slack_on_call_schedule(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_slack_on_call_schedule_current ON slack_on_call_schedule(is_current) WHERE is_current = true;

-- Update incidents table to link to Slack workspace for team isolation
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS slack_workspace_id INTEGER REFERENCES slack_workspaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_incidents_slack_workspace_id ON incidents(slack_workspace_id);
