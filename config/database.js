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