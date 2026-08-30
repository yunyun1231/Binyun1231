@echo off
echo [1/1] Pushing to GitHub (make sure Clash Global proxy is ON)...
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
echo.
pause
