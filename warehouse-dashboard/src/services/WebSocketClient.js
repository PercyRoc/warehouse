import { WpfConfig, WpfUtils } from './WpfIntegrationConfig.js';

class WebSocketClient {
  constructor() {
    this.connections = new Map(); // 多个WebSocket连接
    this.allServers = [WpfConfig.connection.url, ...WpfConfig.connection.backendServers];
    this.reconnectInterval = WpfConfig.connection.reconnectInterval;
    this.maxReconnectAttempts = WpfConfig.connection.maxReconnectAttempts;
    this.eventHandlers = new Map();
    this.deviceStates = new Map();
    this.packageBuffer = new Map();
    
    // 设备心跳管理
    this.deviceHeartbeats = new Map(); // 存储每个设备的心跳信息
    this.heartbeatTimeout = 90000; // 90秒心跳超时时间（后端30秒发送一次）
    this.heartbeatCheckInterval = null; // 心跳检查定时器
    this.heartbeatCheckFrequency = 15000; // 15秒检查一次心跳状态
    
    // 摆轮负载平衡管理
    this.sorterUsageStats = new Map(); // 存储每个路径上摆轮的使用统计
  }

  // 事件监听器管理
  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.eventHandlers.has(event)) {
      const handlers = this.eventHandlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // 启动设备心跳检查
  startHeartbeatCheck() {
    if (this.heartbeatCheckInterval) {
      return; // 已经启动了
    }

    console.log(`💓 启动设备心跳检查，检查间隔: ${this.heartbeatCheckFrequency/1000}秒，超时阈值: ${this.heartbeatTimeout/1000}秒`);
    
    this.heartbeatCheckInterval = setInterval(() => {
      this.checkDeviceHeartbeats();
    }, this.heartbeatCheckFrequency);
  }

  // 停止设备心跳检查
  stopHeartbeatCheck() {
    if (this.heartbeatCheckInterval) {
      console.log(`💔 停止设备心跳检查`);
      clearInterval(this.heartbeatCheckInterval);
      this.heartbeatCheckInterval = null;
    }
  }

  // 检查设备心跳状态
  checkDeviceHeartbeats() {
    const now = Date.now();
    let timeoutDevices = [];

    this.deviceHeartbeats.forEach((heartbeatInfo, deviceId) => {
      const timeSinceLastHeartbeat = now - heartbeatInfo.lastHeartbeatTime;
      
      if (timeSinceLastHeartbeat > this.heartbeatTimeout) {
        // 后端服务心跳超时（不是设备离线，而是后端服务可能离线）
        if (heartbeatInfo.heartbeatStatus !== 'TIMEOUT') {
          heartbeatInfo.heartbeatStatus = 'TIMEOUT';
          heartbeatInfo.timeoutTime = new Date().toISOString();
          
          console.warn(`⚠️ 后端服务 ${deviceId} 心跳超时，最后心跳: ${heartbeatInfo.lastHeartbeat}`);
          console.warn(`   设备最后TCP状态: ${heartbeatInfo.tcpConnected ? '已连接' : '已断开'}`);
          
          // 设备状态保持最后已知的TCP状态，但标记后端服务离线
          timeoutDevices.push({
            deviceId: deviceId,
            deviceName: heartbeatInfo.deviceName,
            lastHeartbeat: heartbeatInfo.lastHeartbeat,
            timeoutDuration: timeSinceLastHeartbeat,
            lastTcpStatus: heartbeatInfo.tcpConnected,
            reason: 'backend_service_timeout'
          });
          
          // 发送后端服务超时事件（不是设备离线）
          this.emit('deviceEvent', {
            type: 'backendServiceTimeout',
            data: {
              deviceId: deviceId,
              status: heartbeatInfo.status, // 保持设备的TCP状态
              timestamp: new Date().toISOString(),
              reason: 'backend_service_timeout',
              lastHeartbeat: heartbeatInfo.lastHeartbeat,
              timeoutDuration: timeSinceLastHeartbeat,
              lastTcpStatus: heartbeatInfo.tcpConnected
            }
          });
        }
      } else {
        // 心跳正常，后端服务在线
        if (heartbeatInfo.heartbeatStatus === 'TIMEOUT') {
          heartbeatInfo.heartbeatStatus = 'NORMAL';
          console.log(`✅ 后端服务 ${deviceId} (${heartbeatInfo.deviceName}) 心跳恢复正常`);
          
          // 发送后端服务恢复事件
          this.emit('deviceEvent', {
            type: 'backendServiceRecovered',
            data: {
              deviceId: deviceId,
              status: heartbeatInfo.status, // 使用当前TCP状态
              timestamp: new Date().toISOString(),
              reason: 'backend_service_recovered'
            }
          });
        }
      }
    });

    // 如果有后端服务超时，发送批量通知
    if (timeoutDevices.length > 0) {
      this.emit('deviceHeartbeatTimeout', {
        timeoutDevices: timeoutDevices,
        timestamp: new Date().toISOString(),
        type: 'backend_service_timeout'
      });
    }
  }

  // 处理设备心跳消息
  handleDeviceHeartbeat(data) {
    const { deviceId, deviceName, lastHeartbeat, tcpConnected, status } = data;
    const now = Date.now();
    
    // 根据TCP连接状态确定设备状态
    const deviceStatus = tcpConnected ? 'ONLINE' : 'OFFLINE';
    
    // 更新设备心跳信息
    this.deviceHeartbeats.set(deviceId, {
      deviceId: deviceId,
      deviceName: deviceName || deviceId,
      lastHeartbeat: lastHeartbeat,
      lastHeartbeatTime: now,
      status: deviceStatus,
      tcpConnected: tcpConnected,
      serverUrl: data._serverUrl,
      uptime: data.uptime,
      area: data.area,
      tcpLastUpdate: data.tcpLastUpdate
    });

    console.log(`💓 收到设备 ${deviceId} 心跳，TCP状态: ${tcpConnected ? '已连接' : '已断开'}，设备状态: ${deviceStatus}`);
    
    // 发送设备心跳事件
    this.emit('deviceHeartbeat', {
      deviceId: deviceId,
      status: deviceStatus,
      lastHeartbeat: lastHeartbeat,
      timestamp: new Date().toISOString(),
      data: data
    });
  }

  // 连接到所有后端服务器
  connect() {
    console.log('尝试连接到所有后端服务器...');
    
    // 启动心跳检查
    this.startHeartbeatCheck();
    
    this.allServers.forEach((serverUrl, index) => {
      this.connectToServer(serverUrl);
    });
  }

  // 连接到单个服务器
  connectToServer(serverUrl) {
    if (this.connections.has(serverUrl)) {
      const conn = this.connections.get(serverUrl);
      if (conn.ws && (conn.ws.readyState === WebSocket.CONNECTING || conn.ws.readyState === WebSocket.OPEN)) {
        return; // 已经连接或正在连接
      }
    }

    console.log(`尝试连接到后端服务: ${serverUrl}`);

    try {
      const ws = new WebSocket(serverUrl);
      const connectionInfo = {
        ws: ws,
        url: serverUrl,
        reconnectAttempts: 0,
        isConnected: false,
        lastPongTime: Date.now(), // 初始化为当前时间
        pingInterval: null
      };

      this.connections.set(serverUrl, connectionInfo);

      ws.onopen = () => {
        console.log(`✅ 成功连接到后端服务: ${serverUrl}`);
        connectionInfo.isConnected = true;
        connectionInfo.reconnectAttempts = 0;
        connectionInfo.lastPongTime = Date.now(); // 连接成功时更新时间
        
        this.emit('connected', { 
          timestamp: new Date().toISOString(),
          serverUrl: serverUrl,
          connectedCount: this.getConnectedCount()
        });
        
        // 启动心跳检测
        this.startHeartbeatForConnection(connectionInfo);
        
        // 连接成功后请求初始数据
        this.requestInitialDataFromServer(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message, serverUrl);
        } catch (error) {
          console.error(`解析WebSocket消息失败 (${serverUrl}):`, error, event.data);
        }
      };

      ws.onclose = (event) => {
        console.log(`❌ 后端服务连接断开: ${serverUrl}`, event.code, event.reason);
        connectionInfo.isConnected = false;
        
        // 停止心跳检测
        this.stopHeartbeatForConnection(connectionInfo);
        
        this.emit('disconnected', {
          code: event.code,
          reason: event.reason,
          timestamp: new Date().toISOString(),
          serverUrl: serverUrl,
          connectedCount: this.getConnectedCount()
        });

        // 自动重连
        this.scheduleReconnectForServer(serverUrl);
      };

      ws.onerror = (error) => {
        console.error(`WebSocket连接错误 (${serverUrl}):`, error);
        connectionInfo.isConnected = false;
        this.emit('error', {
          error: error.message || '连接错误',
          timestamp: new Date().toISOString(),
          serverUrl: serverUrl
        });
      };

    } catch (error) {
      console.error(`创建WebSocket连接失败 (${serverUrl}):`, error);
      this.emit('error', {
        error: error.message,
        timestamp: new Date().toISOString(),
        serverUrl: serverUrl
      });
    }
  }

  // 为单个连接启动心跳检测
  startHeartbeatForConnection(connectionInfo) {
    this.stopHeartbeatForConnection(connectionInfo);
    
    console.log(`💓 启动连接心跳检测: ${connectionInfo.url}`);
    
    connectionInfo.pingInterval = setInterval(() => {
      if (connectionInfo.ws && connectionInfo.ws.readyState === WebSocket.OPEN) {
        // 浏览器WebSocket没有ping方法，使用JSON消息代替
        try {
          const pingMessage = {
            type: 'ping',
            timestamp: Date.now()
          };
          connectionInfo.ws.send(JSON.stringify(pingMessage));
          console.log(`💓 发送心跳包: ${connectionInfo.url}`);
        } catch (error) {
          console.warn(`心跳发送失败，重新连接: ${connectionInfo.url}`, error);
          this.reconnectServer(connectionInfo.url);
        }
        
        // 检查上次pong响应时间
        const timeSinceLastPong = Date.now() - connectionInfo.lastPongTime;
        if (timeSinceLastPong > WpfConfig.connection.networkTimeout) {
          console.warn(`心跳检测超时 (${timeSinceLastPong}ms > ${WpfConfig.connection.networkTimeout}ms)，重新连接: ${connectionInfo.url}`);
          this.reconnectServer(connectionInfo.url);
        }
      }
    }, WpfConfig.connection.pingInterval);
  }

  // 停止单个连接的心跳检测
  stopHeartbeatForConnection(connectionInfo) {
    if (connectionInfo.pingInterval) {
      clearInterval(connectionInfo.pingInterval);
      connectionInfo.pingInterval = null;
    }
  }

  // 获取已连接的服务器数量
  getConnectedCount() {
    let count = 0;
    this.connections.forEach(conn => {
      if (conn.isConnected) count++;
    });
    return count;
  }

  // 为单个服务器安排重连
  scheduleReconnectForServer(serverUrl) {
    const connectionInfo = this.connections.get(serverUrl);
    if (!connectionInfo) return;

    if (connectionInfo.reconnectAttempts < this.maxReconnectAttempts) {
      connectionInfo.reconnectAttempts++;
      
      console.log(`${this.reconnectInterval/1000}秒后尝试第${connectionInfo.reconnectAttempts}次重连: ${serverUrl}`);
      
      setTimeout(() => {
        this.connectToServer(serverUrl);
      }, this.reconnectInterval);
    } else {
      console.error(`达到最大重连次数，停止重连: ${serverUrl}`);
      this.emit('maxReconnectReached', {
        attempts: connectionInfo.reconnectAttempts,
        timestamp: new Date().toISOString(),
        serverUrl: serverUrl
      });
    }
  }

  // 重连单个服务器
  reconnectServer(serverUrl) {
    console.log(`手动重连服务器: ${serverUrl}`);
    const connectionInfo = this.connections.get(serverUrl);
    if (connectionInfo) {
      if (connectionInfo.ws) {
        connectionInfo.ws.close(1000, '手动重连');
      }
      this.stopHeartbeatForConnection(connectionInfo);
      connectionInfo.reconnectAttempts = 0; // 重置重连次数
    }
    
    setTimeout(() => {
      this.connectToServer(serverUrl);
    }, 1000);
  }

  // 手动重连所有服务器
  reconnect() {
    console.log('手动重连所有服务器...');
    this.disconnect();
    setTimeout(() => this.connect(), 1000);
  }

  // 断开所有连接
  disconnect() {
    console.log('断开所有WebSocket连接...');
    
    // 停止心跳检查
    this.stopHeartbeatCheck();
    
    this.connections.forEach((connectionInfo, serverUrl) => {
      if (connectionInfo.ws) {
        connectionInfo.ws.close(1000, '用户主动断开连接');
      }
      this.stopHeartbeatForConnection(connectionInfo);
      connectionInfo.reconnectAttempts = this.maxReconnectAttempts; // 阻止自动重连
    });
    this.connections.clear();
    this.deviceHeartbeats.clear(); // 清空心跳信息
  }

  // 消息处理
  handleMessage(message, serverUrl) {
    const { type, data } = message;
    
    // 添加消息来源信息
    if (data) {
      data._serverUrl = serverUrl;
    }
    
    switch (type) {
      case 'connected':
        // 处理连接成功消息
        console.log(`✅ 连接确认 (${serverUrl}):`, data.message);
        // 如果包含设备信息，处理设备心跳
        if (data.deviceInfo) {
          this.handleDeviceHeartbeat(data.deviceInfo);
        }
        this.emit('connected', {
          serverUrl: serverUrl,
          data: data
        });
        break;
      case 'pong':
        // 处理心跳响应
        const connectionInfo = this.connections.get(serverUrl);
        if (connectionInfo) {
          connectionInfo.lastPongTime = Date.now();
          console.log(`💓 收到心跳响应 (${serverUrl})`);
        }
        break;
      case 'deviceStatus':
        this.handleDeviceStatus(data);
        // 转发设备状态变化事件
        this.emit('deviceStatus', {
          deviceId: data.deviceId,
          status: data.status,
          timestamp: data.timestamp,
          data: data
        });
        break;
      case 'packageReport':
        this.handlePackageReport(data);
        break;
      case 'deviceConfig':
        this.handleDeviceConfig(data);
        break;
      case 'alert':
        this.handleAlert(data);
        break;
      case 'initialData':
        this.handleInitialData(data);
        break;
      case 'systemCommand':
        this.handleSystemCommand(data);
        break;
      case 'systemMessage':
        this.handleSystemMessage(data);
        break;
      case 'deviceHeartbeat':
        this.handleDeviceHeartbeat(data);
        break;
      default:
        console.warn(`收到未知消息类型 (${serverUrl}):`, type, data);
    }
  }

  // 处理系统消息
  handleSystemMessage(data) {
    console.log(`📢 系统消息 [${data.level}]: ${data.message} (来源: ${data._serverUrl})`);
    this.emit('systemMessage', data);
  }

  // 具体消息处理方法
  handleDeviceStatus(data) {
    const { deviceId, status, timestamp, metadata } = data;
    
    // 更新设备状态缓存
    this.deviceStates.set(deviceId, {
      status,
      lastUpdate: timestamp,
      metadata
    });
    
    console.log(`设备 ${deviceId} 状态更新为: ${status}`);
    this.emit('deviceEvent', {
      type: 'statusUpdate',
      data: { deviceId, status, timestamp, metadata }
    });
  }

  handlePackageReport(data) {
    const { packageId, sourceDeviceId, sortCode, destination } = data;
    
    // 优先根据设备ID确定路径
    let pathId = data.pathId;
    if (!pathId && sourceDeviceId) {
      pathId = WpfUtils.getPathByDeviceId(sourceDeviceId);
    }
    if (!pathId && destination) {
      pathId = this.determinePathByDestination(destination);
    }
    
    // 随机生成分拣信息（不再依赖后端的格口号）
    const sorterInfo = this.generateRandomSorterInfo(pathId);
    
    // 缓存包裹信息
    this.packageBuffer.set(packageId, {
      ...data,
      pathId,
      sorterInfo,
      reportTime: new Date().toISOString(),
      status: 'reported'
    });
    
    console.log(`收到包裹 ${packageId}，源设备: ${sourceDeviceId || '未知'}，路径: ${pathId}，随机分拣: ${sorterInfo.action === 'sort' ? `第${sorterInfo.sorterIndex + 1}个摆轮${sorterInfo.direction === 'left' ? '左摆' : '右摆'}` : '直行'}`);
    
    this.emit('packageEvent', {
      type: 'packageCreated',
      data: {
        packageInfo: {
          id: packageId,
          sku: data.sku || `SKU_${packageId.slice(-3)}`,
          region: destination?.region,
          sortCode: sorterInfo.targetSortCode, // 使用随机生成的格口号
          priority: destination?.priority,
          weight: data.weight,
          dimensions: data.dimensions,
          sourceDeviceId: sourceDeviceId,
          sorterInfo: sorterInfo
        },
        _startPathId: pathId
      }
    });
  }

  // 初始化摆轮使用统计
  initSorterUsageStats(pathId, sorterCount) {
    if (!this.sorterUsageStats.has(pathId)) {
      const stats = {
        totalCount: sorterCount,
        usageCount: new Array(sorterCount).fill(0), // 每个摆轮的使用次数
        lastResetTime: Date.now()
      };
      this.sorterUsageStats.set(pathId, stats);
      console.log(`📊 [负载平衡] 初始化路径 ${pathId} 摆轮使用统计 (${sorterCount}个摆轮)`);
    }
  }

  // 选择负载最小的摆轮
  selectBalancedSorter(pathId, sorterCount) {
    this.initSorterUsageStats(pathId, sorterCount);
    const stats = this.sorterUsageStats.get(pathId);
    
    // 找到使用次数最少的摆轮
    const minUsage = Math.min(...stats.usageCount);
    const candidateIndexes = [];
    
    for (let i = 0; i < stats.usageCount.length; i++) {
      if (stats.usageCount[i] === minUsage) {
        candidateIndexes.push(i);
      }
    }
    
    // 如果有多个摆轮使用次数相同，随机选择一个
    const selectedIndex = candidateIndexes[Math.floor(Math.random() * candidateIndexes.length)];
    
    // 更新使用统计
    stats.usageCount[selectedIndex]++;
    
    // 每100次分拣后输出统计信息
    const totalUsage = stats.usageCount.reduce((sum, count) => sum + count, 0);
    if (totalUsage % 100 === 0) {
      console.log(`📊 [负载平衡] 路径 ${pathId} 摆轮使用统计 (总计${totalUsage}次):`, 
        stats.usageCount.map((count, index) => `摆轮${index + 1}:${count}次`).join(', '));
    }
    
    return selectedIndex;
  }

  // 重置摆轮使用统计（可选，用于长期运行时的周期性重置）
  resetSorterUsageStats(pathId) {
    const stats = this.sorterUsageStats.get(pathId);
    if (stats) {
      stats.usageCount.fill(0);
      stats.lastResetTime = Date.now();
      console.log(`🔄 [负载平衡] 重置路径 ${pathId} 摆轮使用统计`);
    }
  }

  // 新增：随机生成分拣信息（使用负载平衡）
  generateRandomSorterInfo(pathId) {
    // 检查是否启用随机分拣
    if (!WpfConfig.randomSortingConfig.enabled) {
      return { 
        action: 'straight', 
        sorterIndex: -1, 
        direction: 'straight',
        targetSortCode: 0
      };
    }
    
    // 获取路径上的摆轮数量配置
    const sorterCount = WpfConfig.pathSorterCount[pathId] || 0;
    
    // 如果没有摆轮配置，直行通过
    if (sorterCount === 0) {
      console.log(`⚠️ [分拣模拟] 路径 ${pathId} 无摆轮配置，强制直行通过`);
      return { 
        action: 'straight', 
        sorterIndex: -1, 
        direction: 'straight',
        targetSortCode: 0
      };
    }
    
    // 获取特定路径的分拣概率，如果没有配置则使用默认概率
    const sortingProbability = WpfConfig.randomSortingConfig.pathSpecificProbability[pathId] 
      || WpfConfig.randomSortingConfig.sortingProbability;
    
    // 随机决定是否进行分拣
    const shouldSort = Math.random() < sortingProbability;
    
    if (!shouldSort) {
      console.log(`➡️ [分拣模拟] 路径 ${pathId} 随机决定: 直行通过 [概率${Math.round((1-sortingProbability)*100)}%]`);
      return { 
        action: 'straight', 
        sorterIndex: -1, 
        direction: 'straight',
        targetSortCode: 0
      };
    }
    
    // 使用负载平衡算法选择摆轮，确保每个摆轮使用次数尽可能平均
    const balancedSorterIndex = this.selectBalancedSorter(pathId, sorterCount);
    
    // 获取路径特定的方向限制
    const allowedDirections = WpfConfig.randomSortingConfig.pathDirectionConstraints[pathId] || ['left', 'right'];
    
    // 根据路径限制选择分拣方向
    let randomDirection;
    if (allowedDirections.length === 1) {
      // 只有一个允许的方向
      randomDirection = allowedDirections[0];
    } else {
      // 多个允许的方向，使用配置的平衡比例或随机选择
      if (allowedDirections.includes('left') && allowedDirections.includes('right')) {
        randomDirection = Math.random() < WpfConfig.randomSortingConfig.leftRightBalance ? 'left' : 'right';
      } else {
        // 从允许的方向中随机选择
        randomDirection = allowedDirections[Math.floor(Math.random() * allowedDirections.length)];
      }
    }
    
    // 计算对应的格口号（每个摆轮支持2个格口：左、右）
    const targetSortCode = balancedSorterIndex * 2 + (randomDirection === 'left' ? 1 : 2);
    
    const directionText = randomDirection === 'left' ? '左摆' : '右摆';
    const constraintText = allowedDirections.length === 1 ? ` [限制:仅${directionText}]` : '';
    const currentUsage = this.sorterUsageStats.get(pathId)?.usageCount[balancedSorterIndex] || 0;
    
    console.log(`🎯 [平衡分拣] 路径 ${pathId} 分拣到第${balancedSorterIndex + 1}个摆轮${directionText} (格口${targetSortCode}) [使用${currentUsage}次] [概率${Math.round(sortingProbability*100)}%]${constraintText}`);
    
    return {
      action: 'sort',
      sorterIndex: balancedSorterIndex,
      direction: randomDirection,
      targetSortCode: targetSortCode
    };
  }

  // 根据目的地信息确定包裹路径
  determinePathByDestination(destination) {
    // 这里需要导入WpfUtils，但为了避免循环依赖，我们简化处理
    const { sortCode, region } = destination;
    
    // 简化的路径映射逻辑
    const sortCodeToPath = {
      'A01': 'scan_line_1_start', 'A02': 'scan_line_1_start', 'A03': 'scan_line_1_start',
      'B01': 'scan_line_2_start', 'B02': 'scan_line_2_start', 'B03': 'scan_line_2_start',
      'SKU01': 'sku_line_1', 'SKU02': 'sku_line_1', 'SKU03': 'sku_line_2', 'SKU04': 'sku_line_2',
      'REG01': 'region_sort_line', 'REG02': 'region_sort_line', 'REG03': 'region_sort_line'
    };
    
    // 优先使用格口编号映射
    if (sortCode && sortCodeToPath[sortCode]) {
      return sortCodeToPath[sortCode];
    }
    
    // 其次使用区域映射
    if (region === 'A区') return 'scan_line_1_start';
    if (region === 'B区') return 'scan_line_2_start';
    
    // 返回默认路径
    return 'region_sort_line';
  }

  handleDeviceConfig(data) {
    console.log(`收到设备 ${data.deviceId} 配置更新:`, data.config);
    this.emit('deviceEvent', {
      type: 'configUpdate',
      data
    });
  }

  handleAlert(data) {
    console.log(`收到告警 [${data.severity}]: ${data.message}`);
    this.emit('alert', data);
  }

  handleInitialData(data) {
    console.log('收到初始数据:', data);
    
    // 更新设备状态
    if (data.devices) {
      data.devices.forEach(device => {
        this.deviceStates.set(device.deviceId, {
          status: device.status,
          lastUpdate: device.timestamp,
          metadata: device.metadata
        });
      });
    }
    
    // 如果初始数据包含设备信息，初始化心跳状态
    if (data.deviceInfo) {
      this.handleDeviceHeartbeat(data.deviceInfo);
    }
    
    this.emit('initialData', data);
  }

  handleSystemCommand(data) {
    console.log('收到系统命令:', data);
    this.emit('systemCommand', data);
  }

  // 发送消息到所有连接的后端服务
  broadcast(message) {
    let successCount = 0;
    this.connections.forEach((connectionInfo, serverUrl) => {
      if (connectionInfo.ws && connectionInfo.ws.readyState === WebSocket.OPEN) {
        try {
          connectionInfo.ws.send(JSON.stringify(message));
          successCount++;
        } catch (error) {
          console.error(`发送消息失败 (${serverUrl}):`, error);
        }
      }
    });
    
    if (successCount === 0) {
      console.warn('无可用连接，无法发送消息');
    }
    
    return successCount;
  }

  // 发送消息到特定服务器
  sendToServer(serverUrl, message) {
    const connectionInfo = this.connections.get(serverUrl);
    if (connectionInfo && connectionInfo.ws && connectionInfo.ws.readyState === WebSocket.OPEN) {
      try {
        connectionInfo.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error(`发送消息失败 (${serverUrl}):`, error);
        return false;
      }
    } else {
      console.warn(`服务器未连接，无法发送消息: ${serverUrl}`);
      return false;
    }
  }

  // 兼容旧接口：发送消息到所有服务器
  send(message) {
    return this.broadcast(message) > 0;
  }

  // 请求初始数据（向所有服务器）
  requestInitialData() {
    const message = {
      type: 'requestInitialData',
      data: {
        timestamp: new Date().toISOString(),
        clientInfo: {
          userAgent: navigator.userAgent,
          version: '1.0.0'
        }
      }
    };
    
    return this.broadcast(message);
  }

  // 向单个服务器请求初始数据
  requestInitialDataFromServer(ws) {
    const message = {
      type: 'requestInitialData',
      data: {
        timestamp: new Date().toISOString(),
        clientInfo: {
          userAgent: navigator.userAgent,
          version: '1.0.0'
        }
      }
    };
    
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('请求初始数据失败:', error);
    }
  }

  // 手动请求设备心跳
  requestDeviceHeartbeat() {
    const message = {
      type: 'requestDeviceHeartbeat',
      data: {
        timestamp: new Date().toISOString()
      }
    };
    
    return this.broadcast(message);
  }

  // 发送包裹状态反馈
  reportPackageStatus(packageId, status, deviceId, position) {
    this.send({
      type: 'packageStatus',
      data: {
        packageId,
        status,
        currentDevice: deviceId,
        currentPosition: position,
        timestamp: new Date().toISOString(),
        processingTime: this.calculateProcessingTime(packageId)
      }
    });
  }

  // 发送设备运行数据
  reportDeviceMetrics(deviceId, metrics) {
    this.send({
      type: 'deviceMetrics',
      data: {
        deviceId,
        metrics: {
          ...metrics,
          timestamp: new Date().toISOString()
        }
      }
    });
  }

  // 发送系统统计数据
  reportSystemStats(stats) {
    this.send({
      type: 'systemStats',
      data: {
        ...stats,
        timestamp: new Date().toISOString()
      }
    });
  }

  // 工具方法
  calculateProcessingTime(packageId) {
    const packageInfo = this.packageBuffer.get(packageId);
    if (packageInfo && packageInfo.reportTime) {
      return (new Date() - new Date(packageInfo.reportTime)) / 1000;
    }
    return 0;
  }

  // 获取设备状态
  getDeviceStatus(deviceId) {
    return this.deviceStates.get(deviceId) || { status: 'unknown' };
  }

  // 获取所有设备状态
  getAllDeviceStates() {
    return Object.fromEntries(this.deviceStates);
  }

  // 获取设备心跳状态
  getDeviceHeartbeatStatus(deviceId) {
    return this.deviceHeartbeats.get(deviceId) || null;
  }

  // 获取所有设备心跳状态
  getAllDeviceHeartbeats() {
    return Object.fromEntries(this.deviceHeartbeats);
  }

  // 连接状态检查 - 检查是否有任何连接
  isConnected() {
    return this.getConnectedCount() > 0;
  }

  // 检查是否连接到所有服务器
  isFullyConnected() {
    return this.getConnectedCount() === this.allServers.length;
  }

  // 获取连接状态摘要
  getConnectionState() {
    const total = this.allServers.length;
    const connected = this.getConnectedCount();
    
    if (connected === 0) return 'disconnected';
    if (connected === total) return 'connected';
    return 'partial'; // 部分连接
  }

  // 获取详细连接状态
  getDetailedConnectionState() {
    const states = {};
    this.allServers.forEach(serverUrl => {
      const connectionInfo = this.connections.get(serverUrl);
      if (connectionInfo && connectionInfo.ws) {
        switch (connectionInfo.ws.readyState) {
          case WebSocket.CONNECTING: states[serverUrl] = 'connecting'; break;
          case WebSocket.OPEN: states[serverUrl] = 'connected'; break;
          case WebSocket.CLOSING: states[serverUrl] = 'closing'; break;
          case WebSocket.CLOSED: states[serverUrl] = 'disconnected'; break;
          default: states[serverUrl] = 'unknown';
        }
      } else {
        states[serverUrl] = 'disconnected';
      }
    });
    
    return {
      summary: this.getConnectionState(),
      total: this.allServers.length,
      connected: this.getConnectedCount(),
      details: states,
      deviceHeartbeats: this.getAllDeviceHeartbeats()
    };
  }

  // 摆轮负载平衡管理方法
  // 获取摆轮使用统计
  getSorterUsageStats(pathId = null) {
    if (pathId) {
      return this.sorterUsageStats.get(pathId) || null;
    }
    return Object.fromEntries(this.sorterUsageStats);
  }

  // 获取所有路径的摆轮使用统计概览
  getSorterUsageOverview() {
    const overview = {};
    this.sorterUsageStats.forEach((stats, pathId) => {
      const totalUsage = stats.usageCount.reduce((sum, count) => sum + count, 0);
      const avgUsage = totalUsage / stats.totalCount;
      const maxUsage = Math.max(...stats.usageCount);
      const minUsage = Math.min(...stats.usageCount);
      const variance = stats.usageCount.reduce((sum, count) => sum + Math.pow(count - avgUsage, 2), 0) / stats.totalCount;
      
      overview[pathId] = {
        totalSorters: stats.totalCount,
        totalUsage: totalUsage,
        averageUsage: Math.round(avgUsage * 100) / 100,
        maxUsage: maxUsage,
        minUsage: minUsage,
        variance: Math.round(variance * 100) / 100,
        balanceScore: Math.round((1 - (maxUsage - minUsage) / (avgUsage || 1)) * 100), // 平衡度评分(0-100)
        usageDetails: stats.usageCount.map((count, index) => ({
          sorterIndex: index + 1,
          usageCount: count,
          percentage: totalUsage > 0 ? Math.round((count / totalUsage) * 100) : 0
        }))
      };
    });
    return overview;
  }

  // 重置指定路径的摆轮使用统计
  resetPathSorterStats(pathId) {
    this.resetSorterUsageStats(pathId);
  }

  // 重置所有路径的摆轮使用统计
  resetAllSorterStats() {
    this.sorterUsageStats.forEach((stats, pathId) => {
      this.resetSorterUsageStats(pathId);
    });
    console.log('🔄 [负载平衡] 已重置所有路径的摆轮使用统计');
  }

  // 输出摆轮使用统计报告
  printSorterUsageReport() {
    console.log('\n📊 =============== 摆轮负载平衡报告 ===============');
    const overview = this.getSorterUsageOverview();
    
    Object.keys(overview).forEach(pathId => {
      const stats = overview[pathId];
      console.log(`\n🛤️  路径: ${pathId}`);
      console.log(`   摆轮总数: ${stats.totalSorters}个`);
      console.log(`   分拣总次数: ${stats.totalUsage}次`);
      console.log(`   平均使用次数: ${stats.averageUsage}次`);
      console.log(`   最大使用次数: ${stats.maxUsage}次`);
      console.log(`   最小使用次数: ${stats.minUsage}次`);
      console.log(`   平衡度评分: ${stats.balanceScore}%`);
      console.log(`   详细统计:`);
      stats.usageDetails.forEach(detail => {
        console.log(`     摆轮${detail.sorterIndex}: ${detail.usageCount}次 (${detail.percentage}%)`);
      });
    });
    
    console.log('\n===============================================\n');
  }
}

// 创建单例实例
const webSocketClient = new WebSocketClient();

export default webSocketClient; 