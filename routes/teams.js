const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment-timezone');

// Get all teams
router.get('/', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT t.*,
                   COUNT(DISTINCT tm.id) as member_count,
                   COUNT(DISTINCT sw.id) as workspace_count
            FROM teams t
            LEFT JOIN team_members tm ON t.id = tm.team_id
            LEFT JOIN slack_workspaces sw ON t.id = sw.app_team_id
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `);

        res.json({ teams: result.rows });
    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

// Get single team by ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Get team data
        const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [id]);

        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        const team = teamResult.rows[0];

        // Get team members
        const membersResult = await db.query(
            'SELECT * FROM team_members WHERE team_id = $1 ORDER BY created_at',
            [id]
        );

        // Get incident categories
        const categoriesResult = await db.query(
            'SELECT * FROM team_incident_categories WHERE team_id = $1',
            [id]
        );

        // Get linked Slack workspaces
        const workspacesResult = await db.query(
            'SELECT id, team_name, team_id, is_active FROM slack_workspaces WHERE app_team_id = $1',
            [id]
        );

        res.json({
            team,
            members: membersResult.rows,
            incident_categories: categoriesResult.rows,
            slack_workspaces: workspacesResult.rows
        });
    } catch (error) {
        console.error('Error fetching team:', error);
        res.status(500).json({ error: 'Failed to fetch team' });
    }
});

// Create new team
router.post('/', async (req, res) => {
    try {
        const {
            name,
            description,
            primary_role,
            timezone,
            language_tone,
            team_lead_email,
            daily_horoscope_enabled,
            delivery_time,
            delivery_channel,
            slack_alert_enabled,
            slack_alert_channel,
            alert_sensitivity,
            members,
            incident_categories
        } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Team name is required' });
        }

        // Insert team
        const teamResult = await db.query(
            `INSERT INTO teams (
                name, description, primary_role, timezone, language_tone,
                team_lead_email, daily_horoscope_enabled, delivery_time, delivery_channel,
                slack_alert_enabled, slack_alert_channel, alert_sensitivity
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *`,
            [
                name,
                description || null,
                primary_role || null,
                timezone || 'America/New_York',
                language_tone || 'Cosmic',
                team_lead_email || null,
                daily_horoscope_enabled !== false,
                delivery_time || '09:00:00',
                delivery_channel || null,
                slack_alert_enabled !== false,
                slack_alert_channel || '#horoscope-alerts',
                alert_sensitivity || 'medium'
            ]
        );

        const team = teamResult.rows[0];

        // Insert team members if provided
        if (members && Array.isArray(members)) {
            for (const member of members) {
                await db.query(
                    `INSERT INTO team_members (team_id, name, email, role, slack_user_id)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (team_id, email) DO NOTHING`,
                    [team.id, member.name, member.email, member.role || null, member.slack_user_id || null]
                );
            }
        }

        // Insert incident categories if provided
        if (incident_categories && Array.isArray(incident_categories)) {
            for (const cat of incident_categories) {
                await db.query(
                    `INSERT INTO team_incident_categories (
                        team_id, category, enabled, default_severity, auto_escalate, escalation_threshold_minutes
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (team_id, category) DO NOTHING`,
                    [
                        team.id,
                        cat.category,
                        cat.enabled !== false,
                        cat.default_severity || null,
                        cat.auto_escalate || false,
                        cat.escalation_threshold_minutes || null
                    ]
                );
            }
        } else {
            // Create default incident categories
            const defaultCategories = ['deployment', 'infrastructure', 'communication', 'monitoring', 'other'];
            for (const category of defaultCategories) {
                await db.query(
                    `INSERT INTO team_incident_categories (team_id, category, enabled)
                     VALUES ($1, $2, true)`,
                    [team.id, category]
                );
            }
        }

        res.status(201).json({ team, message: 'Team created successfully' });
    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Failed to create team' });
    }
});

// Update team
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            primary_role,
            timezone,
            language_tone,
            team_lead_email,
            daily_horoscope_enabled,
            delivery_time,
            delivery_channel,
            slack_alert_enabled,
            slack_alert_channel,
            alert_sensitivity
        } = req.body;

        const result = await db.query(
            `UPDATE teams SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                primary_role = COALESCE($3, primary_role),
                timezone = COALESCE($4, timezone),
                language_tone = COALESCE($5, language_tone),
                team_lead_email = COALESCE($6, team_lead_email),
                daily_horoscope_enabled = COALESCE($7, daily_horoscope_enabled),
                delivery_time = COALESCE($8, delivery_time),
                delivery_channel = COALESCE($9, delivery_channel),
                slack_alert_enabled = COALESCE($10, slack_alert_enabled),
                slack_alert_channel = COALESCE($11, slack_alert_channel),
                alert_sensitivity = COALESCE($12, alert_sensitivity),
                updated_at = NOW()
            WHERE id = $13
            RETURNING *`,
            [name, description, primary_role, timezone, language_tone, team_lead_email,
             daily_horoscope_enabled, delivery_time, delivery_channel,
             slack_alert_enabled, slack_alert_channel, alert_sensitivity, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        res.json({ team: result.rows[0], message: 'Team updated successfully' });
    } catch (error) {
        console.error('Error updating team:', error);
        res.status(500).json({ error: 'Failed to update team' });
    }
});

// Delete team
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query('DELETE FROM teams WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        res.json({ message: 'Team deleted successfully' });
    } catch (error) {
        console.error('Error deleting team:', error);
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// Add member to team
router.post('/:id/members', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, slack_user_id } = req.body;

        if (!name || !email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }

        const result = await db.query(
            `INSERT INTO team_members (team_id, name, email, role, slack_user_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (team_id, email) DO UPDATE SET
                name = EXCLUDED.name,
                role = EXCLUDED.role,
                slack_user_id = EXCLUDED.slack_user_id
             RETURNING *`,
            [id, name, email, role || null, slack_user_id || null]
        );

        res.status(201).json({ member: result.rows[0], message: 'Member added successfully' });
    } catch (error) {
        console.error('Error adding team member:', error);
        res.status(500).json({ error: 'Failed to add team member' });
    }
});

// Remove member from team
router.delete('/:id/members/:memberId', async (req, res) => {
    try {
        const { id, memberId } = req.params;

        const result = await db.query(
            'DELETE FROM team_members WHERE id = $1 AND team_id = $2 RETURNING *',
            [memberId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Member not found' });
        }

        res.json({ message: 'Member removed successfully' });
    } catch (error) {
        console.error('Error removing team member:', error);
        res.status(500).json({ error: 'Failed to remove team member' });
    }
});

// Update incident category settings
router.put('/:id/categories/:category', async (req, res) => {
    try {
        const { id, category } = req.params;
        const { enabled, default_severity, auto_escalate, escalation_threshold_minutes } = req.body;

        const result = await db.query(
            `INSERT INTO team_incident_categories (
                team_id, category, enabled, default_severity, auto_escalate, escalation_threshold_minutes
            ) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (team_id, category) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                default_severity = EXCLUDED.default_severity,
                auto_escalate = EXCLUDED.auto_escalate,
                escalation_threshold_minutes = EXCLUDED.escalation_threshold_minutes
            RETURNING *`,
            [id, category, enabled, default_severity, auto_escalate, escalation_threshold_minutes]
        );

        res.json({ category: result.rows[0], message: 'Category updated successfully' });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ error: 'Failed to update category' });
    }
});

// Get team analytics
router.get('/:id/analytics', async (req, res) => {
    try {
        const { id } = req.params;
        const { days = 30 } = req.query;

        // Get team info
        const teamResult = await db.query('SELECT * FROM teams WHERE id = $1', [id]);
        if (teamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Team not found' });
        }

        // Get incident stats for the team
        const incidentStatsResult = await db.query(`
            SELECT
                COUNT(*) as total_incidents,
                COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical_count,
                COUNT(CASE WHEN severity = 'high' THEN 1 END) as high_count,
                COUNT(CASE WHEN severity = 'medium' THEN 1 END) as medium_count,
                COUNT(CASE WHEN severity = 'low' THEN 1 END) as low_count,
                AVG(duration_minutes) as avg_duration,
                category,
                severity
            FROM incidents
            WHERE team_id = $1
                AND date >= CURRENT_DATE - $2::integer
            GROUP BY category, severity
            ORDER BY category, severity
        `, [id, days]);

        // Get incidents over time
        const incidentsOverTimeResult = await db.query(`
            SELECT
                date,
                COUNT(*) as count,
                severity
            FROM incidents
            WHERE team_id = $1
                AND date >= CURRENT_DATE - $2::integer
            GROUP BY date, severity
            ORDER BY date
        `, [id, days]);

        // Get prediction accuracy (if we have actual incidents to compare)
        const accuracyResult = await db.query(`
            SELECT
                i.date,
                i.severity,
                i.category,
                COUNT(*) as actual_incidents
            FROM incidents i
            WHERE i.team_id = $1
                AND i.date >= CURRENT_DATE - $2::integer
            GROUP BY i.date, i.severity, i.category
            ORDER BY i.date DESC
        `, [id, days]);

        res.json({
            team: teamResult.rows[0],
            incident_stats: incidentStatsResult.rows,
            incidents_over_time: incidentsOverTimeResult.rows,
            accuracy_data: accuracyResult.rows,
            period_days: days
        });
    } catch (error) {
        console.error('Error fetching team analytics:', error);
        res.status(500).json({ error: 'Failed to fetch team analytics' });
    }
});

// Link Slack workspace to team
router.post('/:id/link-slack', async (req, res) => {
    try {
        const { id } = req.params;
        const { slack_team_id } = req.body;

        if (!slack_team_id) {
            return res.status(400).json({ error: 'Slack team ID is required' });
        }

        // Update the Slack workspace to link it to this team
        const result = await db.query(
            `UPDATE slack_workspaces
             SET app_team_id = $1, updated_at = NOW()
             WHERE team_id = $2
             RETURNING *`,
            [id, slack_team_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Slack workspace not found' });
        }

        res.json({ workspace: result.rows[0], message: 'Slack workspace linked successfully' });
    } catch (error) {
        console.error('Error linking Slack workspace:', error);
        res.status(500).json({ error: 'Failed to link Slack workspace' });
    }
});

module.exports = router;
