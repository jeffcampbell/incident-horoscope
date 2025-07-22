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

// Test NASA API connectivity
router.get('/test', async (req, res) => {
    try {
        const testDate = '2025-07-22';
        console.log('Testing NASA API connectivity...');
        
        // Test with Sun (most reliable target)
        const data = await fetchBodyPosition('10', testDate);
        
        res.json({
            status: 'success',
            nasa_api_working: !data.isFallback,
            test_date: testDate,
            sample_data: data,
            api_base: process.env.NASA_API_BASE
        });
    } catch (error) {
        console.error('NASA API test failed:', error);
        res.json({
            status: 'error',
            nasa_api_working: false,
            error: error.message,
            api_base: process.env.NASA_API_BASE
        });
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
    
    let usingFallbackData = false;
    const dataSource = {};
    
    for (const [bodyName, bodyCode] of Object.entries(CELESTIAL_BODIES)) {
        try {
            const data = await fetchBodyPosition(bodyCode, date, observer);
            ephemerisData[`${bodyName}_ra`] = data.ra;
            ephemerisData[`${bodyName}_dec`] = data.dec;
            ephemerisData[`${bodyName}_distance`] = data.distance;
            
            // Track data source
            if (data.isFallback) {
                usingFallbackData = true;
                dataSource[bodyName] = 'fallback';
            } else {
                dataSource[bodyName] = 'nasa';
            }
            
            // Add small delay to avoid overwhelming NASA API
            await new Promise(resolve => setTimeout(resolve, 500)); // Increased delay
        } catch (error) {
            console.error(`Error fetching ${bodyName} data:`, error.message);
            ephemerisData[`${bodyName}_ra`] = null;
            ephemerisData[`${bodyName}_dec`] = null;
            ephemerisData[`${bodyName}_distance`] = null;
            dataSource[bodyName] = 'error';
            usingFallbackData = true;
        }
    }
    
    console.log(`Ephemeris fetch complete. Using fallback data: ${usingFallbackData}`);
    console.log('Data sources:', dataSource);
    
    // Add metadata about data sources
    ephemerisData.data_source_info = {
        using_fallback_data: usingFallbackData,
        sources: dataSource,
        warning: usingFallbackData ? 'Some or all planetary positions are approximated due to NASA API unavailability' : null
    };
    
    return ephemerisData;
}

async function fetchBodyPosition(bodyCode, date, observer) {
    const startDate = moment(date).format('YYYY-MM-DD');
    const endDate = moment(date).add(1, 'day').format('YYYY-MM-DD');
    
    const params = new URLSearchParams({
        format: 'text',  // Use text format as shown in example - more reliable parsing
        COMMAND: bodyCode,  // Remove quotes around body code
        OBJ_DATA: 'YES',
        MAKE_EPHEM: 'YES',
        EPHEM_TYPE: 'OBSERVER',
        CENTER: '500@399',  // Earth geocenter
        START_TIME: startDate,  // Remove quotes
        STOP_TIME: endDate,     // Remove quotes  
        STEP_SIZE: '1d',        // Remove space - NASA API expects '1d' not '1 d'
        QUANTITIES: '1',        // Just astrometric RA/DEC to avoid "too many constants" error
        TIME_DIGITS: 'MINUTES',
        CAL_FORMAT: 'CAL',
        ANG_FORMAT: 'DEG',      // Use degrees instead of HMS for easier parsing
        EXTRA_PREC: 'YES',      // Extra precision for better accuracy
        CSV_FORMAT: 'NO'
    });
    
    const url = `${process.env.NASA_API_BASE}?${params}`;
    
    try {
        console.log(`Fetching NASA data for body ${bodyCode}: ${url}`);
        
        const response = await axios.get(url, {
            timeout: 15000,  // Increased timeout
            headers: {
                'User-Agent': 'IncidentHoroscopeApp/1.0',
                'Accept': 'text/plain'
            }
        });
        
        console.log(`NASA API response status: ${response.status}`);
        
        const parsed = parseEphemerisResponse(response.data, bodyCode);
        
        // If parsing failed or NASA API is unavailable, generate fallback data
        if (!parsed) {
            console.warn(`Failed to parse NASA data for body ${bodyCode}, using fallback`);
            const fallbackData = generateFallbackPosition(bodyCode, date);
            fallbackData.isFallback = true;
            return fallbackData;
        }
        
        // Mark as real NASA data
        parsed.isFallback = false;
        console.log(`Successfully parsed NASA data for body ${bodyCode}`);
        return parsed;
    } catch (error) {
        console.warn(`NASA API failed for body ${bodyCode}:`, error.message);
        const fallbackData = generateFallbackPosition(bodyCode, date);
        fallbackData.isFallback = true;
        return fallbackData;
    }
}

function parseEphemerisResponse(data, bodyCode) {
    try {
        if (typeof data !== 'string') {
            console.warn('NASA API returned non-string data');
            return null;
        }
        
        console.log(`Parsing NASA response for body ${bodyCode}, data length: ${data.length}`);
        
        // Check for API errors first
        if (data.includes('ERROR') || data.includes('FAILED') || data.includes('No ephemeris')) {
            console.warn('NASA API returned error:', data.substring(0, 200));
            return null;
        }
        
        // Parse NASA Horizons text format response
        const lines = data.split('\n');
        let dataSection = false;
        let foundData = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for start of ephemeris data
            if (line.includes('$$SOE')) {
                dataSection = true;
                console.log('Found start of ephemeris data ($$SOE)');
                continue;
            }
            
            // Look for end of ephemeris data
            if (line.includes('$$EOE')) {
                console.log('Found end of ephemeris data ($$EOE)');
                break;
            }
            
            if (dataSection && line.trim()) {
                // NASA Horizons text format typically has columns:
                // Date__(UT)__HR:MN     R.A._____(ICRF)_____DEC  APmag S-brt  delta      deldot
                // Look for lines with date and coordinates
                
                const trimmed = line.trim();
                if (trimmed.length < 20) continue; // Skip short lines
                
                // Split by multiple spaces to get columns
                const parts = trimmed.split(/\s+/);
                
                if (parts.length >= 4) {
                    // Try to find RA and DEC values
                    // RA is usually in format HH MM SS.SS or decimal degrees
                    // DEC is usually in format +/-DD MM SS.S or decimal degrees
                    
                    let ra = null;
                    let dec = null;
                    let distance = 1.0; // Default distance
                    
                    // Look for RA/DEC patterns in the parts array
                    for (let j = 1; j < parts.length - 1; j++) {
                        const part = parts[j];
                        const nextPart = parts[j + 1];
                        
                        // Check if this looks like RA (0-360 degrees)
                        const raCandidate = parseFloat(part);
                        const decCandidate = parseFloat(nextPart);
                        
                        if (!isNaN(raCandidate) && !isNaN(decCandidate)) {
                            // RA should be 0-360 degrees
                            // DEC should be -90 to +90 degrees
                            if (raCandidate >= 0 && raCandidate <= 360 && 
                                decCandidate >= -90 && decCandidate <= 90) {
                                ra = raCandidate;
                                dec = decCandidate;
                                
                                // Look for distance in subsequent columns (AU)
                                if (j + 2 < parts.length) {
                                    const distCandidate = parseFloat(parts[j + 2]);
                                    if (!isNaN(distCandidate) && distCandidate > 0) {
                                        distance = distCandidate;
                                    }
                                }
                                
                                foundData = true;
                                console.log(`Parsed coordinates for body ${bodyCode}: RA=${ra}°, DEC=${dec}°, Distance=${distance} AU`);
                                break;
                            }
                        }
                    }
                    
                    if (foundData) {
                        return { ra, dec, distance };
                    }
                }
            }
        }
        
        if (!foundData) {
            console.warn(`No valid coordinate data found in NASA response for body ${bodyCode}`);
            console.log('Response sample:', data.substring(0, 500));
        }
        
        return null;
    } catch (error) {
        console.error('Error parsing ephemeris response:', error);
        return null;
    }
}

// Generate realistic fallback planetary positions based on date and celestial body
function generateFallbackPosition(bodyCode, date) {
    const daysSinceEpoch = moment(date).diff(moment('2000-01-01'), 'days');
    
    // Approximate orbital periods (in days) and initial positions
    const orbitalData = {
        '10': { period: 365.25, initialRA: 280, name: 'Sun' }, // Sun
        '199': { period: 87.97, initialRA: 48, name: 'Mercury' }, // Mercury
        '299': { period: 224.7, initialRA: 105, name: 'Venus' }, // Venus
        '499': { period: 686.98, initialRA: 350, name: 'Mars' }, // Mars
        '599': { period: 4332.59, initialRA: 155, name: 'Jupiter' }, // Jupiter
        '699': { period: 10759.22, initialRA: 234, name: 'Saturn' }, // Saturn
        '799': { period: 30688.5, initialRA: 12, name: 'Uranus' }, // Uranus
        '899': { period: 60182, initialRA: 305, name: 'Neptune' }, // Neptune
        '301': { period: 27.32, initialRA: 125, name: 'Moon' } // Moon
    };
    
    const body = orbitalData[bodyCode];
    if (!body) {
        // Unknown body, return random position
        return {
            ra: Math.random() * 360,
            dec: (Math.random() - 0.5) * 60, // -30 to +30 degrees
            distance: 1 + Math.random() * 10
        };
    }
    
    // Calculate approximate position based on orbital period
    const orbitPosition = (daysSinceEpoch / body.period) % 1;
    const ra = (body.initialRA + (orbitPosition * 360)) % 360;
    
    // Add some variation based on date hash for consistency
    const dateHash = date.split('-').reduce((acc, part) => acc + parseInt(part), 0);
    const variation = (dateHash % 60) - 30; // -30 to +30 degree variation
    
    return {
        ra: (ra + variation + 360) % 360,
        dec: (Math.sin(orbitPosition * Math.PI * 2) * 23.5), // Simulate declination variation
        distance: 1 + Math.abs(Math.sin(orbitPosition * Math.PI)) * (body.period / 1000)
    };
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
            moon_ra, moon_dec, moon_distance,
            using_fallback_data, data_sources
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31
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
            moon_ra = EXCLUDED.moon_ra, moon_dec = EXCLUDED.moon_dec, moon_distance = EXCLUDED.moon_distance,
            using_fallback_data = EXCLUDED.using_fallback_data, data_sources = EXCLUDED.data_sources
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
        data.moon_ra, data.moon_dec, data.moon_distance,
        data.data_source_info?.using_fallback_data || false,
        JSON.stringify(data.data_source_info?.sources || {})
    ];
    
    await db.query(query, values);
    return { ...data, date, location };
}

module.exports = router;