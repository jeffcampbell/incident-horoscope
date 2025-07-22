const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../config/database');
const moment = require('moment');

// Planet codes for NASA Horizons API
const CELESTIAL_BODIES = {
    sun: '10',
    mercury: '199',
    venus: '299',
    mars: '499', 
    jupiter: '599',
    saturn: '699',
    uranus: '799',
    neptune: '899',
    moon: '301'
};

// Get ephemeris data for a specific date
router.get('/', async (req, res) => {
    try {
        const { date, location = 'New York City' } = req.query;
        
        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }
        
        // Check if we already have this data
        const existing = await db.query(
            'SELECT * FROM ephemeris_data WHERE date = $1 AND location = $2',
            [date, location]
        );
        
        if (existing.rows.length > 0) {
            return res.json(existing.rows[0]);
        }
        
        // Fetch from NASA API
        const ephemerisData = await fetchEphemerisForDate(date, location);
        
        // Store in database
        await storeEphemerisData(ephemerisData, date, location);
        
        res.json(ephemerisData);
    } catch (error) {
        console.error('Error fetching ephemeris data:', error);
        res.status(500).json({ error: 'Failed to fetch ephemeris data' });
    }
});

// Bulk fetch ephemeris data for multiple dates
router.post('/bulk', async (req, res) => {
    try {
        const { dates, location = 'New York City' } = req.body;
        
        if (!dates || !Array.isArray(dates)) {
            return res.status(400).json({ error: 'Dates array is required' });
        }
        
        const results = [];
        
        for (const date of dates) {
            try {
                // Check if we already have this data
                const existing = await db.query(
                    'SELECT * FROM ephemeris_data WHERE date = $1 AND location = $2',
                    [date, location]
                );
                
                if (existing.rows.length > 0) {
                    results.push(existing.rows[0]);
                } else {
                    // Fetch from NASA API with delay to respect rate limits
                    await new Promise(resolve => setTimeout(resolve, 500));
                    const ephemerisData = await fetchEphemerisForDate(date, location);
                    await storeEphemerisData(ephemerisData, date, location);
                    results.push(ephemerisData);
                }
            } catch (error) {
                console.error(`Error fetching data for ${date}:`, error);
                results.push({ date, error: error.message });
            }
        }
        
        res.json({ results });
    } catch (error) {
        console.error('Error in bulk ephemeris fetch:', error);
        res.status(500).json({ error: 'Failed to fetch bulk ephemeris data' });
    }
});

async function fetchEphemerisForDate(date, location) {
    const ephemerisData = {
        date,
        location,
        created_at: new Date()
    };
    
    // New York City coordinates (default)
    const observer = "coord@399"; // Earth geocenter as fallback
    
    for (const [bodyName, bodyCode] of Object.entries(CELESTIAL_BODIES)) {
        try {
            const data = await fetchBodyPosition(bodyCode, date, observer);
            ephemerisData[`${bodyName}_ra`] = data.ra;
            ephemerisData[`${bodyName}_dec`] = data.dec;
            ephemerisData[`${bodyName}_distance`] = data.distance;
            
            // Add small delay to avoid overwhelming NASA API
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.error(`Error fetching ${bodyName} data:`, error);
            ephemerisData[`${bodyName}_ra`] = null;
            ephemerisData[`${bodyName}_dec`] = null;
            ephemerisData[`${bodyName}_distance`] = null;
        }
    }
    
    return ephemerisData;
}

async function fetchBodyPosition(bodyCode, date, observer) {
    const startDate = moment(date).format('YYYY-MM-DD');
    const endDate = moment(date).add(1, 'day').format('YYYY-MM-DD');
    
    const params = new URLSearchParams({
        format: 'json',
        COMMAND: `'${bodyCode}'`,
        OBJ_DATA: 'YES',
        MAKE_EPHEM: 'YES',
        EPHEM_TYPE: 'OBSERVER',
        CENTER: '500@399', // Earth geocenter
        START_TIME: `'${startDate}'`,
        STOP_TIME: `'${endDate}'`,
        STEP_SIZE: '1d',
        QUANTITIES: '1,3' // RA & DEC, distance
    });
    
    const url = `${process.env.NASA_API_BASE}?${params}`;
    
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'IncidentHoroscopeApp/1.0'
            }
        });
        
        return parseEphemerisResponse(response.data);
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            throw new Error('NASA API timeout');
        }
        throw new Error(`NASA API error: ${error.message}`);
    }
}

function parseEphemerisResponse(data) {
    try {
        // Parse NASA Horizons response - this is a simplified parser
        // The actual response format may vary, so this might need refinement
        
        if (typeof data === 'string') {
            // Text format response - extract coordinates
            const lines = data.split('\n');
            let dataSection = false;
            
            for (const line of lines) {
                if (line.includes('$$SOE')) {
                    dataSection = true;
                    continue;
                }
                if (line.includes('$$EOE')) {
                    break;
                }
                
                if (dataSection && line.trim()) {
                    // Parse coordinate line - format may vary
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 6) {
                        const ra = parseFloat(parts[2]) || 0; // Right Ascension
                        const dec = parseFloat(parts[3]) || 0; // Declination  
                        const distance = parseFloat(parts[4]) || 0; // Distance
                        
                        return { ra, dec, distance };
                    }
                }
            }
        }
        
        // Fallback - return zeros if parsing fails
        return { ra: 0, dec: 0, distance: 0 };
    } catch (error) {
        console.error('Error parsing ephemeris response:', error);
        return { ra: 0, dec: 0, distance: 0 };
    }
}

async function storeEphemerisData(data, date, location) {
    const query = `
        INSERT INTO ephemeris_data (
            date, location, sun_ra, sun_dec, sun_distance,
            mercury_ra, mercury_dec, mercury_distance,
            venus_ra, venus_dec, venus_distance,
            mars_ra, mars_dec, mars_distance,
            jupiter_ra, jupiter_dec, jupiter_distance,
            saturn_ra, saturn_dec, saturn_distance,
            uranus_ra, uranus_dec, uranus_distance,
            neptune_ra, neptune_dec, neptune_distance,
            moon_ra, moon_dec, moon_distance
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
        ON CONFLICT (date, location) DO UPDATE SET
            sun_ra = EXCLUDED.sun_ra, sun_dec = EXCLUDED.sun_dec, sun_distance = EXCLUDED.sun_distance,
            mercury_ra = EXCLUDED.mercury_ra, mercury_dec = EXCLUDED.mercury_dec, mercury_distance = EXCLUDED.mercury_distance,
            venus_ra = EXCLUDED.venus_ra, venus_dec = EXCLUDED.venus_dec, venus_distance = EXCLUDED.venus_distance,
            mars_ra = EXCLUDED.mars_ra, mars_dec = EXCLUDED.mars_dec, mars_distance = EXCLUDED.mars_distance,
            jupiter_ra = EXCLUDED.jupiter_ra, jupiter_dec = EXCLUDED.jupiter_dec, jupiter_distance = EXCLUDED.jupiter_distance,
            saturn_ra = EXCLUDED.saturn_ra, saturn_dec = EXCLUDED.saturn_dec, saturn_distance = EXCLUDED.saturn_distance,
            uranus_ra = EXCLUDED.uranus_ra, uranus_dec = EXCLUDED.uranus_dec, uranus_distance = EXCLUDED.uranus_distance,
            neptune_ra = EXCLUDED.neptune_ra, neptune_dec = EXCLUDED.neptune_dec, neptune_distance = EXCLUDED.neptune_distance,
            moon_ra = EXCLUDED.moon_ra, moon_dec = EXCLUDED.moon_dec, moon_distance = EXCLUDED.moon_distance
    `;
    
    const values = [
        date, location,
        data.sun_ra, data.sun_dec, data.sun_distance,
        data.mercury_ra, data.mercury_dec, data.mercury_distance,
        data.venus_ra, data.venus_dec, data.venus_distance,
        data.mars_ra, data.mars_dec, data.mars_distance,
        data.jupiter_ra, data.jupiter_dec, data.jupiter_distance,
        data.saturn_ra, data.saturn_dec, data.saturn_distance,
        data.uranus_ra, data.uranus_dec, data.uranus_distance,
        data.neptune_ra, data.neptune_dec, data.neptune_distance,
        data.moon_ra, data.moon_dec, data.moon_distance
    ];
    
    await db.query(query, values);
    return { ...data, date, location };
}

module.exports = router;