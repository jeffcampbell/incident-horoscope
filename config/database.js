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