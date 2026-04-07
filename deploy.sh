#!/bin/bash
set -e

APP_NAME="sales-kb-app"
RG="sales-kb-rg"
PLAN="ASP-swe-ae74"
PLAN_RG="swe"

echo "==> Building frontend..."
cd frontend && npm ci && npm run build && cd ..

echo "==> Creating Azure Web App..."
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --plan "/subscriptions/84e85ed8-74a4-461a-a958-6aaeeb95f2cc/resourceGroups/$PLAN_RG/providers/Microsoft.Web/serverfarms/$PLAN" \
  --runtime "PYTHON:3.12" \
  2>/dev/null || echo "Web App already exists, updating..."

echo "==> Configuring startup command..."
az webapp config set \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --startup-file "python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000" \
  2>/dev/null

echo "==> Setting environment variables..."
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --settings \
    AZURE_OPENAI_ENDPOINT="$(grep AZURE_OPENAI_ENDPOINT .env | cut -d= -f2-)" \
    AZURE_OPENAI_KEY="$(grep AZURE_OPENAI_KEY .env | cut -d= -f2-)" \
    AZURE_OPENAI_CHAT_DEPLOYMENT="$(grep AZURE_OPENAI_CHAT_DEPLOYMENT .env | cut -d= -f2-)" \
    AZURE_OPENAI_EMBEDDING_DEPLOYMENT="$(grep AZURE_OPENAI_EMBEDDING_DEPLOYMENT .env | cut -d= -f2-)" \
    AZURE_SEARCH_ENDPOINT="$(grep AZURE_SEARCH_ENDPOINT .env | cut -d= -f2-)" \
    AZURE_SEARCH_KEY="$(grep AZURE_SEARCH_KEY .env | cut -d= -f2-)" \
    AZURE_SEARCH_INDEX="$(grep AZURE_SEARCH_INDEX .env | cut -d= -f2-)" \
    AZURE_SPEECH_KEY="$(grep AZURE_SPEECH_KEY .env | cut -d= -f2-)" \
    AZURE_SPEECH_REGION="$(grep AZURE_SPEECH_REGION .env | cut -d= -f2-)" \
    AZURE_STORAGE_CONNECTION_STRING="$(grep AZURE_STORAGE_CONNECTION_STRING .env | cut -d= -f2-)" \
    AZURE_STORAGE_CONTAINER="$(grep AZURE_STORAGE_CONTAINER .env | cut -d= -f2-)" \
    COSMOS_ENDPOINT="$(grep COSMOS_ENDPOINT .env | cut -d= -f2-)" \
    COSMOS_KEY="$(grep COSMOS_KEY .env | cut -d= -f2-)" \
    COSMOS_DATABASE="$(grep COSMOS_DATABASE .env | cut -d= -f2-)" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true" \
    2>/dev/null | tail -3

echo "==> Deploying application code..."
cd /Users/arslan/Desktop/sales-knowledge-base

# Create a zip of the deployment
rm -f /tmp/sales-kb-deploy.zip
zip -r /tmp/sales-kb-deploy.zip \
  backend/ \
  frontend/dist/ \
  requirements.txt \
  -x "**/__pycache__/*" "**/.DS_Store" "**/node_modules/*"

az webapp deploy \
  --name "$APP_NAME" \
  --resource-group "$RG" \
  --src-path /tmp/sales-kb-deploy.zip \
  --type zip \
  2>/dev/null

echo ""
echo "==> Deployment complete!"
echo "    URL: https://${APP_NAME}.azurewebsites.net"
