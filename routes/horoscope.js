const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment');

// Generate horoscope for a specific date based on planetary positions
router.get('/', async (req, res) => {
    try {
        const { date } = req.query;
        
        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }
        
        // Get ephemeris data for the requested date
        const ephemerisResult = await db.query(
            'SELECT * FROM ephemeris_data WHERE date = $1',
            [date]
        );
        
        let ephemeris = null;
        if (ephemerisResult.rows.length > 0) {
            ephemeris = ephemerisResult.rows[0];
        } else {
            return res.json({
                date,
                message: 'No ephemeris data available for this date. Please fetch it first.',
                horoscope: null
            });
        }
        
        // Generate horoscope based on planetary positions
        const horoscope = await generateHoroscope(ephemeris);
        
        res.json({
            date,
            ephemeris,
            horoscope
        });
    } catch (error) {
        console.error('Error generating horoscope:', error);
        res.status(500).json({ error: 'Failed to generate horoscope' });
    }
});

// Get general planetary influences for software teams
router.get('/influences', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT planet, sign, influence_category, influence_description, risk_level, confidence
            FROM planetary_influences
            ORDER BY planet, sign
        `);
        
        res.json({ influences: result.rows });
    } catch (error) {
        console.error('Error fetching planetary influences:', error);
        res.status(500).json({ error: 'Failed to fetch planetary influences' });
    }
});

async function generateHoroscope(ephemeris) {
    const predictions = [];
    
    // Mars - Incident Risk and System Conflicts
    const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
    const marsSign = getAstrologicalSign(ephemeris.mars_ra);
    if (marsIntensity > 25) {
        predictions.push({
            category: 'incident_risk',
            level: 'high',
            message: `Mars in ${marsSign} suggests heightened potential for critical incidents. Infrastructure and security teams should be extra vigilant. Review monitoring systems and incident response procedures.`,
            confidence: 0.75,
            planet: 'Mars'
        });
    } else if (marsIntensity > 15) {
        predictions.push({
            category: 'incident_risk',
            level: 'medium',
            message: `Mars energy indicates moderate system tension. Good time to proactively address technical debt and potential failure points.`,
            confidence: 0.6,
            planet: 'Mars'
        });
    }
    
    // Mercury - Communication and Deployment Issues
    const mercuryPosition = ephemeris.mercury_ra % 360;
    const mercurySign = getAstrologicalSign(ephemeris.mercury_ra);
    if (mercuryPosition > 300 || mercuryPosition < 60) {
        predictions.push({
            category: 'communication_risk',
            level: 'medium',
            message: `Mercury in ${mercurySign} may cause communication and deployment-related issues. Double-check configurations, review change management processes, and ensure clear team communication.`,
            confidence: 0.65,
            planet: 'Mercury'
        });
    }
    
    // Venus - Team Collaboration and User Experience
    const venusHarmony = Math.sin(ephemeris.venus_ra * Math.PI / 180);
    const venusSign = getAstrologicalSign(ephemeris.venus_ra);
    if (venusHarmony > 0.5) {
        predictions.push({
            category: 'team_harmony',
            level: 'positive',
            message: `Venus in ${venusSign} favors team collaboration and user satisfaction. Excellent day for cross-team coordination, user experience improvements, and complex deployments.`,
            confidence: 0.55,
            planet: 'Venus'
        });
    }
    
    // Jupiter - Learning and Process Improvements
    const jupiterExpansion = ephemeris.jupiter_distance < 5;
    const jupiterSign = getAstrologicalSign(ephemeris.jupiter_ra);
    if (jupiterExpansion) {
        predictions.push({
            category: 'growth_opportunities',
            level: 'positive',
            message: `Jupiter in ${jupiterSign} creates favorable conditions for implementing process improvements, conducting post-mortems, and expanding system capabilities.`,
            confidence: 0.5,
            planet: 'Jupiter'
        });
    }
    
    // Saturn - Structure, Testing, and Discipline
    const saturnDiscipline = Math.cos(ephemeris.saturn_ra * Math.PI / 180);
    const saturnSign = getAstrologicalSign(ephemeris.saturn_ra);
    if (saturnDiscipline > 0.3) {
        predictions.push({
            category: 'testing_focus',
            level: 'medium',
            message: `Saturn in ${saturnSign} emphasizes the importance of thorough testing and structured processes. Focus on code reviews, automated testing, and compliance checks.`,
            confidence: 0.6,
            planet: 'Saturn'
        });
    }
    
    // Moon - On-call and Emotional Responses
    const moonPhase = (ephemeris.moon_ra / 15) % 24;
    const moonSign = getAstrologicalSign(ephemeris.moon_ra);
    if (moonPhase < 6 || moonPhase > 18) {
        predictions.push({
            category: 'on_call_management',
            level: 'medium',
            message: `Moon in ${moonSign} suggests heightened emotional responses to incidents. Ensure adequate on-call coverage and support systems for team well-being.`,
            confidence: 0.7,
            planet: 'Moon'
        });
    }
    
    // Sun - Leadership and System Authority
    const sunAuthority = Math.abs(Math.sin(ephemeris.sun_ra * Math.PI / 180));
    const sunSign = getAstrologicalSign(ephemeris.sun_ra);
    if (sunAuthority > 0.7) {
        predictions.push({
            category: 'leadership_opportunity',
            level: 'positive',
            message: `Sun in ${sunSign} highlights leadership opportunities. Strong day for architectural decisions, system governance, and establishing technical authority.`,
            confidence: 0.6,
            planet: 'Sun'
        });
    }
    
    return {
        date: ephemeris.date,
        overall_risk_level: calculateOverallRisk(predictions),
        predictions,
        cosmic_advice: generateCosmicAdvice(predictions),
        planetary_summary: generatePlanetarySummary(ephemeris)
    };
}

function calculateOverallRisk(predictions) {
    const riskLevels = { high: 3, medium: 2, low: 1, positive: -1 };
    const totalRisk = predictions.reduce((sum, pred) => {
        return sum + (riskLevels[pred.level] || 0) * pred.confidence;
    }, 0);
    
    if (totalRisk > 1.5) return 'high';
    if (totalRisk > 0.5) return 'medium';
    if (totalRisk < -0.5) return 'favorable';
    return 'normal';
}

function generateCosmicAdvice(predictions) {
    const riskCount = predictions.filter(p => ['high', 'medium'].includes(p.level)).length;
    const positiveCount = predictions.filter(p => p.level === 'positive').length;
    
    if (riskCount > positiveCount) {
        return "The cosmic alignment suggests extra caution today. Review your monitoring systems, strengthen communication protocols, and ensure your incident response teams are well-prepared.";
    } else if (positiveCount > riskCount) {
        return "Favorable planetary energies support smooth operations and productive collaboration. An excellent day for ambitious deployments, process improvements, and team coordination.";
    } else {
        return "Balanced cosmic energies suggest a typical operational day. Maintain standard vigilance, follow established procedures, and stay alert to emerging patterns.";
    }
}

function generatePlanetarySummary(ephemeris) {
    const planets = [
        { name: 'Sun', ra: ephemeris.sun_ra, symbol: '☉', domain: 'Leadership & Authority' },
        { name: 'Mercury', ra: ephemeris.mercury_ra, symbol: '☿', domain: 'Communication & Deployments' },
        { name: 'Venus', ra: ephemeris.venus_ra, symbol: '♀', domain: 'Team Harmony & UX' },
        { name: 'Mars', ra: ephemeris.mars_ra, symbol: '♂', domain: 'Incidents & Conflicts' },
        { name: 'Jupiter', ra: ephemeris.jupiter_ra, symbol: '♃', domain: 'Growth & Learning' },
        { name: 'Saturn', ra: ephemeris.saturn_ra, symbol: '♄', domain: 'Structure & Testing' },
        { name: 'Moon', ra: ephemeris.moon_ra, symbol: '☽', domain: 'On-call & Team Emotions' }
    ];
    
    return planets.map(planet => ({
        ...planet,
        sign: getAstrologicalSign(planet.ra),
        influence_strength: getInfluenceIntensity(planet.ra)
    }));
}

function getAstrologicalSign(ra) {
    if (ra === null) return 'Unknown';
    
    const signs = [
        'Aries ♈', 'Taurus ♉', 'Gemini ♊', 'Cancer ♋',
        'Leo ♌', 'Virgo ♍', 'Libra ♎', 'Scorpio ♏',
        'Sagittarius ♐', 'Capricorn ♑', 'Aquarius ♒', 'Pisces ♓'
    ];
    
    const normalizedRA = ((ra % 360) + 360) % 360;
    const signIndex = Math.floor(normalizedRA / 30);
    return signs[signIndex] || signs[0];
}

function getInfluenceIntensity(ra) {
    if (ra === null) return 'low';
    
    const intensity = Math.abs(Math.sin(ra * Math.PI / 180));
    if (intensity > 0.8) return 'high';
    if (intensity > 0.5) return 'medium';
    return 'low';
}

module.exports = router;