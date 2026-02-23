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
        // No API key configured - log warning but allow in production
        // This maintains backward compatibility but should be addressed
        console.warn('⚠️  WARNING: No API_KEY configured. API endpoints are unprotected.');
        console.warn('   Set API_KEY environment variable to secure your endpoints.');
        return next();
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
 * TODO: Implement proper team-based authorization when user/session management is added
 * Currently this is a placeholder that allows all authenticated requests
 */
function requireTeamAccess(req, res, next) {
    // TODO: Implement team-based authorization
    // For now, if authenticated, allow access to any team
    // Future: Check user's team membership, role-based permissions, etc.
    const { team_id } = req.params;

    if (!team_id) {
        return res.status(400).json({
            error: 'Bad Request',
            message: 'team_id parameter required'
        });
    }

    // Placeholder - allow all authenticated requests
    // TODO: Query database to verify user has access to this team
    next();
}

module.exports = {
    requireAuth,
    requireTeamAccess
};
