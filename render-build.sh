#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install project dependencies
npm install

# Store puppeteer cache in a location that persists between builds on Render
export PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer

# Pre-download Chromium/Chrome browser for Puppeteer to run in headless mode
echo "Installing Chrome browser for Puppeteer..."
npx puppeteer browsers install chrome
