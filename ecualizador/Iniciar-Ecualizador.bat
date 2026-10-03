@echo off
title Ecualizador Libre
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
if errorlevel 1 (
  echo.
  echo No se pudo iniciar el servidor. Abriendo el archivo directamente...
  start "" "%~dp0index.html"
  pause
)
