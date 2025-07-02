# 仓储监控系统 - Windows开机自启部署指南

## 🚀 功能特性

- **自动设备上下线通知**: 后端服务启动时自动发送设备上线消息，关闭时发送下线消息
- **开机自启**: 支持Windows任务计划程序和Windows服务两种开机自启方式
- **故障重启**: 服务异常退出时自动重启
- **优雅关闭**: 确保设备下线通知正常发送

## 📦 部署方式选择

### 方式一: Windows任务计划程序 (推荐)
✅ 配置简单，无需额外工具  
✅ 支持日志记录  
✅ 易于管理和调试  

### 方式二: Windows服务
✅ 后台运行，用户无感知  
✅ 系统级别的权限管理  
❌ 需要下载NSSM工具  

## 🛠️ 方式一: 任务计划程序部署

### 1. 安装开机自启
```powershell
# 以管理员身份打开PowerShell
cd warehouse-backend\scripts
.\install-startup.ps1 -Action install
```

### 2. 检查任务状态
```powershell
.\install-startup.ps1 -Action status
```

### 3. 卸载开机自启
```powershell
.\install-startup.ps1 -Action uninstall
```

### 4. 手动管理任务
- 打开"任务计划程序" (taskschd.msc)
- 查找任务: `WarehouseBackendService`
- 可以手动启动/停止/禁用任务

## 🔧 方式二: Windows服务部署

### 1. 下载NSSM工具
- 访问: https://nssm.cc/download
- 下载适合系统的版本（32位或64位）
- 将 `nssm.exe` 放置到 `warehouse-backend\scripts\` 目录

### 2. 安装Windows服务
```cmd
# 以管理员身份打开命令提示符
cd warehouse-backend\scripts
install-service.bat
```

### 3. 服务管理命令
```cmd
# 启动服务
net start WarehouseBackendService

# 停止服务
net stop WarehouseBackendService

# 查看服务状态
sc query WarehouseBackendService
```

### 4. 卸载Windows服务
```cmd
uninstall-service.bat
```

## 📊 设备上下线流程

### 设备上线流程
1. 后端服务启动 (开机自启或手动启动)
2. WebSocket服务器启动成功
3. 延迟2秒等待前端连接
4. 自动发送设备上线消息:
   ```json
   {
     "type": "deviceStatus",
     "data": {
       "deviceId": "CAM_SKU_01",
       "status": "ONLINE",
       "timestamp": "2024-12-01T10:00:00.000Z"
     }
   }
   ```

### 设备下线流程
1. 接收到关闭信号 (Ctrl+C, 系统关机等)
2. 发送设备下线消息:
   ```json
   {
     "type": "deviceStatus", 
     "data": {
       "deviceId": "CAM_SKU_01",
       "status": "OFFLINE",
       "timestamp": "2024-12-01T10:30:00.000Z"
     }
   }
   ```
3. 等待1秒确保消息发送完成
4. 优雅关闭TCP连接和WebSocket服务器

## 📝 日志文件位置

### 任务计划程序方式
- 控制台日志: 直接在任务计划程序中查看
- 应用日志: `warehouse-backend\logs\app.log` (如果配置了文件日志)

### Windows服务方式  
- 服务日志: `warehouse-backend\logs\service.log`
- 错误日志: `warehouse-backend\logs\service_error.log`

## 🔍 故障排查

### 1. 检查Node.js环境
```cmd
node --version
npm --version
```

### 2. 手动测试启动
```cmd
cd warehouse-backend
node src/app.js
```

### 3. 检查端口占用
```cmd
netstat -ano | findstr :8080
```

### 4. 查看任务计划程序日志
- 打开"事件查看器" (eventvwr.msc)
- 导航到: Windows日志 → 系统
- 筛选事件源: Task Scheduler

### 5. 检查防火墙设置
确保WebSocket端口(8080)和TCP端口(8001)未被防火墙阻止

## 🎯 多设备部署示例

### 设备配置表
| 设备ID | 设备名称 | TCP端口 | WebSocket端口 | 部署电脑 |
|--------|----------|---------|---------------|----------|
| CAM_SKU_01 | SKU相机1 | 8001 | 8080 | 电脑A |
| CAM_SKU_02 | SKU相机2 | 8001 | 8081 | 电脑B |
| CAM_REG_01 | 大区相机1 | 8001 | 8082 | 电脑C |

### 配置文件修改
每台电脑的 `config/config.json`:
```json
{
  "deviceConfig": {
    "deviceId": "CAM_SKU_01",
    "deviceName": "SKU相机1"
  },
  "webSocketConfig": {
    "port": 8080
  }
}
```

### 前端连接配置
在前端 `src/services/WpfIntegrationConfig.js` 中配置所有后端服务器:
```javascript
const servers = [
  { url: 'ws://192.168.1.100:8080', name: 'SKU相机1' },
  { url: 'ws://192.168.1.101:8081', name: 'SKU相机2' },
  { url: 'ws://192.168.1.102:8082', name: '大区相机1' }
];
```

## ✅ 验证部署成功

1. **设备上线测试**: 重启电脑，检查前端是否显示设备在线状态
2. **信号测试**: 使用netcat模拟发送TCP信号，验证包裹生成
3. **设备下线测试**: 关闭服务，检查前端是否显示设备离线状态
4. **故障恢复测试**: 模拟服务异常，验证自动重启功能

## 📞 技术支持

如遇到部署问题，请提供以下信息:
- Windows版本和架构
- Node.js版本
- 错误日志内容
- 网络配置信息 