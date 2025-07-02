@echo off
cd /d "%~dp0.."
echo 启动仓储监控系统后端服务...
echo 当前目录: %CD%
echo 启动时间: %DATE% %TIME%

REM 检查Node.js是否已安装
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 未找到Node.js，请先安装Node.js
    pause
    exit /b 1
)

REM 检查依赖是否已安装
if not exist "node_modules" (
    echo 安装依赖包...
    npm install
)

REM 启动服务
echo 正在启动服务...
node src/app.js

REM 如果服务异常退出，暂停显示错误信息
if %ERRORLEVEL% NEQ 0 (
    echo 服务异常退出，错误代码: %ERRORLEVEL%
    pause
) 