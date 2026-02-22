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

            // Get all active channel configurations
            const result = await db.query(`
                SELECT scc.*, sw.team_id, sw.bot_token
                FROM slack_channel_configs scc
                JOIN slack_workspaces sw ON scc.workspace_id = sw.id
                WHERE scc.daily_horoscope_enabled = true AND sw.is_active = true
            `);

            for (const config of result.rows) {
                try {
                    // Get current time in the channel's timezone
                    const now = moment.tz(config.timezone);
                    const scheduledTime = moment.tz(config.daily_horoscope_time, 'HH:mm:ss', config.timezone);

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
        const horoscopeData = await fetchHoroscopeData(date);

        if (!horoscopeData) {
            console.log(`No horoscope data available for ${date}`);
            return;
        }

        // Get accuracy stats
        const accuracyStats = await getAccuracyStats(config.workspace_id);

        // Format message
        const message = formatHoroscopeMessage(horoscopeData, accuracyStats);

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

// Create the log table if it doesn't exist
async function initializeSchedulerTables() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS slack_daily_horoscope_log (
                id SERIAL PRIMARY KEY,
                workspace_id INTEGER NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,
                channel_id VARCHAR(255) NOT NULL,
                sent_date DATE NOT NULL,
                sent_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(workspace_id, channel_id, sent_date)
            );
        `);

        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_slack_daily_horoscope_log_workspace
            ON slack_daily_horoscope_log(workspace_id, sent_date);
        `);

        console.log('✅ Scheduler tables initialized');
    } catch (error) {
        console.error('Error initializing scheduler tables:', error);
    }
}

module.exports = {
    scheduleDailyHoroscopeMessages,
    initializeSchedulerTables
};
