const cron = require('node-cron');
const moment = require('moment-timezone');
const db = require('../config/database');
const { fetchHoroscopeData, getAccuracyStats, formatHoroscopeMessage } = require('./commands');

// Schedule daily horoscope messages for all configured channels
function scheduleDailyHoroscopeMessages(app) {
    // Run every hour to check for channels that need daily horoscopes
    // This allows for timezone-specific delivery (e.g., 9 AM in each timezone)
    cron.schedule('0 * * * *', async () => {
        try {
            console.log('🔮 Checking for scheduled daily horoscopes...');

            // Get all active channel configurations with team settings
            const result = await db.query(`
                SELECT scc.*, sw.team_id, sw.bot_token, sw.app_team_id,
                       t.primary_role, t.language_tone, t.timezone as team_timezone,
                       t.delivery_time as team_delivery_time
                FROM slack_channel_configs scc
                JOIN slack_workspaces sw ON scc.workspace_id = sw.id
                LEFT JOIN teams t ON sw.app_team_id = t.id
                WHERE scc.daily_horoscope_enabled = true AND sw.is_active = true
            `);

            for (const config of result.rows) {
                try {
                    // Use team timezone and delivery time if available, otherwise use channel settings
                    const timezone = config.team_timezone || config.timezone;
                    const deliveryTime = config.team_delivery_time || config.daily_horoscope_time;

                    // Get current time in the appropriate timezone
                    const now = moment.tz(timezone);
                    const scheduledTime = moment.tz(deliveryTime, 'HH:mm:ss', timezone);

                    // Check if we're in the right hour to send
                    if (now.hour() === scheduledTime.hour()) {
                        // Check if we already sent today
                        const lastSentCheck = await db.query(
                            `SELECT * FROM slack_daily_horoscope_log
                             WHERE workspace_id = $1 AND channel_id = $2 AND sent_date = $3`,
                            [config.workspace_id, config.channel_id, now.format('YYYY-MM-DD')]
                        );

                        if (lastSentCheck.rows.length === 0) {
                            // Send daily horoscope
                            await sendDailyHoroscope(app, config);

                            // Log that we sent it
                            await db.query(
                                `INSERT INTO slack_daily_horoscope_log (workspace_id, channel_id, sent_date, sent_at)
                                 VALUES ($1, $2, $3, NOW())`,
                                [config.workspace_id, config.channel_id, now.format('YYYY-MM-DD')]
                            );
                        }
                    }
                } catch (error) {
                    console.error(`Error sending daily horoscope to channel ${config.channel_id}:`, error);
                }
            }
        } catch (error) {
            console.error('Error in daily horoscope scheduler:', error);
        }
    });

    console.log('✅ Daily horoscope scheduler initialized');
}

async function sendDailyHoroscope(app, config) {
    try {
        const date = moment().format('YYYY-MM-DD');

        // Fetch horoscope data with team settings if available
        const horoscopeData = await fetchHoroscopeData(
            date,
            config.app_team_id,
            config.primary_role
        );

        if (!horoscopeData) {
            console.log(`No horoscope data available for ${date}`);
            return;
        }

        // Get accuracy stats
        const accuracyStats = await getAccuracyStats(config.workspace_id);

        // Format message with team-specific tone
        const message = formatHoroscopeMessage(
            horoscopeData,
            accuracyStats,
            config.language_tone
        );

        // Add daily greeting
        const greetingBlock = {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '☀️ Good morning! Here\'s your daily planetary horoscope for SRE operations.'
            }
        };

        message.blocks.unshift(greetingBlock);

        // Send to channel
        await app.client.chat.postMessage({
            token: config.bot_token,
            channel: config.channel_id,
            ...message
        });

        console.log(`✅ Sent daily horoscope to channel ${config.channel_id}`);
    } catch (error) {
        console.error('Error sending daily horoscope:', error);
        throw error;
    }
}

module.exports = {
    scheduleDailyHoroscopeMessages
};
