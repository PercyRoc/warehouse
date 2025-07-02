@echo off
chcp 65001 >nul 2>&1
title 更新仓储配置管理服务 - 需要管理员权限

:: 检查管理员权限
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if %errorlevel% neq 0 (
    echo =========================================
    echo           需要管理员权限
    echo =========================================
    echo.
    echo 此操作需要管理员权限才能操作Windows服务
    echo 请右键点击此文件，选择"以管理员身份运行"
    echo.
    echo 按任意键退出...
    pause >nul
    exit /b 1
)

echo =========================================
echo      更新仓储配置管理服务
echo =========================================
echo.

:: 检查服务是否存在
sc query WarehouseConfigServer >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 未找到 WarehouseConfigServer 服务
    echo 请先运行 install-service-admin.bat 安装服务
    echo.
    echo 按任意键退出...
    pause >nul
    exit /b 1
)

echo 1. 停止配置管理服务...
sc stop WarehouseConfigServer
if %errorlevel% equ 0 (
    echo    ✅ 服务已停止
) else (
    echo    ⚠️ 服务可能已经停止或停止失败
)

:: 等待服务完全停止
echo 2. 等待服务完全停止...
timeout /t 3 /nobreak >nul

echo 3. 检查并更新依赖包...
if exist package.json (
    npm install
    if %errorlevel% equ 0 (
        echo    ✅ 依赖包更新完成
    ) else (
        echo    ❌ 依赖包更新失败
        echo    请检查网络连接或package.json文件
    )
) else (
    echo    ⚠️ 未找到package.json，跳过依赖包更新
)

echo 4. 启动配置管理服务...
sc start WarehouseConfigServer
if %errorlevel% equ 0 (
    echo    ✅ 服务启动成功
) else (
    echo    ❌ 服务启动失败
    echo    请检查日志文件或手动启动服务
)

:: 等待服务启动
echo 5. 验证服务状态...
timeout /t 5 /nobreak >nul

:: 测试服务健康状态
echo 6. 测试服务连接...
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://localhost:3001/health' -TimeoutSec 10; if ($response.StatusCode -eq 200) { Write-Host '    ✅ 服务健康检查通过' } else { Write-Host '    ⚠️ 服务响应异常' } } catch { Write-Host '    ❌ 服务连接失败: ' + $_.Exception.Message }"

echo.
echo =========================================
echo           更新完成！
echo =========================================
echo.
echo 服务状态检查:
sc query WarehouseConfigServer | findstr "STATE"
echo.
echo 服务地址: http://localhost:3001
echo 健康检查: http://localhost:3001/health
echo.
echo 如果服务未正常启动，请检查:
echo   1. 查看Windows事件日志
echo   2. 检查 logs/ 目录下的日志文件
echo   3. 手动运行: sc start WarehouseConfigServer
echo.

echo 按任意键退出...
pause >nul 