# 🚀 Deployment Guide

## Free/Low-Cost Hosting Options

### 1. Railway (Recommended - ~$5/month)

**Steps:**
1. Push your code to GitHub
2. Visit [railway.app](https://railway.app) and sign up
3. Click "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect Node.js and deploy
6. Add PostgreSQL service in Railway dashboard
7. Set environment variables:
   ```
   DATABASE_URL=<railway-provides-this>
   NODE_ENV=production
   PORT=3000
   NASA_API_BASE=https://ssd.jpl.nasa.gov/api/horizons.api
   ```

**Pros:** Easy setup, includes PostgreSQL, great for Node.js
**Cost:** ~$5/month total

### 2. Render (Free tier + $7/month for DB)

**Steps:**
1. Create account at [render.com](https://render.com)
2. Connect GitHub repository
3. Create Web Service (detects Node.js automatically)
4. Create PostgreSQL database
5. Link database to web service
6. Set environment variables in dashboard

**Cost:** Free web service + $7/month PostgreSQL

### 3. Vercel + Supabase (Mostly Free)

**Setup:**
1. Deploy frontend to Vercel (free)
2. Create Supabase account for PostgreSQL (free tier: 500MB)
3. Update database config to use Supabase connection string
4. Set environment variables in Vercel dashboard

**Cost:** Free (with limitations)

### 4. Heroku + Supabase ($5/month + free DB)

**Steps:**
1. Create Heroku app
2. Connect GitHub for auto-deploys
3. Use Supabase for free PostgreSQL
4. Configure environment variables

## Quick Deploy Commands

### For Railway:
```bash
# After connecting GitHub repo to Railway
git add .
git commit -m "Deploy to Railway"
git push origin main
```

### For Render:
```bash
# After connecting repo
git add .
git commit -m "Deploy to Render" 
git push origin main
```

## Environment Variables Needed:
- `DATABASE_URL` (provided by hosting platform)
- `NODE_ENV=production`
- `PORT` (usually auto-set)
- `NASA_API_BASE=https://ssd.jpl.nasa.gov/api/horizons.api`

## Post-Deployment:
1. Visit your app URL
2. Click "Generate Horoscope" to fetch initial astronomical data
3. Share your cosmic DevOps insights with the world! 🌟