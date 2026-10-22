@echo off
setlocal
pushd "%~dp0.."
node tools\inspect-neon.mjs %*
set "result=%ERRORLEVEL%"
popd
exit /b %result%
