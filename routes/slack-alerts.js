const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { app } = require('../slack/bot');
const { calculate7DayRiskForecast, sendHighRiskAlert, checkAndSendHighRiskAlerts } = require('../slack/high-risk-alerts');
const { requireAuth, requireTeamAccess } = require('../middleware/auth');

/**
 * POST /api/slack/alert-high-risk-days
 * Manually trigger high-risk alert check and send alerts to teams
 * Can optionally specify a specific team_id, otherwise checks all teams
 *
 * Authentication: Requires API key (X-API-Key header or Authorization: Bearer <key>)
 */
router.post('/alert-high-risk-days', requireAuth, async (req, res) => {
    try {
        const { team_id, force } = req.body;

        // If team_id specified, only alert that team
        if (team_id) {
            // Validate team_id is a valid integer
            if (isNaN(parseInt(team_id))) {
                return res.status(400).json({ error: 'Invalid team_id parameter' });
            }

            // Get team settings
            const teamResult = await db.query(
                'SELECT * FROM teams WHERE id = $1',
                [team_id]
            );

            if (!teamResult.rows || teamResult.rows.length === 0) {
                return res.status(404).json({ error: 'Team not found' });
            }

            const team = teamResult.rows[0];

            if (!team.slack_alert_enabled && !force) {
                return res.status(400).json({
                    error: 'Alerts are disabled for this team',
                    message: 'Enable alerts in team settings or use force=true to override'
                });
            }

            // Check if already sent today (unless force=true)
            if (!force) {
                const today = new Date().toISOString().split('T')[0];
                const logResult = await db.query(
                    'SELECT * FROM slack_high_risk_alerts_log WHERE team_id = $1 AND alert_date = $2',
                    [team_id, today]
                );

                if (logResult.rows && logResult.rows.length > 0) {
                    return res.status(400).json({
                        error: 'Alert already sent today',
                        message: 'Use force=true to send another alert',
                        last_sent: logResult.rows[0].sent_at
                    });
                }
            }

            // Calculate 7-day forecast
            const highRiskDays = await calculate7DayRiskForecast(team);

            if (!highRiskDays || highRiskDays.length === 0) {
                return res.json({
                    success: true,
                    message: 'No high-risk days detected in the next 7 days',
                    team_id: team_id,
                    high_risk_days: []
                });
            }

            // Send alert
            const sent = await sendHighRiskAlert(app, team, highRiskDays);

            if (sent) {
                return res.json({
                    success: true,
                    message: `High-risk alert sent to ${team.name}`,
                    team_id: team_id,
                    team_name: team.name,
                    high_risk_days: highRiskDays.map(d => ({
                        date: d.date,
                        risk_level: d.risk_level,
                        days_away: d.daysAway
                    })),
                    alert_channel: team.slack_alert_channel || '#horoscope-alerts'
                });
            } else {
                return res.status(500).json({
                    error: 'Failed to send alert',
                    message: 'Check server logs for details'
                });
            }
        } else {
            // Check and alert all teams
            const summary = await checkAndSendHighRiskAlerts(app);

            return res.json({
                success: true,
                message: 'High-risk alert check completed for all teams',
                summary: {
                    teams_checked: summary.teamsChecked,
                    alerts_sent: summary.alertsSent,
                    errors: summary.errors
                }
            });
        }
    } catch (error) {
        console.error('Error sending high-risk alerts:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/slack/alert-high-risk-days/preview/:team_id
 * Preview what high-risk days would be alerted for a team without sending
 *
 * Authentication: Requires API key + team access authorization
 */
router.get('/alert-high-risk-days/preview/:team_id', requireAuth, requireTeamAccess, async (req, res) => {
    try {
        const { team_id } = req.params;

        // Validate team_id is a valid integer
        if (!team_id || isNaN(parseInt(team_id))) {
            return res.status(400).json({ error: 'Invalid team_id parameter' });
        }

        // Get team settings
        const teamResult = await db.query(
            'SELECT * FROM teams WHERE id = $1',
            [team_id]
        );

        if (!teamResult.rows || teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const team = teamResult.rows[0];

        // Calculate 7-day forecast
        const highRiskDays = await calculate7DayRiskForecast(team);

        return res.json({
            team_id: team_id,
            team_name: team.name,
            alert_enabled: team.slack_alert_enabled,
            alert_sensitivity: team.alert_sensitivity,
            alert_channel: team.slack_alert_channel || '#horoscope-alerts',
            high_risk_days_count: highRiskDays ? highRiskDays.length : 0,
            high_risk_days: highRiskDays || []
        });
    } catch (error) {
        console.error('Error previewing high-risk alerts:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

/**
 * GET /api/slack/alert-high-risk-days/history/:team_id
 * Get alert history for a team
 *
 * Authentication: Requires API key + team access authorization
 */
router.get('/alert-high-risk-days/history/:team_id', requireAuth, requireTeamAccess, async (req, res) => {
    try {
        const { team_id } = req.params;

        // Validate team_id is a valid integer
        if (!team_id || isNaN(parseInt(team_id))) {
            return res.status(400).json({ error: 'Invalid team_id parameter' });
        }

        // Validate and clamp limit parameter (min: 1, max: 100, default: 30)
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);

        // Get team
        const teamResult = await db.query(
            'SELECT id, name FROM teams WHERE id = $1',
            [team_id]
        );

        if (!teamResult.rows || teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        // Get alert history
        const historyResult = await db.query(
            `SELECT * FROM slack_high_risk_alerts_log
             WHERE team_id = $1
             ORDER BY alert_date DESC
             LIMIT $2`,
            [team_id, limit]
        );

        return res.json({
            team_id: team_id,
            team_name: teamResult.rows[0].name,
            alert_history: historyResult.rows || []
        });
    } catch (error) {
        console.error('Error fetching alert history:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

module.exports = router;
