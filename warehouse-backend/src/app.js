#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const TcpClient = require('./TcpClient');
const WebSocketServer = require('./WebSocketServer');
const PackageManager = require('./PackageManager');

class WarehouseBackendService {
  constructor() {
    this.config = null;
    this.tcpClient = null;
    this.webSocketServer = null;
    this.packageManager = null;
    this.isRunning = false;
    this.startTime = new Date();
    
    // 加载配置
    this.loadConfig();
    
    // 初始化组件
    this.init();
    
    // 设置进程信号处理
    this.setupProcessHandlers();
  }

  // 加载配置文件
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '../config.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      
      console.log('🔧 配置加载成功:');
      console.log(`   设备ID: ${this.config.deviceConfig.deviceId}`);
      console.log(`   设备名称: ${this.config.deviceConfig.deviceName}`);
      console.log(`   TCP地址: ${this.config.tcpConfig.host}:${this.config.tcpConfig.port}`);
      console.log(`   WebSocket端口: ${this.config.webSocketConfig.port}`);
      console.log(`   触发信号: ${this.config.signalConfig.triggerSignal}`);
      
    } catch (error) {
      console.error('❌ 配置文件加载失败:', error.message);
      process.exit(1);
    }
  }

  // 初始化所有组件
  init() {
    try {
      console.log('\n🚀 初始化仓储后端服务...\n');
      
      // 初始化包裹管理器
      this.packageManager = new PackageManager(this.config.signalConfig);
      console.log('✅ 包裹管理器初始化完成');
      
      // 初始化WebSocket服务器
      this.webSocketServer = new WebSocketServer(this.config.webSocketConfig);
      
      // 设置心跳配置到WebSocket服务器
      this.webSocketServer.setHeartbeatConfig(this.config.heartbeatConfig);
      
      // 设置设备信息到WebSocket服务器（用于心跳）
      this.webSocketServer.setDeviceInfo({
        deviceId: this.config.deviceConfig.deviceId,
        deviceName: this.config.deviceConfig.deviceName,
        area: this.config.deviceConfig.area,
        startTime: this.startTime.toISOString(),
        version: '1.0.0',
        tcpConnected: false, // 初始状态为未连接
        tcpLastUpdate: new Date().toISOString(),
        tcpConfig: {
          host: this.config.tcpConfig.host,
          port: this.config.tcpConfig.port,
          connected: false // 初始状态为未连接
        }
      });
      
      this.setupWebSocketHandlers();
      console.log('✅ WebSocket服务器初始化完成');
      
      // 初始化TCP客户端
      this.tcpClient = new TcpClient(this.config.tcpConfig);
      this.setupTcpHandlers();
      console.log('✅ TCP客户端初始化完成');
      
      // 启动定时任务
      this.startScheduledTasks();
      console.log('✅ 定时任务启动完成');
      
      this.isRunning = true;
      console.log('\n🎉 仓储后端服务启动成功！\n');
      
    } catch (error) {
      console.error('❌ 服务初始化失败:', error);
      process.exit(1);
    }
  }

  // 设置TCP客户端事件处理
  setupTcpHandlers() {
    // TCP连接成功
    this.tcpClient.on('connected', () => {
      console.log('🔗 TCP连接已建立');
      
      // 更新设备信息中的TCP连接状态
      this.updateTcpConnectionStatus(true);
      
      this.webSocketServer.broadcastSystemMessage('info', 
        `设备 ${this.config.deviceConfig.deviceId} TCP连接已建立`);
    });

    // TCP连接断开
    this.tcpClient.on('disconnected', () => {
      console.log('💔 TCP连接已断开');
      
      // 更新设备信息中的TCP连接状态
      this.updateTcpConnectionStatus(false);
      
      this.webSocketServer.broadcastSystemMessage('warning', 
        `设备 ${this.config.deviceConfig.deviceId} TCP连接已断开`);
    });

    // TCP连接错误
    this.tcpClient.on('error', (error) => {
      console.error('⚠️ TCP连接错误:', error.message);
      
      // 更新设备信息中的TCP连接状态
      this.updateTcpConnectionStatus(false);
      
      this.webSocketServer.broadcastSystemMessage('error', 
        `设备 ${this.config.deviceConfig.deviceId} TCP连接错误: ${error.message}`);
    });

    // 接收到信号数据
    this.tcpClient.on('signal', (signalData) => {
      this.handleDeviceSignal(signalData);
    });

    // 达到最大重连次数
    this.tcpClient.on('maxReconnectReached', () => {
      console.error('❌ TCP连接重连失败，已达到最大重连次数');
      this.webSocketServer.broadcastSystemMessage('critical', 
        `设备 ${this.config.deviceConfig.deviceId} 连接失败，请检查网络和设备状态`);
    });
  }

  // 设置WebSocket服务器事件处理
  setupWebSocketHandlers() {
    // 服务器启动
    this.webSocketServer.on('listening', () => {
      console.log('🌐 WebSocket服务器已启动');
      
      // 延迟发送设备上线通知，确保前端有时间连接
      setTimeout(() => {
        this.notifyDeviceOnline();
      }, 2000);
    });

    // 服务器错误
    this.webSocketServer.on('error', (error) => {
      console.error('⚠️ WebSocket服务器错误:', error);
    });

    // 客户端消息
    this.webSocketServer.on('clientMessage', ({ ws, message, clientInfo }) => {
      this.handleClientMessage(ws, message, clientInfo);
    });
  }

  // 处理设备信号
  handleDeviceSignal(signalData) {
    console.log(`🔔 收到设备信号: ${signalData.signal} = ${signalData.value}`);
    
    // 创建包裹
    const packageInfo = this.packageManager.createPackageFromSignal(
      signalData, 
      this.config.deviceConfig
    );
    
    if (packageInfo) {
      // 向前端广播简化的包裹报告（不包含具体格口信息）
      this.webSocketServer.broadcastPackageReport(
        packageInfo.packageId,
        packageInfo.sourceDeviceId,
        packageInfo.signalValue // 发送原始信号值而非格口号
      );
      
      console.log(`📦 包裹创建成功，已发送到前端: ${packageInfo.packageId} (前端将随机生成分拣信息)`);
    }
  }

  // 处理客户端消息
  handleClientMessage(ws, message, clientInfo) {
    const { type, data } = message;
    
    switch (type) {
      case 'requestInitialData':
      case 'ping':
      case 'requestDeviceHeartbeat':
      case 'packageStatus':
      case 'deviceMetrics':
      case 'systemStats':
        // 这些消息已在WebSocketServer层处理，无需重复处理
        break;
        
      case 'getStatistics':
        // 发送统计信息
        const stats = this.getSystemStatistics();
        this.webSocketServer.sendToClient(ws, {
          type: 'statistics',
          data: stats
        });
        break;
        
      case 'getPackageHistory':
        // 发送包裹历史
        const history = this.packageManager.getPackageHistory(data?.limit || 50);
        this.webSocketServer.sendToClient(ws, {
          type: 'packageHistory',
          data: history
        });
        break;
        
      case 'resetPackageCounter':
        // 重置包裹计数器
        this.packageManager.reset();
        this.webSocketServer.broadcastSystemMessage('info', '包裹计数器已重置');
        break;
        
      case 'getSystemStatus':
        // 发送系统状态
        const status = this.getSystemStatus();
        this.webSocketServer.sendToClient(ws, {
          type: 'systemStatus',
          data: status
        });
        break;
        
      default:
        console.log(`📨 收到未处理的客户端消息: ${type}`);
    }
  }

  // 获取系统统计信息
  getSystemStatistics() {
    const packageStats = this.packageManager.getStatistics();
    const tcpStatus = this.tcpClient.getStatus();
    const wsStatus = this.webSocketServer.getStatus();
    
    return {
      device: this.config.deviceConfig,
      packages: packageStats,
      connections: {
        tcp: tcpStatus,
        webSocket: wsStatus
      },
      uptime: Date.now() - this.startTime.getTime(),
      timestamp: new Date().toISOString()
    };
  }

  // 获取系统状态
  getSystemStatus() {
    return {
      running: this.isRunning,
      startTime: this.startTime.toISOString(),
      uptime: Date.now() - this.startTime.getTime(),
      tcp: this.tcpClient.getStatus(),
      webSocket: this.webSocketServer.getStatus(),
      packageManager: this.packageManager.getStatus(),
      device: this.config.deviceConfig
    };
  }

  // 更新TCP连接状态到设备信息
  updateTcpConnectionStatus(isConnected) {
    // 获取当前设备信息
    const currentDeviceInfo = this.webSocketServer.deviceInfo || {};
    
    // 更新TCP连接状态
    const updatedDeviceInfo = {
      ...currentDeviceInfo,
      tcpConnected: isConnected,
      tcpLastUpdate: new Date().toISOString(),
      tcpConfig: {
        host: this.config.tcpConfig.host,
        port: this.config.tcpConfig.port,
        connected: isConnected
      }
    };
    
    // 设置更新后的设备信息
    this.webSocketServer.setDeviceInfo(updatedDeviceInfo);
    
    console.log(`🔄 设备 ${this.config.deviceConfig.deviceId} TCP状态已更新: ${isConnected ? '已连接' : '已断开'}`);
  }

  // 启动定时任务
  startScheduledTasks() {
    // 定时清理过期数据（每小时）
    setInterval(() => {
      console.log('🧹 执行定时清理任务...');
      this.packageManager.cleanup();
    }, 60 * 60 * 1000); // 1小时

    // 定时发送统计信息（每10分钟）
    setInterval(() => {
      if (this.webSocketServer.getStatus().clientCount > 0) {
        const stats = this.getSystemStatistics();
        this.webSocketServer.broadcast({
          type: 'statistics',
          data: stats
        });
      }
    }, 10 * 60 * 1000); // 10分钟

    // 定时检查连接状态（每30秒）
    setInterval(() => {
      const tcpStatus = this.tcpClient.getStatus();
      if (!tcpStatus.connected) {
        console.log('🔍 检测到TCP连接断开，尝试重新连接...');
      }
    }, 30 * 1000); // 30秒
  }

  // 发送设备上线通知
  notifyDeviceOnline() {
    console.log(`📱 发送设备上线通知: ${this.config.deviceConfig.deviceId}`);
    this.webSocketServer.broadcastDeviceStatus(
      this.config.deviceConfig.deviceId, 
      'ONLINE'
    );
    this.webSocketServer.broadcastSystemMessage('info', 
      `设备 ${this.config.deviceConfig.deviceName} (${this.config.deviceConfig.deviceId}) 已上线`);
  }

  // 发送设备下线通知
  notifyDeviceOffline() {
    console.log(`📱 发送设备下线通知: ${this.config.deviceConfig.deviceId}`);
    this.webSocketServer.broadcastDeviceStatus(
      this.config.deviceConfig.deviceId, 
      'OFFLINE'
    );
    this.webSocketServer.broadcastSystemMessage('warning', 
      `设备 ${this.config.deviceConfig.deviceName} (${this.config.deviceConfig.deviceId}) 已下线`);
  }

  // 设置进程信号处理
  setupProcessHandlers() {
    // 优雅关闭
    const gracefulShutdown = (signal) => {
      console.log(`\n📴 收到${signal}信号，正在优雅关闭服务...`);
      
      this.isRunning = false;
      
      // 发送设备下线通知
      this.notifyDeviceOffline();
      
      // 等待消息发送完成
      setTimeout(() => {
        // 关闭TCP连接
        if (this.tcpClient) {
          this.tcpClient.disconnect();
        }
        
        // 关闭WebSocket服务器
        if (this.webSocketServer) {
          this.webSocketServer.stop();
        }
        
        console.log('✅ 服务已关闭');
        process.exit(0);
      }, 1000); // 等待1秒确保消息发送完成
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // 处理未捕获异常
    process.on('uncaughtException', (error) => {
      console.error('❌ 未捕获异常:', error);
      if (this.webSocketServer) {
        this.webSocketServer.broadcastSystemMessage('critical', 
          `系统异常: ${error.message}`);
        // 发送设备下线通知
        this.notifyDeviceOffline();
      }
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ 未处理的Promise拒绝:', reason);
    });

    // 监听系统关机信号（Windows）
    if (process.platform === 'win32') {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.on('SIGINT', () => {
        gracefulShutdown('SIGINT');
      });
    }
  }

  // 手动触发包裹创建（用于测试）
  triggerTestPackage(sortCode = 1) {
    const testSignal = {
      signal: this.config.signalConfig.triggerSignal,
      value: sortCode.toString(),
      rawMessage: `${this.config.signalConfig.triggerSignal}:${sortCode}`,
      timestamp: new Date().toISOString()
    };
    
    console.log('🧪 手动触发测试包裹...');
    this.handleDeviceSignal(testSignal);
  }
}

// 启动服务
if (require.main === module) {
  console.log('🏭 仓储监控系统后端服务');
  console.log('='.repeat(50));
  console.log(`启动时间: ${new Date().toLocaleString()}`);
  console.log(`Node.js版本: ${process.version}`);
  console.log(`进程ID: ${process.pid}`);
  console.log('='.repeat(50));
  
  const service = new WarehouseBackendService();
  
  // 导出服务实例供外部使用
  global.warehouseService = service;
  
  // 开发环境下可以通过控制台触发测试包裹
  if (process.env.NODE_ENV === 'development') {
    console.log('\n💡 开发模式提示：');
    console.log('   可以通过以下命令手动触发测试包裹：');
    console.log('   global.warehouseService.triggerTestPackage(1)  // 格口1');
    console.log('   global.warehouseService.triggerTestPackage(3)  // 格口3');
  }
}

module.exports = WarehouseBackendService; 