const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

// Test database connection
pool.on('connect', () => {
    console.log('🗄️ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ Database connection error:', err);
    process.exit(-1);
});

// Initialize database tables
async function initializeTables() {
    try {
        console.log('🔄 Checking database tables...');
        
        // Create ephemeris_data table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ephemeris_data (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                location TEXT DEFAULT 'New York City',
                -- Solar system bodies with coordinates
                sun_ra NUMERIC,
                sun_dec NUMERIC,
                sun_distance NUMERIC,
                mercury_ra NUMERIC,
                mercury_dec NUMERIC,
                mercury_distance NUMERIC,
                venus_ra NUMERIC,
                venus_dec NUMERIC,
                venus_distance NUMERIC,
                mars_ra NUMERIC,
                mars_dec NUMERIC,
                mars_distance NUMERIC,
                jupiter_ra NUMERIC,
                jupiter_dec NUMERIC,
                jupiter_distance NUMERIC,
                saturn_ra NUMERIC,
                saturn_dec NUMERIC,
                saturn_distance NUMERIC,
                uranus_ra NUMERIC,
                uranus_dec NUMERIC,
                uranus_distance NUMERIC,
                neptune_ra NUMERIC,
                neptune_dec NUMERIC,
                neptune_distance NUMERIC,
                moon_ra NUMERIC,
                moon_dec NUMERIC,
                moon_distance NUMERIC,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(date, location)
            );
        `);
        
        // Create planetary_influences table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS planetary_influences (
                id SERIAL PRIMARY KEY,
                planet VARCHAR(50) NOT NULL,
                sign VARCHAR(50) NOT NULL,
                influence_category VARCHAR(100) NOT NULL,
                influence_description TEXT NOT NULL,
                risk_level VARCHAR(20) NOT NULL, -- low, medium, high, positive
                confidence NUMERIC DEFAULT 0.5,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        // Create indexes for better query performance
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_ephemeris_date ON ephemeris_data(date);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_planetary_influences_planet ON planetary_influences(planet);
        `);
        
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_planetary_influences_sign ON planetary_influences(sign);
        `);

        // Create incidents table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS incidents (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
                category VARCHAR(50) NOT NULL CHECK (category IN ('deployment', 'infrastructure', 'communication', 'monitoring', 'other')),
                duration_minutes INTEGER,
                description TEXT NOT NULL,
                team_id INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Create indexes for incidents table
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_incidents_date ON incidents(date);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_incidents_team_id ON incidents(team_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_incidents_severity ON incidents(severity);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents(category);
        `);

        // Create Slack integration tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS slack_workspaces (
                id SERIAL PRIMARY KEY,
                team_id VARCHAR(255) UNIQUE NOT NULL,
                enterprise_id VARCHAR(255),
                team_name VARCHAR(255) NOT NULL,
                bot_token TEXT NOT NULL,
                bot_user_id VARCHAR(255) NOT NULL,
                scope TEXT,
                authed_user_id VARCHAR(255),
                is_active BOOLEAN DEFAULT true,
                installed_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS slack_channel_configs (
                id SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
                channel_id VARCHAR(255) NOT NULL,
                channel_name VARCHAR(255),
                daily_horoscope_enabled BOOLEAN DEFAULT true,
                daily_horoscope_time TIME DEFAULT '09:00:00',
                timezone VARCHAR(50) DEFAULT 'America/New_York',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(workspace_id, channel_id)
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS slack_on_call_schedule (
                id SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
                slack_user_id VARCHAR(255) NOT NULL,
                slack_user_name VARCHAR(255),
                birth_sign VARCHAR(50),
                start_date DATE NOT NULL,
                end_date DATE,
                is_current BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Create indexes for Slack tables
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_workspaces_team_id ON slack_workspaces(team_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_workspace_id ON slack_channel_configs(workspace_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_on_call_schedule_workspace_id ON slack_on_call_schedule(workspace_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_on_call_schedule_dates ON slack_on_call_schedule(start_date, end_date);
        `);

        // Add slack_workspace_id to incidents table if not exists
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='incidents' AND column_name='slack_workspace_id'
                ) THEN
                    ALTER TABLE incidents ADD COLUMN slack_workspace_id INTEGER REFERENCES slack_workspaces(id) ON DELETE SET NULL;
                END IF;
            END $$;
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_incidents_slack_workspace_id ON incidents(slack_workspace_id);
        `);

        // Create Slack daily horoscope log table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS slack_daily_horoscope_log (
                id SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
                channel_id VARCHAR(255) NOT NULL,
                sent_date DATE NOT NULL,
                sent_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(workspace_id, channel_id, sent_date)
            );
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_daily_horoscope_log_workspace
            ON slack_daily_horoscope_log(workspace_id, sent_date);
        `);

        // Create teams table for team configuration portal
        await pool.query(`
            CREATE TABLE IF NOT EXISTS teams (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                primary_role VARCHAR(50) CHECK (primary_role IN ('Backend', 'Frontend', 'DevOps', 'QA', 'Full-Stack', 'Leadership')),
                timezone VARCHAR(50) DEFAULT 'America/New_York',
                language_tone VARCHAR(50) DEFAULT 'Cosmic' CHECK (language_tone IN ('Cosmic', 'Technical', 'Casual')),
                team_lead_email VARCHAR(255),
                daily_horoscope_enabled BOOLEAN DEFAULT true,
                delivery_time TIME DEFAULT '09:00:00',
                delivery_channel VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Add Slack alert columns to teams table if they don't exist
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='teams' AND column_name='slack_alert_enabled'
                ) THEN
                    ALTER TABLE teams ADD COLUMN slack_alert_enabled BOOLEAN DEFAULT true;
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='teams' AND column_name='slack_alert_channel'
                ) THEN
                    ALTER TABLE teams ADD COLUMN slack_alert_channel VARCHAR(255) DEFAULT '#horoscope-alerts';
                END IF;

                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='teams' AND column_name='alert_sensitivity'
                ) THEN
                    ALTER TABLE teams ADD COLUMN alert_sensitivity VARCHAR(20) DEFAULT 'medium' CHECK (alert_sensitivity IN ('low', 'medium', 'high'));
                END IF;
            END $$;
        `);

        // Create Slack high-risk alerts log table (must be after teams table)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS slack_high_risk_alerts_log (
                id SERIAL PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                alert_date DATE NOT NULL,
                high_risk_dates JSONB NOT NULL,
                sent_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(team_id, alert_date)
            );
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_high_risk_alerts_log_team
            ON slack_high_risk_alerts_log(team_id, alert_date);
        `);

        // Create team_members junction table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS team_members (
                id SERIAL PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                role VARCHAR(50),
                slack_user_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(team_id, email)
            );
        `);

        // Create team_incident_categories for customization
        await pool.query(`
            CREATE TABLE IF NOT EXISTS team_incident_categories (
                id SERIAL PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                category VARCHAR(50) NOT NULL,
                enabled BOOLEAN DEFAULT true,
                default_severity VARCHAR(20),
                auto_escalate BOOLEAN DEFAULT false,
                escalation_threshold_minutes INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(team_id, category)
            );
        `);

        // Create indexes for teams tables
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_teams_timezone ON teams(timezone);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_team_incident_categories_team_id ON team_incident_categories(team_id);
        `);

        // Add team_id to slack_workspaces if not exists
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='slack_workspaces' AND column_name='app_team_id'
                ) THEN
                    ALTER TABLE slack_workspaces ADD COLUMN app_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
                END IF;
            END $$;
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_workspaces_app_team_id ON slack_workspaces(app_team_id);
        `);

        // Create deployments table for deployment planning
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deployments (
                id SERIAL PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                service_name VARCHAR(255) NOT NULL,
                description TEXT,
                planned_date DATE NOT NULL,
                actual_date DATE,
                status VARCHAR(50) DEFAULT 'planned' CHECK (status IN ('planned', 'scheduled', 'completed', 'cancelled')),
                outcome VARCHAR(50) CHECK (outcome IN ('success', 'failure', 'partial')),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);

        // Create indexes for deployments table
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_deployments_team_id ON deployments(team_id);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_deployments_planned_date ON deployments(planned_date);
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
        `);

        console.log('✅ Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing database tables:', error);
        throw error;
    }
}

// Initialize tables when the module is loaded
initializeTables().catch(err => {
    console.error('❌ Failed to initialize database:', err);
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
    initializeTables
};