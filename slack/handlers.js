const moment = require('moment');
const db = require('../config/database');
const {
    fetchHoroscopeData,
    getRecentIncidents,
    getAccuracyStats,
    formatHoroscopeMessage
} = require('./commands');
const { getWorkspace, getOrCreateTeamId } = require('./bot');

// Register all Slack command and interaction handlers
function registerHandlers(app) {
    // /horoscope command - Get today's horoscope
    app.command('/horoscope', async ({ command, ack, respond, client }) => {
        await ack();

        try {
            const workspace = await getWorkspace(command.team_id);
            if (!workspace) {
                await respond({
                    text: 'Workspace not found. Please reinstall the app.',
                    response_type: 'ephemeral'
                });
                return;
            }

            // Parse command text for date (default to today)
            const dateText = command.text.trim();
            const date = dateText ? moment(dateText, 'YYYY-MM-DD').format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');

            if (!moment(date, 'YYYY-MM-DD', true).isValid()) {
                await respond({
                    text: 'Invalid date format. Please use YYYY-MM-DD or leave empty for today.',
                    response_type: 'ephemeral'
                });
                return;
            }

            // Fetch horoscope data
            const horoscopeData = await fetchHoroscopeData(date);
            if (!horoscopeData) {
                await respond({
                    text: 'Unable to fetch horoscope data. Please try again later.',
                    response_type: 'ephemeral'
                });
                return;
            }

            // Get accuracy stats
            const accuracyStats = await getAccuracyStats(workspace.id);

            // Format and send message
            const message = formatHoroscopeMessage(horoscopeData, accuracyStats);
            await respond({
                ...message,
                response_type: 'in_channel'
            });

        } catch (error) {
            console.error('Error handling /horoscope command:', error);
            await respond({
                text: 'An error occurred while fetching the horoscope. Please try again.',
                response_type: 'ephemeral'
            });
        }
    });

    // /log-incident command - Log an incident from Slack
    app.command('/log-incident', async ({ command, ack, respond, client }) => {
        await ack();

        try {
            const workspace = await getWorkspace(command.team_id);
            if (!workspace) {
                await respond({
                    text: 'Workspace not found. Please reinstall the app.',
                    response_type: 'ephemeral'
                });
                return;
            }

            // Open modal for incident logging
            await client.views.open({
                trigger_id: command.trigger_id,
                view: {
                    type: 'modal',
                    callback_id: 'log_incident_modal',
                    title: {
                        type: 'plain_text',
                        text: 'Log Incident'
                    },
                    submit: {
                        type: 'plain_text',
                        text: 'Submit'
                    },
                    close: {
                        type: 'plain_text',
                        text: 'Cancel'
                    },
                    blocks: [
                        {
                            type: 'input',
                            block_id: 'date_block',
                            element: {
                                type: 'datepicker',
                                action_id: 'incident_date',
                                initial_date: moment().format('YYYY-MM-DD'),
                                placeholder: {
                                    type: 'plain_text',
                                    text: 'Select incident date'
                                }
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Incident Date'
                            }
                        },
                        {
                            type: 'input',
                            block_id: 'severity_block',
                            element: {
                                type: 'static_select',
                                action_id: 'severity',
                                options: [
                                    { text: { type: 'plain_text', text: 'Low' }, value: 'low' },
                                    { text: { type: 'plain_text', text: 'Medium' }, value: 'medium' },
                                    { text: { type: 'plain_text', text: 'High' }, value: 'high' },
                                    { text: { type: 'plain_text', text: 'Critical' }, value: 'critical' }
                                ],
                                initial_option: { text: { type: 'plain_text', text: 'Medium' }, value: 'medium' }
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Severity'
                            }
                        },
                        {
                            type: 'input',
                            block_id: 'category_block',
                            element: {
                                type: 'static_select',
                                action_id: 'category',
                                options: [
                                    { text: { type: 'plain_text', text: 'Deployment' }, value: 'deployment' },
                                    { text: { type: 'plain_text', text: 'Infrastructure' }, value: 'infrastructure' },
                                    { text: { type: 'plain_text', text: 'Communication' }, value: 'communication' },
                                    { text: { type: 'plain_text', text: 'Monitoring' }, value: 'monitoring' },
                                    { text: { type: 'plain_text', text: 'Other' }, value: 'other' }
                                ]
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Category'
                            }
                        },
                        {
                            type: 'input',
                            block_id: 'duration_block',
                            element: {
                                type: 'number_input',
                                action_id: 'duration',
                                is_decimal_allowed: false,
                                min_value: '0',
                                placeholder: {
                                    type: 'plain_text',
                                    text: 'Duration in minutes'
                                }
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Duration (minutes)'
                            },
                            optional: true
                        },
                        {
                            type: 'input',
                            block_id: 'description_block',
                            element: {
                                type: 'plain_text_input',
                                action_id: 'description',
                                multiline: true,
                                placeholder: {
                                    type: 'plain_text',
                                    text: 'Describe the incident...'
                                }
                            },
                            label: {
                                type: 'plain_text',
                                text: 'Description'
                            }
                        }
                    ],
                    private_metadata: JSON.stringify({ workspace_id: workspace.id, team_id: command.team_id })
                }
            });

        } catch (error) {
            console.error('Error handling /log-incident command:', error);
            await respond({
                text: 'An error occurred while opening the incident form. Please try again.',
                response_type: 'ephemeral'
            });
        }
    });

    // Handle incident logging modal submission
    app.view('log_incident_modal', async ({ ack, body, view, client }) => {
        await ack();

        try {
            const metadata = JSON.parse(view.private_metadata);
            const values = view.state.values;

            const incidentData = {
                date: values.date_block.incident_date.selected_date,
                severity: values.severity_block.severity.selected_option.value,
                category: values.category_block.category.selected_option.value,
                duration_minutes: values.duration_block.duration.value || null,
                description: values.description_block.description.value,
                slack_workspace_id: metadata.workspace_id
            };

            // Insert incident into database
            const result = await db.query(
                `INSERT INTO incidents (date, severity, category, duration_minutes, description, slack_workspace_id)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [
                    incidentData.date,
                    incidentData.severity,
                    incidentData.category,
                    incidentData.duration_minutes,
                    incidentData.description,
                    incidentData.slack_workspace_id
                ]
            );

            const incident = result.rows[0];

            // Get validation data
            const validationResult = await db.query(
                `SELECT * FROM ephemeris_data WHERE date = $1`,
                [incidentData.date]
            );

            let validationMessage = '';
            if (validationResult.rows.length > 0) {
                const ephemeris = validationResult.rows[0];
                const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
                let predictedRisk = 'normal';

                if (marsIntensity > 27) {
                    predictedRisk = 'high';
                } else if (marsIntensity > 20) {
                    predictedRisk = 'medium';
                }

                validationMessage = `\n\n🔮 *Cosmic Validation*: The horoscope predicted *${predictedRisk}* risk for this day.`;
            }

            // Send confirmation message to the user
            await client.chat.postMessage({
                channel: body.user.id,
                text: `Incident logged successfully! ${validationMessage}`,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `✅ *Incident Logged Successfully*\n\n*Date:* ${moment(incident.date).format('MMMM D, YYYY')}\n*Severity:* ${incident.severity.toUpperCase()}\n*Category:* ${incident.category}\n*Description:* ${incident.description}${validationMessage}`
                        }
                    }
                ]
            });

        } catch (error) {
            console.error('Error logging incident:', error);
        }
    });

    // /schedule command - Register on-call engineers
    app.command('/schedule', async ({ command, ack, respond, client }) => {
        await ack();

        try {
            const workspace = await getWorkspace(command.team_id);
            if (!workspace) {
                await respond({
                    text: 'Workspace not found. Please reinstall the app.',
                    response_type: 'ephemeral'
                });
                return;
            }

            // Parse command: /schedule @user start_date end_date
            const parts = command.text.trim().split(/\s+/);

            if (parts.length < 2) {
                await respond({
                    text: 'Usage: `/schedule @user YYYY-MM-DD [YYYY-MM-DD]`\nExample: `/schedule @john 2026-03-01 2026-03-07`',
                    response_type: 'ephemeral'
                });
                return;
            }

            const userMention = parts[0];
            const startDate = parts[1];
            const endDate = parts[2] || null;

            // Extract user ID from mention
            const userIdMatch = userMention.match(/<@(\w+)>/);
            if (!userIdMatch) {
                await respond({
                    text: 'Please mention a user with @username',
                    response_type: 'ephemeral'
                });
                return;
            }

            const userId = userIdMatch[1];

            // Get user info
            const userInfo = await client.users.info({ user: userId });
            const userName = userInfo.user.real_name || userInfo.user.name;

            // Insert on-call schedule
            const result = await db.query(
                `INSERT INTO slack_on_call_schedule (workspace_id, slack_user_id, slack_user_name, start_date, end_date, is_current)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [workspace.id, userId, userName, startDate, endDate, true]
            );

            const schedule = result.rows[0];

            await respond({
                text: `✅ On-call schedule registered for ${userName}`,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `✅ *On-Call Schedule Registered*\n\n*Engineer:* <@${userId}>\n*Start Date:* ${moment(startDate).format('MMMM D, YYYY')}\n*End Date:* ${endDate ? moment(endDate).format('MMMM D, YYYY') : 'Ongoing'}\n\nUse \`/horoscope\` to get personalized on-call predictions!`
                        }
                    }
                ],
                response_type: 'in_channel'
            });

        } catch (error) {
            console.error('Error handling /schedule command:', error);
            await respond({
                text: 'An error occurred while registering the schedule. Please try again.',
                response_type: 'ephemeral'
            });
        }
    });

    // Interactive button handlers
    app.action('show_deployment_forecast', async ({ action, ack, respond, body }) => {
        await ack();

        try {
            const date = action.value;
            const horoscopeData = await fetchHoroscopeData(date);

            if (!horoscopeData || !horoscopeData.horoscope || !horoscopeData.horoscope.developer_insights) {
                await respond({
                    text: 'Deployment forecast not available.',
                    response_type: 'ephemeral',
                    replace_original: false
                });
                return;
            }

            const forecast = horoscopeData.horoscope.developer_insights.deployment_forecast;
            const outlookEmoji = {
                'favorable': '✅',
                'challenging': '⚠️',
                'mixed': '🟡',
                'neutral': '➖'
            };

            await respond({
                text: 'Deployment Forecast',
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: `🚀 Deployment Forecast for ${moment(date).format('MMMM D')}`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Outlook:* ${outlookEmoji[forecast.overall_outlook]} ${forecast.overall_outlook.toUpperCase()}\n*Confidence:* ${Math.round(forecast.confidence * 100)}%`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Cosmic Message*\n${forecast.cosmic_message}`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Recommendations*\n${forecast.recommendations.map(r => `• ${r}`).join('\n')}`
                        }
                    }
                ],
                response_type: 'ephemeral',
                replace_original: false
            });

        } catch (error) {
            console.error('Error showing deployment forecast:', error);
            await respond({
                text: 'Error loading deployment forecast.',
                response_type: 'ephemeral',
                replace_original: false
            });
        }
    });

    app.action('show_oncall_insights', async ({ action, ack, respond, body }) => {
        await ack();

        try {
            const date = action.value;
            const horoscopeData = await fetchHoroscopeData(date);

            if (!horoscopeData || !horoscopeData.horoscope || !horoscopeData.horoscope.developer_insights) {
                await respond({
                    text: 'On-call insights not available.',
                    response_type: 'ephemeral',
                    replace_original: false
                });
                return;
            }

            const forecast = horoscopeData.horoscope.developer_insights.oncall_forecast;
            const outlookEmoji = {
                'favorable': '✅',
                'challenging': '⚠️',
                'mixed': '🟡',
                'neutral': '➖'
            };

            // Get recent incidents for context
            const workspace = await getWorkspace(body.team.id);
            const recentIncidents = await getRecentIncidents(workspace.id, 3);

            let incidentsText = '';
            if (recentIncidents.length > 0) {
                incidentsText = '\n\n*Recent Incidents*\n' +
                    recentIncidents.map(inc =>
                        `• ${moment(inc.date).format('MMM D')}: ${inc.severity.toUpperCase()} - ${inc.description.substring(0, 50)}...`
                    ).join('\n');
            }

            await respond({
                text: 'On-Call Insights',
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: `👨‍💻 On-Call Insights for ${moment(date).format('MMMM D')}`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Outlook:* ${outlookEmoji[forecast.overall_outlook]} ${forecast.overall_outlook.toUpperCase()}\n*Confidence:* ${Math.round(forecast.confidence * 100)}%`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Cosmic Message*\n${forecast.cosmic_message}`
                        }
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*Recommendations*\n${forecast.recommendations.map(r => `• ${r}`).join('\n')}${incidentsText}`
                        }
                    }
                ],
                response_type: 'ephemeral',
                replace_original: false
            });

        } catch (error) {
            console.error('Error showing on-call insights:', error);
            await respond({
                text: 'Error loading on-call insights.',
                response_type: 'ephemeral',
                replace_original: false
            });
        }
    });

    app.action('show_planetary_positions', async ({ action, ack, respond }) => {
        await ack();

        try {
            const date = action.value;
            const horoscopeData = await fetchHoroscopeData(date);

            if (!horoscopeData || !horoscopeData.horoscope) {
                await respond({
                    text: 'Planetary positions not available.',
                    response_type: 'ephemeral',
                    replace_original: false
                });
                return;
            }

            const planetarySummary = horoscopeData.horoscope.planetary_summary;

            await respond({
                text: 'Planetary Positions',
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: `🌍 Planetary Positions for ${moment(date).format('MMMM D')}`
                        }
                    },
                    ...planetarySummary.map(planet => ({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `*${planet.symbol} ${planet.name}* in ${planet.sign}\n_${planet.domain}_ • Influence: ${planet.influence_strength}`
                        }
                    }))
                ],
                response_type: 'ephemeral',
                replace_original: false
            });

        } catch (error) {
            console.error('Error showing planetary positions:', error);
            await respond({
                text: 'Error loading planetary positions.',
                response_type: 'ephemeral',
                replace_original: false
            });
        }
    });

    console.log('✅ Slack command handlers registered');
}

module.exports = { registerHandlers };
