const moment = require('moment');
const db = require('../config/database');
const { fetchEphemerisForDate, storeEphemerisData } = require('../routes/ephemeris-utils');
const { generateHoroscope } = require('../routes/horoscope');

/**
 * Fetch horoscope data for a given date
 * Retrieves ephemeris data from database or NASA API if needed, then generates horoscope
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Object|null} Horoscope data including date, ephemeris, and horoscope predictions
 */
async function fetchHoroscopeData(date) {
    try {
        // Check if ephemeris data exists for the date
        let ephemerisResult = await db.query(
            'SELECT * FROM ephemeris_data WHERE date = $1',
            [date]
        );

        // If no data exists, fetch it from NASA API
        if (ephemerisResult.rows.length === 0) {
            console.log(`📅 Fetching ephemeris data for ${date}...`);
            const ephemerisData = await fetchEphemerisForDate(date, 'Slack Command');
            await storeEphemerisData(ephemerisData, date, 'Slack Command');

            ephemerisResult = await db.query(
                'SELECT * FROM ephemeris_data WHERE date = $1',
                [date]
            );
        }

        if (ephemerisResult.rows.length === 0) {
            return null;
        }

        // Generate horoscope directly using the horoscope module
        const ephemeris = ephemerisResult.rows[0];
        const horoscope = await generateHoroscope(ephemeris, null);

        return {
            date,
            ephemeris,
            horoscope
        };
    } catch (error) {
        console.error('Error fetching horoscope data:', error);
        return null;
    }
}

/**
 * Get recent incidents for a workspace
 * @param {number} workspaceId - Slack workspace database ID
 * @param {number} limit - Maximum number of incidents to return (default 5)
 * @returns {Array} Array of incident records
 */
async function getRecentIncidents(workspaceId, limit = 5) {
    try {
        const result = await db.query(
            `SELECT * FROM incidents
             WHERE slack_workspace_id = $1
             ORDER BY date DESC, created_at DESC
             LIMIT $2`,
            [workspaceId, limit]
        );
        return result.rows;
    } catch (error) {
        console.error('Error fetching recent incidents:', error);
        return [];
    }
}

/**
 * Get accuracy stats for horoscope predictions for a workspace
 * Calculates validation metrics for the past 7 days
 * @param {number} workspaceId - Slack workspace database ID
 * @returns {Object|null} Summary object with accuracy metrics or null on error
 */
async function getAccuracyStats(workspaceId) {
    try {
        const endDate = moment().format('YYYY-MM-DD');
        const startDate = moment().subtract(7, 'days').format('YYYY-MM-DD');

        // Get all incidents in range for this workspace
        const incidentsResult = await db.query(
            `SELECT date, severity, category, duration_minutes
             FROM incidents
             WHERE date >= $1 AND date <= $2 AND slack_workspace_id = $3
             ORDER BY date`,
            [startDate, endDate, workspaceId]
        );

        // Get ephemeris data for all dates in range
        const ephemerisResult = await db.query(
            `SELECT date, mars_ra, mercury_ra
             FROM ephemeris_data
             WHERE date >= $1 AND date <= $2
             ORDER BY date`,
            [startDate, endDate]
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

        // Calculate validation for each date
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
            if (actualRisk === predictedRisk) {
                matches++;
            } else if (
                (predictedRisk === 'high' && actualRisk === 'medium') ||
                (predictedRisk === 'medium' && actualRisk === 'high') ||
                (predictedRisk === 'medium' && actualRisk === 'normal') ||
                (predictedRisk === 'normal' && actualRisk === 'medium')
            ) {
                partialMatches++;
            } else {
                mismatches++;
            }

            totalDays++;
        });

        const accuracy = totalDays > 0
            ? Math.round(((matches + partialMatches * 0.5) / totalDays) * 100)
            : 0;

        return {
            total_days: totalDays,
            matches: matches,
            partial_matches: partialMatches,
            mismatches: mismatches,
            overall_accuracy: accuracy
        };
    } catch (error) {
        console.error('Error fetching accuracy stats:', error);
        return null;
    }
}

/**
 * Calculate actual risk level based on incident severity and count
 * @param {Array} incidents - Array of incident objects
 * @returns {string} Risk level: 'high', 'medium', or 'normal'
 */
function calculateActualRisk(incidents) {
    if (incidents.length === 0) {
        return 'normal';
    }

    const criticalCount = incidents.filter(i => i.severity === 'critical').length;
    const highCount = incidents.filter(i => i.severity === 'high').length;
    const mediumCount = incidents.filter(i => i.severity === 'medium').length;

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

/**
 * Format horoscope data into Slack message blocks with interactive buttons
 * @param {Object} horoscopeData - Horoscope data object containing horoscope and date
 * @param {Object|null} accuracyStats - Accuracy statistics or null
 * @returns {Object} Slack message object with text and blocks
 */
function formatHoroscopeMessage(horoscopeData, accuracyStats) {
    const { horoscope, date } = horoscopeData;

    if (!horoscope) {
        return {
            text: `No horoscope data available for ${date}`,
            blocks: []
        };
    }

    const riskEmoji = {
        'high': '🔴',
        'medium': '🟡',
        'normal': '🟢',
        'favorable': '✨'
    };

    const emoji = riskEmoji[horoscope.overall_risk_level] || '🔮';

    // Build main message blocks
    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `🔮 Planetary Horoscope for ${moment(date).format('MMMM D, YYYY')}`
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Overall Risk Level:* ${emoji} *${horoscope.overall_risk_level.toUpperCase()}*`
            }
        },
        {
            type: 'divider'
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Cosmic Advice*\n${horoscope.cosmic_advice}`
            }
        }
    ];

    // Add accuracy stats if available
    if (accuracyStats) {
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `📊 This week: *${accuracyStats.overall_accuracy}% accuracy* (${accuracyStats.matches} matches, ${accuracyStats.partial_matches} partial)`
                }
            ]
        });
    }

    blocks.push({
        type: 'divider'
    });

    // Add key predictions
    const highPredictions = horoscope.predictions.filter(p => p.level === 'high').slice(0, 2);
    const positivePredictions = horoscope.predictions.filter(p => p.level === 'positive').slice(0, 2);

    if (highPredictions.length > 0 || positivePredictions.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*Key Predictions*'
            }
        });

        [...highPredictions, ...positivePredictions].forEach(pred => {
            const predEmoji = pred.level === 'high' ? '⚠️' : '✨';
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `${predEmoji} *${pred.planet}*: ${pred.message}`
                }
            });
        });
    }

    // Add interactive buttons
    blocks.push({
        type: 'actions',
        elements: [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '🚀 Deployment Forecast'
                },
                action_id: 'show_deployment_forecast',
                value: date
            },
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '👨‍💻 On-Call Insights'
                },
                action_id: 'show_oncall_insights',
                value: date
            },
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '🌍 Planetary Positions'
                },
                action_id: 'show_planetary_positions',
                value: date
            }
        ]
    });

    return {
        text: `Horoscope for ${date}: ${horoscope.overall_risk_level}`,
        blocks
    };
}

module.exports = {
    fetchHoroscopeData,
    getRecentIncidents,
    getAccuracyStats,
    formatHoroscopeMessage
};
