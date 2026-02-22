const moment = require('moment');
const db = require('../config/database');
const { fetchEphemerisForDate, storeEphemerisData } = require('../routes/ephemeris-utils');
const axios = require('axios');

// Helper function to fetch horoscope data
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

        // Generate horoscope (simplified version based on routes/horoscope.js)
        const ephemeris = ephemerisResult.rows[0];
        const response = await axios.get(`http://localhost:${process.env.PORT || 3000}/api/horoscope`, {
            params: { date }
        });

        return response.data;
    } catch (error) {
        console.error('Error fetching horoscope data:', error);
        return null;
    }
}

// Helper function to get recent incidents for display
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

// Helper function to get accuracy stats
async function getAccuracyStats(workspaceId) {
    try {
        const endDate = moment().format('YYYY-MM-DD');
        const startDate = moment().subtract(7, 'days').format('YYYY-MM-DD');

        const response = await axios.get(`http://localhost:${process.env.PORT || 3000}/api/incidents/validation/range`, {
            params: {
                start: startDate,
                end: endDate,
                team_id: workspaceId
            }
        });

        return response.data.summary;
    } catch (error) {
        console.error('Error fetching accuracy stats:', error);
        return null;
    }
}

// Format horoscope message with interactive buttons
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
