@echo off
echo 安装仓储监控系统Windows服务
echo ================================

REM 检查管理员权限
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 错误: 需要管理员权限运行此脚本
    echo 请右键点击此文件，选择"以管理员身份运行"
    pause
    exit /b 1
)

REM 设置服务名称
set SERVICE_NAME=WarehouseBackendService

REM 获取当前目录
set CURRENT_DIR=%~dp0..
cd /d "%CURRENT_DIR%"

REM 检查nssm是否存在
if not exist "scripts\nssm.exe" (
    echo 下载NSSM服务管理工具...
    echo 请手动下载NSSM并将nssm.exe放置在scripts目录下
    echo 下载地址: https://nssm.cc/download
    pause
    exit /b 1
)

REM 停止并删除现有服务（如果存在）
echo 检查现有服务...
sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo 停止现有服务...
    scripts\nssm.exe stop %SERVICE_NAME%
    echo 删除现有服务...
    scripts\nssm.exe remove %SERVICE_NAME% confirm
)

REM 安装新服务
echo 安装服务: %SERVICE_NAME%
scripts\nssm.exe install %SERVICE_NAME% node "%CURRENT_DIR%\src\app.js"

REM 配置服务
echo 配置服务参数...
scripts\nssm.exe set %SERVICE_NAME% AppDirectory "%CURRENT_DIR%"
scripts\nssm.exe set %SERVICE_NAME% DisplayName "仓储监控系统后端服务"
scripts\nssm.exe set %SERVICE_NAME% Description "仓储监控系统后端服务 - 处理设备通信和数据转发"

REM 配置日志
if not exist "logs" mkdir logs
scripts\nssm.exe set %SERVICE_NAME% AppStdout "%CURRENT_DIR%\logs\service.log"
scripts\nssm.exe set %SERVICE_NAME% AppStderr "%CURRENT_DIR%\logs\service_error.log"

REM 配置重启策略
scripts\nssm.exe set %SERVICE_NAME% AppExit Default Restart
scripts\nssm.exe set %SERVICE_NAME% AppRestartDelay 5000

REM 启动服务
echo 启动服务...
scripts\nssm.exe start %SERVICE_NAME%

REM 检查服务状态
timeout /t 3 >nul
sc query %SERVICE_NAME%

echo.
echo ================================
echo 服务安装完成！
echo 服务名称: %SERVICE_NAME%
echo 显示名称: 仓储监控系统后端服务
echo 日志目录: %CURRENT_DIR%\logs
echo.
echo 服务管理命令:
echo   启动服务: net start %SERVICE_NAME%
echo   停止服务: net stop %SERVICE_NAME%
echo   查看状态: sc query %SERVICE_NAME%
echo ================================
pause 