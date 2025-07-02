@echo off
chcp 65001 >nul 2>&1
title 卸载仓储配置管理服务 - 需要管理员权限

:: 检查管理员权限
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if %errorlevel% neq 0 (
    echo =========================================
    echo           需要管理员权限
    echo =========================================
    echo.
    echo 此操作需要管理员权限才能卸载Windows服务
    echo 请右键点击此文件，选择"以管理员身份运行"
    echo.
    echo 按任意键退出...
    pause >nul
    exit /b 1
)

echo =========================================
echo      卸载仓储配置管理服务
echo =========================================
echo.

echo 警告: 此操作将完全移除配置管理服务！
echo 服务卸载后将不再开机自启动。
echo.
set /p confirm=确认卸载服务？(Y/N): 

if /i "%confirm%" neq "Y" (
    echo 操作已取消
    pause
    exit /b 0
)

echo.
echo 正在卸载Windows服务...
node uninstall-service.js

if %errorlevel% equ 0 (
    echo.
    echo =========================================
    echo           卸载完成！
    echo =========================================
    echo.
    echo 服务已成功卸载！
    echo 配置管理服务已从系统中移除，不再开机自启
    echo.
    echo 如需重新安装，请运行: install-service-admin.bat
    echo.
) else (
    echo.
    echo 卸载失败，请检查错误信息
)

echo 按任意键退出...
pause >nul 