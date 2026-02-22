# Slack Integration for Planetary Horoscope

This directory contains the Slack integration for the Planetary Horoscope application. It enables SRE teams to receive daily cosmic predictions directly in Slack.

## Features

### 1. Slash Commands

- **`/horoscope [date]`** - Get today's horoscope (or specify a date in YYYY-MM-DD format)
- **`/log-incident`** - Open a modal to log an incident from Slack
- **`/schedule @user start_date [end_date]`** - Register on-call engineers for personalized horoscopes

### 2. Daily Scheduled Messages

- Automatically post daily horoscopes to configured channels
- Customizable time and timezone per channel
- Default: 9 AM in the team's timezone

### 3. Interactive Messages

Horoscope messages include interactive buttons to expand:
- 🚀 Deployment Forecast
- 👨‍💻 On-Call Insights
- 🌍 Planetary Positions

### 4. Incident Validation

When incidents are logged via Slack:
- They're stored in the application database
- Linked to the specific Slack workspace for team data isolation
- Validated against horoscope predictions
- Accuracy stats are shown in horoscope messages

### 5. Team Data Isolation

Each Slack workspace has its own:
- Incident history
- On-call schedules
- Channel configurations
- Accuracy statistics

## Setup

### Prerequisites

1. A Slack workspace where you have permission to install apps
2. Access to create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)

### Step 1: Create Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click "Create New App"
2. Choose "From scratch"
3. Name it "Planetary Horoscope" and select your workspace
4. Click "Create App"

### Step 2: Configure OAuth & Permissions

1. Navigate to "OAuth & Permissions" in the sidebar
2. Under "Scopes", add these Bot Token Scopes:
   - `chat:write` - Post messages
   - `commands` - Add slash commands
   - `app_mentions:read` - Listen to mentions
3. Under "Redirect URLs", add:
   - `http://localhost:3000/slack/oauth_redirect` (for development)
   - `https://yourdomain.com/slack/oauth_redirect` (for production)
4. Click "Save URLs"

### Step 3: Configure Slash Commands

Navigate to "Slash Commands" and create these commands:

1. **Command:** `/horoscope`
   - Request URL: `https://yourdomain.com/slack/events`
   - Short Description: "Get today's planetary horoscope"
   - Usage Hint: `[YYYY-MM-DD]`

2. **Command:** `/log-incident`
   - Request URL: `https://yourdomain.com/slack/events`
   - Short Description: "Log an incident for horoscope validation"

3. **Command:** `/schedule`
   - Request URL: `https://yourdomain.com/slack/events`
   - Short Description: "Register on-call engineer schedule"
   - Usage Hint: `@user YYYY-MM-DD [YYYY-MM-DD]`

### Step 4: Enable Interactivity

1. Navigate to "Interactivity & Shortcuts"
2. Turn on Interactivity
3. Set Request URL to: `https://yourdomain.com/slack/events`
4. Click "Save Changes"

### Step 5: Configure Environment Variables

Add these to your `.env` file:

```env
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_CLIENT_ID=your_client_id
SLACK_CLIENT_SECRET=your_client_secret
SLACK_STATE_SECRET=random_string_for_oauth_security
```

You can find these values in your Slack app settings:
- Signing Secret: "Basic Information" → "App Credentials"
- Client ID & Secret: "Basic Information" → "App Credentials"
- State Secret: Generate a random string (e.g., `openssl rand -hex 32`)

### Step 6: Install to Workspace

1. Navigate to "Install App" in the sidebar
2. Click "Install to Workspace"
3. Review permissions and click "Allow"
4. The app is now installed!

## Usage

### Configuring Daily Horoscopes

After installation, you can configure daily horoscopes for specific channels:

```sql
-- Example: Configure daily horoscopes for a channel
INSERT INTO slack_channel_configs (workspace_id, channel_id, channel_name, daily_horoscope_time, timezone)
VALUES (1, 'C01234567', 'general', '09:00:00', 'America/New_York');
```

Or use the Slack API to set it up programmatically.

### Testing Commands

In any Slack channel where the bot is present:

```
/horoscope
/horoscope 2026-03-15
/log-incident
/schedule @john 2026-03-01 2026-03-07
```

## Architecture

### File Structure

- `bot.js` - Slack Bolt app initialization and OAuth handling
- `commands.js` - Helper functions for command processing
- `handlers.js` - Slash command and interaction handlers
- `scheduler.js` - Daily horoscope scheduling logic
- `index.js` - Main entry point that ties everything together

### Database Tables

- `slack_workspaces` - Installed Slack workspaces and OAuth tokens
- `slack_channel_configs` - Channel-specific configurations for daily messages
- `slack_on_call_schedule` - On-call engineer schedules for personalized horoscopes
- `slack_daily_horoscope_log` - Tracks daily messages sent (prevents duplicates)
- `incidents.slack_workspace_id` - Links incidents to specific Slack workspaces

### Data Flow

1. User triggers slash command in Slack
2. Slack sends request to `/slack/events` endpoint
3. Bolt framework routes to appropriate handler
4. Handler fetches/generates horoscope data
5. Response sent back to Slack (ephemeral or in-channel)
6. Interactive buttons allow expanding specific sections

## Rate Limiting

The integration respects NASA Horizons API rate limits by:
- Caching ephemeris data in the database
- Only fetching new data when needed
- Reusing existing horoscope calculations

## Security

- OAuth tokens are stored in the database (encrypt in production!)
- Signing secret validates all incoming requests
- State secret prevents CSRF attacks during OAuth flow
- Team data isolation ensures workspaces can't see each other's data

## Troubleshooting

### Commands not responding

1. Check that Request URLs are correct in Slack app settings
2. Verify your server is accessible from the internet (use ngrok for local dev)
3. Check server logs for errors

### Daily messages not sending

1. Verify channel configuration in `slack_channel_configs` table
2. Check that timezone is correct
3. Look for errors in server logs during scheduled runs

### OAuth flow failing

1. Verify redirect URL matches exactly in Slack app settings
2. Check that all environment variables are set correctly
3. Ensure database is accessible and tables are created

## Future Enhancements

- Slack Workflow Builder integration
- PagerDuty incident auto-logging
- Custom team-specific horoscope rules
- Horoscope reminder threads before predicted high-risk periods
- Admin commands for channel configuration
- Personal DM horoscopes based on birth charts
