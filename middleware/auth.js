/**
 * Authentication middleware for API routes
 *
 * Security implementation for protecting sensitive endpoints.
 * Checks for API key in request headers or allows bypass in development mode.
 */

/**
 * Middleware to authenticate API requests
 *
 * Authentication methods (in order of precedence):
 * 1. API Key via X-API-Key header (if API_KEY env variable is set)
 * 2. Development mode bypass (if NODE_ENV !== 'production')
 *
 * Usage:
 *   const { requireAuth } = require('../middleware/auth');
 *   router.post('/protected-route', requireAuth, (req, res) => { ... });
 */
function requireAuth(req, res, next) {
    // In development mode, allow access without authentication
    // TODO: Remove or restrict this in production deployments
    if (process.env.NODE_ENV !== 'production') {
        return next();
    }

    // Check for API key in environment
    const configuredApiKey = process.env.API_KEY;

    if (!configuredApiKey) {
        // In production, API_KEY must be configured
        console.error('❌ CRITICAL: No API_KEY configured in production environment');
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'API authentication is not properly configured'
        });
    }

    // Extract API key from request headers
    const providedApiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!providedApiKey) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'API key required. Provide X-API-Key header or Authorization: Bearer <key>'
        });
    }

    // Validate API key
    if (providedApiKey !== configuredApiKey) {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid API key'
        });
    }

    // Authentication successful
    next();
}

/**
 * Middleware to verify team access authorization
 * Checks that the authenticated user has permission to access the specified team
 *
 * Prerequisites: Must be used after requireAuth middleware
 *
 * Usage:
 *   router.get('/team/:team_id/data', requireAuth, requireTeamAccess, (req, res) => { ... });
 *
 * ⚠️ SECURITY WARNING: INCOMPLETE TEAM ISOLATION
 *
 * Current implementation ONLY verifies that the team exists in the database.
 * It does NOT verify that the authenticated API key or user has permission
 * to access the requested team.
 *
 * SECURITY IMPLICATIONS:
 * - Any valid API key can access data from ANY team
 * - No team-level access control is enforced
 * - Team data isolation is NOT maintained
 *
 * This middleware should be used with caution and is NOT suitable for
 * production environments requiring strict team isolation.
 *
 * RECOMMENDED ALTERNATIVES until proper authorization is implemented:
 * - Use separate API keys per team
 * - Implement team-based API key mapping in database
 * - Add user/session management with team membership verification
 *
 * TODO: Implement proper team-based authorization:
 *   1. Add API key to team membership mapping in database
 *   2. Verify authenticated API key has access to requested team
 *   3. Implement role-based permissions for different actions
 */
async function requireTeamAccess(req, res, next) {
    const { team_id } = req.params;

    if (!team_id) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'team_id parameter required'
        });
    }

    try {
        // Verify team exists in database
        const db = require('../config/database');
        const result = await db.query('SELECT id FROM teams WHERE id = $1', [team_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Team not found'
            });
        }

        // ⚠️ SECURITY GAP: This only checks team existence, not access permissions
        // Any authenticated API key can access this team's data
        next();
    } catch (error) {
        console.error('Error verifying team access:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to verify team access'
        });
    }
}

module.exports = {
    requireAuth,
    requireTeamAccess
};
