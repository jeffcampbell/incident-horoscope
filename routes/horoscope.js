const express = require('express');
const router = express.Router();
const db = require('../config/database');
const moment = require('moment');

// Generate horoscope for a specific date based on planetary positions
router.get('/', async (req, res) => {
    try {
        const { date, birthday } = req.query;
        
        if (!date) {
            return res.status(400).json({ error: 'Date parameter is required' });
        }
        
        // Get ephemeris data for the requested date
        const ephemerisResult = await db.query(
            'SELECT * FROM ephemeris_data WHERE date = $1',
            [date]
        );
        
        let ephemeris = null;
        if (ephemerisResult.rows.length > 0) {
            ephemeris = ephemerisResult.rows[0];
        } else {
            return res.json({
                date,
                message: 'No ephemeris data available for this date. Please fetch it first.',
                horoscope: null
            });
        }
        
        // Get user's birth chart data if birthday is provided
        let birthChart = null;
        if (birthday) {
            try {
                let birthEphemerisResult = await db.query(
                    'SELECT * FROM ephemeris_data WHERE date = $1',
                    [birthday]
                );
                
                if (birthEphemerisResult.rows.length > 0) {
                    birthChart = birthEphemerisResult.rows[0];
                } else {
                    // If birth chart data doesn't exist, fetch it directly using the ephemeris functions
                    console.log(`📅 Fetching birth chart data for ${birthday}...`);
                    
                    try {
                        // Import the ephemeris fetching functions
                        const { fetchEphemerisForDate, storeEphemerisData } = require('./ephemeris-utils');
                        
                        // Fetch ephemeris data for the birthday
                        const birthEphemerisData = await fetchEphemerisForDate(birthday, 'Birth Chart');
                        
                        // Store it in the database
                        await storeEphemerisData(birthEphemerisData, birthday, 'Birth Chart');
                        
                        // Try to get the data again after storing
                        birthEphemerisResult = await db.query(
                            'SELECT * FROM ephemeris_data WHERE date = $1',
                            [birthday]
                        );
                        
                        if (birthEphemerisResult.rows.length > 0) {
                            birthChart = birthEphemerisResult.rows[0];
                            console.log(`✅ Successfully fetched and stored birth chart data for ${birthday}`);
                        }
                    } catch (fetchError) {
                        console.log(`⚠️ Could not fetch ephemeris data for birthday ${birthday}:`, fetchError.message);
                    }
                }
            } catch (error) {
                console.log('Birth chart data not available, proceeding without personal horoscope:', error.message);
            }
        }
        
        // Generate horoscope based on planetary positions
        const horoscope = await generateHoroscope(ephemeris, birthChart);
        
        res.json({
            date,
            birthday,
            ephemeris,
            horoscope
        });
    } catch (error) {
        console.error('Error generating horoscope:', error);
        res.status(500).json({ error: 'Failed to generate horoscope' });
    }
});

// Get general planetary influences for software teams
router.get('/influences', async (req, res) => {
    try {
        const result = await db.query(`
            SELECT planet, sign, influence_category, influence_description, risk_level, confidence
            FROM planetary_influences
            ORDER BY planet, sign
        `);
        
        res.json({ influences: result.rows });
    } catch (error) {
        console.error('Error fetching planetary influences:', error);
        res.status(500).json({ error: 'Failed to fetch planetary influences' });
    }
});

async function generateHoroscope(ephemeris, birthChart) {
    const predictions = [];
    
    // Mars - Incident Risk and System Conflicts
    const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
    const marsSign = getAstrologicalSign(ephemeris.mars_ra);
    if (marsIntensity > 27) {  // Reduced frequency: was >25, now >27 (10% instead of 17%)
        predictions.push({
            category: 'incident_risk',
            level: 'high',
            message: `Mars in ${marsSign} suggests heightened potential for critical incidents. Infrastructure and security teams should be extra vigilant. Review monitoring systems and incident response procedures.`,
            confidence: 0.75,
            planet: 'Mars'
        });
    } else if (marsIntensity > 20) {  // Was >15, now >20 for more selectivity
        predictions.push({
            category: 'incident_risk',
            level: 'medium',
            message: `Mars energy indicates moderate system tension. Good time to proactively address technical debt and potential failure points.`,
            confidence: 0.6,
            planet: 'Mars'
        });
    } else if (marsIntensity < 5) {  // Add positive Mars condition
        predictions.push({
            category: 'system_stability',
            level: 'positive',
            message: `Mars in ${marsSign} supports system stability and smooth operations. Good day for maintenance and system updates.`,
            confidence: 0.5,
            planet: 'Mars'
        });
    }
    
    // Mercury - Communication and Deployment Issues
    const mercuryPosition = ephemeris.mercury_ra % 360;
    const mercurySign = getAstrologicalSign(ephemeris.mercury_ra);
    if (mercuryPosition > 330 || mercuryPosition < 30) {  // Reduced from 300/60 to 330/30 (17% instead of 33%)
        predictions.push({
            category: 'communication_risk',
            level: 'medium',
            message: `Mercury in ${mercurySign} may cause communication and deployment-related issues. Double-check configurations, review change management processes, and ensure clear team communication.`,
            confidence: 0.65,
            planet: 'Mercury'
        });
    } else if (mercuryPosition > 150 && mercuryPosition < 210) {  // Add positive Mercury condition
        predictions.push({
            category: 'communication_flow',
            level: 'positive',
            message: `Mercury in ${mercurySign} enhances communication clarity and deployment success. Excellent time for releases and system integrations.`,
            confidence: 0.6,
            planet: 'Mercury'
        });
    }
    
    // Venus - Team Collaboration and User Experience
    const venusHarmony = Math.sin(ephemeris.venus_ra * Math.PI / 180);
    const venusSign = getAstrologicalSign(ephemeris.venus_ra);
    if (venusHarmony > 0.5) {
        predictions.push({
            category: 'team_harmony',
            level: 'positive',
            message: `Venus in ${venusSign} favors team collaboration and user satisfaction. Excellent day for cross-team coordination, user experience improvements, and complex deployments.`,
            confidence: 0.55,
            planet: 'Venus'
        });
    }
    
    // Jupiter - Learning and Process Improvements
    const jupiterExpansion = ephemeris.jupiter_distance < 5;
    const jupiterSign = getAstrologicalSign(ephemeris.jupiter_ra);
    if (jupiterExpansion) {
        predictions.push({
            category: 'growth_opportunities',
            level: 'positive',
            message: `Jupiter in ${jupiterSign} creates favorable conditions for implementing process improvements, conducting post-mortems, and expanding system capabilities.`,
            confidence: 0.5,
            planet: 'Jupiter'
        });
    }
    
    // Saturn - Structure, Testing, and Discipline
    const saturnDiscipline = Math.cos(ephemeris.saturn_ra * Math.PI / 180);
    const saturnSign = getAstrologicalSign(ephemeris.saturn_ra);
    if (saturnDiscipline > 0.7) {  // Increased from 0.3 to 0.7 (much more selective)
        predictions.push({
            category: 'testing_focus',
            level: 'medium',
            message: `Saturn in ${saturnSign} emphasizes the importance of thorough testing and structured processes. Focus on code reviews, automated testing, and compliance checks.`,
            confidence: 0.6,
            planet: 'Saturn'
        });
    } else if (saturnDiscipline < -0.5) {  // Add negative Saturn condition
        predictions.push({
            category: 'process_flexibility',
            level: 'positive',
            message: `Saturn in ${saturnSign} supports flexible processes and rapid adaptation. Good time for agile practices and quick iterations.`,
            confidence: 0.5,
            planet: 'Saturn'
        });
    }
    
    // Moon - On-call and Emotional Responses
    const moonPhase = (ephemeris.moon_ra / 15) % 24;
    const moonSign = getAstrologicalSign(ephemeris.moon_ra);
    if (moonPhase < 3 || moonPhase > 21) {  // Reduced from 6/18 to 3/21 (25% instead of 50%)
        predictions.push({
            category: 'on_call_management',
            level: 'medium',
            message: `Moon in ${moonSign} suggests heightened emotional responses to incidents. Ensure adequate on-call coverage and support systems for team well-being.`,
            confidence: 0.7,
            planet: 'Moon'
        });
    } else if (moonPhase > 10 && moonPhase < 14) {  // Add positive Moon condition
        predictions.push({
            category: 'team_wellness',
            level: 'positive',
            message: `Moon in ${moonSign} supports team emotional balance and resilience. Good time for team building and stress management initiatives.`,
            confidence: 0.55,
            planet: 'Moon'
        });
    }
    
    // Sun - Leadership and System Authority
    const sunAuthority = Math.abs(Math.sin(ephemeris.sun_ra * Math.PI / 180));
    const sunSign = getAstrologicalSign(ephemeris.sun_ra);
    if (sunAuthority > 0.7) {
        predictions.push({
            category: 'leadership_opportunity',
            level: 'positive',
            message: `Sun in ${sunSign} highlights leadership opportunities. Strong day for architectural decisions, system governance, and establishing technical authority.`,
            confidence: 0.6,
            planet: 'Sun'
        });
    }
    
    // Developer-focused predictions based on personal birth chart
    if (birthChart) {
        // Mars - Personal Incident Risk
        const birthMarsIntensity = Math.abs(birthChart.mars_ra % 30);
        const birthMarsSign = getAstrologicalSign(birthChart.mars_ra);
        if (birthMarsIntensity > 27) {
            predictions.push({
                category: 'personal_incident_risk',
                level: 'high',
                message: `With Mars in ${birthMarsSign} at a critical degree, be especially cautious of personal burnout and overcommitment. Ensure you have adequate support and avoid taking on too many high-stakes tasks.`,
                confidence: 0.75,
                planet: 'Mars'
            });
        } else if (birthMarsIntensity > 20) {
            predictions.push({
                category: 'personal_incident_risk',
                level: 'medium',
                message: `Mars influences suggest a period of potential stress or conflict. Consider focusing on personal projects or improvements, and avoid unnecessary confrontations.`,
                confidence: 0.6,
                planet: 'Mars'
            });
        }
        
        // Mercury - Personal Communication and Learning
        const birthMercuryPosition = birthChart.mercury_ra % 360;
        const birthMercurySign = getAstrologicalSign(birthChart.mercury_ra);
        if (birthMercuryPosition > 330 || birthMercuryPosition < 30) {
            predictions.push({
                category: 'personal_communication_risk',
                level: 'medium',
                message: `Mercury in ${birthMercurySign} suggests potential misunderstandings or delays in personal communications. Take extra time to ensure clarity in your messages and be patient with responses.`,
                confidence: 0.65,
                planet: 'Mercury'
            });
        } else if (birthMercuryPosition > 150 && birthMercuryPosition < 210) {
            predictions.push({
                category: 'personal_learning_opportunity',
                level: 'positive',
                message: `Mercury's position favors personal learning and skill development. Consider dedicating time to study, attend workshops, or engage in activities that enhance your knowledge and abilities.`,
                confidence: 0.6,
                planet: 'Mercury'
            });
        }
        
        // Venus - Personal Relationships and Aesthetics
        const birthVenusHarmony = Math.sin(birthChart.venus_ra * Math.PI / 180);
        const birthVenusSign = getAstrologicalSign(birthChart.venus_ra);
        if (birthVenusHarmony > 0.5) {
            predictions.push({
                category: 'personal_relationship_harmony',
                level: 'positive',
                message: `Venus in ${birthVenusSign} enhances your charm and social skills. A great time for strengthening personal relationships, networking, and engaging in creative or artistic pursuits.`,
                confidence: 0.55,
                planet: 'Venus'
            });
        }
        
        // Jupiter - Personal Growth and Opportunities
        const birthJupiterExpansion = birthChart.jupiter_distance < 5;
        const birthJupiterSign = getAstrologicalSign(birthChart.jupiter_ra);
        if (birthJupiterExpansion) {
            predictions.push({
                category: 'personal_growth_opportunity',
                level: 'positive',
                message: `Jupiter in ${birthJupiterSign} indicates a period of personal growth and expansion. Embrace new opportunities, whether in your personal life, career, or education.`,
                confidence: 0.5,
                planet: 'Jupiter'
            });
        }
        
        // Saturn - Personal Discipline and Challenges
        const birthSaturnDiscipline = Math.cos(birthChart.saturn_ra * Math.PI / 180);
        const birthSaturnSign = getAstrologicalSign(birthChart.saturn_ra);
        if (birthSaturnDiscipline > 0.7) {
            predictions.push({
                category: 'personal_discipline',
                level: 'medium',
                message: `Saturn in ${birthSaturnSign} calls for increased discipline and responsibility in your personal affairs. It's a good time to tackle long-standing issues or projects that require sustained effort.`,
                confidence: 0.6,
                planet: 'Saturn'
            });
        } else if (birthSaturnDiscipline < -0.5) {
            predictions.push({
                category: 'personal_flexibility',
                level: 'positive',
                message: `Saturn's position supports personal flexibility and adaptability. You may find it easier to adjust to changes or challenges in your personal life.`,
                confidence: 0.5,
                planet: 'Saturn'
            });
        }
        
        // Moon - Personal Emotions and Intuition
        const birthMoonPhase = (birthChart.moon_ra / 15) % 24;
        const birthMoonSign = getAstrologicalSign(birthChart.moon_ra);
        if (birthMoonPhase < 3 || birthMoonPhase > 21) {
            predictions.push({
                category: 'personal_on_call_management',
                level: 'medium',
                message: `Moon in ${birthMoonSign} suggests you may be more emotionally sensitive or reactive during this time. Consider taking breaks, practicing self-care, and ensuring you have support if needed.`,
                confidence: 0.7,
                planet: 'Moon'
            });
        } else if (birthMoonPhase > 10 && birthMoonPhase < 14) {
            predictions.push({
                category: 'personal_wellness',
                level: 'positive',
                message: `Moon in ${birthMoonSign} favors emotional balance and well-being. A good time for personal reflection, relaxation, and activities that bring you joy.`,
                confidence: 0.55,
                planet: 'Moon'
            });
        }
        
        // Sun - Personal Identity and Authority
        const birthSunAuthority = Math.abs(Math.sin(birthChart.sun_ra * Math.PI / 180));
        const birthSunSign = getAstrologicalSign(birthChart.sun_ra);
        if (birthSunAuthority > 0.7) {
            predictions.push({
                category: 'personal_leadership_opportunity',
                level: 'positive',
                message: `Sun in ${birthSunSign} highlights your personal leadership qualities. You may find yourself in situations where you can take charge or inspire others.`,
                confidence: 0.6,
                planet: 'Sun'
            });
        }
    }
    
    // Generate developer-focused insights
    const developerInsights = generateDeveloperInsights(ephemeris, birthChart);
    
    return {
        date: ephemeris.date,
        overall_risk_level: calculateOverallRisk(predictions),
        predictions,
        cosmic_advice: generateCosmicAdvice(predictions),
        planetary_summary: generatePlanetarySummary(ephemeris),
        developer_insights: developerInsights
    };
}

function calculateOverallRisk(predictions) {
    const riskLevels = { high: 3, medium: 2, low: 1, positive: -1 };
    const totalRisk = predictions.reduce((sum, pred) => {
        return sum + (riskLevels[pred.level] || 0) * pred.confidence;
    }, 0);
    
    // Adjusted thresholds for more variety - made them higher to reduce "high" frequency
    if (totalRisk > 3.0) return 'high';      // Was 1.5, now requires more risk factors
    if (totalRisk > 1.0) return 'medium';    // Was 0.5, now requires more medium factors  
    if (totalRisk < -0.8) return 'favorable'; // Slightly adjusted for positive days
    return 'normal';
}

function generateCosmicAdvice(predictions) {
    const riskCount = predictions.filter(p => ['high', 'medium'].includes(p.level)).length;
    const positiveCount = predictions.filter(p => p.level === 'positive').length;
    
    if (riskCount > positiveCount) {
        return "The cosmic alignment suggests extra caution today. Review your monitoring systems, strengthen communication protocols, and ensure your incident response teams are well-prepared.";
    } else if (positiveCount > riskCount) {
        return "Favorable planetary energies support smooth operations and productive collaboration. An excellent day for ambitious deployments, process improvements, and team coordination.";
    } else {
        return "Balanced cosmic energies suggest a typical operational day. Maintain standard vigilance, follow established procedures, and stay alert to emerging patterns.";
    }
}

function generatePlanetarySummary(ephemeris) {
    const planets = [
        { name: 'Sun', ra: ephemeris.sun_ra, symbol: '☉', domain: 'Leadership & Authority' },
        { name: 'Mercury', ra: ephemeris.mercury_ra, symbol: '☿', domain: 'Communication & Deployments' },
        { name: 'Venus', ra: ephemeris.venus_ra, symbol: '♀', domain: 'Team Harmony & UX' },
        { name: 'Mars', ra: ephemeris.mars_ra, symbol: '♂', domain: 'Incidents & Conflicts' },
        { name: 'Jupiter', ra: ephemeris.jupiter_ra, symbol: '♃', domain: 'Growth & Learning' },
        { name: 'Saturn', ra: ephemeris.saturn_ra, symbol: '♄', domain: 'Structure & Testing' },
        { name: 'Moon', ra: ephemeris.moon_ra, symbol: '☽', domain: 'On-call & Team Emotions' }
    ];
    
    return planets.map(planet => ({
        ...planet,
        sign: getAstrologicalSign(planet.ra),
        influence_strength: getInfluenceIntensity(planet.ra)
    }));
}

function getAstrologicalSign(ra) {
    if (ra === null) return 'Unknown';
    
    const signs = [
        'Aries ♈', 'Taurus ♉', 'Gemini ♊', 'Cancer ♋',
        'Leo ♌', 'Virgo ♍', 'Libra ♎', 'Scorpio ♏',
        'Sagittarius ♐', 'Capricorn ♑', 'Aquarius ♒', 'Pisces ♓'
    ];
    
    const normalizedRA = ((ra % 360) + 360) % 360;
    const signIndex = Math.floor(normalizedRA / 30);
    return signs[signIndex] || signs[0];
}

function getInfluenceIntensity(ra) {
    if (ra === null) return 'low';
    
    const intensity = Math.abs(Math.sin(ra * Math.PI / 180));
    if (intensity > 0.8) return 'high';
    if (intensity > 0.5) return 'medium';
    return 'low';
}

function generateDeveloperInsights(ephemeris, birthChart) {
    const insights = {
        deployment_forecast: generateDeploymentForecast(ephemeris, birthChart),
        oncall_forecast: generateOnCallForecast(ephemeris, birthChart)
    };
    
    return insights;
}

function generateDeploymentForecast(ephemeris, birthChart) {
    const mercuryInfluence = calculateMercuryInfluence(ephemeris, birthChart);
    const marsInfluence = calculateMarsInfluence(ephemeris, birthChart);
    const saturnInfluence = calculateSaturnInfluence(ephemeris, birthChart);
    
    let forecast = {
        overall_outlook: 'neutral',
        confidence: 0.5,
        recommendations: [],
        cosmic_message: ''
    };
    
    // Mercury governs communication and technical processes
    if (mercuryInfluence.retrograde_risk > 0.7) {
        forecast.overall_outlook = 'challenging';
        forecast.confidence = 0.8;
        forecast.cosmic_message = "Mercury's chaotic dance suggests deployment gremlins lurk in your CI/CD pipeline. The cosmic forces whisper of configuration drift and mysterious environment variables going astray.";
        forecast.recommendations.push("🔍 Triple-check all configuration files and environment variables");
        forecast.recommendations.push("📋 Implement extra validation steps in your deployment pipeline");
        forecast.recommendations.push("🤝 Ensure clear communication channels between all teams");
    } else if (mercuryInfluence.clarity > 0.6) {
        forecast.overall_outlook = 'favorable';
        forecast.confidence = 0.7;
        forecast.cosmic_message = "Mercury blesses your technical endeavors with crystalline clarity. The stars align for smooth deployments and seamless integrations.";
        forecast.recommendations.push("🚀 Excellent time for complex feature rollouts");
        forecast.recommendations.push("🔄 Consider batch deployments or major version upgrades");
        forecast.recommendations.push("📚 Document any new processes while mental clarity is high");
    }
    
    // Mars affects system conflicts and aggressive changes
    if (marsInfluence.conflict_potential > 0.6) {
        if (forecast.overall_outlook === 'favorable') forecast.overall_outlook = 'mixed';
        else forecast.overall_outlook = 'challenging';
        forecast.cosmic_message += " Mars throws sparks into your deployment forge - expect database migrations to rebel and APIs to clash like cosmic titans.";
        forecast.recommendations.push("⚡ Be extra cautious with database schema changes");
        forecast.recommendations.push("🛡️ Implement robust rollback strategies");
        forecast.recommendations.push("🎯 Focus on smaller, incremental deployments");
    } else if (marsInfluence.energy > 0.7) {
        if (forecast.overall_outlook === 'challenging') forecast.overall_outlook = 'mixed';
        else forecast.overall_outlook = 'favorable';
        forecast.cosmic_message += " Mars energizes your deployment velocity with the fire of a thousand suns.";
        forecast.recommendations.push("💪 Harness this energy for bold architectural changes");
        forecast.recommendations.push("🔥 Perfect time for performance optimizations");
    }
    
    // Saturn brings discipline but also delays
    if (saturnInfluence.discipline > 0.6) {
        forecast.cosmic_message += " Saturn's wise hand guides you toward methodical excellence - though patience will be your virtue.";
        forecast.recommendations.push("📝 Emphasize thorough code reviews and testing");
        forecast.recommendations.push("🎯 Focus on code quality over speed");
        forecast.recommendations.push("🏗️ Great time for refactoring and technical debt reduction");
    }
    
    // Personal birth chart influences
    if (birthChart) {
        const personalMercury = calculatePersonalMercuryInfluence(birthChart);
        if (personalMercury.communication_gift > 0.6) {
            forecast.cosmic_message += " Your personal Mercury placement grants you the gift of technical eloquence today.";
            forecast.recommendations.push("👥 Lead technical discussions and architectural reviews");
        }
    }
    
    if (!forecast.cosmic_message) {
        forecast.cosmic_message = "The cosmic forces maintain neutral equilibrium around your deployments. Standard vigilance and established procedures will serve you well.";
    }
    
    return forecast;
}

function generateOnCallForecast(ephemeris, birthChart) {
    const moonInfluence = calculateMoonInfluence(ephemeris, birthChart);
    const marsInfluence = calculateMarsInfluence(ephemeris, birthChart);
    const venusInfluence = calculateVenusInfluence(ephemeris, birthChart);
    
    let forecast = {
        overall_outlook: 'neutral',
        confidence: 0.5,
        recommendations: [],
        cosmic_message: ''
    };
    
    // Moon governs emotions and sleep cycles
    if (moonInfluence.emotional_intensity > 0.7) {
        forecast.overall_outlook = 'challenging';
        forecast.confidence = 0.75;
        forecast.cosmic_message = "Luna's wild energy stirs the emotional tides of your on-call rotation. Incidents may trigger stronger reactions, and sleep patterns dance to chaotic rhythms.";
        forecast.recommendations.push("🧘 Practice extra mindfulness and stress-reduction techniques");
        forecast.recommendations.push("😴 Prioritize sleep hygiene and prepare for potential disruptions");
        forecast.recommendations.push("🤝 Arrange backup support for high-stress scenarios");
        forecast.recommendations.push("☕ Keep calming teas handy instead of excessive caffeine");
    } else if (moonInfluence.emotional_balance > 0.6) {
        forecast.overall_outlook = 'favorable';
        forecast.confidence = 0.65;
        forecast.cosmic_message = "The Moon smiles upon your on-call journey with serene emotional equilibrium. Your responses will be measured, your sleep peaceful.";
        forecast.recommendations.push("🌟 Your calm energy will inspire confidence in others");
        forecast.recommendations.push("📖 Good time to update runbooks or mentor junior team members");
        forecast.recommendations.push("🎯 Focus on proactive monitoring improvements");
    }
    
    // Mars affects incident frequency and stress
    if (marsInfluence.incident_magnetism > 0.6) {
        if (forecast.overall_outlook === 'favorable') forecast.overall_outlook = 'mixed';
        else forecast.overall_outlook = 'challenging';
        forecast.cosmic_message += " Mars hurls digital thunderbolts into your infrastructure - alerts may cascade like dominoes in a cosmic windstorm.";
        forecast.recommendations.push("⚡ Prepare for higher-than-usual incident frequency");
        forecast.recommendations.push("🔧 Have your troubleshooting toolkit readily accessible");
        forecast.recommendations.push("📞 Ensure escalation paths are clear and contact lists updated");
    } else if (marsInfluence.protective_energy > 0.6) {
        if (forecast.overall_outlook === 'challenging') forecast.overall_outlook = 'mixed';
        else forecast.overall_outlook = 'favorable';
        forecast.cosmic_message += " Mars stands as your digital guardian, deflecting chaos from your systems.";
        forecast.recommendations.push("🛡️ Your systems enjoy extra cosmic protection today");
        forecast.recommendations.push("🔍 Good time for proactive system health checks");
    }
    
    // Venus affects team support and communication
    if (venusInfluence.team_harmony > 0.6) {
        forecast.cosmic_message += " Venus weaves golden threads of collaboration through your support network.";
        forecast.recommendations.push("💫 Team communication will flow smoothly");
        forecast.recommendations.push("🤗 Excellent support from colleagues during incidents");
        forecast.recommendations.push("🎵 Consider playing calming background music during incident response");
    }
    
    // Personal birth chart influences
    if (birthChart) {
        const personalMoon = calculatePersonalMoonInfluence(birthChart);
        if (personalMoon.intuitive_strength > 0.6) {
            forecast.cosmic_message += " Your personal lunar placement heightens your troubleshooting intuition.";
            forecast.recommendations.push("🔮 Trust your instincts when diagnosing complex issues");
        }
        
        const personalMars = calculatePersonalMarsInfluence(birthChart);
        if (personalMars.stress_resilience > 0.6) {
            forecast.cosmic_message += " Your natal Mars grants extraordinary resilience during high-pressure situations.";
            forecast.recommendations.push("💪 You're cosmically equipped to handle major incidents");
        }
    }
    
    if (!forecast.cosmic_message) {
        forecast.cosmic_message = "The celestial on-call energies remain in gentle balance. Expect a routine rotation with standard operational rhythms.";
    }
    
    return forecast;
}

// Helper functions for calculating planetary influences
function calculateMercuryInfluence(ephemeris, birthChart) {
    const mercuryRA = ephemeris.mercury_ra % 360;
    const mercurySign = getAstrologicalSign(ephemeris.mercury_ra);
    
    return {
        retrograde_risk: mercuryRA > 330 || mercuryRA < 30 ? 0.8 : 0.2,
        clarity: mercuryRA > 150 && mercuryRA < 210 ? 0.7 : 0.3,
        sign: mercurySign
    };
}

function calculateMarsInfluence(ephemeris, birthChart) {
    const marsRA = ephemeris.mars_ra % 360;
    const marsIntensity = Math.abs(ephemeris.mars_ra % 30);
    
    return {
        conflict_potential: marsIntensity > 25 ? 0.8 : marsIntensity / 30,
        energy: marsRA > 210 && marsRA < 330 ? 0.8 : 0.4,
        incident_magnetism: marsIntensity > 27 ? 0.9 : 0.3,
        protective_energy: marsIntensity < 5 ? 0.7 : 0.2
    };
}

function calculateSaturnInfluence(ephemeris, birthChart) {
    const saturnDiscipline = Math.cos(ephemeris.saturn_ra * Math.PI / 180);
    
    return {
        discipline: saturnDiscipline > 0.5 ? 0.8 : 0.3,
        delays: saturnDiscipline < -0.5 ? 0.7 : 0.2
    };
}

function calculateMoonInfluence(ephemeris, birthChart) {
    const moonPhase = (ephemeris.moon_ra / 15) % 24;
    const moonRA = ephemeris.moon_ra % 360;
    
    return {
        emotional_intensity: moonPhase < 3 || moonPhase > 21 ? 0.8 : 0.3,
        emotional_balance: moonPhase > 10 && moonPhase < 14 ? 0.7 : 0.3
    };
}

function calculateVenusInfluence(ephemeris, birthChart) {
    const venusHarmony = Math.sin(ephemeris.venus_ra * Math.PI / 180);
    
    return {
        team_harmony: venusHarmony > 0.5 ? 0.7 : 0.3
    };
}

function calculatePersonalMercuryInfluence(birthChart) {
    if (!birthChart.mercury_ra) return { communication_gift: 0 };
    const mercuryRA = birthChart.mercury_ra % 360;
    return {
        communication_gift: mercuryRA > 150 && mercuryRA < 210 ? 0.8 : 0.3
    };
}

function calculatePersonalMoonInfluence(birthChart) {
    if (!birthChart.moon_ra) return { intuitive_strength: 0 };
    const moonPhase = (birthChart.moon_ra / 15) % 24;
    return {
        intuitive_strength: moonPhase > 6 && moonPhase < 18 ? 0.7 : 0.4
    };
}

function calculatePersonalMarsInfluence(birthChart) {
    if (!birthChart.mars_ra) return { stress_resilience: 0 };
    const marsIntensity = Math.abs(birthChart.mars_ra % 30);
    return {
        stress_resilience: marsIntensity > 15 && marsIntensity < 25 ? 0.8 : 0.3
    };
}

module.exports = router;