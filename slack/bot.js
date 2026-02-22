const { App, ExpressReceiver } = require('@slack/bolt');
const db = require('../config/database');

/**
 * Slack Bot Configuration
 *
 * This bot supports two modes:
 *
 * 1. SINGLE-WORKSPACE MODE (Development):
 *    - Set SLACK_BOT_TOKEN environment variable
 *    - Bot connects to a single workspace
 *    - No OAuth flow required
 *    - Simpler for local development and testing
 *
 * 2. MULTI-WORKSPACE MODE (Production):
 *    - Do NOT set SLACK_BOT_TOKEN
 *    - Uses OAuth flow with installationStore
 *    - Supports multiple workspace installations
 *    - Tokens stored in database
 *    - Requires SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET
 */

// Determine mode based on SLACK_BOT_TOKEN presence
const isSingleWorkspaceMode = !!process.env.SLACK_BOT_TOKEN;

// Create Express receiver to integrate with existing Express app
const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    stateSecret: process.env.SLACK_STATE_SECRET,
    scopes: ['chat:write', 'commands', 'app_mentions:read'],
    installationStore: {
        storeInstallation: async (installation) => {
            // Store installation in database
            if (installation.isEnterpriseInstall && installation.enterprise !== undefined) {
                // Handle enterprise installation
                await db.query(
                    `INSERT INTO slack_workspaces (team_id, enterprise_id, team_name, bot_token, bot_user_id, scope, authed_user_id)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (team_id) DO UPDATE SET
                        enterprise_id = EXCLUDED.enterprise_id,
                        team_name = EXCLUDED.team_name,
                        bot_token = EXCLUDED.bot_token,
                        bot_user_id = EXCLUDED.bot_user_id,
                        scope = EXCLUDED.scope,
                        authed_user_id = EXCLUDED.authed_user_id,
                        updated_at = NOW()`,
                    [
                        installation.team.id,
                        installation.enterprise.id,
                        installation.team.name,
                        installation.bot.token,
                        installation.bot.userId,
                        installation.bot.scopes.join(','),
                        installation.user.id
                    ]
                );
            } else {
                // Handle normal workspace installation
                await db.query(
                    `INSERT INTO slack_workspaces (team_id, team_name, bot_token, bot_user_id, scope, authed_user_id)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (team_id) DO UPDATE SET
                        team_name = EXCLUDED.team_name,
                        bot_token = EXCLUDED.bot_token,
                        bot_user_id = EXCLUDED.bot_user_id,
                        scope = EXCLUDED.scope,
                        authed_user_id = EXCLUDED.authed_user_id,
                        updated_at = NOW()`,
                    [
                        installation.team.id,
                        installation.team.name,
                        installation.bot.token,
                        installation.bot.userId,
                        installation.bot.scopes.join(','),
                        installation.user.id
                    ]
                );
            }
            console.log('✅ Slack workspace installed:', installation.team.name);
        },
        fetchInstallation: async (installQuery) => {
            // Fetch installation from database
            const result = await db.query(
                'SELECT * FROM slack_workspaces WHERE team_id = $1 AND is_active = true',
                [installQuery.teamId]
            );

            if (result.rows.length === 0) {
                throw new Error('No installation found for this team');
            }

            const workspace = result.rows[0];

            // Return installation in the format Bolt expects
            return {
                team: {
                    id: workspace.team_id,
                    name: workspace.team_name
                },
                enterprise: workspace.enterprise_id ? {
                    id: workspace.enterprise_id
                } : undefined,
                bot: {
                    token: workspace.bot_token,
                    userId: workspace.bot_user_id,
                    scopes: workspace.scope ? workspace.scope.split(',') : []
                },
                user: {
                    id: workspace.authed_user_id
                }
            };
        },
        deleteInstallation: async (installQuery) => {
            // Soft delete by marking as inactive
            await db.query(
                'UPDATE slack_workspaces SET is_active = false, updated_at = NOW() WHERE team_id = $1',
                [installQuery.teamId]
            );
            console.log('✅ Slack workspace uninstalled:', installQuery.teamId);
        }
    }
});

// Create Slack Bolt app
// In single-workspace mode, provide token directly
// In multi-workspace mode, token comes from installationStore
const app = new App({
    receiver,
    token: isSingleWorkspaceMode ? process.env.SLACK_BOT_TOKEN : undefined
});

if (isSingleWorkspaceMode) {
    console.log('🔧 Slack bot running in SINGLE-WORKSPACE mode (development)');
} else {
    console.log('🚀 Slack bot running in MULTI-WORKSPACE mode (production with OAuth)');
}

// Helper function to get workspace from database
async function getWorkspace(teamId) {
    const result = await db.query(
        'SELECT * FROM slack_workspaces WHERE team_id = $1 AND is_active = true',
        [teamId]
    );
    return result.rows[0];
}

// Helper function to get or create team_id mapping
async function getOrCreateTeamId(workspaceId) {
    // For now, we use workspace database ID as team_id
    // This ensures data isolation between Slack workspaces
    return workspaceId;
}

module.exports = {
    app,
    receiver,
    getWorkspace,
    getOrCreateTeamId
};
