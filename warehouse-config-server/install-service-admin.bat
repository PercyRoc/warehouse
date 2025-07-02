@echo off
chcp 65001 >nul 2>&1
title 安装仓储配置管理服务 - 需要管理员权限

:: 检查管理员权限
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if %errorlevel% neq 0 (
    echo =========================================
    echo           需要管理员权限
    echo =========================================
    echo.
    echo 此操作需要管理员权限才能安装Windows服务
    echo 请右键点击此文件，选择"以管理员身份运行"
    echo.
    echo 按任意键退出...
    pause >nul
    exit /b 1
)

echo =========================================
echo      安装仓储配置管理服务
echo =========================================
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
echo 正在安装Windows服务...
node install-service.js

if %errorlevel% equ 0 (
    echo.
    echo =========================================
    echo           安装完成！
    echo =========================================
    echo.
    echo 服务已成功安装并启动！
    echo 配置管理服务现在将在系统启动时自动运行
    echo.
    echo 服务地址: http://localhost:3001
    echo 健康检查: http://localhost:3001/health
    echo.
    echo 管理命令:
    echo   查看服务: Win+R → services.msc → 查找 WarehouseConfigServer
    echo   卸载服务: 运行 uninstall-service-admin.bat
    echo.
) else (
    echo.
    echo 安装失败，请检查错误信息
)

echo 按任意键退出...
pause >nul 