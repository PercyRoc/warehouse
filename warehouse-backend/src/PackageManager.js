const { v4: uuidv4 } = require('uuid');

class PackageManager {
  constructor(config) {
    this.config = config;
    this.packageCounter = 0;
    this.activePackages = new Map();
    this.packageHistory = [];
    this.maxHistorySize = 1000;
  }

  // 生成包裹ID
  generatePackageId() {
    this.packageCounter++;
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS
    return `${this.config.packageIdPrefix}_${timestamp}_${this.packageCounter.toString().padStart(3, '0')}`;
  }

  // 根据信号创建包裹
  createPackageFromSignal(signalData, deviceConfig) {
    try {
      const { signal, value, timestamp, rawMessage } = signalData;
      
      // 构建完整的信号字符串用于比较
      const fullSignal = `${signal}:${value}`;
      
      // 检查是否是触发信号（比较完整信号）
      if (fullSignal !== this.config.triggerSignal) {
        console.log(`[PackageManager] ⏭️ 忽略非触发信号: ${fullSignal} (期望: ${this.config.triggerSignal})`);
        return null;
      }
      
      // 后端不再解析具体格口号，由前端随机生成分拣信息
      // 保留原有的值用于日志记录，但不作为实际的分拣依据
      const signalValue = value || '1';
      
      // 生成包裹信息
      const packageInfo = {
        packageId: this.generatePackageId(),
        sourceDeviceId: deviceConfig.deviceId,
        signalValue: signalValue, // 原始信号值，仅用于记录
        signal: signal,
        deviceName: deviceConfig.deviceName,
        area: deviceConfig.area,
        createdAt: timestamp,
        status: 'created'
      };
      
      // 存储包裹信息
      this.activePackages.set(packageInfo.packageId, packageInfo);
      
      // 添加到历史记录
      this.addToHistory(packageInfo);
      
      console.log(`[PackageManager] 📦 创建包裹: ${packageInfo.packageId} (设备: ${deviceConfig.deviceId}, 触发信号: ${fullSignal}) - 分拣信息将由前端随机生成`);
      
      return packageInfo;
      
    } catch (error) {
      console.error(`[PackageManager] ❌ 创建包裹失败:`, error);
      return null;
    }
  }

  // 更新包裹状态
  updatePackageStatus(packageId, status, additionalData = {}) {
    const packageInfo = this.activePackages.get(packageId);
    if (!packageInfo) {
      console.warn(`[PackageManager] ⚠️ 包裹不存在: ${packageId}`);
      return false;
    }
    
    packageInfo.status = status;
    packageInfo.lastUpdate = new Date().toISOString();
    
    // 合并额外数据
    Object.assign(packageInfo, additionalData);
    
    console.log(`[PackageManager] 🔄 更新包裹状态: ${packageId} -> ${status}`);
    
    // 如果包裹已完成，移到历史记录
    if (status === 'completed' || status === 'error') {
      this.completePackage(packageId);
    }
    
    return true;
  }

  // 完成包裹处理
  completePackage(packageId) {
    const packageInfo = this.activePackages.get(packageId);
    if (packageInfo) {
      packageInfo.completedAt = new Date().toISOString();
      packageInfo.processingTime = this.calculateProcessingTime(packageInfo);
      
      // 从活跃包裹中移除
      this.activePackages.delete(packageId);
      
      console.log(`[PackageManager] ✅ 包裹处理完成: ${packageId} (耗时: ${packageInfo.processingTime}ms)`);
    }
  }

  // 计算处理时间
  calculateProcessingTime(packageInfo) {
    if (!packageInfo.createdAt) return 0;
    
    const createdTime = new Date(packageInfo.createdAt);
    const completedTime = new Date(packageInfo.completedAt || new Date());
    
    return completedTime.getTime() - createdTime.getTime();
  }

  // 添加到历史记录
  addToHistory(packageInfo) {
    this.packageHistory.unshift({
      ...packageInfo,
      addedToHistory: new Date().toISOString()
    });
    
    // 限制历史记录大小
    if (this.packageHistory.length > this.maxHistorySize) {
      this.packageHistory.splice(this.maxHistorySize);
    }
  }

  // 获取包裹信息
  getPackage(packageId) {
    return this.activePackages.get(packageId) || null;
  }

  // 获取所有活跃包裹
  getActivePackages() {
    return Array.from(this.activePackages.values());
  }

  // 获取历史包裹
  getPackageHistory(limit = 50) {
    return this.packageHistory.slice(0, limit);
  }

  // 获取统计信息
  getStatistics() {
    const activeCount = this.activePackages.size;
    const totalCount = this.packageCounter;
    const completedCount = totalCount - activeCount;
    
    // 计算最近24小时的包裹数量
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent24hCount = this.packageHistory.filter(pkg => 
      new Date(pkg.createdAt) > last24Hours
    ).length;
    
    // 计算平均处理时间
    const completedPackages = this.packageHistory.filter(pkg => pkg.processingTime);
    const avgProcessingTime = completedPackages.length > 0 
      ? completedPackages.reduce((sum, pkg) => sum + pkg.processingTime, 0) / completedPackages.length 
      : 0;
    
    return {
      activePackages: activeCount,
      totalPackages: totalCount,
      completedPackages: completedCount,
      recent24Hours: recent24hCount,
      averageProcessingTime: Math.round(avgProcessingTime),
      uptime: this.getUptime()
    };
  }

  // 获取运行时间
  getUptime() {
    if (!this.startTime) {
      this.startTime = new Date();
    }
    return Date.now() - this.startTime.getTime();
  }

  // 清理过期数据
  cleanup() {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24小时
    
    // 清理过期的活跃包裹（异常情况）
    let cleanedCount = 0;
    for (const [packageId, packageInfo] of this.activePackages) {
      const createdTime = new Date(packageInfo.createdAt);
      if (now.getTime() - createdTime.getTime() > maxAge) {
        this.activePackages.delete(packageId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`[PackageManager] 🧹 清理了 ${cleanedCount} 个过期包裹`);
    }
    
    // 限制历史记录大小
    if (this.packageHistory.length > this.maxHistorySize) {
      const removed = this.packageHistory.splice(this.maxHistorySize);
      console.log(`[PackageManager] 🧹 清理了 ${removed.length} 条历史记录`);
    }
  }

  // 重置计数器
  reset() {
    console.log(`[PackageManager] 🔄 重置包裹管理器`);
    this.packageCounter = 0;
    this.activePackages.clear();
    this.packageHistory = [];
    this.startTime = new Date();
  }

  // 获取状态信息
  getStatus() {
    return {
      activePackages: this.activePackages.size,
      historyCount: this.packageHistory.length,
      totalGenerated: this.packageCounter,
      uptime: this.getUptime(),
      lastCleanup: this.lastCleanup || null
    };
  }
}

module.exports = PackageManager; 