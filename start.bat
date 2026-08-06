@echo off
title Track Annotation Tool

:: Use portable Node.js from the local "node" folder if it exists
:: Otherwise fall back to system-installed Node.js
if exist "%~dp0node\node.exe" (
    set "PATH=%~dp0node;%~dp0node\node_modules\.bin;%PATH%"
    echo Using portable Node.js from node\ folder
) else (
    echo Using system Node.js
)

:: Check Node.js is available
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found.
    echo Either install Node.js from https://nodejs.org
    echo or place the portable Node.js folder named "node" in this folder.
    pause
    exit /b 1
)

:: Install dependencies if node_modules doesn't exist
if not exist "%~dp0node_modules" (
    echo Node modules not found. Installing dependencies...
    echo Make sure you are connected to 102 WiFi before continuing.
    pause
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed. Please switch to Ethernet or 14 WiFi now.
    pause
)

:: Open the browser after a short delay
start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000"

:: Start the server
echo Starting Track Annotation Tool...
echo Open http://localhost:3000 in your browser
echo Press Ctrl+C to stop the server
echo.
npm run dev
