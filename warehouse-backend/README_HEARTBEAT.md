# 仓储监控系统 - 前后端心跳机制

## 📋 概述

前后端心跳机制解决了电脑异常关机或网络中断时，前端无法及时感知后端服务状态的问题。系统采用**WebSocket心跳机制**，后端定期发送心跳包给前端，同时携带设备TCP连接状态信息，确保前端能够准确反映系统的实时状态。

### 🔑 **核心理念**

- **设备状态 = TCP连接状态**：设备在线与否完全基于TCP连接是否正常
- **TCP通讯无需心跳**：TCP连接本身就是最好的连接状态指示器
- **WebSocket心跳**：后端定期向前端发送心跳包，携带设备TCP状态信息
- **分层监控**：监控设备状态（TCP连接）和后端服务状态（WebSocket心跳）

## 🎯 解决的问题

### 原有问题
- **正常关机**：后端会发送下线通知，但等待时间有限（1秒）
- **异常关机**：断电、强制关机、系统崩溃时无法发送下线通知
- **后端服务离线**：前端无法及时感知后端服务状态
- **设备状态同步**：前端需要实时了解设备TCP连接状态

### 解决方案
- **WebSocket心跳机制**：后端定期向前端发送心跳包
- **TCP状态携带**：心跳包中携带设备TCP连接状态信息
- **无需TCP心跳**：TCP连接本身就能反映设备状态，无需额外心跳
- **分层状态管理**：区分设备状态（TCP连接）和后端服务状态（WebSocket心跳）
- **状态恢复**：设备重新连接时自动恢复在线状态

## 🔧 技术实现

### 后端实现（Node.js）

#### 1. 配置文件 (`config.json`)
```json
{
  "heartbeatConfig": {
    "enabled": true,                      // 是否启用心跳功能
    "interval": 30000,                    // 心跳发送间隔（毫秒）
    "timeout": 90000,                     // 前端超时阈值建议值
    "enableOnlyWhenClientsConnected": true // 仅在有客户端连接时发送心跳
  }
}
```

#### 2. WebSocket服务器心跳功能
```javascript
// 启动设备心跳上报
startDeviceHeartbeat() {
  this.deviceHeartbeatInterval = setInterval(() => {
    if (this.clients.size > 0 && this.deviceInfo) {
      this.broadcastDeviceHeartbeat();
    }
  }, this.heartbeatInterval);
}

// 广播设备心跳
broadcastDeviceHeartbeat() {
  const heartbeatData = {
    deviceId: this.deviceInfo.deviceId,
    deviceName: this.deviceInfo.deviceName,
    lastHeartbeat: new Date().toISOString(),
    uptime: Date.now() - new Date(this.deviceInfo.startTime).getTime(),
    area: this.deviceInfo.area,
    clientCount: this.clients.size
  };
  
  this.broadcast({
    type: 'deviceHeartbeat',
    data: heartbeatData
  });
}
```

#### 3. 心跳消息格式
```json
{
  "type": "deviceHeartbeat",
  "data": {
    "deviceId": "CAM_SKU_01",
    "deviceName": "SKU相机1",
    "area": "SKU分拣区",
    "lastHeartbeat": "2024-12-01T10:15:30.123Z",
    "uptime": 3600000,
    "startTime": "2024-12-01T09:15:30.123Z",
    "version": "1.0.0",
    "clientCount": 2,
    "tcpConnected": true,
    "status": "ONLINE",
    "tcpLastUpdate": "2024-12-01T10:15:30.123Z",
    "tcpConfig": {
      "host": "192.168.1.100",
      "port": 8001,
      "connected": true
    }
  }
}
```

### 前端实现（Vue.js）

#### 1. 心跳检测器
```javascript
class WebSocketClient {
  constructor() {
    this.deviceHeartbeats = new Map();     // 存储设备心跳信息
    this.heartbeatTimeout = 90000;         // 90秒超时时间
    this.heartbeatCheckInterval = null;    // 心跳检查定时器
    this.heartbeatCheckFrequency = 15000;  // 15秒检查一次
  }
  
  // 启动心跳检查
  startHeartbeatCheck() {
    this.heartbeatCheckInterval = setInterval(() => {
      this.checkDeviceHeartbeats();
    }, this.heartbeatCheckFrequency);
  }
  
  // 检查设备心跳状态
  checkDeviceHeartbeats() {
    const now = Date.now();
    this.deviceHeartbeats.forEach((heartbeatInfo, deviceId) => {
      const timeSinceLastHeartbeat = now - heartbeatInfo.lastHeartbeatTime;
      
      if (timeSinceLastHeartbeat > this.heartbeatTimeout) {
        // 设备心跳超时
        this.handleDeviceTimeout(deviceId, heartbeatInfo);
      } else if (heartbeatInfo.status === 'TIMEOUT') {
        // 设备心跳恢复
        this.handleDeviceRecovered(deviceId, heartbeatInfo);
      }
    });
  }
}
```

#### 2. 设备状态可视化
- **在线设备**：正常颜色显示
- **离线设备**：降低透明度(50%)，显示灰色
- **状态指示器**：
  - 🟢 绿色：在线 (ONLINE)
  - 🔴 红色：离线 (OFFLINE)  
  - 🟠 橙色：心跳超时 (TIMEOUT)
  - ⚪ 灰色：未知状态 (UNKNOWN)

## 📊 通信时序图

```
TCP设备      后端服务      WebSocket服务器    前端监控界面
   |            |              |                |
   |--TCP连接--->|              |                |
   |            |--设备启动---->|                |
   |            |              |----设备上线---->|
   |            |              |                |
   |--信号数据--->|              |                |
   |            |              |--心跳包(携带TCP:在线)--->|  ✅ 后端在线,设备在线
   |            |              |--心跳包(携带TCP:在线)--->|  ✅ 后端在线,设备在线
   |            |              |--心跳包(携带TCP:在线)--->|  ✅ 后端在线,设备在线
   |            |              |                |
   |--TCP断开--->|              |                |
   |            |              |--心跳包(携带TCP:离线)--->|  ✅ 后端在线,❌ 设备离线
   |            |              |                |
   |            |--异常关机---->|                |
   |            |              |                |  ⏱️ 等待90秒心跳超时
   |            |              |                |
   |            |              |                |  ❌ 后端服务超时
   |            |              |                |  ⚠️ 保持最后设备TCP状态
```

## ⚙️ 配置参数说明

### 后端配置

| 参数 | 说明 | 默认值 | 推荐值 |
|------|------|--------|--------|
| `enabled` | 是否启用心跳功能 | `true` | `true` |
| `interval` | 心跳发送间隔 | `30000`(30秒) | `30000` |
| `enableOnlyWhenClientsConnected` | 仅在有客户端时发送 | `true` | `true` |

### 前端配置

| 参数 | 说明 | 默认值 | 推荐值 |
|------|------|--------|--------|
| `heartbeatTimeout` | 心跳超时阈值 | `90000`(90秒) | `90000` |
| `heartbeatCheckFrequency` | 检查频率 | `15000`(15秒) | `15000` |

### 时间配置建议

- **心跳间隔**: 30秒（平衡网络负载和响应速度）
- **超时阈值**: 90秒（3倍心跳间隔，避免网络波动误报）
- **检查频率**: 15秒（及时发现超时，避免过于频繁检查）

## 🔍 监控和调试

### 后端日志示例
```
[WebSocket] 💓 设置心跳配置: 间隔30000ms，启用: true
[WebSocket] 🫀 启动WebSocket心跳上报，间隔: 30秒
[TCP] ✅ 成功连接到 192.168.1.100:8001
🔄 设备 CAM_SKU_01 TCP状态已更新: 已连接
[WebSocket] 💓 发送心跳包: CAM_SKU_01 (TCP状态: 已连接)
[TCP] ❌ 连接已关闭
🔄 设备 CAM_SKU_01 TCP状态已更新: 已断开
[WebSocket] 💓 发送心跳包: CAM_SKU_01 (TCP状态: 已断开)
[WebSocket] 💔 停止WebSocket心跳上报
```

### 前端日志示例
```
💓 启动WebSocket心跳检查，检查间隔: 15秒，超时阈值: 90秒
💓 收到后端心跳包，设备 CAM_SKU_01 TCP状态: 已连接，设备状态: ONLINE
💓 收到后端心跳包，设备 CAM_SKU_01 TCP状态: 已断开，设备状态: OFFLINE
⚠️ 后端服务 CAM_SKU_01 心跳超时，最后心跳: 2024-12-01T10:15:30.123Z
   设备最后TCP状态: 已断开
✅ 后端服务 CAM_SKU_01 (SKU相机1) 心跳恢复正常
```

### 手动测试命令

#### 测试心跳功能
```javascript
// 前端控制台执行
webSocketClient.requestDeviceHeartbeat(); // 手动请求心跳
webSocketClient.getAllDeviceHeartbeats(); // 查看所有设备心跳状态
webSocketClient.getDetailedConnectionState(); // 查看连接状态
```

## 🚀 部署注意事项

### 1. 网络环境
- 确保WebSocket端口（8080）未被防火墙阻止
- 确保TCP端口（8001）未被防火墙阻止
- 建议在局域网环境下部署，减少网络延迟

### 2. 系统资源
- WebSocket心跳功能会产生少量网络流量（约100字节/30秒/后端服务）
- TCP连接无额外心跳开销，仅使用基础连接资源
- 对系统性能影响极小

### 3. 多设备部署
```javascript
// 不同设备使用不同的配置
// 设备1 (config.json)
{
  "deviceConfig": {
    "deviceId": "CAM_SKU_01",
    "deviceName": "SKU相机1"
  },
  "webSocketConfig": { "port": 8080 }
}

// 设备2 (config.json)  
{
  "deviceConfig": {
    "deviceId": "CAM_SKU_02", 
    "deviceName": "SKU相机2"
  },
  "webSocketConfig": { "port": 8081 }
}
```

### 4. 故障处理

#### WebSocket心跳丢失
1. 检查后端服务运行状态
2. 查看后端服务日志
3. 确认WebSocket连接状态
4. 重启后端服务

#### 设备连接异常
1. 检查设备TCP网络连接
2. 确认设备IP和端口配置
3. 查看TCP连接日志
4. 重启设备或后端服务

#### 前端显示异常
1. 刷新前端页面
2. 检查浏览器控制台错误
3. 确认与后端的WebSocket连接

## 📈 性能优化

### 1. 网络优化
- 心跳消息使用JSON格式，数据量小
- 支持WebSocket压缩（`perMessageDeflate`）

### 2. 内存优化
- 使用Map数据结构存储设备状态
- 自动清理断开连接的设备信息

### 3. CPU优化
- 心跳检查使用定时器，避免轮询
- 批量处理多设备超时事件

## 🔄 未来扩展

### 1. 增强功能
- 支持设备性能指标上报（CPU、内存、磁盘）
- 添加心跳质量统计（延迟、丢包率）
- 支持自适应心跳间隔

### 2. 告警机制
- 设备离线时发送邮件/短信通知
- 集成第三方监控系统
- 历史状态数据存储和分析

### 3. 高可用性
- 支持多个前端监控节点
- 添加心跳数据持久化
- 实现设备状态同步机制

---

💡 **提示**: 心跳机制已完全自动化，无需手动干预。系统会自动处理设备上下线、网络异常等各种情况。 