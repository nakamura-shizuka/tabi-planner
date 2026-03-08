#!/bin/bash
set -e

echo "🚀 [1/3] Creating and pushing to GitHub (tabi-planner)..."
cd /Users/shizuka/Documents/my-obsidian/tabi-planner

if [ ! -d ".git" ]; then
  git init
  # Remove appsscript.json from Git (it contains scriptId)
  echo "appsscript.json" > .gitignore
  echo ".clasp.json" >> .gitignore
  git add .
  git commit -m "Initial commit ✨"
else
  # Add anything new
  git add .
  git commit -m "Update Tabi Planner 🗺" || true
fi

# We assume gh CLI is authenticated. Let's create a public repo.
if ! gh repo view tabi-planner > /dev/null 2>&1; then
  gh repo create tabi-planner --public --source=. --remote=origin --push
else
  git push origin HEAD || true
fi

# Enable GitHub Pages
echo "⚙️ Enabling GitHub Pages..."
gh api repos/@me/tabi-planner/pages -X POST -F "source[branch]=main" -F "source[path]=/" || true

# Get Pages URL
PAGES_URL="https://$(gh api user -q .login).github.io/tabi-planner/"

echo "🚀 [2/3] Deploying GAS API utilizing docker / clasp..."
cd /Users/shizuka/Documents/my-obsidian/env

# Ensure container is up
docker-compose up -d

# Execute clasp commands inside the container
# Use node image simply to run clasp inside
docker-compose exec -w /workspace/tabi-planner -T agent-env sh -c "
  if [ ! -f .clasp.json ]; then
    echo 'Creating new GAS project...'
    clasp create --title 'Tabi Planner API' --type webapp
  fi
  
  echo 'Pushing to GAS...'
  clasp push -f
  
  echo 'Deploying as Web App...'
  # Extract deployment id if exists or create new
  DEPLOY_OUTPUT=\$(clasp deploy --description 'Auto Deploy')
  echo \"\$DEPLOY_OUTPUT\"
" > /tmp/gas_deploy.log 2>&1 || true

cat /tmp/gas_deploy.log

# Extract GAS_URL
GAS_URL=$(grep -o 'https://script.google.com/macros/s/[a-zA-Z0-9_-]*/exec' /tmp/gas_deploy.log | tail -n 1)

if [ -z "$GAS_URL" ]; then
  echo "❌ Could not extract GAS_URL"
  exit 1
fi

echo "✅ GAS API Deployed: $GAS_URL"

echo "🚀 [3/3] Injecting GAS_URL to index.html and re-pushing..."
cd /Users/shizuka/Documents/my-obsidian/tabi-planner

# macOS sed inplace
sed -i '' "s|const GAS_URL = '';|const GAS_URL = '${GAS_URL}';|g" index.html

git add index.html
git commit -m "Configure GAS_URL 🔗" || true
git push origin HEAD || true

echo ""
echo "🎉 Tabi Planner Deployment Complete!"
echo "📱 Frontend URL: $PAGES_URL"
echo "🛠 Backend  URL: $GAS_URL"

