# ============================================================
# Dockerfile — Container image for Google Cloud Run Jobs
# ============================================================
#
# This creates a "Docker image" — a self-contained package with
# your app, Node.js, and a Chromium browser. Google Cloud Run
# uses this to run your job in an isolated environment.
#
# Based on the official Playwright image which comes with
# Chromium and all its system dependencies pre-installed.
# ============================================================

# Use Playwright's official Docker image as the base.
# This includes Node.js, Chromium, and all system libraries
# needed to run a headless browser.
FROM mcr.microsoft.com/playwright:v1.49.0-noble

# Set the working directory inside the container
WORKDIR /app

# Copy package files first (for efficient Docker layer caching).
# Docker caches each step ("layer"). If package.json hasn't changed,
# Docker reuses the cached npm install instead of re-running it.
COPY package.json package-lock.json* ./

# Install only production dependencies (skip devDependencies like vitest)
RUN npm ci --omit=dev

# Install Chromium browser inside the container
RUN npx playwright install chromium

# Copy the rest of the application code
COPY . .

# Set environment variables for the container
# TZ ensures cron expressions use Pacific Time
ENV TZ=America/Los_Angeles
# Tell Playwright not to download browsers during require() (we already installed them)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Run the pipeline when the container starts
CMD ["node", "index.js"]
