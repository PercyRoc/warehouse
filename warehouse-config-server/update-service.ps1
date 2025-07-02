# PowerShell版本的配置服务更新脚本
# 支持更好的中文显示和错误处理

param(
    [switch]$Force = $false
)

# 设置控制台编码为UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 检查管理员权限
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 显示带颜色的消息
function Write-ColorMessage {
    param(
        [string]$Message,
        [string]$Color = "White",
        [string]$Icon = ""
    )
    
    if ($Icon) {
        Write-Host "$Icon " -NoNewline -ForegroundColor $Color
    }
    Write-Host $Message -ForegroundColor $Color
}

# 显示标题
function Show-Title {
    Clear-Host
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "      更新仓储配置管理服务" -ForegroundColor Yellow
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
}

# 检查服务状态
function Test-ServiceExists {
    param([string]$ServiceName)
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

# 获取服务状态
function Get-ServiceStatus {
    param([string]$ServiceName)
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        return $service.Status
    }
    catch {
        return "NotFound"
    }
}

# 停止服务
function Stop-ConfigService {
    param([string]$ServiceName)
    
    Write-ColorMessage "正在停止配置管理服务..." "Yellow" "🔄"
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        
        if ($service.Status -eq "Running") {
            Stop-Service -Name $ServiceName -Force -ErrorAction Stop
            Write-ColorMessage "服务已停止" "Green" "✅"
            
            # 等待服务完全停止
            $timeout = 30
            $elapsed = 0
            do {
                Start-Sleep -Seconds 1
                $elapsed++
                $service.Refresh()
            } while ($service.Status -ne "Stopped" -and $elapsed -lt $timeout)
            
            if ($service.Status -ne "Stopped") {
                Write-ColorMessage "警告: 服务可能未完全停止" "Yellow" "⚠️"
            }
        } else {
            Write-ColorMessage "服务已经停止" "Green" "✅"
        }
        
        return $true
    }
    catch {
        Write-ColorMessage "停止服务失败: $($_.Exception.Message)" "Red" "❌"
        return $false
    }
}

# 启动服务
function Start-ConfigService {
    param([string]$ServiceName)
    
    Write-ColorMessage "正在启动配置管理服务..." "Yellow" "🔄"
    
    try {
        Start-Service -Name $ServiceName -ErrorAction Stop
        Write-ColorMessage "服务启动成功" "Green" "✅"
        
        # 等待服务完全启动
        Start-Sleep -Seconds 3
        
        return $true
    }
    catch {
        Write-ColorMessage "启动服务失败: $($_.Exception.Message)" "Red" "❌"
        return $false
    }
}

# 更新依赖包
function Update-Dependencies {
    Write-ColorMessage "检查并更新依赖包..." "Yellow" "📦"
    
    if (Test-Path "package.json") {
        try {
            $result = & npm install
            if ($LASTEXITCODE -eq 0) {
                Write-ColorMessage "依赖包更新完成" "Green" "✅"
                return $true
            } else {
                Write-ColorMessage "依赖包更新失败" "Red" "❌"
                return $false
            }
        }
        catch {
            Write-ColorMessage "依赖包更新失败: $($_.Exception.Message)" "Red" "❌"
            return $false
        }
    } else {
        Write-ColorMessage "未找到package.json，跳过依赖包更新" "Yellow" "⚠️"
        return $true
    }
}

# 测试服务连接
function Test-ServiceConnection {
    Write-ColorMessage "测试服务连接..." "Yellow" "🌐"
    
    $maxRetries = 5
    $retryDelay = 2
    
    for ($i = 1; $i -le $maxRetries; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -TimeoutSec 10 -ErrorAction Stop
            
            if ($response.StatusCode -eq 200) {
                Write-ColorMessage "服务健康检查通过" "Green" "✅"
                return $true
            }
        }
        catch {
            if ($i -lt $maxRetries) {
                Write-ColorMessage "连接失败，$retryDelay 秒后重试... ($i/$maxRetries)" "Yellow" "🔄"
                Start-Sleep -Seconds $retryDelay
            }
        }
    }
    
    Write-ColorMessage "服务连接失败，请检查服务状态" "Red" "❌"
    return $false
}

# 显示服务状态
function Show-ServiceStatus {
    param([string]$ServiceName)
    
    Write-Host ""
    Write-ColorMessage "服务状态检查:" "Cyan" "📊"
    
    try {
        $service = Get-Service -Name $ServiceName -ErrorAction Stop
        $status = $service.Status
        $statusColor = if ($status -eq "Running") { "Green" } else { "Red" }
        
        Write-Host "  服务名称: " -NoNewline
        Write-Host $ServiceName -ForegroundColor White
        Write-Host "  运行状态: " -NoNewline
        Write-Host $status -ForegroundColor $statusColor
        Write-Host "  启动类型: " -NoNewline
        Write-Host $service.StartType -ForegroundColor White
    }
    catch {
        Write-ColorMessage "无法获取服务状态: $($_.Exception.Message)" "Red" "❌"
    }
}

# 主程序
function Main {
    Show-Title
    
    # 检查管理员权限
    if (-not (Test-Administrator)) {
        Write-ColorMessage "需要管理员权限" "Red" "🔒"
        Write-Host ""
        Write-Host "此操作需要管理员权限才能操作Windows服务"
        Write-Host "请右键点击PowerShell，选择'以管理员身份运行'"
        Write-Host ""
        Read-Host "按Enter键退出"
        exit 1
    }
    
    $serviceName = "WarehouseConfigServer"
    
    # 检查服务是否存在
    if (-not (Test-ServiceExists $serviceName)) {
        Write-ColorMessage "未找到 $serviceName 服务" "Red" "❌"
        Write-Host "请先运行 install-service-admin.bat 安装服务"
        Write-Host ""
        Read-Host "按Enter键退出"
        exit 1
    }
    
    Write-ColorMessage "开始更新配置管理服务..." "Green" "🚀"
    Write-Host ""
    
    # 1. 停止服务
    if (-not (Stop-ConfigService $serviceName)) {
        Write-Host ""
        Read-Host "按Enter键退出"
        exit 1
    }
    
    Write-Host ""
    
    # 2. 更新依赖包
    if (-not (Update-Dependencies)) {
        Write-ColorMessage "依赖包更新失败，但将继续启动服务" "Yellow" "⚠️"
    }
    
    Write-Host ""
    
    # 3. 启动服务
    if (-not (Start-ConfigService $serviceName)) {
        Write-Host ""
        Read-Host "按Enter键退出"
        exit 1
    }
    
    Write-Host ""
    
    # 4. 测试连接
    Test-ServiceConnection | Out-Null
    
    # 5. 显示最终状态
    Show-ServiceStatus $serviceName
    
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "           更新完成！" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "服务地址: " -NoNewline
    Write-Host "http://localhost:3001" -ForegroundColor Yellow
    Write-Host "健康检查: " -NoNewline
    Write-Host "http://localhost:3001/health" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "如果遇到问题，请检查:"
    Write-Host "  1. Windows事件日志"
    Write-Host "  2. logs/ 目录下的日志文件"
    Write-Host "  3. 确保端口3001未被占用"
    Write-Host ""
    
    Read-Host "按Enter键退出"
}

# 运行主程序
Main 