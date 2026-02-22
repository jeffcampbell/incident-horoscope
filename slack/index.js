const { app, receiver } = require('./bot');
const { registerHandlers } = require('./handlers');
const { scheduleDailyHoroscopeMessages, initializeSchedulerTables } = require('./scheduler');

// Initialize Slack integration
async function initializeSlack() {
    try {
        // Initialize scheduler tables
        await initializeSchedulerTables();

        // Register command and interaction handlers
        registerHandlers(app);

        // Start daily horoscope scheduler
        scheduleDailyHoroscopeMessages(app);

        console.log('✅ Slack integration initialized successfully');
    } catch (error) {
        console.error('❌ Error initializing Slack integration:', error);
    }
}

module.exports = {
    app,
    receiver,
    initializeSlack
};
