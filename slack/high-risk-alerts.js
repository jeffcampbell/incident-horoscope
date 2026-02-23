const moment = require('moment-timezone');
const db = require('../config/database');
const { fetchEphemerisForDate, storeEphemerisData } = require('../routes/ephemeris-utils');
const { generateHoroscope } = require('../routes/horoscope');

/**
 * Calculate 7-day risk forecast for a team
 * @param {Object} teamSettings - Team configuration object
 * @returns {Array} Array of high-risk days with details
 */
async function calculate7DayRiskForecast(teamSettings) {
    const highRiskDays = [];
    const today = moment().startOf('day');

    // Determine risk threshold based on alert sensitivity
    const sensitivityThresholds = {
        'low': { marsIntensity: 28, overallRisk: ['high'] },
        'medium': { marsIntensity: 27, overallRisk: ['high'] },
        'high': { marsIntensity: 25, overallRisk: ['high', 'medium'] }
    };

    const sensitivity = teamSettings?.alert_sensitivity || 'medium';
    const threshold = sensitivityThresholds[sensitivity];

    if (!threshold) {
        console.error(`Invalid alert sensitivity: ${sensitivity}`);
        return highRiskDays;
    }

    // Check each of the next 7 days
    for (let i = 1; i <= 7; i++) {
        const checkDate = moment(today).add(i, 'days').format('YYYY-MM-DD');

        try {
            // Get or fetch ephemeris data for the date
            let ephemerisResult = await db.query(
                'SELECT * FROM ephemeris_data WHERE date = $1',
                [checkDate]
            );

            // If no data exists, fetch it from NASA API
            if (!ephemerisResult.rows || ephemerisResult.rows.length === 0) {
                console.log(`📅 Fetching ephemeris data for ${checkDate}...`);
                try {
                    const ephemerisData = await fetchEphemerisForDate(checkDate, 'High-Risk Alert');
                    await storeEphemerisData(ephemerisData, checkDate, 'High-Risk Alert');

                    ephemerisResult = await db.query(
                        'SELECT * FROM ephemeris_data WHERE date = $1',
                        [checkDate]
                    );
                } catch (fetchError) {
                    console.error(`Failed to fetch ephemeris for ${checkDate}:`, fetchError.message);
                    continue;
                }
            }

            if (!ephemerisResult.rows || ephemerisResult.rows.length === 0) {
                console.log(`No ephemeris data available for ${checkDate}`);
                continue;
            }

            const ephemeris = ephemerisResult.rows[0];

            // Generate horoscope to get full risk assessment
            const horoscope = await generateHoroscope(ephemeris, null, teamSettings, null);

            if (!horoscope) {
                console.log(`Could not generate horoscope for ${checkDate}`);
                continue;
            }

            // Check Mars intensity
            const marsIntensity = (ephemeris.mars_ra !== null && ephemeris.mars_ra !== undefined)
                ? Math.abs(ephemeris.mars_ra % 30)
                : 0;

            // Check if this day meets high-risk criteria
            const isHighRiskByMars = marsIntensity > threshold.marsIntensity;
            const isHighRiskByOverall = horoscope.overall_risk_level && threshold.overallRisk.includes(horoscope.overall_risk_level);

            if (isHighRiskByMars || isHighRiskByOverall) {
                // Extract key risk factors
                const keyFactors = extractKeyRiskFactors(horoscope, ephemeris);

                highRiskDays.push({
                    date: checkDate,
                    dateFormatted: moment(checkDate).format('dddd, MMMM D'),
                    daysAway: i,
                    risk_level: horoscope.overall_risk_level,
                    mars_intensity: marsIntensity,
                    key_factors: keyFactors,
                    recommendations: extractRecommendations(horoscope),
                    confidence: calculateConfidence(horoscope),
                    horoscope: horoscope
                });
            }
        } catch (error) {
            console.error(`Error processing date ${checkDate}:`, error);
        }
    }

    return highRiskDays;
}

/**
 * Extract key risk factors from horoscope
 * @param {Object} horoscope - Horoscope object
 * @param {Object} ephemeris - Ephemeris data
 * @returns {Array} Array of risk factor strings
 */
function extractKeyRiskFactors(horoscope, ephemeris) {
    const factors = [];

    if (!horoscope || !horoscope.predictions) {
        return factors;
    }

    // Get high and medium risk predictions
    const riskPredictions = horoscope.predictions.filter(p =>
        p.level === 'high' || p.level === 'medium'
    );

    // Extract unique planets and their impacts
    const planetImpacts = {};
    riskPredictions.forEach(pred => {
        if (pred.planet && !planetImpacts[pred.planet]) {
            planetImpacts[pred.planet] = {
                category: pred.category,
                level: pred.level,
                confidence: pred.confidence
            };
        }
    });

    // Format factors
    Object.keys(planetImpacts).forEach(planet => {
        const impact = planetImpacts[planet];
        const categoryText = formatCategory(impact.category);
        factors.push(`${planet} → ${categoryText} (${impact.level} risk)`);
    });

    return factors;
}

/**
 * Format category name for display
 * @param {string} category - Category key
 * @returns {string} Formatted category name
 */
function formatCategory(category) {
    const categoryMap = {
        'incident_risk': 'Critical Incidents',
        'communication_risk': 'Communication Issues',
        'deployment': 'Deployment Problems',
        'infrastructure': 'Infrastructure Failures',
        'on_call_management': 'On-Call Stress',
        'testing_focus': 'Testing Requirements'
    };
    return categoryMap[category] || category.replace(/_/g, ' ');
}

/**
 * Extract actionable recommendations from horoscope
 * @param {Object} horoscope - Horoscope object
 * @returns {Array} Array of recommendation strings
 */
function extractRecommendations(horoscope) {
    const recommendations = [];

    if (!horoscope || !horoscope.predictions) {
        return ['Monitor systems closely', 'Review incident response procedures'];
    }

    // Check for specific high-risk categories and provide recommendations
    const highRiskPredictions = horoscope.predictions.filter(p => p.level === 'high');

    const hasIncidentRisk = highRiskPredictions.some(p => p.category === 'incident_risk');
    const hasCommunicationRisk = highRiskPredictions.some(p => p.category === 'communication_risk');
    const hasDeploymentRisk = highRiskPredictions.some(p => p.category === 'deployment');

    if (hasIncidentRisk) {
        recommendations.push('Review and test incident response procedures');
        recommendations.push('Ensure monitoring and alerting systems are functioning properly');
        recommendations.push('Have senior engineers available for critical issues');
    }

    if (hasCommunicationRisk) {
        recommendations.push('Double-check all configuration files and environment variables');
        recommendations.push('Ensure clear communication channels between teams');
        recommendations.push('Document all changes thoroughly');
    }

    if (hasDeploymentRisk) {
        recommendations.push('Consider postponing non-critical deployments');
        recommendations.push('Implement extra validation steps in deployment pipeline');
        recommendations.push('Have rollback plans ready');
    }

    // If no specific recommendations, add general ones
    if (recommendations.length === 0) {
        recommendations.push('Maintain heightened vigilance');
        recommendations.push('Review monitoring dashboards regularly');
        recommendations.push('Ensure team has adequate support coverage');
    }

    return recommendations.slice(0, 5); // Limit to 5 recommendations
}

/**
 * Calculate confidence score from horoscope predictions
 * @param {Object} horoscope - Horoscope object
 * @returns {number} Confidence score (0-1)
 */
function calculateConfidence(horoscope) {
    if (!horoscope || !horoscope.predictions || horoscope.predictions.length === 0) {
        return 0.5;
    }

    const riskPredictions = horoscope.predictions.filter(p =>
        p.level === 'high' || p.level === 'medium'
    );

    if (riskPredictions.length === 0) {
        return 0.5;
    }

    const avgConfidence = riskPredictions.reduce((sum, p) => sum + (p.confidence || 0.5), 0) / riskPredictions.length;
    return Math.round(avgConfidence * 100) / 100;
}

/**
 * Format high-risk alert message for Slack with rich blocks
 * @param {Array} highRiskDays - Array of high-risk day objects
 * @param {Object} teamSettings - Team configuration
 * @returns {Object} Slack message with blocks
 */
function formatHighRiskAlertMessage(highRiskDays, teamSettings) {
    // Validate input
    if (!highRiskDays || highRiskDays.length === 0) {
        return {
            text: 'No high-risk days detected',
            blocks: [{
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '✅ No high-risk days detected in the next 7 days'
                }
            }]
        };
    }

    const languageTone = teamSettings?.language_tone || 'Cosmic';

    // Determine greeting based on tone
    let greeting = '🔮 *Planetary High-Risk Alert*';
    if (languageTone === 'Technical') {
        greeting = '⚠️ *High-Risk Period Detected*';
    } else if (languageTone === 'Casual') {
        greeting = '⚠️ *Heads Up: High-Risk Days Ahead*';
    }

    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: greeting.replace(/\*/g, ''),
                emoji: true
            }
        }
    ];

    // Add summary
    const summary = createAlertSummary(highRiskDays, languageTone);
    blocks.push({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: summary
        }
    });

    blocks.push({ type: 'divider' });

    // Add details for each high-risk day (limit to 3 most critical)
    const topRiskDays = highRiskDays
        .sort((a, b) => {
            const riskOrder = { 'high': 3, 'medium': 2, 'normal': 1 };
            return (riskOrder[b.risk_level] || 0) - (riskOrder[a.risk_level] || 0);
        })
        .slice(0, 3);

    topRiskDays.forEach((day, index) => {
        const riskEmoji = day.risk_level === 'high' ? '🔴' : '🟡';

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${riskEmoji} ${day.dateFormatted}* (${day.daysAway} ${day.daysAway === 1 ? 'day' : 'days'} away)\n*Risk Level:* ${day.risk_level.toUpperCase()} | *Confidence:* ${Math.round(day.confidence * 100)}%`
            }
        });

        // Add key factors
        if (day.key_factors && day.key_factors.length > 0) {
            const factorsText = day.key_factors.map(f => `• ${f}`).join('\n');
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Key Risk Factors:*\n${factorsText}`
                }
            });
        }

        // Add recommendations
        if (day.recommendations && day.recommendations.length > 0) {
            const recsText = day.recommendations.slice(0, 3).map(r => `✓ ${r}`).join('\n');
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*Recommendations:*\n${recsText}`
                }
            });
        }

        if (index < topRiskDays.length - 1) {
            blocks.push({ type: 'divider' });
        }
    });

    // Add footer with configuration info
    blocks.push({
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: `⚙️ Alert sensitivity: *${teamSettings?.alert_sensitivity || 'medium'}* | Configure alerts at your team portal`
            }
        ]
    });

    return {
        text: `High-Risk Alert: ${highRiskDays.length} high-risk ${highRiskDays.length === 1 ? 'day' : 'days'} detected in the next 7 days`,
        blocks
    };
}

/**
 * Create alert summary based on language tone
 * @param {Array} highRiskDays - Array of high-risk days
 * @param {string} languageTone - Language tone setting
 * @returns {string} Summary text
 */
function createAlertSummary(highRiskDays, languageTone) {
    const count = highRiskDays.length;
    const dayWord = count === 1 ? 'day' : 'days';

    if (languageTone === 'Technical') {
        return `Our predictive models have identified *${count} high-risk ${dayWord}* in the upcoming 7-day window. These periods show elevated incident probability based on system risk indicators.`;
    } else if (languageTone === 'Casual') {
        return `Looks like we've got *${count} high-risk ${dayWord}* coming up in the next week. Time to prep the team and get ready for potential bumps in the road!`;
    } else {
        return `The cosmic alignment reveals *${count} high-risk ${dayWord}* approaching in the next 7 days. The planetary forces suggest heightened vigilance and preparation will serve your team well.`;
    }
}

/**
 * Send high-risk alert to team's Slack channel
 * @param {Object} app - Slack Bolt app instance
 * @param {Object} team - Team configuration object
 * @param {Array} highRiskDays - Array of high-risk days
 * @returns {Promise<boolean>} True if sent successfully
 */
async function sendHighRiskAlert(app, team, highRiskDays) {
    try {
        if (!team || !team.slack_alert_enabled) {
            console.log(`Alerts disabled for team ${team?.name || 'unknown'}`);
            return false;
        }

        if (!highRiskDays || highRiskDays.length === 0) {
            console.log(`No high-risk days to alert for team ${team.name}`);
            return false;
        }

        // Get linked Slack workspace for this team
        const workspaceResult = await db.query(
            'SELECT * FROM slack_workspaces WHERE app_team_id = $1 AND is_active = true LIMIT 1',
            [team.id]
        );

        if (!workspaceResult.rows || workspaceResult.rows.length === 0) {
            console.log(`No active Slack workspace found for team ${team.name}`);
            return false;
        }

        const workspace = workspaceResult.rows[0];
        const alertChannel = team.slack_alert_channel || '#horoscope-alerts';

        // Format alert message
        const message = formatHighRiskAlertMessage(highRiskDays, team);

        // Send to Slack
        await app.client.chat.postMessage({
            token: workspace.bot_token,
            channel: alertChannel,
            ...message
        });

        // Log the alert
        const highRiskDatesStr = highRiskDays.map(d => d.date).join(',');
        await db.query(
            `INSERT INTO slack_high_risk_alerts_log (team_id, alert_date, high_risk_dates)
             VALUES ($1, CURRENT_DATE, $2)
             ON CONFLICT (team_id, alert_date) DO UPDATE SET
                high_risk_dates = EXCLUDED.high_risk_dates,
                sent_at = NOW()`,
            [team.id, highRiskDatesStr]
        );

        console.log(`✅ Sent high-risk alert to ${team.name} (${alertChannel}): ${highRiskDays.length} days`);
        return true;
    } catch (error) {
        console.error(`Error sending high-risk alert to team ${team?.name}:`, error);
        return false;
    }
}

/**
 * Check and send high-risk alerts for all teams
 * @param {Object} app - Slack Bolt app instance
 * @returns {Promise<Object>} Summary of alerts sent
 */
async function checkAndSendHighRiskAlerts(app) {
    console.log('🔍 Checking for high-risk days across all teams...');

    const summary = {
        teamsChecked: 0,
        alertsSent: 0,
        errors: 0
    };

    try {
        // Get all teams with alerts enabled
        const teamsResult = await db.query(
            'SELECT * FROM teams WHERE slack_alert_enabled = true'
        );

        if (!teamsResult.rows || teamsResult.rows.length === 0) {
            console.log('No teams with alerts enabled');
            return summary;
        }

        for (const team of teamsResult.rows) {
            summary.teamsChecked++;

            try {
                // Check if we already sent an alert today
                const today = moment().format('YYYY-MM-DD');
                const logResult = await db.query(
                    'SELECT * FROM slack_high_risk_alerts_log WHERE team_id = $1 AND alert_date = $2',
                    [team.id, today]
                );

                if (logResult.rows && logResult.rows.length > 0) {
                    console.log(`Already sent alert today for team ${team.name}`);
                    continue;
                }

                // Calculate 7-day forecast
                const highRiskDays = await calculate7DayRiskForecast(team);

                // Send alert if high-risk days found
                if (highRiskDays && highRiskDays.length > 0) {
                    const sent = await sendHighRiskAlert(app, team, highRiskDays);
                    if (sent) {
                        summary.alertsSent++;
                    }
                } else {
                    console.log(`No high-risk days found for team ${team.name}`);
                }
            } catch (error) {
                console.error(`Error processing team ${team.name}:`, error);
                summary.errors++;
            }
        }

        console.log(`✅ High-risk alert check complete: ${summary.alertsSent} alerts sent to ${summary.teamsChecked} teams`);
        return summary;
    } catch (error) {
        console.error('Error in checkAndSendHighRiskAlerts:', error);
        summary.errors++;
        return summary;
    }
}

module.exports = {
    calculate7DayRiskForecast,
    formatHighRiskAlertMessage,
    sendHighRiskAlert,
    checkAndSendHighRiskAlerts
};
