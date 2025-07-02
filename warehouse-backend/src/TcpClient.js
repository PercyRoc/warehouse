const net = require('net');
const EventEmitter = require('events');

class TcpClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    
    this.connect();
  }

  connect() {
    if (this.isConnected || this.client) {
      return;
    }

    console.log(`[TCP] 尝试连接到 ${this.config.host}:${this.config.port}`);
    
    this.client = new net.Socket();
    
    // 设置连接超时
    this.client.setTimeout(this.config.timeout);
    
    // 设置Keep-Alive
    this.client.setKeepAlive(this.config.keepAlive, 1000);
    
    // 连接成功事件
    this.client.on('connect', () => {
      console.log(`[TCP] ✅ 成功连接到 ${this.config.host}:${this.config.port}`);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();
      this.emit('connected');
    });

    // 接收数据事件
    this.client.on('data', (data) => {
      const message = data.toString().trim();
      console.log(`[TCP] 📨 收到数据: ${message}`);
      this.handleMessage(message);
    });

    // 连接关闭事件
    this.client.on('close', () => {
      console.log(`[TCP] ❌ 连接已关闭`);
      this.isConnected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    // 连接错误事件
    this.client.on('error', (error) => {
      console.error(`[TCP] ⚠️ 连接错误:`, error.message);
      this.isConnected = false;
      this.emit('error', error);
      this.scheduleReconnect();
    });

    // 超时事件
    this.client.on('timeout', () => {
      console.warn(`[TCP] ⏰ 连接超时`);
      this.client.destroy();
    });

    // 发起连接
    this.client.connect(this.config.port, this.config.host);
  }

  handleMessage(message) {
    try {
      // 解析接收到的消息
      const parts = message.split(':');
      if (parts.length >= 2) {
        const signal = parts[0];
        const value = parts[1];
        
        console.log(`[TCP] 🔍 解析信号: ${signal} = ${value}`);
        
        // 发射信号事件
        this.emit('signal', {
          signal: signal,
          value: value,
          rawMessage: message,
          timestamp: new Date().toISOString()
        });
      } else {
        console.warn(`[TCP] ⚠️ 无法解析的消息格式: ${message}`);
      }
    } catch (error) {
      console.error(`[TCP] ❌ 消息解析错误:`, error);
    }
  }



  scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`[TCP] ❌ 达到最大重连次数 (${this.config.maxReconnectAttempts})，停止重连`);
      this.emit('maxReconnectReached');
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempts++;
    
    console.log(`[TCP] 🔄 ${this.config.reconnectInterval/1000}秒后进行第${this.reconnectAttempts}次重连...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.client = null;
      this.connect();
    }, this.config.reconnectInterval);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  send(message) {
    if (this.isConnected && this.client) {
      try {
        this.client.write(message + '\n');
        console.log(`[TCP] 📤 发送数据: ${message}`);
        return true;
      } catch (error) {
        console.error(`[TCP] ❌ 发送失败:`, error);
        return false;
      }
    } else {
      console.warn(`[TCP] ⚠️ 连接未建立，无法发送消息: ${message}`);
      return false;
    }
  }

  disconnect() {
    console.log(`[TCP] 🔌 主动断开连接`);
    this.clearReconnectTimer();
    this.reconnectAttempts = this.config.maxReconnectAttempts; // 阻止自动重连
    
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.isConnected = false;
  }

  getStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      host: this.config.host,
      port: this.config.port
    };
  }
}

module.exports = TcpClient; 