# 🔮 Planetary Horoscope for SRE Teams

A fun and entertaining horoscope generator that uses real NASA astronomical data to provide "cosmic insights" for software incident response and operations teams. Perfect for adding some levity to your team's daily standup or incident retrospectives!

## 🌟 Features

- **Real Astronomical Data**: Fetches planetary positions from NASA JPL Horizons API
- **Future Horoscope Generation**: Generate horoscopes for any future date based on planetary alignments
- **SRE-Focused Predictions**: Tailored predictions for software teams covering:
  - Incident risk levels
  - Communication and deployment issues
  - Team collaboration insights
  - On-call management guidance
  - Testing and code review focus areas
  - Leadership opportunities

## 🚀 Production Deployment

For production deployments, if you're upgrading from an earlier version, you may need to run the database migration:

```sql
-- Run this on your production database to add data source tracking
\i scripts/migrate-add-data-sources.sql
```

The application is backward-compatible and will work with both old and new database schemas.

## 🛠️ Quick Start

### Using Docker (Recommended)

1. Clone the repository:
```bash
git clone <your-repo-url>
cd planetary-horoscope
```

2. Start the application:
```bash
docker-compose up -d
```

3. Visit http://localhost:3000

### Manual Setup

1. Install dependencies:
```bash
npm install
```

2. Set up PostgreSQL database and update `.env` file

3. Start the application:
```bash
npm start
```

## 🌌 How It Works

The application combines real astronomical data with entertaining "cosmic correlations" for software teams:

- **☉ Sun**: System authority and architectural decisions
- **☿ Mercury**: Communication, APIs, and deployments  
- **♀ Venus**: Team harmony and user experience
- **♂ Mars**: Critical incidents and system conflicts
- **♃ Jupiter**: Learning opportunities and process improvements
- **♄ Saturn**: Code quality, testing, and structured processes
- **☽ Moon**: On-call emotions and team stress levels

## 🔮 Usage

1. **Today's Horoscope**: Get instant cosmic insights for today's operations
2. **Future Predictions**: Select any future date to see what the planets have in store
3. **Planetary Positions**: View current astrological positions and their SRE influences

## 🛠 Technology Stack

- **Backend**: Node.js, Express, PostgreSQL
- **Frontend**: Vanilla JavaScript, Chart.js
- **Data Source**: NASA JPL Horizons API
- **Deployment**: Docker & Docker Compose

## 📊 API Endpoints

- `GET /` - Main dashboard
- `GET /api/ephemeris?date=YYYY-MM-DD` - Get planetary positions for a date
- `POST /api/ephemeris/bulk` - Fetch ephemeris data for multiple dates
- `GET /api/horoscope?date=YYYY-MM-DD` - Generate horoscope for a specific date
- `GET /api/horoscope/influences` - Get planetary influence knowledge base

## 🎭 Disclaimer

This application is created for entertainment purposes only! The "cosmic correlations" are humorous interpretations and should not be used for actual operational decisions. Real astronomical data is used, but the SRE predictions are purely fictional and meant to bring some fun to your team culture.

## 🤝 Contributing

Feel free to fork this repository and add your own planetary influences or improve the cosmic algorithms! Some ideas:

- Add more planetary bodies (asteroids, comets)
- Create team-specific horoscope variations
- Add historical incident pattern analysis (using mock data)
- Improve the astrological calculations

## 📄 License

MIT License - Feel free to use this for your team's entertainment!

## 🌟 Credits

- Astronomical data provided by NASA JPL Horizons System
- Created with cosmic inspiration for the SRE community

---

*May the stars align for smooth deployments! 🌟*