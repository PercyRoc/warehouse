@echo off
echo 卸载仓储监控系统Windows服务
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

REM 检查服务是否存在
echo 检查服务状态...
sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 服务不存在或已被删除
    pause
    exit /b 0
)

REM 显示当前服务状态
echo 当前服务状态:
sc query %SERVICE_NAME%

echo.
echo 确定要卸载服务吗？(Y/N)
set /p CONFIRM=请输入选择: 
if /i "%CONFIRM%" NEQ "Y" (
    echo 操作已取消
    pause
    exit /b 0
)

REM 停止服务
echo 正在停止服务...
scripts\nssm.exe stop %SERVICE_NAME%
timeout /t 3 >nul

REM 删除服务
echo 正在删除服务...
scripts\nssm.exe remove %SERVICE_NAME% confirm

REM 检查删除结果
sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ================================
    echo 服务卸载成功！
    echo ================================
) else (
    echo ================================
    echo 服务卸载失败，请手动删除
    echo ================================
)

pause