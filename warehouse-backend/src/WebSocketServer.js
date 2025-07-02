const WebSocket = require('ws');
const EventEmitter = require('events');

class WebSocketServer extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.wss = null;
    this.clients = new Set();
    this.isRunning = false;
    this.deviceHeartbeatInterval = null; // 设备心跳定时器
    this.heartbeatInterval = 30000; // 30秒心跳间隔（默认值）
    this.deviceInfo = null; // 设备信息
    this.heartbeatConfig = null; // 心跳配置
    
    this.start();
  }

  start() {
    try {
      console.log(`[WebSocket] 启动服务器，监听 ${this.config.host}:${this.config.port}`);
      
      this.wss = new WebSocket.Server({
        host: this.config.host,
        port: this.config.port,
        perMessageDeflate: false
      });

      this.wss.on('listening', () => {
        console.log(`[WebSocket] ✅ 服务器启动成功，地址: ws://${this.config.host}:${this.config.port}`);
        this.isRunning = true;
        this.emit('listening');
      });

      this.wss.on('connection', (ws, request) => {
        const clientInfo = {
          ip: request.socket.remoteAddress,
          userAgent: request.headers['user-agent'],
          connectTime: new Date().toISOString()
        };
        
        console.log(`[WebSocket] 🔗 新客户端连接: ${clientInfo.ip}`);
        this.clients.add(ws);
        
        // 设置心跳
        ws.isAlive = true;
        ws.lastPongTime = Date.now();
        
        ws.on('pong', () => {
          ws.isAlive = true;
          ws.lastPongTime = Date.now();
        });

        // 监听客户端消息
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log(`[WebSocket] 📨 收到客户端消息:`, message);
            this.handleClientMessage(ws, message, clientInfo);
          } catch (error) {
            console.error(`[WebSocket] ❌ 解析客户端消息失败:`, error);
          }
        });

        // 客户端断开连接
        ws.on('close', (code, reason) => {
          console.log(`[WebSocket] ❌ 客户端断开连接: ${clientInfo.ip} (${code})`);
          this.clients.delete(ws);
          
          // 如果没有客户端连接了，停止设备心跳
          if (this.clients.size === 0) {
            this.stopDeviceHeartbeat();
          }
        });

        // 连接错误
        ws.on('error', (error) => {
          console.error(`[WebSocket] ⚠️ 客户端连接错误:`, error);
          this.clients.delete(ws);
        });

        // 发送欢迎消息
        this.sendToClient(ws, {
          type: 'connected',
          data: {
            message: '连接成功',
            serverTime: new Date().toISOString(),
            clientCount: this.clients.size,
            deviceInfo: this.deviceInfo
          }
        });

        // 如果是第一个客户端连接，启动设备心跳
        if (this.clients.size === 1) {
          this.startDeviceHeartbeat();
        }
      });

      this.wss.on('error', (error) => {
        console.error(`[WebSocket] ❌ 服务器错误:`, error);
        this.emit('error', error);
      });

      // 启动WebSocket连接心跳检测
      this.startWebSocketHeartbeat();

    } catch (error) {
      console.error(`[WebSocket] ❌ 启动失败:`, error);
      this.emit('error', error);
    }
  }

  // 启动WebSocket连接心跳检测
  startWebSocketHeartbeat() {
    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          console.log(`[WebSocket] 💔 检测到僵尸连接，终止连接`);
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30秒心跳

    this.wss.on('close', () => {
      clearInterval(interval);
    });
  }

  // 启动设备状态心跳上报
  startDeviceHeartbeat() {
    if (this.deviceHeartbeatInterval) {
      return; // 已经启动了
    }

    console.log(`[WebSocket] 🫀 启动设备心跳上报，间隔: ${this.heartbeatInterval/1000}秒`);
    
    this.deviceHeartbeatInterval = setInterval(() => {
      if (this.clients.size > 0 && this.deviceInfo) {
        this.broadcastDeviceHeartbeat();
      }
    }, this.heartbeatInterval);
  }

  // 停止设备状态心跳上报
  stopDeviceHeartbeat() {
    if (this.deviceHeartbeatInterval) {
      console.log(`[WebSocket] 💔 停止设备心跳上报`);
      clearInterval(this.deviceHeartbeatInterval);
      this.deviceHeartbeatInterval = null;
    }
  }

  // 设置设备信息（从主程序传入）
  setDeviceInfo(deviceInfo) {
    this.deviceInfo = {
      ...deviceInfo,
      lastHeartbeat: new Date().toISOString()
    };
    console.log(`[WebSocket] 📝 设置设备信息:`, this.deviceInfo);
  }

  // 设置心跳配置（从主程序传入）
  setHeartbeatConfig(heartbeatConfig) {
    this.heartbeatConfig = heartbeatConfig;
    
    if (heartbeatConfig && heartbeatConfig.enabled) {
      this.heartbeatInterval = heartbeatConfig.interval || 30000;
      console.log(`[WebSocket] 💓 设置心跳配置: 间隔${this.heartbeatInterval}ms，启用: ${heartbeatConfig.enabled}`);
    } else {
      console.log(`[WebSocket] 💔 心跳功能已禁用`);
    }
  }

  // 广播设备心跳（基于TCP连接状态）
  broadcastDeviceHeartbeat() {
    if (!this.deviceInfo) {
      return;
    }

    // 检查心跳配置
    if (this.heartbeatConfig && !this.heartbeatConfig.enabled) {
      return; // 心跳功能已禁用
    }

    // 检查是否只在有客户端连接时才发送心跳
    if (this.heartbeatConfig && this.heartbeatConfig.enableOnlyWhenClientsConnected && this.clients.size === 0) {
      return;
    }

    // 获取TCP连接状态（从主程序传入）
    const tcpConnected = this.deviceInfo.tcpConnected || false;
    const deviceStatus = tcpConnected ? 'ONLINE' : 'OFFLINE';

    const heartbeatData = {
      ...this.deviceInfo,
      lastHeartbeat: new Date().toISOString(),
      uptime: Date.now() - (this.deviceInfo.startTime ? new Date(this.deviceInfo.startTime).getTime() : Date.now()),
      clientCount: this.clients.size,
      tcpConnected: tcpConnected,
      status: deviceStatus
    };

    this.broadcast({
      type: 'deviceHeartbeat',
      data: heartbeatData
    });

    console.log(`[WebSocket] 💓 发送设备心跳: ${this.deviceInfo.deviceId} (TCP状态: ${tcpConnected ? '已连接' : '已断开'})`);
  }

  handleClientMessage(ws, message, clientInfo) {
    const { type, data } = message;
    
    switch (type) {
      case 'requestInitialData':
        // 客户端请求初始数据
        this.sendToClient(ws, {
          type: 'initialData',
          data: {
            devices: [],
            packages: [],
            systemInfo: {
              version: '1.0.0',
              startTime: new Date().toISOString(),
              totalDevices: 1,
              activeDevices: 1
            },
            deviceInfo: this.deviceInfo
          }
        });
        break;
        
      case 'ping':
        // 心跳响应
        this.sendToClient(ws, {
          type: 'pong',
          data: { 
            timestamp: new Date().toISOString(),
            deviceInfo: this.deviceInfo,
            receivedTimestamp: data?.timestamp
          }
        });
        break;

      case 'requestDeviceHeartbeat':
        // 客户端主动请求设备心跳
        if (this.deviceInfo) {
          this.sendToClient(ws, {
            type: 'deviceHeartbeat',
            data: {
              ...this.deviceInfo,
              lastHeartbeat: new Date().toISOString(),
              uptime: Date.now() - (this.deviceInfo.startTime ? new Date(this.deviceInfo.startTime).getTime() : Date.now())
            }
          });
        }
        break;

      case 'packageStatus':
        // 包裹状态反馈
        console.log(`[WebSocket] 📦 收到包裹状态反馈: ${data.packageId} -> ${data.status}`);
        break;

      case 'deviceMetrics':
        // 设备运行数据
        console.log(`[WebSocket] 📊 收到设备运行数据: ${data.deviceId}`);
        break;

      case 'systemStats':
        // 系统统计数据
        console.log(`[WebSocket] 📈 收到系统统计数据`);
        break;
        
      default:
        console.warn(`[WebSocket] ⚠️ 未知消息类型: ${type}`);
    }
    
    // 发射客户端消息事件
    this.emit('clientMessage', { ws, message, clientInfo });
  }

  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`[WebSocket] ❌ 发送消息到客户端失败:`, error);
        return false;
      }
    }
    return false;
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    let successCount = 0;
    
    this.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(messageStr);
          successCount++;
        } catch (error) {
          console.error(`[WebSocket] ❌ 广播消息失败:`, error);
          this.clients.delete(ws);
        }
      } else {
        this.clients.delete(ws);
      }
    });
    
    if (this.clients.size > 0) {
      console.log(`[WebSocket] 📡 广播消息到 ${successCount}/${this.clients.size} 个客户端:`, message.type);
    }
    
    return successCount;
  }

  // 发送设备状态
  broadcastDeviceStatus(deviceId, status) {
    this.broadcast({
      type: 'deviceStatus',
      data: {
        deviceId: deviceId,
        status: status,
        timestamp: new Date().toISOString()
      }
    });
  }

  // 发送包裹报告
  broadcastPackageReport(packageId, sourceDeviceId, sortCode) {
    this.broadcast({
      type: 'packageReport',
      data: {
        packageId: packageId,
        sourceDeviceId: sourceDeviceId,
        sortCode: sortCode,
        timestamp: new Date().toISOString()
      }
    });
  }

  // 发送系统消息
  broadcastSystemMessage(level, message) {
    this.broadcast({
      type: 'systemMessage',
      data: {
        level: level,
        message: message,
        timestamp: new Date().toISOString()
      }
    });
  }

  getStatus() {
    return {
      running: this.isRunning,
      clientCount: this.clients.size,
      host: this.config.host,
      port: this.config.port,
      deviceHeartbeatActive: !!this.deviceHeartbeatInterval,
      deviceInfo: this.deviceInfo
    };
  }

  stop() {
    console.log(`[WebSocket] 🔌 停止服务器`);
    
    // 停止设备心跳
    this.stopDeviceHeartbeat();
    
    if (this.wss) {
      // 关闭所有客户端连接
      this.clients.forEach((ws) => {
        ws.close(1001, '服务器关闭');
      });
      
      // 关闭服务器
      this.wss.close(() => {
        console.log(`[WebSocket] ✅ 服务器已关闭`);
        this.isRunning = false;
        this.emit('closed');
      });
    }
  }
}

module.exports = WebSocketServer; 