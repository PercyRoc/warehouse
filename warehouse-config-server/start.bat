@echo off
chcp 65001 >nul 2>&1
title 仓储监控系统 - 配置管理服务器
echo ======================================
echo   仓储监控系统 - 配置管理服务器
echo ======================================
echo.

echo 检查Node.js环境...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到Node.js，请先安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo 检查依赖包...
if not exist node_modules (
    echo 正在安装依赖包...
    npm install
    if %errorlevel% neq 0 (
        echo 错误: 依赖包安装失败
        pause
        exit /b 1
    )
)

echo.
echo 启动配置管理服务器...
echo 服务地址: http://localhost:3001
echo 按 Ctrl+C 停止服务器
echo.

npm start

pause 