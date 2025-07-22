#!/bin/bash

# Incident Horoscope Setup Script
# This script helps set up the application in different environments

echo "🔮 Setting up Incident Horoscope..."

# Check for required tools
check_requirements() {
    echo "Checking system requirements..."
    
    if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
        echo "✅ Docker and Docker Compose found"
        return 0
    elif command -v node &> /dev/null && command -v npm &> /dev/null; then
        echo "✅ Node.js and npm found"
        return 1
    else
        echo "❌ Neither Docker nor Node.js found"
        echo ""
        echo "Please install one of the following:"
        echo "  Option 1: Docker Desktop (recommended)"
        echo "  Option 2: Node.js (v18+) and PostgreSQL"
        echo ""
        echo "Installation guides:"
        echo "  Docker: https://docs.docker.com/get-docker/"
        echo "  Node.js: https://nodejs.org/en/download/"
        exit 1
    fi
}

# Docker setup
setup_docker() {
    echo "🐳 Setting up with Docker..."
    
    # Start containers
    docker-compose up -d
    
    # Wait for database to be ready
    echo "⏳ Waiting for database to be ready..."
    sleep 10
    
    # Import data if CSV exists
    if [ -f "./data/full_incidents.csv" ]; then
        echo "📊 Importing incident data..."
        docker-compose exec app npm run import-data
    else
        echo "⚠️  No incident data found at ./data/full_incidents.csv"
        echo "   Please add your CSV file there and run: docker-compose exec app npm run import-data"
    fi
    
    echo "🎉 Setup complete! Visit http://localhost:3000"
}

# Node.js setup
setup_nodejs() {
    echo "📦 Setting up with Node.js..."
    
    # Install dependencies
    npm install
    
    # Check for PostgreSQL
    if ! command -v psql &> /dev/null; then
        echo "❌ PostgreSQL not found. Please install PostgreSQL and update .env file"
        exit 1
    fi
    
    # Create database
    echo "🗄️  Setting up database..."
    createdb incident_horoscope 2>/dev/null || echo "Database may already exist"
    psql incident_horoscope < scripts/init.sql
    
    # Import data if CSV exists
    if [ -f "./data/full_incidents.csv" ]; then
        echo "📊 Importing incident data..."
        npm run import-data
    fi
    
    echo "🎉 Setup complete! Run 'npm start' and visit http://localhost:3000"
}

# Production deployment script for hosting platforms
deploy_production() {
    echo "🚀 Starting production deployment..."

    # Install dependencies
    npm install --production

    # Run database initialization (if needed)
    if [ "$NODE_ENV" = "production" ]; then
        echo "🔄 Production environment detected"
        echo "🗄️ Database will be initialized automatically by the application"
    fi

    echo "✅ Deployment preparation complete"
}

# Main execution
check_requirements
docker_available=$?

if [ $docker_available -eq 0 ]; then
    setup_docker
else
    setup_nodejs
fi

# Uncomment the following line to enable production deployment
# deploy_production