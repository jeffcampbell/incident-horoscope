const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment-timezone');
const { generateHoroscope } = require('./horoscope');
const { requireAuth, requireTeamAccess } = require('../middleware/auth');

// Get deployments for a team within a date range
router.get('/', requireAuth, async (req, res) => {
    try {
        const { team_id, start_date, end_date, status } = req.query;

        if (!team_id) {
            return res.status(400).json({ error: 'team_id parameter is required' });
        }

        let query = `
            SELECT d.*
            FROM deployments d
            WHERE d.team_id = $1
        `;
        const params = [team_id];
        let paramIndex = 2;

        if (start_date) {
            query += ` AND d.planned_date >= $${paramIndex}`;
            params.push(start_date);
            paramIndex++;
        }

        if (end_date) {
            query += ` AND d.planned_date <= $${paramIndex}`;
            params.push(end_date);
            paramIndex++;
        }

        if (status) {
            query += ` AND d.status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }

        query += ' ORDER BY d.planned_date ASC, d.created_at ASC';

        const result = await db.query(query, params);

        res.json({ deployments: result.rows });
    } catch (error) {
        console.error('Error fetching deployments:', error);
        res.status(500).json({ error: 'Failed to fetch deployments' });
    }
});

// Get deployment risk outlook for next N days
router.get('/outlook', requireAuth, async (req, res) => {
    try {
        const { team_id, days = 14 } = req.query;

        if (!team_id) {
            return res.status(400).json({ error: 'team_id parameter is required' });
        }

        // Validate days parameter
        const numDays = parseInt(days);
        if (isNaN(numDays) || numDays < 1 || numDays > 30) {
            return res.status(400).json({ error: 'days must be between 1 and 30' });
        }

        // Get team settings
        const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [team_id]);
        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const team = teamResult.rows[0];
        const timezone = team.timezone || 'America/New_York';

        // Get ephemeris data and generate horoscopes for the next N days
        const outlook = [];
        const today = moment().tz(timezone).startOf('day');

        for (let i = 0; i < numDays; i++) {
            const date = today.clone().add(i, 'days').format('YYYY-MM-DD');

            // Get ephemeris data
            const ephemerisResult = await db.query(
                'SELECT * FROM ephemeris_data WHERE date = $1',
                [date]
            );

            let riskLevel = 'unknown';
            let riskScore = 0;
            let riskFactors = [];
            let recommendations = [];

            if (ephemerisResult.rows.length > 0) {
                const ephemeris = ephemerisResult.rows[0];

                // Generate horoscope for this date
                const horoscope = await generateHoroscope(ephemeris, null, team, team.primary_role);

                riskLevel = horoscope?.overall_risk_level || 'unknown';

                // Calculate risk score based on predictions
                const riskLevels = { high: 3, medium: 2, low: 1, positive: -1 };
                if (horoscope?.predictions && Array.isArray(horoscope.predictions)) {
                    riskScore = horoscope.predictions.reduce((sum, pred) => {
                        return sum + (riskLevels[pred.level] || 0) * (pred.confidence || 0);
                    }, 0);

                    // Extract risk factors
                    riskFactors = horoscope.predictions
                        .filter(p => ['high', 'medium'].includes(p.level))
                        .map(p => ({
                            category: p.category,
                            level: p.level,
                            message: p.message,
                            planet: p.planet
                        }));
                }

                // Extract deployment-specific recommendations
                if (horoscope.developer_insights?.deployment_forecast) {
                    const forecast = horoscope.developer_insights.deployment_forecast;
                    recommendations = forecast.recommendations || [];
                }
            }

            // Get scheduled deployments for this date
            const deploymentsResult = await db.query(
                `SELECT * FROM deployments
                 WHERE team_id = $1 AND planned_date = $2 AND status != 'cancelled'
                 ORDER BY created_at`,
                [team_id, date]
            );

            outlook.push({
                date,
                risk_level: riskLevel,
                risk_score: riskScore,
                risk_factors: riskFactors,
                recommendations: recommendations,
                deployments: deploymentsResult.rows
            });
        }

        res.json({
            team_id: parseInt(team_id),
            team_name: team.name,
            timezone: timezone,
            start_date: outlook[0]?.date,
            end_date: outlook[outlook.length - 1]?.date,
            outlook: outlook
        });
    } catch (error) {
        console.error('Error generating deployment outlook:', error);
        res.status(500).json({ error: 'Failed to generate deployment outlook' });
    }
});

// Get single deployment by ID
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query('SELECT * FROM deployments WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found' });
        }

        const deployment = result.rows[0];

        // Get risk assessment for the planned date
        const ephemerisResult = await db.query(
            'SELECT * FROM ephemeris_data WHERE date = $1',
            [deployment.planned_date]
        );

        let riskAssessment = null;
        if (ephemerisResult.rows.length > 0) {
            // Get team settings
            const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [deployment.team_id]);
            if (teamResult.rows.length > 0) {
                const team = teamResult.rows[0];
                const horoscope = await generateHoroscope(ephemerisResult.rows[0], null, team, team.primary_role);

                riskAssessment = {
                    risk_level: horoscope?.overall_risk_level || 'unknown',
                    risk_factors: horoscope?.predictions ? horoscope.predictions.filter(p => ['high', 'medium'].includes(p.level)) : [],
                    cosmic_advice: horoscope?.cosmic_advice || '',
                    deployment_forecast: horoscope?.developer_insights?.deployment_forecast
                };
            }
        }

        res.json({
            deployment,
            risk_assessment: riskAssessment
        });
    } catch (error) {
        console.error('Error fetching deployment:', error);
        res.status(500).json({ error: 'Failed to fetch deployment' });
    }
});

// Create new deployment
router.post('/', requireAuth, async (req, res) => {
    try {
        const { team_id, service_name, description, planned_date, status } = req.body;

        if (!team_id || !service_name || !planned_date) {
            return res.status(400).json({
                error: 'team_id, service_name, and planned_date are required'
            });
        }

        // Verify team exists
        const teamResult = await db.query('SELECT id FROM teams WHERE id = $1', [team_id]);
        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        // Validate planned_date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(planned_date)) {
            return res.status(400).json({ error: 'planned_date must be in YYYY-MM-DD format' });
        }

        // Validate status if provided
        const validStatuses = ['planned', 'scheduled', 'completed', 'cancelled'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'status must be one of: ' + validStatuses.join(', ')
            });
        }

        const result = await db.query(
            `INSERT INTO deployments (team_id, service_name, description, planned_date, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [team_id, service_name, description || null, planned_date, status || 'planned']
        );

        res.status(201).json({
            deployment: result.rows[0],
            message: 'Deployment created successfully'
        });
    } catch (error) {
        console.error('Error creating deployment:', error);
        res.status(500).json({ error: 'Failed to create deployment' });
    }
});

// Update deployment
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { service_name, description, planned_date, actual_date, status, outcome } = req.body;

        // Check if deployment exists
        const existingResult = await db.query('SELECT * FROM deployments WHERE id = $1', [id]);
        if (existingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found' });
        }

        // Validate status if provided
        const validStatuses = ['planned', 'scheduled', 'completed', 'cancelled'];
        if (status && !validStatuses.includes(status)) {
            return res.status(400).json({
                error: 'status must be one of: ' + validStatuses.join(', ')
            });
        }

        // Validate outcome if provided
        const validOutcomes = ['success', 'failure', 'partial'];
        if (outcome && !validOutcomes.includes(outcome)) {
            return res.status(400).json({
                error: 'outcome must be one of: ' + validOutcomes.join(', ')
            });
        }

        // Validate date formats if provided
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (planned_date && !dateRegex.test(planned_date)) {
            return res.status(400).json({ error: 'planned_date must be in YYYY-MM-DD format' });
        }
        if (actual_date && !dateRegex.test(actual_date)) {
            return res.status(400).json({ error: 'actual_date must be in YYYY-MM-DD format' });
        }

        const result = await db.query(
            `UPDATE deployments SET
                service_name = COALESCE($1, service_name),
                description = COALESCE($2, description),
                planned_date = COALESCE($3, planned_date),
                actual_date = COALESCE($4, actual_date),
                status = COALESCE($5, status),
                outcome = COALESCE($6, outcome),
                updated_at = NOW()
            WHERE id = $7
            RETURNING *`,
            [service_name, description, planned_date, actual_date, status, outcome, id]
        );

        res.json({
            deployment: result.rows[0],
            message: 'Deployment updated successfully'
        });
    } catch (error) {
        console.error('Error updating deployment:', error);
        res.status(500).json({ error: 'Failed to update deployment' });
    }
});

// Delete deployment
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query('DELETE FROM deployments WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Deployment not found' });
        }

        res.json({ message: 'Deployment deleted successfully' });
    } catch (error) {
        console.error('Error deleting deployment:', error);
        res.status(500).json({ error: 'Failed to delete deployment' });
    }
});

// Get deployment analytics for a team
router.get('/analytics/:team_id', requireAuth, requireTeamAccess, async (req, res) => {
    try {
        const { team_id } = req.params;
        const { days = 30 } = req.query;

        // Verify team exists
        const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [team_id]);
        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        // Get completed deployments with outcomes
        const deploymentsResult = await db.query(
            `SELECT
                d.*,
                CASE
                    WHEN d.outcome = 'success' THEN 1
                    WHEN d.outcome = 'failure' THEN 0
                    ELSE NULL
                END as success_flag
            FROM deployments d
            WHERE d.team_id = $1
                AND d.status = 'completed'
                AND d.outcome IS NOT NULL
                AND d.actual_date >= CURRENT_DATE - $2::integer
            ORDER BY d.actual_date DESC`,
            [team_id, days]
        );

        const deployments = deploymentsResult.rows;

        // Calculate success rates by risk level
        const riskCorrelation = {
            high: { total: 0, success: 0, failure: 0 },
            medium: { total: 0, success: 0, failure: 0 },
            normal: { total: 0, success: 0, failure: 0 },
            favorable: { total: 0, success: 0, failure: 0 }
        };

        // For each deployment, get the risk level for that date
        for (const deployment of deployments) {
            const date = deployment.actual_date || deployment.planned_date;
            const ephemerisResult = await db.query(
                'SELECT * FROM ephemeris_data WHERE date = $1',
                [date]
            );

            if (ephemerisResult.rows.length > 0) {
                const horoscope = await generateHoroscope(
                    ephemerisResult.rows[0],
                    null,
                    teamResult.rows[0],
                    teamResult.rows[0].primary_role
                );

                const riskLevel = horoscope?.overall_risk_level || 'unknown';

                if (riskCorrelation[riskLevel]) {
                    riskCorrelation[riskLevel].total++;
                    if (deployment.outcome === 'success') {
                        riskCorrelation[riskLevel].success++;
                    } else if (deployment.outcome === 'failure') {
                        riskCorrelation[riskLevel].failure++;
                    }
                }
            }
        }

        // Calculate success rates
        const successRates = {};
        for (const [level, stats] of Object.entries(riskCorrelation)) {
            successRates[level] = {
                total: stats.total,
                success_count: stats.success,
                failure_count: stats.failure,
                success_rate: stats.total > 0 ? (stats.success / stats.total * 100).toFixed(1) : null
            };
        }

        // Get upcoming deployments
        const upcomingResult = await db.query(
            `SELECT * FROM deployments
             WHERE team_id = $1
                AND planned_date >= CURRENT_DATE
                AND status != 'cancelled'
             ORDER BY planned_date ASC
             LIMIT 10`,
            [team_id]
        );

        res.json({
            team: teamResult.rows[0],
            period_days: days,
            total_deployments: deployments.length,
            success_by_risk_level: successRates,
            recent_deployments: deployments.slice(0, 10),
            upcoming_deployments: upcomingResult.rows
        });
    } catch (error) {
        console.error('Error fetching deployment analytics:', error);
        res.status(500).json({ error: 'Failed to fetch deployment analytics' });
    }
});

module.exports = router;
