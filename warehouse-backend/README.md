# 仓储监控系统后端服务

独立的Node.js后端服务，用于连接设备TCP信号并通过WebSocket与前端通信。

## 🏗️ 架构图

```
设备 (TCP) ---> 后端服务 (WebSocket) ---> 前端监控
```

## 📋 功能特性

- ✅ **TCP客户端**: 连接设备接收信号 `OCCH2:1`
- ✅ **WebSocket服务器**: 与前端实时通信
- ✅ **包裹管理**: 自动生成包裹运动轨迹
- ✅ **自动重连**: TCP和WebSocket自动重连机制
- ✅ **前后端心跳**: WebSocket心跳机制，携带设备TCP连接状态，支持异常关机检测
- ✅ **智能分拣**: 负载平衡算法确保摆轮使用均匀，支持概率配置和策略优化
- ✅ **负载平衡**: 实时统计摆轮使用次数，自动选择负载最小的摆轮进行分拣
- ✅ **多实例部署**: 支持部署到多台电脑
- ✅ **配置化管理**: 通过配置文件管理设备信息
- ✅ **优雅关闭**: 支持SIGINT/SIGTERM信号

## 🚀 快速开始

### 1. 安装依赖

```bash
cd warehouse-backend
npm install
```

### 2. 配置设备信息

编辑 `config.json` 文件：

```json
{
  "deviceConfig": {
    "deviceId": "CAM_SKU_01",
    "deviceName": "SKU相机1", 
    "area": "SKU分拣区"
  },
  "tcpConfig": {
    "host": "192.168.1.100",
    "port": 8001
  },
  "webSocketConfig": {
    "port": 8080
  },
  "signalConfig": {
    "triggerSignal": "OCCH2:1"
  }
}
```

### 3. 启动服务

```bash
# 生产环境
npm start

# 开发环境
npm run dev
```

## 📝 配置说明

### deviceConfig - 设备配置
| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| deviceId | string | 设备唯一ID | `CAM_SKU_01` |
| deviceName | string | 设备名称 | `SKU相机1` |
| area | string | 设备所在区域 | `SKU分拣区` |

### tcpConfig - TCP连接配置  
| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| host | string | 设备IP地址 | `192.168.1.100` |
| port | number | 设备TCP端口 | `8001` |
| reconnectInterval | number | 重连间隔(毫秒) | `5000` |
| maxReconnectAttempts | number | 最大重连次数 | `10` |
| keepAlive | boolean | 启用TCP保活 | `true` |
| timeout | number | 连接超时(毫秒) | `30000` |

### webSocketConfig - WebSocket配置
| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| port | number | WebSocket端口 | `8080` |
| host | string | 监听地址 | `0.0.0.0` |

### signalConfig - 信号配置
| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| triggerSignal | string | 触发信号 | `OCCH2:1` |
| packageIdPrefix | string | 包裹ID前缀 | `PKG` |
| defaultSortCode | number | 默认格口号 | `1` |

### heartbeatConfig - WebSocket心跳配置
| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| enabled | boolean | 是否启用WebSocket心跳功能 | `true` |
| interval | number | 心跳发送间隔(毫秒) | `30000` |
| timeout | number | 前端超时阈值建议值(毫秒) | `90000` |
| enableOnlyWhenClientsConnected | boolean | 仅在有客户端连接时发送心跳 | `true` |

## 🔌 TCP信号协议

### 接收信号格式
```
OCCH2:1    // 信号名:值
OCCH2:3    // 格口3
OCCH2:5    // 格口5
```

### 信号处理流程
1. 接收设备TCP信号
2. 解析信号名和值
3. 检查是否为触发信号 `OCCH2:1`
4. 生成包裹ID和基本信息
5. 向前端发送触发通知
6. **前端智能生成分拣策略**

## 📡 WebSocket通信协议

### 发送给前端的消息

#### 包裹触发通知
```json
{
  "type": "packageReport",
  "data": {
    "packageId": "PKG_20241201T101530_001",
    "sourceDeviceId": "CAM_SKU_01", 
    "signalValue": "1",
    "timestamp": "2024-12-01T10:15:30.123Z"
  }
}
```
> 注：前端接收后将根据设备ID和配置自动生成随机分拣策略

#### 系统消息
```json
{
  "type": "systemMessage",
  "data": {
    "level": "info",
    "message": "设备连接已建立",
    "timestamp": "2024-12-01T10:15:30.123Z"
  }
}
```

## 🖥️ 多实例部署

### 部署方案

```bash
# 电脑A - SKU设备1
warehouse-backend-sku1/
├── config.json (deviceId: CAM_SKU_01, host: 192.168.1.100)
└── src/

# 电脑B - SKU设备2  
warehouse-backend-sku2/
├── config.json (deviceId: CAM_SKU_02, host: 192.168.1.101)
└── src/

# 电脑C - 扫码设备1
warehouse-backend-scan1/
├── config.json (deviceId: CAM_SCAN_01, host: 192.168.1.102)
└── src/
```

### 配置示例

**电脑A配置 (config.json):**
```json
{
  "deviceConfig": {
    "deviceId": "CAM_SKU_01",
    "deviceName": "SKU相机1",
    "area": "SKU分拣区"
  },
  "tcpConfig": {
    "host": "192.168.1.100",
    "port": 8001
  },
  "webSocketConfig": {
    "port": 8080
  }
}
```

**电脑B配置 (config.json):**
```json
{
  "deviceConfig": {
    "deviceId": "CAM_SKU_02", 
    "deviceName": "SKU相机2",
    "area": "SKU分拣区"
  },
  "tcpConfig": {
    "host": "192.168.1.101",
    "port": 8001
  },
  "webSocketConfig": {
    "port": 8081
  }
}
```

## 🧪 测试和调试

### 手动触发测试包裹

```bash
# 启动开发模式
NODE_ENV=development npm run dev

# 在Node.js控制台中执行
global.warehouseService.triggerTestPackage(1);  // 格口1
global.warehouseService.triggerTestPackage(3);  // 格口3
global.warehouseService.triggerTestPackage(5);  // 格口5
```

### 模拟TCP信号

```bash
# 使用netcat发送测试信号
echo "OCCH2:1" | nc 192.168.1.100 8001
echo "OCCH2:3" | nc 192.168.1.100 8001
echo "OCCH2:5" | nc 192.168.1.100 8001
```

### 日志输出

```
🔧 配置加载成功:
   设备ID: CAM_SKU_01
   设备名称: SKU相机1
   TCP地址: 192.168.1.100:8001
   WebSocket端口: 8080
   触发信号: OCCH2:1

🚀 初始化仓储后端服务...

✅ 包裹管理器初始化完成
✅ WebSocket服务器初始化完成
✅ TCP客户端初始化完成
✅ 定时任务启动完成

🎉 仓储后端服务启动成功！

[TCP] 📨 收到数据: OCCH2:3
🔔 收到设备信号: OCCH2 = 3
📦 包裹创建成功，已发送到前端: PKG_20241201T101530_001
```

## 🛠️ 运维管理

### 系统监控

服务提供以下监控端点：

- **系统状态**: 通过WebSocket发送 `getSystemStatus` 消息
- **包裹统计**: 通过WebSocket发送 `getStatistics` 消息
- **包裹历史**: 通过WebSocket发送 `getPackageHistory` 消息

### 进程管理

```bash
# 使用PM2管理进程
npm install -g pm2

# 启动服务
pm2 start src/app.js --name warehouse-backend

# 查看状态
pm2 status

# 查看日志
pm2 logs warehouse-backend

# 重启服务
pm2 restart warehouse-backend

# 停止服务
pm2 stop warehouse-backend
```

### 开机自启

```bash
# 设置PM2开机自启
pm2 startup
pm2 save
```

## 🔧 故障排除

### 常见问题

**1. TCP连接失败**
- 检查设备IP地址和端口
- 确认设备TCP服务是否启动
- 检查网络连通性: `ping 192.168.1.100`
- 检查端口是否开放: `telnet 192.168.1.100 8001`

**2. WebSocket连接失败**
- 检查端口是否被占用: `netstat -an | grep 8080`
- 确认防火墙设置
- 检查前端连接地址

**3. 包裹不生成**
- 确认接收到的信号格式: `OCCH2:1`
- 检查触发信号配置
- 确认TCP设备连接状态
- 查看控制台日志输出

**4. 心跳机制问题**
- WebSocket心跳：检查前后端连接状态
- TCP连接：无需心跳，连接状态即设备状态
- 前端显示异常：检查WebSocket心跳是否正常

### 日志级别

可以通过环境变量设置日志级别：

```bash
LOG_LEVEL=debug npm start
```

## 📦 项目结构

```
warehouse-backend/
├── package.json          # 项目配置
├── config.json          # 运行时配置  
├── README.md            # 说明文档
└── src/
    ├── app.js           # 主程序入口
    ├── TcpClient.js     # TCP客户端
    ├── WebSocketServer.js # WebSocket服务器
    └── PackageManager.js  # 包裹管理器
```

## 📋 相关文档

- [开机自启部署指南](README_STARTUP.md) - Windows开机自启配置
- [前后端心跳机制](README_HEARTBEAT.md) - WebSocket心跳与设备状态监控详解
- [随机分拣机制](README_RANDOM_SORTING.md) - 智能分拣策略详解

## 🔄 版本更新

### v1.4.0 (最新)
- ✅ 摆轮负载平衡算法
- ✅ 智能分拣负载均衡，确保每个摆轮使用次数平均
- ✅ 实时负载统计和平衡度评分
- ✅ 负载平衡管理API和监控工具

### v1.3.0
- ✅ 基于TCP状态的心跳机制
- ✅ 分层状态管理（设备状态 vs 后端服务状态）
- ✅ 真实TCP连接状态监控
- ✅ 修复TCP设备无心跳响应的问题

### v1.2.1
- ✅ 路径特定方向限制
- ✅ SKU线1仅左摆，SKU线2仅右摆
- ✅ 扫码线1仅左摆，扫码线2仅右摆
- ✅ 更智能的分拣方向选择算法

### v1.2.0
- ✅ 随机分拣机制
- ✅ 智能分拣策略
- ✅ 可配置分拣概率
- ✅ 路径差异化分拣

### v1.1.0
- ✅ 前后端心跳机制
- ✅ 异常关机检测
- ✅ 设备状态可视化
- ✅ WebSocket心跳超时告警

### v1.0.0
- ✅ 基础TCP连接功能
- ✅ WebSocket服务器
- ✅ 包裹生成和管理
- ✅ 自动重连机制
- ✅ 多实例部署支持

## 📞 技术支持

如有问题请联系技术支持或查看日志文件进行排查。 