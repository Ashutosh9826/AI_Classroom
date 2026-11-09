@echo off
setlocal

echo ===================================================
echo     Academic Atelier GCP Cloud Run Deployer
echo ===================================================
echo.
echo Make sure you have installed the Google Cloud CLI
echo and run 'gcloud auth login' and 'gcloud config set project YOUR_PROJECT_ID'
echo.
echo This script will build and deploy both containers to Cloud Run.
echo.

echo [1/2] Deploying Backend...
echo ---------------------------------------------------
cmd /c gcloud run deploy academic-atelier-backend ^
    --source .\backend ^
    --region us-central1 ^
    --allow-unauthenticated ^
    --port 8080 ^
    --add-cloudsql-instances="ai-tutor-491810:us-central1:academic-atelier-db" ^
    --set-env-vars="DATABASE_URL=postgresql://postgres:GcpCloud%%232026%%21Db@localhost:5432/academic_atelier?host=/cloudsql/ai-tutor-491810:us-central1:academic-atelier-db,JWT_SECRET=replace_me,JWT_REFRESH_SECRET=replace_me,GOOGLE_CLIENT_ID=replace_me,GCP_PROJECT_ID=ai-tutor-491810,GCP_REGION=us-central1,VERTEX_AI_GENERATION_MODEL=gemini-2.5-pro,VERTEX_AI_CHAT_MODEL=gemini-2.5-flash,FRONTEND_URL=https://academic-atelier-frontend-799700337103.us-central1.run.app"
if errorlevel 1 goto error

echo.
echo [2/2] Deploying Frontend...
echo ---------------------------------------------------
cmd /c gcloud run deploy academic-atelier-frontend ^
    --source .\frontend ^
    --region us-central1 ^
    --allow-unauthenticated ^
    --port 8080
if errorlevel 1 goto error

echo.
echo ===================================================
echo     All deployments completed successfully!
echo ===================================================
goto end

:error
echo.
echo ===================================================
echo ERROR: Deployment failed. Please check the logs above.
echo ===================================================
exit /b 1

:end
endlocal
pause
