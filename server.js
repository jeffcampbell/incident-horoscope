require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize database tables on startup (for hosting platforms)
async function initializeDatabase() {
    if (process.env.NODE_ENV === 'production') {
        try {
            const db = require('./config/database');
            
            // Check if tables exist, create if they don't
            const tableCheck = await db.query(`
                SELECT table_name FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = 'ephemeris_data'
            `);
            
            if (tableCheck.rows.length === 0) {
                const fs = require('fs');
                const initSQL = fs.readFileSync('./scripts/init.sql', 'utf8');
                await db.query(initSQL);
            } 
        } catch (error) {
            console.error('❌ Database initialization error:', error);
        }
    }
}

// Routes
app.use('/api/ephemeris', require('./routes/ephemeris'));
app.use('/api/horoscope', require('./routes/horoscope'));

// Main dashboard route
app.get('/', (req, res) => {
    res.render('dashboard');
});

// How it works page
app.get('/how-it-works', (req, res) => {
    res.render('how-it-works');
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, async () => {
    console.log(`🔮 Planetary Horoscope Server running on port ${PORT}`);
    console.log(`🌟 Dashboard available at http://localhost:${PORT}`);
    
    // Initialize database for production
    await initializeDatabase();
});

module.exports = app;