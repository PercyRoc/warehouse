// WPF程序对接配置
export const WpfConfig = {
  // WebSocket连接配置 - 支持多个后端服务实例
  connection: {
    // 主服务器地址
    url: import.meta.env.VITE_WEBSOCKET_URL || 'ws://127.0.0.1:8080',
    reconnectInterval: 5000,
    maxReconnectAttempts: 10,
    heartbeatInterval: 30000,
    
    // 多个后端服务器地址（每台电脑部署一个后端服务）
    backendServers: [
      // 注释掉其他服务器，测试时只连接本地服务
      // 'ws://192.168.1.100:8080',  // SKU设备1后端服务
      // 'ws://192.168.1.101:8081',  // SKU设备2后端服务  
      // 'ws://192.168.1.102:8082',  // 扫码设备1后端服务
      // 'ws://192.168.1.103:8083',  // 大区设备1后端服务
    ],
    
    // 网络环境检测
    networkTimeout: 30000,    // 增加到30秒，避免频繁超时
    pingInterval: 20000       // 20秒发送一次心跳
  },

  // 设备映射配置 - 将前端设备ID映射到WPF程序的设备编号
  deviceMapping: {
    // 扫码复核区
    'camera-1': { wpfId: 'CAM_SCAN_01', name: '扫码复核相机1', type: 'camera' },
    'camera-2': { wpfId: 'CAM_SCAN_02', name: '扫码复核相机2', type: 'camera' },
    'sorter-1': { wpfId: 'SRT_SCAN_01', name: '扫码复核分拣器1', type: 'sorter' },
    'sorter-2': { wpfId: 'SRT_SCAN_02', name: '扫码复核分拣器2', type: 'sorter' },
    
    // SKU分拣区
    'sku-camera-1': { wpfId: 'CAM_SKU_01', name: 'SKU相机1', type: 'camera' },
    'sku-camera-2': { wpfId: 'CAM_SKU_02', name: 'SKU相机2', type: 'camera' },
    
    // SKU线1摆轮
    'sku-sorter-1-1': { wpfId: 'SRT_SKU_01_01', name: 'SKU分拣器1-1', type: 'sorter' },
    'sku-sorter-1-2': { wpfId: 'SRT_SKU_01_02', name: 'SKU分拣器1-2', type: 'sorter' },
    'sku-sorter-1-3': { wpfId: 'SRT_SKU_01_03', name: 'SKU分拣器1-3', type: 'sorter' },
    'sku-sorter-1-4': { wpfId: 'SRT_SKU_01_04', name: 'SKU分拣器1-4', type: 'sorter' },
    'sku-sorter-1-5': { wpfId: 'SRT_SKU_01_05', name: 'SKU分拣器1-5', type: 'sorter' },
    'sku-sorter-1-6': { wpfId: 'SRT_SKU_01_06', name: 'SKU分拣器1-6', type: 'sorter' },
    
    // SKU线2摆轮
    'sku-sorter-2-1': { wpfId: 'SRT_SKU_02_01', name: 'SKU分拣器2-1', type: 'sorter' },
    'sku-sorter-2-2': { wpfId: 'SRT_SKU_02_02', name: 'SKU分拣器2-2', type: 'sorter' },
    'sku-sorter-2-3': { wpfId: 'SRT_SKU_02_03', name: 'SKU分拣器2-3', type: 'sorter' },
    'sku-sorter-2-4': { wpfId: 'SRT_SKU_02_04', name: 'SKU分拣器2-4', type: 'sorter' },
    'sku-sorter-2-5': { wpfId: 'SRT_SKU_02_05', name: 'SKU分拣器2-5', type: 'sorter' },
    'sku-sorter-2-6': { wpfId: 'SRT_SKU_02_06', name: 'SKU分拣器2-6', type: 'sorter' },
    
    // 大区分拣器
    'region-camera-1': { wpfId: 'CAM_REG_01', name: '大区扫描相机1', type: 'camera' },
    'region-sorter-1': { wpfId: 'SRT_REG_01', name: '大区分拣器1', type: 'sorter' },
    'region-sorter-2': { wpfId: 'SRT_REG_02', name: '大区分拣器2', type: 'sorter' },
    'region-sorter-3': { wpfId: 'SRT_REG_03', name: '大区分拣器3', type: 'sorter' },
    'region-sorter-4': { wpfId: 'SRT_REG_04', name: '大区分拣器4', type: 'sorter' },
    'region-sorter-5': { wpfId: 'SRT_REG_05', name: '大区分拣器5', type: 'sorter' },
    'region-sorter-6': { wpfId: 'SRT_REG_06', name: '大区分拣器6', type: 'sorter' }
  },

  // 路径映射配置 - 根据格口信息确定包裹路径
  pathMapping: {
    // 扫码复核区路径
    scanningPaths: {
      'A区': 'scan_line_1_start',
      'B区': 'scan_line_2_start'
    },
    
    // SKU分拣路径
    skuPaths: {
      'SKU_LINE_1': 'sku_line_1',
      'SKU_LINE_2': 'sku_line_2'
    },
    
    // 大区分拣路径
    regionPaths: {
      'REGION_MAIN': 'region_sort_line'
    },
    
    // 默认路径配置
    defaultPath: 'region_sort_line'
  },

  // 格口到路径的映射规则
  sortCodeToPath: {
    // A区格口 -> 路径1
    'A01': 'scan_line_1_start',
    'A02': 'scan_line_1_start', 
    'A03': 'scan_line_1_start',
    
    // B区格口 -> 路径2
    'B01': 'scan_line_2_start',
    'B02': 'scan_line_2_start',
    'B03': 'scan_line_2_start',
    
    // SKU专用格口
    'SKU01': 'sku_line_1',
    'SKU02': 'sku_line_1',
    'SKU03': 'sku_line_2',
    'SKU04': 'sku_line_2',
    
    // 大区总分拣
    'REG01': 'region_sort_line',
    'REG02': 'region_sort_line',
    'REG03': 'region_sort_line'
  },

  // 包裹状态映射
  packageStatusMapping: {
    created: 'CREATED',      // 包裹已创建
    moving: 'IN_TRANSIT',    // 运输中
    scanned: 'SCANNED',      // 已扫描
    sorted: 'SORTED',        // 已分拣
    completed: 'COMPLETED',  // 处理完成
    error: 'ERROR'           // 处理错误
  },

  // 设备状态映射
  deviceStatusMapping: {
    online: 'ONLINE',
    offline: 'OFFLINE', 
    error: 'ERROR',
    maintenance: 'MAINTENANCE'
  },

  // 告警级别映射
  alertLevelMapping: {
    info: 'INFO',
    warning: 'WARNING',
    error: 'ERROR',
    critical: 'CRITICAL'
  },

  // 设备ID到传送带路径的映射
  deviceToPathMapping: {
    // 扫码复核区设备
    'CAM_SCAN_01': 'scan_line_1_start',
    'CAM_SCAN_02': 'scan_line_2_start', 
    'SRT_SCAN_01': 'scan_line_1_start',
    'SRT_SCAN_02': 'scan_line_2_start',
    
    // SKU分拣区设备
    'CAM_SKU_01': 'sku_line_1',
    'CAM_SKU_02': 'sku_line_2',
    
    // SKU线1摆轮
    'SRT_SKU_01_01': 'sku_line_1',
    'SRT_SKU_01_02': 'sku_line_1',
    'SRT_SKU_01_03': 'sku_line_1',
    'SRT_SKU_01_04': 'sku_line_1',
    'SRT_SKU_01_05': 'sku_line_1',
    'SRT_SKU_01_06': 'sku_line_1',
    
    // SKU线2摆轮
    'SRT_SKU_02_01': 'sku_line_2',
    'SRT_SKU_02_02': 'sku_line_2',
    'SRT_SKU_02_03': 'sku_line_2',
    'SRT_SKU_02_04': 'sku_line_2',
    'SRT_SKU_02_05': 'sku_line_2',
    'SRT_SKU_02_06': 'sku_line_2',
    
    // 大区分拣设备 
    'CAM_REG_01': 'region_sort_line',
    'SRT_REG_01': 'region_sort_line',
    'SRT_REG_02': 'region_sort_line',
    'SRT_REG_03': 'region_sort_line',
    'SRT_REG_04': 'region_sort_line',
    'SRT_REG_05': 'region_sort_line',
    'SRT_REG_06': 'region_sort_line'
  },

  // 数据上报配置
  reporting: {
    // 包裹状态上报频率（毫秒）
    packageStatusInterval: 1000,
    
    // 设备运行数据上报频率（毫秒）
    deviceMetricsInterval: 5000,
    
    // 系统统计数据上报频率（毫秒）
    systemStatsInterval: 10000,
    
    // 批量上报包裹数量阈值
    batchReportThreshold: 10
  },

  // 消息格式配置
  messageFormat: {
    version: '1.0',
    encoding: 'UTF-8',
    compression: false
  },

  // 各传送带线路摆轮数量配置
  pathSorterCount: {
    'scan_line_1_start': 1,    // 扫码线1：1个摆轮
    'scan_line_2_start': 1,    // 扫码线2：1个摆轮
    'sku_line_1': 6,           // SKU线1：6个摆轮
    'sku_line_2': 6,           // SKU线2：6个摆轮  
    'region_sort_line': 6      // 大区线：6个摆轮
  },

  // 随机分拣配置（采用负载平衡算法）
  randomSortingConfig: {
    enabled: true,              // 是否启用随机分拣
    sortingProbability: 0.95,   // 分拣概率（0.95 = 95%概率分拣，5%概率直行）- 提高分拣率让效果更明显
    leftRightBalance: 0.5,      // 左右摆轮平衡（0.5 = 50%左摆，50%右摆）- 仅用于没有特定限制的路径
    // 注意：摆轮选择使用负载平衡算法，自动确保每个摆轮使用次数尽可能平均
    
    // 不同路径的分拣概率可以不同
    pathSpecificProbability: {
      'scan_line_1_start': 0.95,  // 扫码线：95%分拣概率
      'scan_line_2_start': 0.95,   
      'sku_line_1': 0.95,         // SKU线：95%分拣概率（提高让效果更明显）
      'sku_line_2': 0.95,
      'region_sort_line': 0.95    // 大区线：95%分拣概率（提高让效果更明显）
    },

    // 路径特定的分拣方向限制
    pathDirectionConstraints: {
      'scan_line_1_start': ['left'],   // 扫码线1：只能左分拣
      'scan_line_2_start': ['right'],  // 扫码线2：只能右分拣
      'sku_line_1': ['left'],          // SKU线1：只能左分拣  
      'sku_line_2': ['right'],         // SKU线2：只能右分拣
      'region_sort_line': ['left', 'right']  // 大区线：可以左右分拣
    }
  }
};

// 工具函数
export const WpfUtils = {
  // 获取WPF设备ID
  getWpfDeviceId(frontendDeviceId) {
    const mapping = WpfConfig.deviceMapping[frontendDeviceId];
    return mapping ? mapping.wpfId : frontendDeviceId;
  },

  // 获取设备名称
  getDeviceName(frontendDeviceId) {
    const mapping = WpfConfig.deviceMapping[frontendDeviceId];
    return mapping ? mapping.name : frontendDeviceId;
  },

  // 根据设备ID确定传送带路径（新增）
  getPathByDeviceId(deviceId) {
    return WpfConfig.deviceToPathMapping[deviceId] || WpfConfig.pathMapping.defaultPath;
  },

  // 根据格口号和路径确定摆轮分拣信息
  getSorterInfoBySortCode(sortCode, pathId) {
    const sorterCount = WpfConfig.pathSorterCount[pathId] || 0;
    const maxSortCode = sorterCount * 2; // 每个摆轮支持2个格口（左、右）
    
    // 如果格口号超过范围，返回直行
    if (sortCode > maxSortCode || sortCode < 1) {
      return { action: 'straight', sorterIndex: -1, direction: 'straight' };
    }
    
    // 计算摆轮索引和方向
    const sorterIndex = Math.floor((sortCode - 1) / 2); // 第几个摆轮（从0开始）
    const direction = (sortCode - 1) % 2 === 0 ? 'left' : 'right'; // 左摆还是右摆
    
    return {
      action: 'sort',
      sorterIndex: sorterIndex,
      direction: direction,
      targetSortCode: sortCode
    };
  },

  // 根据格口信息确定路径
  getPathByDestination(destination) {
    const { sortCode, region } = destination;
    
    // 优先使用格口编号映射
    if (sortCode && WpfConfig.sortCodeToPath[sortCode]) {
      return WpfConfig.sortCodeToPath[sortCode];
    }
    
    // 其次使用区域映射
    if (region) {
      const scanPath = WpfConfig.pathMapping.scanningPaths[region];
      if (scanPath) return scanPath;
    }
    
    // 返回默认路径
    return WpfConfig.pathMapping.defaultPath;
  },

  // 映射包裹状态
  mapPackageStatus(frontendStatus) {
    return WpfConfig.packageStatusMapping[frontendStatus] || frontendStatus;
  },

  // 映射设备状态
  mapDeviceStatus(frontendStatus) {
    return WpfConfig.deviceStatusMapping[frontendStatus] || frontendStatus;
  },

  // 创建标准消息格式
  createMessage(type, data) {
    return {
      version: WpfConfig.messageFormat.version,
      timestamp: new Date().toISOString(),
      type,
      data
    };
  },

  // 验证消息格式
  validateMessage(message) {
    if (!message || typeof message !== 'object') {
      return { valid: false, error: '消息格式无效' };
    }
    
    if (!message.type) {
      return { valid: false, error: '缺少消息类型' };
    }
    
    if (!message.data) {
      return { valid: false, error: '缺少消息数据' };
    }
    
    return { valid: true };
  }
};

export default WpfConfig; 