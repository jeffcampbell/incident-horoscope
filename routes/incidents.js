const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment');

// POST /api/incidents - Create new incident log
router.post('/', async (req, res) => {
    try {
        const { date, severity, category, duration_minutes, description, team_id = 1 } = req.body;

        // Validate required fields
        if (!date || !severity || !category || !description) {
            return res.status(400).json({
                error: 'Missing required fields: date, severity, category, and description are required'
            });
        }

        // Validate date format
        if (!moment(date, 'YYYY-MM-DD', true).isValid()) {
            return res.status(400).json({
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        // Validate severity
        const validSeverities = ['low', 'medium', 'high', 'critical'];
        if (!validSeverities.includes(severity)) {
            return res.status(400).json({
                error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}`
            });
        }

        // Validate category
        const validCategories = ['deployment', 'infrastructure', 'communication', 'monitoring', 'other'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({
                error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
            });
        }

        // Validate duration_minutes if provided
        if (duration_minutes !== undefined && (isNaN(duration_minutes) || duration_minutes < 0)) {
            return res.status(400).json({
                error: 'Invalid duration_minutes. Must be a non-negative integer'
            });
        }

        const result = await db.query(
            `INSERT INTO incidents (date, severity, category, duration_minutes, description, team_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [date, severity, category, duration_minutes, description, team_id]
        );

        res.status(201).json({
            message: 'Incident logged successfully',
            incident: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating incident:', error);
        res.status(500).json({ error: 'Failed to log incident' });
    }
});

// GET /api/incidents/validation/range?start=YYYY-MM-DD&end=YYYY-MM-DD - Validation metrics for date range
router.get('/validation/range', async (req, res) => {
    try {
        const { start, end, team_id, slack_workspace_id } = req.query;

        if (!start || !end) {
            return res.status(400).json({ error: 'Start and end date parameters are required' });
        }

        // Build WHERE clause based on available filters
        // Prioritize slack_workspace_id for Slack-originated requests, fall back to team_id for API requests
        let whereClause, queryParams;
        if (slack_workspace_id) {
            whereClause = 'WHERE date >= $1 AND date <= $2 AND slack_workspace_id = $3';
            queryParams = [start, end, parseInt(slack_workspace_id)];
        } else {
            whereClause = 'WHERE date >= $1 AND date <= $2 AND team_id = $3';
            queryParams = [start, end, parseInt(team_id) || 1];
        }

        // Get all incidents in range
        const incidentsResult = await db.query(
            `SELECT date, severity, category, duration_minutes
             FROM incidents
             ${whereClause}
             ORDER BY date`,
            queryParams
        );

        // Get ephemeris data for all dates in range
        const ephemerisResult = await db.query(
            `SELECT date, mars_ra, mercury_ra
             FROM ephemeris_data
             WHERE date >= $1 AND date <= $2
             ORDER BY date`,
            [start, end]
        );

        // Create a map of incidents by date
        const incidentsByDate = {};
        incidentsResult.rows.forEach(incident => {
            const dateKey = moment(incident.date).format('YYYY-MM-DD');
            if (!incidentsByDate[dateKey]) {
                incidentsByDate[dateKey] = [];
            }
            incidentsByDate[dateKey].push(incident);
        });

        // Calculate validation for each date with ephemeris data
        const validations = [];
        let totalDays = 0;
        let matches = 0;
        let partialMatches = 0;
        let mismatches = 0;

        ephemerisResult.rows.forEach(ephemeris => {
            const dateKey = moment(ephemeris.date).format('YYYY-MM-DD');
            const incidents = incidentsByDate[dateKey] || [];

            // Calculate predicted risk
            const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
            const mercuryPosition = ephemeris.mercury_ra % 360;

            let predictedRisk = 'normal';
            if (marsIntensity > 27) {
                predictedRisk = 'high';
            } else if (marsIntensity > 20) {
                predictedRisk = 'medium';
            } else if (mercuryPosition > 330 || mercuryPosition < 30) {
                predictedRisk = 'medium';
            }

            // Calculate actual risk
            const actualRisk = calculateActualRisk(incidents);

            // Determine match
            let matchType = 'mismatch';
            if (actualRisk === predictedRisk) {
                matchType = 'match';
                matches++;
            } else if (
                (predictedRisk === 'high' && actualRisk === 'medium') ||
                (predictedRisk === 'medium' && actualRisk === 'high') ||
                (predictedRisk === 'medium' && actualRisk === 'normal') ||
                (predictedRisk === 'normal' && actualRisk === 'medium')
            ) {
                matchType = 'partial_match';
                partialMatches++;
            } else {
                mismatches++;
            }

            validations.push({
                date: dateKey,
                predicted_risk: predictedRisk,
                actual_risk: actualRisk,
                incidents_count: incidents.length,
                match_type: matchType
            });

            totalDays++;
        });

        const accuracy = totalDays > 0
            ? Math.round(((matches + partialMatches * 0.5) / totalDays) * 100)
            : 0;

        res.json({
            start_date: start,
            end_date: end,
            summary: {
                total_days: totalDays,
                matches: matches,
                partial_matches: partialMatches,
                mismatches: mismatches,
                overall_accuracy: accuracy
            },
            validations: validations
        });
    } catch (error) {
        console.error('Error calculating validation range:', error);
        res.status(500).json({ error: 'Failed to calculate validation metrics' });
    }
});

// GET /api/incidents/validation?date=YYYY-MM-DD - Compare incidents with predictions for a date
router.get('/validation', async (req, res) => {
    try {
        const { date, team_id, slack_workspace_id } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }

        // Build WHERE clause based on available filters
        let whereClause, queryParams;
        if (slack_workspace_id) {
            whereClause = 'WHERE date = $1 AND slack_workspace_id = $2';
            queryParams = [date, parseInt(slack_workspace_id)];
        } else {
            whereClause = 'WHERE date = $1 AND team_id = $2';
            queryParams = [date, parseInt(team_id) || 1];
        }

        // Get incidents for the date
        const incidentsResult = await db.query(
            `SELECT * FROM incidents
             ${whereClause}
             ORDER BY CASE severity
                 WHEN 'critical' THEN 4
                 WHEN 'high' THEN 3
                 WHEN 'medium' THEN 2
                 WHEN 'low' THEN 1
             END DESC`,
            queryParams
        );

        const incidents = incidentsResult.rows;

        // Get ephemeris data for the date to generate predictions
        const ephemerisResult = await db.query(
            'SELECT * FROM ephemeris_data WHERE date = $1',
            [date]
        );

        let prediction = null;
        let validationResult = 'no_data';
        let accuracyScore = 0;
        let match_color = 'gray';

        if (ephemerisResult.rows.length > 0) {
            const ephemeris = ephemerisResult.rows[0];

            // Generate simple risk prediction based on Mars intensity (simplified from horoscope.js)
            const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
            const mercuryPosition = ephemeris.mercury_ra % 360;

            let predictedRisk = 'normal';
            if (marsIntensity > 27) {
                predictedRisk = 'high';
            } else if (marsIntensity > 20) {
                predictedRisk = 'medium';
            } else if (mercuryPosition > 330 || mercuryPosition < 30) {
                predictedRisk = 'medium';
            }

            prediction = {
                risk_level: predictedRisk,
                mars_intensity: marsIntensity,
                mercury_position: mercuryPosition
            };

            // Calculate validation
            const actualRisk = calculateActualRisk(incidents);

            // Compare predicted vs actual
            if (actualRisk === predictedRisk) {
                validationResult = 'match';
                accuracyScore = 100;
                match_color = 'green';
            } else if (
                (predictedRisk === 'high' && actualRisk === 'medium') ||
                (predictedRisk === 'medium' && actualRisk === 'high') ||
                (predictedRisk === 'medium' && actualRisk === 'normal') ||
                (predictedRisk === 'normal' && actualRisk === 'medium')
            ) {
                validationResult = 'partial_match';
                accuracyScore = 50;
                match_color = 'yellow';
            } else {
                validationResult = 'mismatch';
                accuracyScore = 0;
                match_color = 'red';
            }
        }

        res.json({
            date,
            prediction,
            actual: {
                risk_level: calculateActualRisk(incidents),
                incidents_count: incidents.length,
                incidents: incidents
            },
            validation: {
                result: validationResult,
                accuracy_score: accuracyScore,
                match_color: match_color
            }
        });
    } catch (error) {
        console.error('Error validating incidents:', error);
        res.status(500).json({ error: 'Failed to validate incidents' });
    }
});

// GET /api/incidents/date-range?start=YYYY-MM-DD&end=YYYY-MM-DD - Get incidents within date range
router.get('/date-range', async (req, res) => {
    try {
        const { start, end, team_id, slack_workspace_id } = req.query;

        if (!start || !end) {
            return res.status(400).json({ error: 'Start and end date parameters are required' });
        }

        // Build WHERE clause based on available filters
        let whereClause, queryParams;
        if (slack_workspace_id) {
            whereClause = 'WHERE date >= $1 AND date <= $2 AND slack_workspace_id = $3';
            queryParams = [start, end, parseInt(slack_workspace_id)];
        } else {
            whereClause = 'WHERE date >= $1 AND date <= $2 AND team_id = $3';
            queryParams = [start, end, parseInt(team_id) || 1];
        }

        const result = await db.query(
            `SELECT * FROM incidents
             ${whereClause}
             ORDER BY date DESC, created_at DESC`,
            queryParams
        );

        res.json({
            start_date: start,
            end_date: end,
            incidents: result.rows
        });
    } catch (error) {
        console.error('Error fetching incidents in date range:', error);
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

// GET /api/incidents/recent - Get recent incidents (last 30 days)
router.get('/recent', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 1000);
        const { team_id, slack_workspace_id } = req.query;
        const thirtyDaysAgo = moment().subtract(30, 'days').format('YYYY-MM-DD');

        // Build WHERE clause based on available filters
        let whereClause, queryParams;
        if (slack_workspace_id) {
            whereClause = 'WHERE slack_workspace_id = $1 AND date >= $2';
            queryParams = [parseInt(slack_workspace_id), thirtyDaysAgo, limit];
        } else {
            whereClause = 'WHERE team_id = $1 AND date >= $2';
            queryParams = [parseInt(team_id) || 1, thirtyDaysAgo, limit];
        }

        const result = await db.query(
            `SELECT * FROM incidents
             ${whereClause}
             ORDER BY date DESC, created_at DESC
             LIMIT $3`,
            queryParams
        );

        res.json({
            incidents: result.rows
        });
    } catch (error) {
        console.error('Error fetching recent incidents:', error);
        res.status(500).json({ error: 'Failed to fetch recent incidents' });
    }
});

// GET /api/incidents?date=YYYY-MM-DD - Get incidents for a specific date
router.get('/', async (req, res) => {
    try {
        const { date, team_id, slack_workspace_id } = req.query;

        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }

        // Build WHERE clause based on available filters
        let whereClause, queryParams;
        if (slack_workspace_id) {
            whereClause = 'WHERE date = $1 AND slack_workspace_id = $2';
            queryParams = [date, parseInt(slack_workspace_id)];
        } else {
            whereClause = 'WHERE date = $1 AND team_id = $2';
            queryParams = [date, parseInt(team_id) || 1];
        }

        const result = await db.query(
            `SELECT * FROM incidents
             ${whereClause}
             ORDER BY created_at DESC`,
            queryParams
        );

        res.json({
            date,
            incidents: result.rows
        });
    } catch (error) {
        console.error('Error fetching incidents:', error);
        res.status(500).json({ error: 'Failed to fetch incidents' });
    }
});

// PUT /api/incidents/:id - Update incident
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { date, severity, category, duration_minutes, description } = req.body;

        // Validate date format if provided
        if (date !== undefined && !moment(date, 'YYYY-MM-DD', true).isValid()) {
            return res.status(400).json({
                error: 'Invalid date format. Use YYYY-MM-DD'
            });
        }

        // Validate severity if provided
        if (severity !== undefined) {
            const validSeverities = ['low', 'medium', 'high', 'critical'];
            if (!validSeverities.includes(severity)) {
                return res.status(400).json({
                    error: `Invalid severity. Must be one of: ${validSeverities.join(', ')}`
                });
            }
        }

        // Validate category if provided
        if (category !== undefined) {
            const validCategories = ['deployment', 'infrastructure', 'communication', 'monitoring', 'other'];
            if (!validCategories.includes(category)) {
                return res.status(400).json({
                    error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
                });
            }
        }

        // Validate duration_minutes if provided
        if (duration_minutes !== undefined && (isNaN(duration_minutes) || duration_minutes < 0)) {
            return res.status(400).json({
                error: 'Invalid duration_minutes. Must be a non-negative integer'
            });
        }

        // Build update query dynamically based on provided fields
        const updates = [];
        const values = [];
        let paramCount = 1;

        if (date !== undefined) {
            updates.push(`date = $${paramCount++}`);
            values.push(date);
        }
        if (severity !== undefined) {
            updates.push(`severity = $${paramCount++}`);
            values.push(severity);
        }
        if (category !== undefined) {
            updates.push(`category = $${paramCount++}`);
            values.push(category);
        }
        if (duration_minutes !== undefined) {
            updates.push(`duration_minutes = $${paramCount++}`);
            values.push(duration_minutes);
        }
        if (description !== undefined) {
            updates.push(`description = $${paramCount++}`);
            values.push(description);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        updates.push(`updated_at = NOW()`);
        values.push(id);

        const result = await db.query(
            `UPDATE incidents
             SET ${updates.join(', ')}
             WHERE id = $${paramCount}
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        res.json({
            message: 'Incident updated successfully',
            incident: result.rows[0]
        });
    } catch (error) {
        console.error('Error updating incident:', error);
        res.status(500).json({ error: 'Failed to update incident' });
    }
});

// DELETE /api/incidents/:id - Delete incident
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            'DELETE FROM incidents WHERE id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        res.json({
            message: 'Incident deleted successfully',
            incident: result.rows[0]
        });
    } catch (error) {
        console.error('Error deleting incident:', error);
        res.status(500).json({ error: 'Failed to delete incident' });
    }
});

// GET /api/incidents/analytics/summary - Analytics summary data
router.get('/analytics/summary', async (req, res) => {
    try {
        const { start, end, team_id } = req.query;

        const startDate = start || moment().subtract(30, 'days').format('YYYY-MM-DD');
        const endDate = end || moment().format('YYYY-MM-DD');
        const teamIdFilter = parseInt(team_id) || 1;

        // Get incidents by category
        const categoryResult = await db.query(
            `SELECT category, COUNT(*) as count
             FROM incidents
             WHERE date >= $1 AND date <= $2 AND team_id = $3
             GROUP BY category
             ORDER BY count DESC`,
            [startDate, endDate, teamIdFilter]
        );

        // Get incidents by severity
        const severityResult = await db.query(
            `SELECT severity, COUNT(*) as count
             FROM incidents
             WHERE date >= $1 AND date <= $2 AND team_id = $3
             GROUP BY severity
             ORDER BY CASE severity
                 WHEN 'critical' THEN 4
                 WHEN 'high' THEN 3
                 WHEN 'medium' THEN 2
                 WHEN 'low' THEN 1
             END DESC`,
            [startDate, endDate, teamIdFilter]
        );

        // Get daily incident counts
        const dailyResult = await db.query(
            `SELECT date, COUNT(*) as count
             FROM incidents
             WHERE date >= $1 AND date <= $2 AND team_id = $3
             GROUP BY date
             ORDER BY date`,
            [startDate, endDate, teamIdFilter]
        );

        res.json({
            start_date: startDate,
            end_date: endDate,
            by_category: categoryResult.rows,
            by_severity: severityResult.rows,
            daily_counts: dailyResult.rows
        });
    } catch (error) {
        console.error('Error fetching analytics summary:', error);
        res.status(500).json({ error: 'Failed to fetch analytics summary' });
    }
});

// GET /api/incidents/analytics/planetary-correlation - Planetary correlation analysis
router.get('/analytics/planetary-correlation', async (req, res) => {
    try {
        const { start, end, team_id } = req.query;

        const startDate = start || moment().subtract(30, 'days').format('YYYY-MM-DD');
        const endDate = end || moment().format('YYYY-MM-DD');
        const teamIdFilter = parseInt(team_id) || 1;

        // Get all incidents in range
        const incidentsResult = await db.query(
            `SELECT date, severity, category
             FROM incidents
             WHERE date >= $1 AND date <= $2 AND team_id = $3
             ORDER BY date`,
            [startDate, endDate, teamIdFilter]
        );

        // Get ephemeris data for the same range
        const ephemerisResult = await db.query(
            `SELECT date, mars_ra, mercury_ra, venus_ra, jupiter_ra, saturn_ra, moon_ra
             FROM ephemeris_data
             WHERE date >= $1 AND date <= $2
             ORDER BY date`,
            [startDate, endDate]
        );

        // Create incident map by date
        const incidentsByDate = {};
        incidentsResult.rows.forEach(incident => {
            const dateKey = moment(incident.date).format('YYYY-MM-DD');
            if (!incidentsByDate[dateKey]) {
                incidentsByDate[dateKey] = [];
            }
            incidentsByDate[dateKey].push(incident);
        });

        // Analyze planetary correlations
        const planetaryStats = {
            mars: { high_risk_days: 0, total_days: 0, incidents: 0 },
            mercury: { high_risk_days: 0, total_days: 0, incidents: 0 },
            venus: { high_risk_days: 0, total_days: 0, incidents: 0 },
            jupiter: { high_risk_days: 0, total_days: 0, incidents: 0 },
            saturn: { high_risk_days: 0, total_days: 0, incidents: 0 },
            moon: { high_risk_days: 0, total_days: 0, incidents: 0 }
        };

        ephemerisResult.rows.forEach(ephemeris => {
            const dateKey = moment(ephemeris.date).format('YYYY-MM-DD');
            const incidents = incidentsByDate[dateKey] || [];
            const hasIncidents = incidents.length > 0;
            const incidentCount = incidents.length;

            // Mars intensity
            const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
            if (marsIntensity > 25) {
                planetaryStats.mars.high_risk_days++;
                if (hasIncidents) planetaryStats.mars.incidents += incidentCount;
            }
            planetaryStats.mars.total_days++;

            // Mercury retrograde-like position
            const mercuryPosition = ephemeris.mercury_ra % 360;
            if (mercuryPosition > 330 || mercuryPosition < 30) {
                planetaryStats.mercury.high_risk_days++;
                if (hasIncidents) planetaryStats.mercury.incidents += incidentCount;
            }
            planetaryStats.mercury.total_days++;

            // Venus position
            const venusPosition = ephemeris.venus_ra % 360;
            if (venusPosition > 300 || venusPosition < 60) {
                planetaryStats.venus.high_risk_days++;
                if (hasIncidents) planetaryStats.venus.incidents += incidentCount;
            }
            planetaryStats.venus.total_days++;

            // Jupiter position
            const jupiterPosition = ephemeris.jupiter_ra % 360;
            if (jupiterPosition > 270 && jupiterPosition < 330) {
                planetaryStats.jupiter.high_risk_days++;
                if (hasIncidents) planetaryStats.jupiter.incidents += incidentCount;
            }
            planetaryStats.jupiter.total_days++;

            // Saturn position
            const saturnPosition = ephemeris.saturn_ra % 360;
            if (saturnPosition > 240 && saturnPosition < 300) {
                planetaryStats.saturn.high_risk_days++;
                if (hasIncidents) planetaryStats.saturn.incidents += incidentCount;
            }
            planetaryStats.saturn.total_days++;

            // Moon phases
            const moonPosition = ephemeris.moon_ra % 360;
            if (moonPosition > 345 || moonPosition < 15 || (moonPosition > 165 && moonPosition < 195)) {
                planetaryStats.moon.high_risk_days++;
                if (hasIncidents) planetaryStats.moon.incidents += incidentCount;
            }
            planetaryStats.moon.total_days++;
        });

        // Calculate correlation scores
        const correlations = Object.keys(planetaryStats).map(planet => {
            const stats = planetaryStats[planet];
            const correlation = stats.high_risk_days > 0
                ? (stats.incidents / stats.high_risk_days)
                : 0;
            return {
                planet: planet.charAt(0).toUpperCase() + planet.slice(1),
                correlation_score: Math.round(correlation * 100) / 100,
                high_risk_days: stats.high_risk_days,
                incidents_on_high_risk_days: stats.incidents
            };
        }).sort((a, b) => b.correlation_score - a.correlation_score);

        res.json({
            start_date: startDate,
            end_date: endDate,
            correlations: correlations
        });
    } catch (error) {
        console.error('Error calculating planetary correlation:', error);
        res.status(500).json({ error: 'Failed to calculate planetary correlation' });
    }
});

// GET /api/incidents/analytics/teams - Get list of teams for comparison
router.get('/analytics/teams', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT DISTINCT team_id, COUNT(*) as incident_count
             FROM incidents
             GROUP BY team_id
             ORDER BY team_id`
        );

        res.json({
            teams: result.rows
        });
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

// Helper function to calculate actual risk level based on incidents
function calculateActualRisk(incidents) {
    if (incidents.length === 0) {
        return 'normal';
    }

    // Count severity levels
    const criticalCount = incidents.filter(i => i.severity === 'critical').length;
    const highCount = incidents.filter(i => i.severity === 'high').length;
    const mediumCount = incidents.filter(i => i.severity === 'medium').length;

    // Determine overall risk
    if (criticalCount > 0 || highCount >= 2) {
        return 'high';
    } else if (highCount > 0 || mediumCount >= 2) {
        return 'medium';
    } else if (mediumCount > 0 || incidents.length >= 3) {
        return 'medium';
    } else {
        return 'normal';
    }
}

module.exports = router;
