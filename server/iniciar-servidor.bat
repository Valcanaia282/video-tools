@echo off
chcp 65001 >nul
title Video Tools - servidor local
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale com:  winget install OpenJS.NodeJS.LTS
  echo Depois feche e abra esta janela de novo.
  pause
  exit /b 1
)
node server.mjs
pause
