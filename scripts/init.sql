-- Create ephemeris data table for planetary positions
CREATE TABLE ephemeris_data (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    location TEXT DEFAULT 'New York City',
    -- Solar system bodies with coordinates
    sun_ra NUMERIC,
    sun_dec NUMERIC,
    sun_distance NUMERIC,
    mercury_ra NUMERIC,
    mercury_dec NUMERIC,
    mercury_distance NUMERIC,
    venus_ra NUMERIC,
    venus_dec NUMERIC,
    venus_distance NUMERIC,
    mars_ra NUMERIC,
    mars_dec NUMERIC,
    mars_distance NUMERIC,
    jupiter_ra NUMERIC,
    jupiter_dec NUMERIC,
    jupiter_distance NUMERIC,
    saturn_ra NUMERIC,
    saturn_dec NUMERIC,
    saturn_distance NUMERIC,
    uranus_ra NUMERIC,
    uranus_dec NUMERIC,
    uranus_distance NUMERIC,
    neptune_ra NUMERIC,
    neptune_dec NUMERIC,
    neptune_distance NUMERIC,
    moon_ra NUMERIC,
    moon_dec NUMERIC,
    moon_distance NUMERIC,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(date, location)
);

-- Create planetary influences knowledge base
CREATE TABLE planetary_influences (
    id SERIAL PRIMARY KEY,
    planet VARCHAR(50) NOT NULL,
    sign VARCHAR(50) NOT NULL,
    influence_category VARCHAR(100) NOT NULL,
    influence_description TEXT NOT NULL,
    risk_level VARCHAR(20) NOT NULL, -- low, medium, high, positive
    confidence NUMERIC DEFAULT 0.5,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_ephemeris_date ON ephemeris_data(date);
CREATE INDEX idx_planetary_influences_planet ON planetary_influences(planet);
CREATE INDEX idx_planetary_influences_sign ON planetary_influences(sign);