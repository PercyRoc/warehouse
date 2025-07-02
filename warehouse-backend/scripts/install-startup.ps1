# 仓储监控系统 - 开机自启配置脚本
# 使用任务计划程序实现开机自启

param(
    [string]$Action = "install"
)

# 检查管理员权限
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "错误: 需要管理员权限运行此脚本" -ForegroundColor Red
    Write-Host "请右键点击PowerShell，选择'以管理员身份运行'" -ForegroundColor Yellow
    Read-Host "按回车键退出"
    exit 1
}

# 配置参数
$TaskName = "WarehouseBackendService"
$TaskDescription = "仓储监控系统后端服务 - 开机自启"
$ScriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectPath = Split-Path -Parent $ScriptPath
$StartScript = Join-Path $ProjectPath "scripts\start-service.bat"

Write-Host "仓储监控系统 - 开机自启配置" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green

switch ($Action.ToLower()) {
    "install" {
        Write-Host "正在安装开机自启任务..." -ForegroundColor Yellow
        
        # 检查启动脚本是否存在
        if (-not (Test-Path $StartScript)) {
            Write-Host "错误: 启动脚本不存在: $StartScript" -ForegroundColor Red
            exit 1
        }
        
        # 删除现有任务（如果存在）
        $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existingTask) {
            Write-Host "删除现有任务..." -ForegroundColor Yellow
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        }
        
        # 创建任务触发器（开机时启动）
        $trigger = New-ScheduledTaskTrigger -AtStartup
        
        # 创建任务动作
        $action = New-ScheduledTaskAction -Execute $StartScript -WorkingDirectory $ProjectPath
        
        # 创建任务主体（以系统权限运行）
        $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
        
        # 创建任务设置
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
        
        # 注册任务
        Register-ScheduledTask -TaskName $TaskName -Description $TaskDescription -Trigger $trigger -Action $action -Principal $principal -Settings $settings
        
        Write-Host "开机自启任务安装成功！" -ForegroundColor Green
        Write-Host "任务名称: $TaskName" -ForegroundColor Cyan
        Write-Host "启动脚本: $StartScript" -ForegroundColor Cyan
        
        # 显示任务信息
        Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, Author
    }
    
    "uninstall" {
        Write-Host "正在卸载开机自启任务..." -ForegroundColor Yellow
        
        $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existingTask) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Host "开机自启任务卸载成功！" -ForegroundColor Green
        } else {
            Write-Host "任务不存在，无需卸载" -ForegroundColor Yellow
        }
    }
    
    "status" {
        Write-Host "检查任务状态..." -ForegroundColor Yellow
        
        $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($existingTask) {
            Write-Host "任务状态:" -ForegroundColor Green
            Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, Author | Format-Table -AutoSize
            
            Write-Host "最近运行记录:" -ForegroundColor Green
            Get-ScheduledTaskInfo -TaskName $TaskName | Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize
        } else {
            Write-Host "未找到开机自启任务" -ForegroundColor Yellow
        }
    }
    
    default {
        Write-Host "用法:" -ForegroundColor Yellow
        Write-Host "  安装开机自启: .\install-startup.ps1 -Action install" -ForegroundColor White
        Write-Host "  卸载开机自启: .\install-startup.ps1 -Action uninstall" -ForegroundColor White
        Write-Host "  查看状态:     .\install-startup.ps1 -Action status" -ForegroundColor White
    }
}

Write-Host "================================" -ForegroundColor Green
Read-Host "按回车键退出" 