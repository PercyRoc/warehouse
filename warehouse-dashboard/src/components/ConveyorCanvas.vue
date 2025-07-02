<script setup>
import { ref, onMounted, onUnmounted, reactive, computed, watch } from 'vue';
import { allPaths as initialPaths, getPathById, devices as initialDevices } from '@/core/PathManager';
import CameraDevice from './CameraDevice.vue';
import Sorter from './Sorter.vue';
import Konva from 'konva';
import webSocketClient from '@/services/WebSocketClient.js';
import { WpfUtils } from '@/services/WpfIntegrationConfig.js';

const LAYOUT_STORAGE_KEY = 'conveyorLayout';

const devices = reactive(initialDevices);
const paths = reactive(initialPaths);

// 智能计算画布尺寸 - 使用浏览器窗口大小
function getCanvasSize() {
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  
  console.log(`📐 使用浏览器窗口尺寸: ${windowWidth}x${windowHeight}`);
  
  return {
    width: windowWidth,
    height: windowHeight
  };
}

const stageConfig = ref(getCanvasSize());

// 画布缩放和平移状态 - 简化为基础配置
const stageTransform = ref({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1
});

// 缩放配置 - 优化为大屏显示
const zoomConfig = {
  minScale: 0.01,  // 进一步降低最小缩放，允许查看更大范围（1%）
  maxScale: 5,     // 增加最大缩放，便于查看细节
  scaleStep: 0.1
};

// 检测是否为大屏环境
const isLargeScreen = computed(() => {
  return window.innerWidth >= 1920 && window.innerHeight >= 1080;
});

// 获取适合的初始缩放比例
function getOptimalInitialScale() {
  const contentWidth = 3048;  // 基于3048x2160分辨率的布局宽度
  const contentHeight = 2160; // 基于3048x2160分辨率的布局高度
  const padding = 100;
  
  const scaleX = (stageConfig.value.width - padding * 2) / contentWidth;
  const scaleY = (stageConfig.value.height - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 1); // 不超过1倍
  
  return Math.max(scale, zoomConfig.minScale);
}

// Stage引用，用于直接操作Konva Stage对象
let stageRef = null;

const activePackages = reactive({});

// WebSocket和实时模式管理
const wsConnectionStatus = ref({
  connected: false,
  reconnectAttempts: 0
});

// 设备在线状态管理
const deviceOnlineStatus = reactive({});

// --- 新增：专门用于节点拖拽的状态管理 ---
const nodeDragState = reactive({
  isDragging: false,
  pathKey: null,
  pointIndex: -1,
  // --- 以下仅用于拉伸模式 ---
  originalPathLength: 0,
  originalDevicesOnPath: [],
  anchorPoint: null,
});

// --- 新增：线体拖拽状态管理 ---
const pathDragState = reactive({
  isDragging: false,
  pathKey: null,
  startX: 0,
  startY: 0,
  originalDevicesOnPath: []
});

// --- 旧的拖拽状态管理（完全移除） ---
// const dragState = reactive({...}) - 已删除

// 设备在线状态到传送带路径的映射
const deviceToPathMapping = {
  'CAM_SKU_01': 'sku_line_1',
  'CAM_SKU_02': 'sku_line_2', 
  'CAM_SCAN_01': 'scan_line_1_start',
  'CAM_SCAN_02': 'scan_line_2_start',
  'CAM_REG_01': 'region_sort_line'
};

// --- 恢复被误删的状态管理 ---
const cameraDevices = computed(() => devices.filter(d => d.type === 'camera'));
const sorterDevices = computed(() => devices.filter(d => d.type === 'sorter'));
const cameraStates = reactive({});
const sorterStates = reactive({});
const particles = ref({});
const packageStatusTracker = ref({});
const deviceMetrics = reactive({});
const lastReportTime = ref(0);
const dynamicLineRefs = ref({});
const activeConveyors = ref(new Set());

// 用于强制触发editPoints重新计算的响应式触发器
const editPointsUpdateTrigger = ref(0);

// 编辑模式下的可拖拽节点（只显示端点）
const editPoints = computed(() => {
  // 依赖触发器，确保在路径修改后重新计算
  editPointsUpdateTrigger.value;
  if (!props.isEditMode) return [];
  
  const points = [];
  Object.entries(paths).forEach(([pathKey, pathObj]) => {
    if (pathKey.startsWith('layout_') || !pathObj.points) return;
    
    // 只添加端点（起点和终点），跳过中间点
    pathObj.points.forEach((point, index) => {
      const isEndpoint = index === 0 || index === pathObj.points.length - 1;
      if (isEndpoint) {
        points.push({
          id: `${pathKey}-${index}`,
          x: point.x,
          y: point.y,
          radius: 8,
          fill: '#e74c3c', // 端点红色
          stroke: 'white',
          strokeWidth: 2,
          draggable: true,
          shadowColor: 'rgba(0,0,0,0.3)',
          shadowBlur: 4,
          shadowOffsetX: 1,
          shadowOffsetY: 1,
          // 存储路径信息用于拖拽处理
          _pathKey: pathKey,
          _pointIndex: index
        });
      }
    });
  });
  
  return points;
});

watch(cameraDevices, (newCameras) => {
  const newIds = new Set(newCameras.map(c => c.id));
  for (const id in cameraStates) {
    if (!newIds.has(id)) delete cameraStates[id];
  }
  newCameras.forEach(cam => {
    if (!cameraStates[cam.id]) cameraStates[cam.id] = { isScanning: false };
  });
}, { immediate: true, deep: true });

watch(sorterDevices, (newSorters) => {
  const newIds = new Set(newSorters.map(s => s.id));
  for (const id in sorterStates) {
    if (!newIds.has(id)) delete sorterStates[id];
  }
  newSorters.forEach(sorter => {
    if (!sorterStates[sorter.id]) {
      sorterStates[sorter.id] = { 
        direction: 'straight',
        lastActiveTime: null
      };
    }
  });
}, { immediate: true, deep: true });

const setLineRef = (el, key) => {
  if (el) {
    dynamicLineRefs.value[key] = el;
  }
};

// 更新活跃传送带状态
function updateActiveConveyors() {
  const currentActive = new Set();
  
  // 1. 基于包裹状态激活传送带
  for (const pkgId in activePackages) {
    const pkg = activePackages[pkgId];
    const pathKey = Object.keys(paths).find(key => paths[key].points === pkg.path);
    if (pathKey) {
      currentActive.add(pathKey);
    }
  }
  
  // 2. 基于设备在线状态激活传送带
  Object.keys(deviceOnlineStatus).forEach(deviceId => {
    const status = deviceOnlineStatus[deviceId];
    if (status.status === 'ONLINE') {
      const pathId = deviceToPathMapping[deviceId];
      if (pathId) {
        currentActive.add(pathId);
        console.log(`🟢 设备 ${deviceId} 在线，激活传送带: ${pathId}`);
      }
    }
  });
  
  activeConveyors.value = currentActive;
}

// 监听包裹变化
watch(activePackages, () => {
  updateActiveConveyors();
  
  // 发送包裹更新事件给父组件
  emit('package-update', activePackages);
}, { deep: true });

// 监听设备在线状态变化
watch(deviceOnlineStatus, () => {
  updateActiveConveyors();
}, { deep: true });

// --- WebSocket事件处理 ---
function setupWebSocketHandlers() {
  // 连接状态更新
  webSocketClient.on('connected', (event) => {
    console.log('WebSocket连接成功:', event);
    wsConnectionStatus.value.connected = true;
    wsConnectionStatus.value.reconnectAttempts = 0;
    
    // 如果连接成功消息包含设备信息，更新设备状态
    if (event.data && event.data.deviceInfo) {
      updateDeviceOnlineStatus(event.data.deviceInfo.deviceId, 'ONLINE', event.data.deviceInfo);
    }
  });

  webSocketClient.on('disconnected', (data) => {
    console.log('WebSocket连接断开:', data);
    wsConnectionStatus.value.connected = false;
  });

  webSocketClient.on('error', (data) => {
    console.error('WebSocket连接错误:', data);
    wsConnectionStatus.value.connected = false;
  });

  // 接收初始数据
  webSocketClient.on('initialData', (data) => {
    console.log('收到初始数据:', data);
    if (data.packages) {
      // 清空现有包裹，加载服务器数据
      Object.keys(activePackages).forEach(key => delete activePackages[key]);
      
      // 将服务器包裹数据转换为前端格式
      Object.values(data.packages).forEach(pkg => {
        createNewPackage({
          packageInfo: {
            id: pkg.id,
            sku: pkg.sku,
            region: pkg.region
          },
          _startPathId: pkg._startPathId
        });
      });
    }
  });

  // 设备心跳处理
  webSocketClient.on('deviceHeartbeat', (event) => {
    console.log('收到设备心跳:', event);
    // 更新设备在线状态
    updateDeviceOnlineStatus(event.deviceId, 'ONLINE', event.data);
  });

  // 设备状态变化处理
  webSocketClient.on('deviceStatus', (event) => {
    console.log('收到设备状态变化:', event);
    updateDeviceOnlineStatus(event.deviceId, event.status, event.data);
  });

  // 设备心跳超时处理
  webSocketClient.on('deviceEvent', (event) => {
    if (event.type === 'heartbeatTimeout') {
      console.warn('设备心跳超时:', event.data);
      updateDeviceOnlineStatus(event.data.deviceId, 'OFFLINE', {
        reason: event.data.reason,
        lastHeartbeat: event.data.lastHeartbeat,
        timeoutDuration: event.data.timeoutDuration
      });
    } else if (event.type === 'heartbeatRecovered') {
      console.log('设备心跳恢复:', event.data);
      updateDeviceOnlineStatus(event.data.deviceId, 'ONLINE', event.data);
    }
  });

  // 批量设备心跳超时处理
  webSocketClient.on('deviceHeartbeatTimeout', (event) => {
    console.warn('多个设备心跳超时:', event);
    event.timeoutDevices.forEach(device => {
      updateDeviceOnlineStatus(device.deviceId, 'OFFLINE', {
        reason: 'heartbeat_timeout',
        lastHeartbeat: device.lastHeartbeat,
        timeoutDuration: device.timeoutDuration
      });
    });
  });

  // 包裹事件处理
  webSocketClient.on('packageEvent', (event) => {
    console.log('收到包裹事件:', event);
    
    switch (event.type) {
      case 'packageCreated':
        createNewPackage(event.data);
        break;
      case 'packageCreatedByName':
        // 通过传送带名称触发包裹动画
        const success = triggerPackageByPathName(event.data.pathName, event.data.packageInfo);
        if (!success) {
          console.error(`❌ WebSocket触发失败：找不到传送带 "${event.data.pathName}"`);
        }
        break;
      case 'packageUpdate':
        updatePackageFromServer(event.data);
        break;
      case 'packageCompleted':
        removePackage(event.data.id);
        break;
    }
  });

  // 设备事件处理
  webSocketClient.on('deviceEvent', (event) => {
    console.log('收到设备事件:', event);
    
    switch (event.type) {
      case 'sorterUpdate':
        updateSorterState(event.data.sorterId, event.data.direction);
        break;
      case 'cameraUpdate':
        updateCameraState(event.data.cameraId, event.data.isScanning);
        break;
      case 'heartbeatTimeout':
        // 旧版本的心跳超时处理（兼容性）
        updateDeviceOnlineStatus(event.data.deviceId, 'OFFLINE', event.data);
        break;
      case 'heartbeatRecovered':
        // 旧版本的心跳恢复处理（兼容性）
        updateDeviceOnlineStatus(event.data.deviceId, 'ONLINE', event.data);
        break;
      case 'backendServiceTimeout':
        // 后端服务超时：设备状态保持不变，但记录后端服务离线
        console.warn(`⚠️ 后端服务超时，设备 ${event.data.deviceId} 最后TCP状态: ${event.data.lastTcpStatus ? '已连接' : '已断开'}`);
        // 不改变设备的在线状态，因为这是后端服务的问题，不是设备的问题
        break;
      case 'backendServiceRecovered':
        // 后端服务恢复：使用当前TCP状态
        console.log(`✅ 后端服务恢复，设备 ${event.data.deviceId} 当前状态: ${event.data.status}`);
        updateDeviceOnlineStatus(event.data.deviceId, event.data.status, event.data);
        break;
    }
  });

  // 系统事件处理
  webSocketClient.on('systemEvent', (event) => {
    console.log('收到系统事件:', event);
    
    if (event.type === 'systemMessage') {
      console.log(`系统消息 [${event.data.level}]: ${event.data.message}`);
    }
  });
}

// --- 服务器数据处理函数 ---
function updatePackageFromServer(packageData) {
  if (activePackages[packageData.id]) {
    // 更新现有包裹状态
    activePackages[packageData.id].status = packageData.status;
  }
}

function removePackage(packageId) {
  if (activePackages[packageId]) {
    // 标记为淡出，让动画处理删除
    activePackages[packageId].isFadingOut = true;
  }
}

function updateSorterState(sorterId, direction) {
  if (sorterStates[sorterId]) {
    sorterStates[sorterId].direction = direction;
    sorterStates[sorterId].lastActiveTime = Date.now();
  }
}

function updateCameraState(cameraId, isScanning) {
  if (cameraStates[cameraId]) {
    cameraStates[cameraId].isScanning = isScanning;
  }
}

// --- 设备在线状态管理 ---
function updateDeviceOnlineStatus(deviceId, status, metadata) {
  const previousStatus = deviceOnlineStatus[deviceId]?.status;
  
  deviceOnlineStatus[deviceId] = {
    status: status,
    lastUpdate: new Date().toISOString(),
    metadata: metadata || {}
  };

  console.log(`设备 ${deviceId} 状态更新: ${previousStatus} → ${status}`, metadata);

  // 根据状态更新设备显示效果
  updateDeviceVisualStatus(deviceId, status);
  
  // 当设备状态变化时，立即更新传送带动画
  if (previousStatus !== status) {
    console.log(`🔄 设备状态变化，更新传送带动画`);
    updateActiveConveyors();
  }
}

function updateDeviceVisualStatus(deviceId, status) {
  // 查找设备在devices数组中的索引
  const device = devices.find(d => d.id === deviceId || WpfUtils.getWpfDeviceId(d.id) === deviceId);
  if (!device) {
    // 尝试通过WPF ID查找
    const wpfDevice = Object.entries(WpfConfig.deviceMapping).find(([key, value]) => value.wpfId === deviceId);
    if (wpfDevice) {
      const frontendId = wpfDevice[0];
      const foundDevice = devices.find(d => d.id === frontendId);
      if (foundDevice) {
        foundDevice.offline = (status === 'OFFLINE');
      }
    } else {
      console.warn(`未找到设备 ${deviceId}`);
    }
    return;
  }

  // 更新设备的视觉状态
  device.offline = (status === 'OFFLINE');
}

// 获取设备在线状态
function getDeviceOnlineStatus(deviceId) {
  const wpfDeviceId = WpfUtils.getWpfDeviceId(deviceId);
  return deviceOnlineStatus[wpfDeviceId] || deviceOnlineStatus[deviceId] || { status: 'UNKNOWN' };
}

// 检查设备是否离线
function isDeviceOffline(deviceId) {
  const status = getDeviceOnlineStatus(deviceId);
  return status.status === 'OFFLINE';
}

let anim;

// --- 画布缩放和平移功能 - 重构为直接操作Stage ---

// 获取当前Stage对象
function getStage() {
  return stageRef;
}



// 通用缩放函数，直接操作Konva Stage对象
function zoomToPoint(newScale, centerPoint = null) {
  const stage = getStage();
  if (!stage) return;
  
  // 如果没有指定中心点，使用当前视窗中心
  if (!centerPoint) {
    centerPoint = {
      x: stageConfig.value.width / 2,
      y: stageConfig.value.height / 2
    };
  }
  
  const oldScale = stage.scaleX();
  
  // 限制缩放范围
  const clampedScale = Math.max(zoomConfig.minScale, Math.min(zoomConfig.maxScale, newScale));
  
  // 如果缩放值没有变化，直接返回
  if (Math.abs(clampedScale - oldScale) < 0.001) {
    return;
  }
  
  // 计算缩放中心点在世界坐标中的位置
  const worldPoint = {
    x: (centerPoint.x - stage.x()) / oldScale,
    y: (centerPoint.y - stage.y()) / oldScale,
  };
  
  // 计算新的位置，保持世界坐标点在屏幕上的位置不变
  const newPos = {
    x: centerPoint.x - worldPoint.x * clampedScale,
    y: centerPoint.y - worldPoint.y * clampedScale,
  };
  
  // 直接更新Stage，避免触发Vue响应式更新
  stage.scale({ x: clampedScale, y: clampedScale });
  stage.position(newPos);
  stage.batchDraw(); // 手动触发重绘
}

function handleWheel(e) {
  e.evt.preventDefault();
  
  const scaleBy = 1.1;
  const stage = e.target.getStage();
  const pointer = stage.getPointerPosition();
  
  // 直接从Stage获取当前缩放
  const oldScale = stage.scaleX();
  let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
  
  // 使用鼠标位置作为缩放中心点
  zoomToPoint(newScale, pointer);
}

function handleStageDragStart(e) {
  if (!props.isEditMode) return;
  // Stage拖拽开始，用于平移画布
}

function handleStageDragEnd(e) {
  if (!props.isEditMode) return;
  // Stage拖拽结束，Konva已经自动更新了位置，无需手动同步
}

// --- 缩放控制函数 ---
function zoomIn() {
  const stage = getStage();
  if (!stage) return;
  const newScale = stage.scaleX() + zoomConfig.scaleStep;
  zoomToPoint(newScale);
}

function zoomOut() {
  const stage = getStage();
  if (!stage) return;
  const newScale = stage.scaleX() - zoomConfig.scaleStep;
  zoomToPoint(newScale);
}

function resetZoom() {
  zoomToPoint(1);
}

// 重置视图到适合的缩放和位置
function forceResetView() {
  const stage = getStage();
  if (!stage) {
    console.warn('⚠️ Stage未找到，无法重置视图');
    return;
  }
  
  console.log('🔄 重置视图到合适的缩放和位置');
  console.log(`📐 画布尺寸: ${stageConfig.value.width}x${stageConfig.value.height} (窗口尺寸)`);
  
  // 计算内容区域的大概范围（基于设备和路径的分布）
  const contentWidth = 3200;  // 大致的内容宽度
  const contentHeight = 2000; // 大致的内容高度
  const padding = 100;
  
  const screenWidth = stageConfig.value.width;
  const screenHeight = stageConfig.value.height;
  
  // 计算合适的缩放比例
  const scaleX = (screenWidth - padding * 2) / contentWidth;
  const scaleY = (screenHeight - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 0.8); // 最大不超过0.8倍，确保有足够的操作空间
  
  console.log(`📊 缩放计算: 内容=${contentWidth}x${contentHeight}, 屏幕=${screenWidth}x${screenHeight}, 最终scale=${scale.toFixed(3)}`);
  
  // 将内容居中显示
  const centerX = contentWidth / 2;
  const centerY = contentHeight / 2;
  
  const newX = screenWidth / 2 - centerX * scale;
  const newY = screenHeight / 2 - centerY * scale;
  
  // 应用变换
  stage.scale({ x: scale, y: scale });
  stage.position({ x: newX, y: newY });
  stage.batchDraw();
  
  console.log(`✅ 视图已重置: 缩放=${scale.toFixed(3)}, 位置=(${newX.toFixed(1)}, ${newY.toFixed(1)})`);
}

function fitToScreen() {
  forceResetView(); // 直接调用强制重置
}

// --- 路径反转功能 ---
function reversePath(pathKey) {
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) return;
  
  console.log(`反转路径: ${pathKey}`);
  
  // 记录反转前的路径信息用于设备重新定位
  const originalStart = { ...pathObj.points[0] };
  const originalEnd = { ...pathObj.points[pathObj.points.length - 1] };
  
  // 反转路径点的顺序
  const reversedPoints = [...pathObj.points].reverse();
  
  // 更新路径点，保持原有的引用结构
  pathObj.points.splice(0, pathObj.points.length, ...reversedPoints);
  
  // 重新计算中间点位置
  if (pathObj.points.length >= 3) {
    const start = pathObj.points[0];
    const end = pathObj.points[pathObj.points.length - 1];
    const middleIndex = Math.floor(pathObj.points.length / 2);
    
    pathObj.points[middleIndex].x = (start.x + end.x) / 2;
    pathObj.points[middleIndex].y = (start.y + end.y) / 2;
  }
  
  // 调整路径上设备的位置以适应反转后的路径
  adjustDevicesForReversedPath(pathKey, originalStart, originalEnd);
  
  saveLayout();
}

// --- 新增：传送带方向切换功能 ---
function togglePathDirection(pathKey) {
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points || pathKey.startsWith('layout_')) return;
  
  console.log(`🔄 切换传送带方向: ${pathKey}, 当前方向: ${pathObj.direction}`);
  
  // 记录原始路径信息
  const originalDirection = pathObj.direction;
  const center = getPathCenter(pathObj);
  const pointCount = pathObj.points.length;
  
  // 🔧 关键修复：在路径改变之前，先记录哪些设备在当前路径上
  const devicesOnPath = devices.filter(device => {
    return isDeviceOnPath(device, pathKey);
  });
  
  console.log(`📍 检测到路径 ${pathKey} 上有 ${devicesOnPath.length} 个设备:`, devicesOnPath.map(d => `${d.id}(${d.type})`));
  
  // 切换方向
  pathObj.direction = pathObj.direction === 'vertical' ? 'horizontal' : 'vertical';
  
  // 计算原始路径的长度（用于保持合理的尺寸）
  let originalSpan = 0;
  if (originalDirection === 'vertical') {
    const minY = Math.min(...pathObj.points.map(p => p.y));
    const maxY = Math.max(...pathObj.points.map(p => p.y));
    originalSpan = maxY - minY;
  } else {
    const minX = Math.min(...pathObj.points.map(p => p.x));
    const maxX = Math.max(...pathObj.points.map(p => p.x));
    originalSpan = maxX - minX;
  }
  
  // 如果原始span太小，使用默认长度
  const defaultSpan = 200; // 默认传送带长度
  const effectiveSpan = originalSpan < 50 ? defaultSpan : originalSpan;
  
  console.log(`📏 原始span: ${originalSpan}, 使用span: ${effectiveSpan}`);
  
  // 根据新方向重新排列路径点
  if (pathObj.direction === 'horizontal') {
    // 转为水平：所有点排列在Y轴上相同位置，X轴上分布
    const startX = center.x - effectiveSpan / 2;
    
    pathObj.points.forEach((point, index) => {
      point.y = center.y; // 统一Y坐标
      if (pointCount > 1) {
        point.x = startX + (effectiveSpan * index) / (pointCount - 1); // 水平分布
      } else {
        point.x = center.x; // 单点情况
      }
    });
  } else {
    // 转为垂直：所有点排列在X轴上相同位置，Y轴上分布
    const startY = center.y - effectiveSpan / 2;
    
    pathObj.points.forEach((point, index) => {
      point.x = center.x; // 统一X坐标
      if (pointCount > 1) {
        point.y = startY + (effectiveSpan * index) / (pointCount - 1); // 垂直分布
      } else {
        point.y = center.y; // 单点情况
      }
    });
  }
  
  console.log(`✅ 传送带 ${pathKey} 方向已切换为: ${pathObj.direction}, 新路径点:`, pathObj.points.map(p => `(${Math.round(p.x)}, ${Math.round(p.y)})`));
  
  // 🔧 关键修复：使用预先记录的设备列表，而不是重新检测
  updateDevicesForPathDirectionChangeWithDeviceList(devicesOnPath, pathObj.direction, originalDirection, center);
  
  saveLayout();
  
  // 强制触发editPoints重新计算
  editPointsUpdateTrigger.value++;
}

// --- 新增：更新路径上设备的方向以匹配传送带方向 ---
function updateDevicesOrientationForPath(pathKey, newPathDirection) {
  // 找到该路径上的所有设备
  const pathDevices = devices.filter(device => {
    return isDeviceOnPath(device, pathKey);
  });
  
  if (pathDevices.length === 0) {
    console.log(`🔍 路径 ${pathKey} 上没有发现设备`);
    return;
  }
  
  console.log(`🔄 正在更新路径 ${pathKey} 上的 ${pathDevices.length} 个设备方向...`);
  
  // 更新每个设备的方向
  pathDevices.forEach(device => {
    const oldOrientation = device.orientation || 'vertical';
    device.orientation = newPathDirection; // 设备方向与传送带方向保持一致
    
    const deviceType = device.type === 'camera' ? '相机' : '摆轮';
    console.log(`  📍 ${deviceType} ${device.id}: ${oldOrientation} → ${device.orientation}`);
  });
  
  console.log(`✅ 已更新路径 ${pathKey} 上所有设备的方向为: ${newPathDirection}`);
}

// --- 新增：传送带方向切换时的设备智能跟随功能 ---
function updateDevicesForPathDirectionChange(pathKey, newDirection, originalDirection, pathCenter) {
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) return;
  
  // 找到该路径上的所有设备
  const pathDevices = devices.filter(device => {
    return isDeviceOnPath(device, pathKey);
  });
  
  if (pathDevices.length === 0) {
    console.log(`🔍 路径 ${pathKey} 上没有发现设备`);
    return;
  }
  
  console.log(`🚀 传送带方向切换：${originalDirection} → ${newDirection}，正在智能重定位 ${pathDevices.length} 个设备...`);
  
  // 更新每个设备的位置和方向
  pathDevices.forEach(device => {
    const oldOrientation = device.orientation || 'vertical';
    const deviceType = device.type === 'camera' ? '相机' : '摆轮';
    
    // 1. 更新设备方向
    if (device.type === 'sorter') {
      // 🔧 摆轮应该与传送带垂直
      device.orientation = newDirection === 'vertical' ? 'horizontal' : 'vertical';
    } else if (device.type === 'camera') {
      // 相机的方向跟随传送带方向
      device.orientation = newDirection;
    }
    
    // 2. 重新计算设备位置
    // 找到设备在新路径上的最佳位置
    const newPosition = findBestPositionOnNewPath(device, pathObj, pathCenter, originalDirection, newDirection);
    
    if (newPosition) {
      const oldX = device.x, oldY = device.y;
      device.x = newPosition.x;
      device.y = newPosition.y;
      
      console.log(`  📍 ${deviceType} ${device.id}:`);
      console.log(`    方向: ${oldOrientation} → ${device.orientation}`);
      console.log(`    位置: (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) → (${device.x.toFixed(1)}, ${device.y.toFixed(1)})`);
    }
  });
  
  console.log(`✅ 已完成路径 ${pathKey} 上所有设备的智能跟随重定位`);
}

// --- 新增：使用预先记录的设备列表进行智能跟随 ---
function updateDevicesForPathDirectionChangeWithDeviceList(devicesOnPath, newDirection, originalDirection, pathCenter) {
  if (devicesOnPath.length === 0) {
    console.log(`🔍 没有需要跟随的设备`);
    return;
  }
  
  console.log(`🚀 传送带方向切换：${originalDirection} → ${newDirection}，正在智能重定位 ${devicesOnPath.length} 个设备...`);
  
  // 更新每个设备的位置和方向
  devicesOnPath.forEach(device => {
    const oldOrientation = device.orientation || 'vertical';
    const deviceType = device.type === 'camera' ? '相机' : '摆轮';
    
    // 1. 更新设备方向
    if (device.type === 'sorter') {
      // 🔧 摆轮应该与传送带垂直
      device.orientation = newDirection === 'vertical' ? 'horizontal' : 'vertical';
    } else if (device.type === 'camera') {
      // 相机的方向跟随传送带方向
      device.orientation = newDirection;
    }
    
    // 2. 重新计算设备位置
    const newPosition = findBestPositionOnNewPath(device, null, pathCenter, originalDirection, newDirection);
    
    if (newPosition) {
      const oldX = device.x, oldY = device.y;
      device.x = newPosition.x;
      device.y = newPosition.y;
      
      console.log(`  📍 ${deviceType} ${device.id}:`);
      console.log(`    方向: ${oldOrientation} → ${device.orientation}`);
      console.log(`    位置: (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) → (${device.x.toFixed(1)}, ${device.y.toFixed(1)})`);
    }
  });
  
  console.log(`✅ 已完成所有设备的智能跟随重定位`);
}

// --- 计算设备在新路径上的最佳位置 ---
function findBestPositionOnNewPath(device, pathObj, pathCenter, originalDirection, newDirection) {
  const oldX = device.x, oldY = device.y;
  
  // 计算设备相对于路径中心的偏移量
  let relativeOffset = 0;
  let crossOffset = 0; // 垂直于路径方向的偏移
  
  if (originalDirection === 'vertical') {
    // 原来是垂直路径
    relativeOffset = oldY - pathCenter.y; // Y轴偏移作为沿路径方向的偏移
    crossOffset = oldX - pathCenter.x;    // X轴偏移作为垂直路径的偏移
  } else {
    // 原来是水平路径  
    relativeOffset = oldX - pathCenter.x; // X轴偏移作为沿路径方向的偏移
    crossOffset = oldY - pathCenter.y;    // Y轴偏移作为垂直路径的偏移
  }
  
  // 根据新方向计算新位置
  let newX, newY;
  
  if (newDirection === 'vertical') {
    // 新方向是垂直
    newX = pathCenter.x + crossOffset; // 保持垂直于路径的偏移
    newY = pathCenter.y + relativeOffset; // 沿路径方向的偏移转换为Y轴
  } else {
    // 新方向是水平
    newX = pathCenter.x + relativeOffset; // 沿路径方向的偏移转换为X轴
    newY = pathCenter.y + crossOffset; // 保持垂直于路径的偏移
  }
  
  // 🔧 修复相机位置：保持原有的相对位置关系，不强制重新定位
  // 相机应该跟随传送带移动，但保持相对距离
  
  console.log(`🔧 设备 ${device.id} 位置计算:`);
  console.log(`  原始位置: (${oldX.toFixed(1)}, ${oldY.toFixed(1)})`);
  console.log(`  路径中心: (${pathCenter.x.toFixed(1)}, ${pathCenter.y.toFixed(1)})`);
  console.log(`  相对偏移: ${relativeOffset.toFixed(1)}, 垂直偏移: ${crossOffset.toFixed(1)}`);
  console.log(`  新位置: (${newX.toFixed(1)}, ${newY.toFixed(1)})`);
  
  return { x: newX, y: newY };
}

// --- 检测设备所在传送带的方向 ---
function getDevicePathDirection(device) {
  // 遍历所有路径，找到设备所在的路径
  for (const [pathKey, pathObj] of Object.entries(paths)) {
    if (pathObj.points && pathObj.points.length >= 2) {
      // 检查设备是否在此路径上
      if (isDeviceOnPath(device, pathKey)) {
        console.log(`🔍 设备 ${device.id} 检测到所在路径 ${pathKey}，方向: ${pathObj.direction}`);
        return pathObj.direction;
      }
    }
  }
  
  // 如果没有找到设备所在的路径，使用ID判断
  if (device.id.includes('region')) {
    console.log(`🔍 设备 ${device.id} 基于ID识别为水平传送带设备`);
    return 'horizontal';
  }
  
  // 默认返回垂直方向
  console.log(`🔍 设备 ${device.id} 使用默认垂直方向`);
  return 'vertical';
}

// --- 判断设备是否在指定路径上 ---
function isDeviceOnPath(device, pathKey) {
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points || pathObj.points.length < 2) {
    return false;
  }
  
  const deviceX = device.x;
  const deviceY = device.y;
  const tolerance = 50; // 距离容差，像素
  
  // 检查设备是否在路径的任何线段附近
  for (let i = 0; i < pathObj.points.length - 1; i++) {
    const point1 = pathObj.points[i];
    const point2 = pathObj.points[i + 1];
    
    // 计算设备到线段的距离
    const distance = pointToLineSegmentDistance(
      { x: deviceX, y: deviceY },
      point1,
      point2
    );
    
    if (distance <= tolerance) {
      return true;
    }
  }
  
  return false;
}

// --- 计算点到线段的最短距离 ---
function pointToLineSegmentDistance(point, segmentStart, segmentEnd) {
  const A = point.x - segmentStart.x;
  const B = point.y - segmentStart.y;
  const C = segmentEnd.x - segmentStart.x;
  const D = segmentEnd.y - segmentStart.y;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  
  if (lenSq === 0) {
    // 线段退化为点
    return Math.sqrt(A * A + B * B);
  }
  
  let param = dot / lenSq;
  
  let xx, yy;
  
  if (param < 0) {
    // 最近点是线段起点
    xx = segmentStart.x;
    yy = segmentStart.y;
  } else if (param > 1) {
    // 最近点是线段终点
    xx = segmentEnd.x;
    yy = segmentEnd.y;
  } else {
    // 最近点在线段上
    xx = segmentStart.x + param * C;
    yy = segmentStart.y + param * D;
  }
  
  const dx = point.x - xx;
  const dy = point.y - yy;
  
  return Math.sqrt(dx * dx + dy * dy);
}

// --- 获取路径中心点用于显示反转按钮 ---
function getPathCenter(pathObj) {
  if (!pathObj.points || pathObj.points.length === 0) return { x: 0, y: 0 };
  
  const points = pathObj.points;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  
  return {
    x: sumX / points.length,
    y: sumY / points.length
  };
}

// --- 键盘控制功能 ---
function setupKeyboardControls() {
  const handleKeyDown = (e) => {
    if (!props.isEditMode) return;
    
    // 检查是否有输入框获得焦点，避免影响正常输入
    if (document.activeElement?.tagName === 'INPUT' || 
        document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }
    
    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
      case '_':
        e.preventDefault();
        zoomOut();
        break;
      case '0':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          resetZoom();
        }
        break;
      case 'f':
      case 'F':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          fitToScreen();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        stageTransform.value.y += 20;
        break;
      case 'ArrowDown':
        e.preventDefault();
        stageTransform.value.y -= 20;
        break;
      case 'ArrowLeft':
        e.preventDefault();
        stageTransform.value.x += 20;
        break;
      case 'ArrowRight':
        e.preventDefault();
        stageTransform.value.x -= 20;
        break;
      case 'Escape':
        e.preventDefault();
        emit('toggleEditMode');
        break;
    }
  };
  
  window.addEventListener('keydown', handleKeyDown);
  
  // 清理函数
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });
}

// --- 新增：处理节点移动的函数 ---
function handleNodeMove(payload) {
  const { pathKey, pointIndex, newX, newY, originalPosition } = payload;

  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) {
    console.warn(`Path with key "${pathKey}" not found for node move.`);
    return;
  }
  
  const path = pathObj.points;
  const originalPoint = path[pointIndex];
  if (!originalPoint) {
    console.warn(`Point at index ${pointIndex} not found in path "${pathKey}".`);
    return;
  }

  const isEndpoint = pointIndex === 0 || pointIndex === path.length - 1;

  if (isEndpoint) {
    // --- 拉伸逻辑 (Stretch Logic) ---
    // 端点只能沿着路径预设的方向移动
    if (pathObj.direction === 'vertical') {
      originalPoint.y = newY; // 只修改 Y 坐标
    } else if (pathObj.direction === 'horizontal') {
      originalPoint.x = newX; // 只修改 X 坐标
    }
    // 注意：拉伸操作不移动设备，让用户手动调整
  } else {
    // --- 平移逻辑 (Pan Logic) ---
    // 计算移动增量
    const deltaX = newX - originalPosition.x;
    const deltaY = newY - originalPosition.y;

    // 平移路径上的所有点
    path.forEach(pointToUpdate => {
      pointToUpdate.x += deltaX;
      pointToUpdate.y += deltaY;
    });
    
    // 平移附着在该路径上的所有设备
    moveDevicesOnPath(pathKey, deltaX, deltaY);
  }

  saveLayout();
}

// --- Layout Persistence Functions ---
function saveLayout() {
  try {
    const layout = {
      paths: JSON.parse(JSON.stringify(paths)),
      devices: JSON.parse(JSON.stringify(devices)),
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    console.log('Layout saved!');
    
    // 🔧 新增：通知父组件触发云端同步
    emit('layout-saved');
  } catch (error) {
    console.error('Failed to save layout:', error);
  }
}

function loadLayout() {
  const savedLayout = localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (savedLayout) {
    try {
      const layout = JSON.parse(savedLayout);
      
      // 使用深度克隆来加载数据，避免引用问题
      const clonedPaths = JSON.parse(JSON.stringify(layout.paths));
      const clonedDevices = JSON.parse(JSON.stringify(layout.devices));

      // 更新路径，并为没有名称的路径添加默认名称
      Object.keys(clonedPaths).forEach(key => {
        const pathObj = clonedPaths[key];
        // 🔧 为旧版本没有名称的路径添加默认名称
        if (!pathObj.name) {
          if (key.includes('scan_line_1')) pathObj.name = '扫码线1';
          else if (key.includes('scan_line_2')) pathObj.name = '扫码线2';
          else if (key.includes('sku_line_1')) pathObj.name = 'SKU主线1';
          else if (key.includes('sku_line_2')) pathObj.name = 'SKU主线2';
          else if (key.includes('region_sort')) pathObj.name = '大区分拣线';
          else pathObj.name = key; // 使用原始key作为后备名称
        }
        paths[key] = pathObj;
      });

      // 更新设备，并为设备添加默认orientation
      clonedDevices.forEach(device => {
        if ((device.type === 'sorter' || device.type === 'camera') && !device.orientation) {
          // 🔧 根据设备所在传送带的方向来设置设备默认方向
          const devicePathDirection = getDevicePathDirection(device);
          if (device.type === 'sorter') {
            // 摆轮应该与传送带垂直
            device.orientation = devicePathDirection === 'vertical' ? 'horizontal' : 'vertical';
          } else {
            // 相机跟随传送带方向
            device.orientation = devicePathDirection;
          }
        }
      });
      devices.splice(0, devices.length, ...clonedDevices);
      console.log('✅ Layout loaded from localStorage!');
    } catch (error) {
      console.error('❌ Failed to load layout:', error);
    }
  } else {
    // 如果没有保存的布局，从初始配置深度克隆
    const clonedPaths = JSON.parse(JSON.stringify(initialPaths));
    const clonedDevices = JSON.parse(JSON.stringify(initialDevices));
    
    // 为设备添加默认方向
    clonedDevices.forEach(device => {
      if ((device.type === 'sorter' || device.type === 'camera') && !device.orientation) {
        // 🔧 根据设备所在传送带的方向来设置设备默认方向
        const devicePathDirection = getDevicePathDirection(device);
        if (device.type === 'sorter') {
          // 摆轮应该与传送带垂直
          device.orientation = devicePathDirection === 'vertical' ? 'horizontal' : 'vertical';
        } else {
          // 相机跟随传送带方向
          device.orientation = devicePathDirection;
        }
      }
    });
    
    Object.keys(clonedPaths).forEach(key => {
      const pathObj = clonedPaths[key];
      // 🔧 为初始路径添加默认名称（如果没有）
      if (!pathObj.name) {
        if (key.includes('scan_line_1')) pathObj.name = '扫码线1';
        else if (key.includes('scan_line_2')) pathObj.name = '扫码线2';
        else if (key.includes('sku_line_1')) pathObj.name = 'SKU主线1';
        else if (key.includes('sku_line_2')) pathObj.name = 'SKU主线2';
        else if (key.includes('region_sort')) pathObj.name = '大区分拣线';
        else pathObj.name = key; // 使用原始key作为后备名称
      }
      paths[key] = pathObj;
    });
    devices.splice(0, devices.length, ...clonedDevices);
    console.log('✅ Initial layout loaded!');
  }
}

function resetLayout() {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    window.location.reload(); // Easiest way to reset to default
}

function applyLayoutUpdate(layout) {
  if (!layout) {
    console.warn('applyLayoutUpdate received null or undefined layout');
    return;
  }
  
  // 更新路径
  if (layout.paths) {
    // 使用深度克隆来加载数据，避免引用问题
    const clonedPaths = JSON.parse(JSON.stringify(layout.paths));
    Object.keys(clonedPaths).forEach(key => {
      const pathObj = clonedPaths[key];
      // 🔧 为云端同步的路径添加默认名称（如果没有）
      if (!pathObj.name) {
        if (key.includes('scan_line_1')) pathObj.name = '扫码线1';
        else if (key.includes('scan_line_2')) pathObj.name = '扫码线2';
        else if (key.includes('sku_line_1')) pathObj.name = 'SKU主线1';
        else if (key.includes('sku_line_2')) pathObj.name = 'SKU主线2';
        else if (key.includes('region_sort')) pathObj.name = '大区分拣线';
        else pathObj.name = key; // 使用原始key作为后备名称
      }
      paths[key] = pathObj;
    });
    // 删除新布局中不存在的旧路径
    Object.keys(paths).forEach(key => {
      if (!clonedPaths[key]) {
        delete paths[key];
      }
    });
  }

  // 更新设备
  if (layout.devices) {
    // 使用深度克隆
    const clonedDevices = JSON.parse(JSON.stringify(layout.devices));
    // 为设备添加默认方向（如果没有）
    clonedDevices.forEach(device => {
      if ((device.type === 'sorter' || device.type === 'camera') && !device.orientation) {
        // 🔧 根据设备所在传送带的方向来设置设备默认方向
        const devicePathDirection = getDevicePathDirection(device);
        if (device.type === 'sorter') {
          // 摆轮应该与传送带垂直
          device.orientation = devicePathDirection === 'vertical' ? 'horizontal' : 'vertical';
        } else {
          // 相机跟随传送带方向
          device.orientation = devicePathDirection;
        }
      }
    });
    devices.splice(0, devices.length, ...clonedDevices);
  }
  
  console.log('✅ Layout updated in real-time via WebSocket!');
}

const props = defineProps({
  isEditMode: {
    type: Boolean,
    default: false,
  },
  themeConfig: {
    type: Object,
    default: () => ({
      background: 'linear-gradient(135deg, #2c3e50 0%, #3498db 50%, #2980b9 100%)',
      panelBg: 'rgba(255, 255, 255, 0.95)',
      textColor: '#2c3e50',
      borderColor: 'rgba(255, 255, 255, 0.2)',
      statusDot: '#27ae60',
      themeName: '白天模式',
      themeIcon: '☀️'
    })
  },
});

const emit = defineEmits(['package-update', 'toggleEditMode', 'layout-saved']);

onMounted(() => {
  // Clear any previous animations if HMR is active
  if (anim) anim.stop();

  loadLayout(); // <-- Load layout on component mount

  // 初始化WebSocket事件处理
  setupWebSocketHandlers();

  // 直接启动WebSocket连接（实时模式）
  console.log('启动实时模式，连接到后端服务...');
  webSocketClient.connect();

  // 初始化传送带状态
  updateActiveConveyors();

  // 添加键盘事件监听
  setupKeyboardControls();

  anim = new Konva.Animation((frame) => {
    if (!frame) return;
    const delta = frame.timeDiff / 1000;

    // --- 1. Animate conveyor belt texture ---
    activeConveyors.value.forEach(key => {
      const line = dynamicLineRefs.value[key];
      if (line) {
        const konvaLine = line.getNode();
        const currentOffset = konvaLine.dashOffset();
        konvaLine.dashOffset(currentOffset - 20 * delta);
      }
    });

    // --- 2. Process each package ---
    for (const pkgId in activePackages) {
      const pkg = activePackages[pkgId];

      // --- a. Fading & Removal ---
      if (pkg.isFadingOut) {
        pkg.konvaConfig.group.opacity -= delta * 1.5;
        if (pkg.konvaConfig.group.opacity <= 0) {
          // 向WPF程序报告包裹完成状态
          reportPackageStatus(pkgId, 'completed', null, {
            x: pkg.konvaConfig.group.x,
            y: pkg.konvaConfig.group.y
          });
          
          // 清理资源
          delete activePackages[pkgId];
          delete particles.value[pkgId]; // 清理粒子轨迹
          delete packageStatusTracker.value[pkgId]; // 清理状态追踪
          continue;
        }
      }

      // --- b. Core Movement Logic ---
      if (pkg.pathIndex < pkg.path.length - 1) {
          const startPoint = pkg.path[pkg.pathIndex];
          const endPoint = pkg.path[pkg.pathIndex + 1];
          const distance = Math.sqrt(Math.pow(endPoint.x - startPoint.x, 2) + Math.pow(endPoint.y - startPoint.y, 2));

          if (distance > 0) {
              pkg.progress += (pkg.speed * delta) / distance;
          }
          
          while (pkg.progress >= 1 && pkg.pathIndex < pkg.path.length - 2) {
              pkg.progress -= 1;
              pkg.pathIndex++;
          }

          const currentPos = pkg.path[pkg.pathIndex];
          const nextPos = pkg.path[pkg.pathIndex + 1];
          if (currentPos && nextPos) {
              const currentDx = nextPos.x - currentPos.x;
              const currentDy = nextPos.y - currentPos.y;
              pkg.konvaConfig.group.x = currentPos.x + currentDx * pkg.progress;
              pkg.konvaConfig.group.y = currentPos.y + currentDy * pkg.progress;
          } else if(currentPos) {
              pkg.konvaConfig.group.x = currentPos.x;
              pkg.konvaConfig.group.y = currentPos.y;
          }

          // 更新粒子轨迹
          if (particles.value[pkgId]) {
            const trail = particles.value[pkgId].trail;
            trail.push({
              x: pkg.konvaConfig.group.x,
              y: pkg.konvaConfig.group.y,
              timestamp: frame.time,
              opacity: 1.0
            });
            
            // 限制轨迹长度
            if (trail.length > particles.value[pkgId].maxTrailLength) {
              trail.shift();
            }
            
            // 更新轨迹点的透明度（渐变效果）
            for (let i = 0; i < trail.length; i++) {
              const age = frame.time - trail[i].timestamp;
              trail[i].opacity = Math.max(0, 1 - age / 2000); // 2秒内完全消失
            }
          }
          
          // 检查是否到达路径末端
          if (pkg.pathIndex >= pkg.path.length - 2 && pkg.progress >= 1) {
            console.log(`包裹 ${pkg.id} 到达路径末端，开始淡出`);
            pkg.isFadingOut = true;
          }
      } else {
        // 包裹已经超出路径，标记为淡出
        if (!pkg.isFadingOut) {
          console.log(`包裹 ${pkg.id} 超出路径范围，开始淡出`);
          pkg.isFadingOut = true;
        }
      }

      // --- c. Interaction Logic (after moving) ---
      // Camera Scan
      if (!pkg.hasBeenScanned) {
        for (const camera of cameraDevices.value) {
          let isInScanRange = false;
          
          if (camera.id.startsWith('region-camera')) {
            // 水平传送带上的相机：检查Y轴对齐和X轴扫描范围
            if (Math.abs(pkg.konvaConfig.group.y - camera.y) < 20) {
              const scanLineX = camera.x;
              if (pkg.konvaConfig.group.x >= scanLineX && pkg.konvaConfig.group.x <= scanLineX + 50) {
                isInScanRange = true;
              }
            }
          } else {
            // 垂直传送带上的相机：原有逻辑
            if (Math.abs(pkg.konvaConfig.group.x - camera.x) < 20) {
              const scanLineY = camera.y; 
              if (pkg.konvaConfig.group.y <= scanLineY && pkg.konvaConfig.group.y >= scanLineY - 50) {
                isInScanRange = true;
              }
            }
          }
          
          if (isInScanRange) {
            pkg.hasBeenScanned = true;
            triggerScanAnimation(camera);
            
            // 更新包裹状态追踪
            const tracker = packageStatusTracker.value[pkg.id];
            if (tracker && !tracker.scannedDevices.includes(camera.id)) {
              tracker.scannedDevices.push(camera.id);
            }
            
            // 向WPF程序报告扫描状态
            reportPackageStatus(pkg.id, 'scanned', camera.id, {
              x: pkg.konvaConfig.group.x,
              y: pkg.konvaConfig.group.y
            });
            
            // 更新设备运行数据
            updateDeviceMetrics(camera.id, 'scan');
            
            console.log(`Package ${pkg.id} scanned by ${camera.id}!`);
            break; 
          }
        }
      }
      
      // Sorter Decision (基于格口号的精确分拣)
      if (!pkg.isFadingOut) {
        for (let sorterIndex = 0; sorterIndex < sorterDevices.value.length; sorterIndex++) {
          const sorter = sorterDevices.value[sorterIndex];
          if (pkg.lastSorterId === sorter.id) continue;
          
          const distance = Math.sqrt(Math.pow(pkg.konvaConfig.group.x - sorter.x, 2) + Math.pow(pkg.konvaConfig.group.y - sorter.y, 2));

          if (distance < 15) {
            const lastSorterOnPath = findLastSorterOnPath(pkg.path);
            const isLast = lastSorterOnPath?.id === sorter.id;
            let chosenDirection = 'straight';
            
            // 检查包裹是否有分拣信息
            if (pkg.sorterInfo && pkg.sorterInfo.action === 'sort') {
              // 获取当前路径上的摆轮列表，按顺序排序
              const sortedSortersOnPath = sorterDevices.value
                .filter(s => pkg.path.some(point => Math.abs(point.x - s.x) < 5 && Math.abs(point.y - s.y) < 5))
                .sort((a, b) => {
                  // 根据路径方向排序：垂直路径按Y坐标，水平路径按X坐标
                  const pathKey = Object.keys(paths).find(key => paths[key].points === pkg.path);
                  const pathDirection = paths[pathKey]?.direction;
                  return pathDirection === 'vertical' ? a.y - b.y : a.x - b.x;
                });
              
              // 调试信息：首次检测到摆轮时显示路径上的所有摆轮
              if (!pkg._debugSortersLogged) {
                console.log(`🔍 包裹 ${pkg.id} 检测到路径上的摆轮:`, sortedSortersOnPath.map(s => `${s.id}(${s.x},${s.y})`));
                pkg._debugSortersLogged = true;
              }
              
              // 找到当前摆轮在路径上的索引
              const currentSorterPathIndex = sortedSortersOnPath.findIndex(s => s.id === sorter.id);
              
              // 检查是否是目标摆轮
              if (currentSorterPathIndex === pkg.sorterInfo.sorterIndex) {
                // 根据传送带方向确定实际分拣方向
                if (sorter.id.startsWith('region-sorter')) {
                  // 水平传送带：left→up, right→down
                  chosenDirection = pkg.sorterInfo.direction === 'left' ? 'up' : 'down';
                } else {
                  // 垂直传送带：直接使用left/right
                  chosenDirection = pkg.sorterInfo.direction;
                }
                
                // 包裹分拣时的视觉效果强化
                pkg.konvaConfig.rect.stroke = '#FF6B6B'; // 改为红色边框表示正在分拣
                pkg.konvaConfig.rect.strokeWidth = 4;
                pkg.konvaConfig.rect.shadowColor = '#FF6B6B';
                pkg.konvaConfig.rect.shadowBlur = 10;
                
                console.log(`🎯 [分拣执行] 包裹 ${pkg.id} 在第${currentSorterPathIndex + 1}个摆轮(${sorter.id})执行${chosenDirection}分拣，目标格口: ${pkg.sorterInfo.targetSortCode}`);
              } else if (currentSorterPathIndex < pkg.sorterInfo.sorterIndex) {
                // 不是目标摆轮，继续直行
                chosenDirection = 'straight';
                console.log(`➡️ 包裹 ${pkg.id} 在第${currentSorterPathIndex + 1}个摆轮(${sorter.id})直行，目标是第${pkg.sorterInfo.sorterIndex + 1}个摆轮`);
              } else {
                // 已经过了目标摆轮，继续直行
                chosenDirection = 'straight';
                console.log(`⚠️ 包裹 ${pkg.id} 已超过目标摆轮位置(当前:第${currentSorterPathIndex + 1}个，目标:第${pkg.sorterInfo.sorterIndex + 1}个)，继续直行`);
              }
            }

            if (chosenDirection === 'straight' && !isLast) {
              pkg.lastSorterId = sorter.id;
              // 即使是直行也更新时间，但direction保持为straight
              sorterStates[sorter.id].lastActiveTime = frame.time;
              
              // 向WPF程序报告包裹继续移动状态
              reportPackageStatus(pkg.id, 'moving', sorter.id, {
                x: pkg.konvaConfig.group.x,
                y: pkg.konvaConfig.group.y
              });
            } else {
              sorterStates[sorter.id].direction = chosenDirection;
              
              // 记录分拣器的使用时间，用于后续回正
              sorterStates[sorter.id].lastActiveTime = frame.time;
              
              // 更新包裹状态追踪
              const tracker = packageStatusTracker.value[pkg.id];
              if (tracker && !tracker.sortedDevices.includes(sorter.id)) {
                tracker.sortedDevices.push(sorter.id);
              }
              
              // 向WPF程序报告分拣状态
              reportPackageStatus(pkg.id, 'sorted', sorter.id, {
                x: pkg.konvaConfig.group.x,
                y: pkg.konvaConfig.group.y
              });
              
              // 更新设备运行数据
              updateDeviceMetrics(sorter.id, 'sort');
              
              // --- Dynamically generate the exit path ---
              const startPoint = { x: sorter.x, y: sorter.y };
              let endPoint;
              const exitDistance = 100;

              if (chosenDirection === 'left') endPoint = { x: startPoint.x - exitDistance, y: startPoint.y };
              else if (chosenDirection === 'right') endPoint = { x: startPoint.x + exitDistance, y: startPoint.y };
              else if (chosenDirection === 'up') endPoint = { x: startPoint.x, y: startPoint.y - exitDistance };
              else if (chosenDirection === 'down') endPoint = { x: startPoint.x, y: startPoint.y + exitDistance };
              else { // straight
                endPoint = { x: startPoint.x, y: startPoint.y - exitDistance };
              }
              const newPath = [startPoint, endPoint];
              
              pkg.path = newPath;
              pkg.pathIndex = 0;
              pkg.progress = 0;
              pkg.isFadingOut = true;
            }
            break;
          }
        }
      }
    }

    // --- 3. 分拣器回正逻辑 ---
    for (const sorterId in sorterStates) {
      const sorterState = sorterStates[sorterId];
      
      // 如果分拣器不是直行状态，并且有记录的上次活跃时间
      if (sorterState.direction !== 'straight' && sorterState.lastActiveTime) {
        const timeSinceLastActive = frame.time - sorterState.lastActiveTime;
        
        // 0.8秒后回正
        if (timeSinceLastActive > 800) {
          sorterState.direction = 'straight';
          sorterState.lastActiveTime = null; // 清除时间记录
          console.log(`Sorter ${sorterId} returned to straight position`);
        }
      }
    }
  });

  anim.start();
  
  // 获取Stage引用并应用初始缩放 - 多次尝试确保成功
  const tryInitializeView = (attempt = 1) => {
    console.log(`🔄 尝试初始化视图 (第${attempt}次)`);
    
    if (Konva.stages && Konva.stages.length > 0) {
      stageRef = Konva.stages[0];
      console.log(`✅ Stage已找到，画布尺寸: ${stageConfig.value.width}x${stageConfig.value.height}`);
      forceResetView();
    } else if (attempt < 5) {
      // 最多尝试5次，每次间隔递增
      setTimeout(() => tryInitializeView(attempt + 1), attempt * 300);
    } else {
      console.error('❌ 无法找到Konva Stage，视图初始化失败');
    }
  };
  
  // 立即尝试一次
  setTimeout(() => tryInitializeView(1), 100);
  
  // 也在窗口加载完成后再尝试一次
  window.addEventListener('load', () => {
    setTimeout(() => {
      console.log('🔄 窗口加载完成，再次尝试重置视图');
      forceResetView();
    }, 500);
  });
  
  window.addEventListener('resize', () => {
    const newSize = getCanvasSize();
    stageConfig.value.width = newSize.width;
    stageConfig.value.height = newSize.height;
    
    // 窗口大小变化后，更新画布大小但保持当前的缩放和位置
    console.log(`🔄 窗口大小变化，更新画布大小: ${newSize.width}x${newSize.height}`);
  });
});

onUnmounted(() => {
  console.log('Stopping animation and WebSocket connection.');
  if (anim) anim.stop();
  
  // 清理WebSocket连接
  webSocketClient.disconnect();
  
  // 清理Stage引用
  stageRef = null;
  
  // 清理节流定时器 - 已移除dragUpdateTimeout相关代码
  
  window.removeEventListener('resize', ()=>{});
});

// Expose functions to be called from parent
defineExpose({ 
  resetLayout, 
  saveLayout, 
  wsConnectionStatus: () => wsConnectionStatus.value,
  zoomIn,
  zoomOut,
  resetZoom,
  fitToScreen,
  forceResetView,
  applyLayoutUpdate,
  findPathByName,
  editPathName,
  getPathDisplayName,
  triggerPackageByPathName,
  getAllPathNames
});

// --- 恢复被误删的辅助函数和逻辑 ---
function getPathLength(points) {
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i+1];
    length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }
  return length;
}

function findLastSorterOnPath(path) {
  const sortersOnPath = sorterDevices.value.filter(sorter => 
    path.some(point => point.x === sorter.x && point.y === sorter.y)
  );
  if (sortersOnPath.length === 0) return null;
  return sortersOnPath.reduce((last, current) => current.y < last.y ? current : last);
}

function createNewPackage(eventData) {
  const { packageInfo, _startPathId } = eventData;
  const startPathPoints = paths[_startPathId]?.points;

  if (!startPathPoints || startPathPoints.length === 0) {
    console.error(`Path with id "${_startPathId}" not found or is empty.`);
    return;
  }

  const packageColors = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399'];
  const packageColor = packageColors[Math.floor(Math.random() * packageColors.length)];
  
  activePackages[packageInfo.id] = {
    id: packageInfo.id,
    sku: packageInfo.sku,
    region: packageInfo.region,
    sortCode: packageInfo.sortCode,
    priority: packageInfo.priority,
    sorterInfo: packageInfo.sorterInfo,
    path: startPathPoints,
    pathIndex: 0,
    progress: 0,
    speed: 100,
    hasBeenScanned: false,
    isFadingOut: false,
    konvaConfig: {
      group: { x: startPathPoints[0].x, y: startPathPoints[0].y, offsetX: 18, offsetY: 18, opacity: 1 },
      rect: { 
        width: 36, 
        height: 36, 
        fill: packageColor, 
        cornerRadius: 8,
        stroke: 'white',
        strokeWidth: 2,
        shadowColor: 'rgba(0,0,0,0.3)',
        shadowBlur: 6,
        shadowOffsetX: 2,
        shadowOffsetY: 2
      },
      text: { 
        text: packageInfo.sortCode ? packageInfo.sortCode.toString() : (packageInfo.sku ? packageInfo.sku.slice(-3) : ''), 
        fontSize: 11, 
        fill: 'white', 
        width: 36, 
        align: 'center', 
        y: 12,
        fontStyle: 'bold'
      },
    },
    lastSorterId: null,
  };

  particles.value[packageInfo.id] = {
    trail: [],
    maxTrailLength: 15,
    color: packageColor,
  };

  packageStatusTracker.value[packageInfo.id] = {
    status: 'created',
    createdTime: Date.now(),
    lastStatusTime: Date.now(),
    scannedDevices: [],
    sortedDevices: [],
    currentDevice: null
  };

  reportPackageStatus(packageInfo.id, 'created', null, {
    x: startPathPoints[0].x,
    y: startPathPoints[0].y
  });

  if (packageInfo.sorterInfo) {
    if (packageInfo.sorterInfo.action === 'sort') {
      console.log(`📦 [包裹创建] ${packageInfo.id} 分拣配置: 第${packageInfo.sorterInfo.sorterIndex + 1}个摆轮${packageInfo.sorterInfo.direction === 'left' ? '左摆' : '右摆'} (格口${packageInfo.sorterInfo.targetSortCode})`);
    } else {
      console.log(`📦 [包裹创建] ${packageInfo.id} 配置: 直行通过`);
    }
  } else {
    console.log(`📦 [包裹创建] ${packageInfo.id} 无分拣信息，将直行`);
  }
}

function triggerScanAnimation(camera) {
  if (cameraStates[camera.id]) {
    cameraStates[camera.id].isScanning = true;
    setTimeout(() => {
      if (cameraStates[camera.id]) {
        cameraStates[camera.id].isScanning = false;
      }
    }, 200);
  }
}

function reportPackageStatus(packageId, status, deviceId, position) {
  const tracker = packageStatusTracker.value[packageId];
  if (!tracker) return;

  tracker.status = status;
  tracker.lastStatusTime = Date.now();
  tracker.currentDevice = deviceId;

  if (webSocketClient.isConnected()) {
    webSocketClient.reportPackageStatus(
      packageId, 
      WpfUtils.mapPackageStatus(status), 
      deviceId ? WpfUtils.getWpfDeviceId(deviceId) : null,
      position
    );
  }

  console.log(`包裹 ${packageId} 状态更新: ${status}`, deviceId ? `设备: ${deviceId}` : '');
}

function updateDeviceMetrics(deviceId, actionType) {
  if (!deviceMetrics[deviceId]) {
    deviceMetrics[deviceId] = {
      packagesProcessed: 0,
      lastActiveTime: Date.now(),
      totalActiveTime: 0,
      errorCount: 0,
      startTime: Date.now()
    };
  }

  const metrics = deviceMetrics[deviceId];
  
  switch (actionType) {
    case 'scan':
    case 'sort':
      metrics.packagesProcessed++;
      metrics.lastActiveTime = Date.now();
      break;
    case 'error':
      metrics.errorCount++;
      break;
  }
}

function handleDeviceMove(newPosition) {
  const device = devices.find(d => d.id === newPosition.id);
  if (device) {
    device.x = newPosition.x;
    device.y = newPosition.y;
    console.log(`Device ${device.id} moved to`, {x: device.x, y: device.y});
    saveLayout();
  }
}



function moveDevicesOnPath(pathKey, deltaX, deltaY) {
  console.log(`🚚 移动路径 ${pathKey} 上的设备，偏移量=(${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})`);
  
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) {
    console.warn(`路径 ${pathKey} 不存在，无法移动设备`);
    return;
  }
  
  const path = pathObj.points;
  let movedDevices = 0;
  
  devices.forEach(device => {
    // 基于几何位置判断设备是否在该路径上（使用与拉伸模式相同的逻辑）
    let onThisPath = false;
    for (let i = 0; i < path.length - 1; i++) {
      const distToSegment = pointToLineSegmentDistance({x: device.x, y: device.y}, path[i], path[i + 1]);
      if (distToSegment < 30) { // 30px容差
        onThisPath = true;
        break;
      }
    }
    
    if (onThisPath) {
      const oldX = device.x;
      const oldY = device.y;
      device.x += deltaX;
      device.y += deltaY;
      movedDevices++;
      console.log(`  设备 ${device.id}: (${oldX.toFixed(1)}, ${oldY.toFixed(1)}) -> (${device.x.toFixed(1)}, ${device.y.toFixed(1)})`);
    }
  });
  
  console.log(`✅ 成功移动 ${movedDevices} 个设备`);
}

function adjustDevicesForReversedPath(pathKey, originalStart, originalEnd) {
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) return;
  
  const tolerance = 30;
  const adjustedDevices = [];
  
  const newStart = pathObj.points[0];
  const newEnd = pathObj.points[pathObj.points.length - 1];
  
  devices.forEach(device => {
    let isOnPath = false;
    for (let i = 0; i < pathObj.points.length - 1; i++) {
      if (pointToLineSegmentDistance({x: device.x, y: device.y}, pathObj.points[i], pathObj.points[i+1]) < tolerance) {
        isOnPath = true;
        break;
      }
    }
    if (!isOnPath) return;
    
    let closestDistance = Infinity;
    let devicePathInfo = null;
    
    for (let i = 0; i < pathObj.points.length; i++) {
      const point = pathObj.points[i];
      const distance = Math.sqrt(Math.pow(device.x - point.x, 2) + Math.pow(device.y - point.y, 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        devicePathInfo = { pointIndex: i, distance: distance, point: point };
      }
    }
    
    if (devicePathInfo) {
      const relativePosition = devicePathInfo.pointIndex / (pathObj.points.length - 1);
      let newX = device.x, newY = device.y;
      
      if (device.type === 'camera') {
        if (relativePosition < 0.3) {
          const targetPoint = pathObj.points[Math.floor((1 - relativePosition) * (pathObj.points.length - 1))];
          newX = targetPoint.x;
          newY = targetPoint.y;
          if (pathObj.direction === 'vertical') newY += 40;
          else newX -= 40;
        }
      } else if (device.type === 'sorter') {
        newX = devicePathInfo.point.x;
        newY = devicePathInfo.point.y;
      }
      
      device.x = newX;
      device.y = newY;
      adjustedDevices.push({ id: device.id, type: device.type });
    }
  });
  
  if (adjustedDevices.length > 0) {
    console.log(`🔄 路径 ${pathKey} 反转后调整了 ${adjustedDevices.length} 个设备位置:`, adjustedDevices.map(d => `${d.id}(${d.type})`));
  }
}

function handleDuplicateDevice(deviceId) {
  const originalDevice = devices.find(d => d.id === deviceId);
  if (!originalDevice) return;

  const newDevice = {
    ...JSON.parse(JSON.stringify(originalDevice)),
    id: `${originalDevice.type}-${Date.now()}`,
    x: originalDevice.x + 40,
    y: originalDevice.y + 40,
  };
  
  // 确保设备复制时包含方向信息
  if ((originalDevice.type === 'sorter' || originalDevice.type === 'camera') && originalDevice.orientation) {
    newDevice.orientation = originalDevice.orientation;
  }

  devices.push(newDevice);
  saveLayout();
}

function handleDeleteDevice(deviceId) {
  const index = devices.findIndex(d => d.id === deviceId);
  if (index !== -1) {
    devices.splice(index, 1);
    saveLayout();
  }
}

function handleToggleDeviceOrientation(deviceId) {
  const device = devices.find(d => d.id === deviceId);
  if (device && (device.type === 'sorter' || device.type === 'camera')) {
    // 切换设备方向：vertical <-> horizontal
    device.orientation = device.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    const deviceType = device.type === 'camera' ? '相机' : '摆轮';
    console.log(`${deviceType} ${deviceId} 方向已切换为: ${device.orientation}`);
    saveLayout();
  }
}

function getSorterConveyorDirection(device) {
  if (device.id.startsWith('region-sorter')) return 'horizontal';
  return 'vertical';
}

function getCameraConveyorDirection(device) {
  if (device.id.startsWith('region-camera')) return 'horizontal';
  return 'vertical';
}

// =================================================================
// --- 节点拖拽核心逻辑 (Node Dragging Core Logic) - 完全重构 ---
// =================================================================

function handleNodeDragStart(e) {
  const node = e.target;
  const pathKey = node.attrs._pathKey;
  const pointIndex = node.attrs._pointIndex;

  console.log(`🖱️ 开始拖拽: 路径=${pathKey}, 点索引=${pointIndex}`);

  nodeDragState.isDragging = true;
  nodeDragState.pathKey = pathKey;
  nodeDragState.pointIndex = pointIndex;

  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) {
    console.warn(`路径 ${pathKey} 不存在或无效`);
    return;
  }

  const path = pathObj.points;
  const isEndpoint = pointIndex === 0 || pointIndex === path.length - 1;

  if (isEndpoint) {
    // --- 端点拉伸模式：记录初始状态 ---
    const anchorIndex = pointIndex === 0 ? path.length - 1 : 0;
    nodeDragState.anchorPoint = { ...path[anchorIndex] }; // 深拷贝锚点
    nodeDragState.originalPathLength = getPathLength(path);
    nodeDragState.originalDevicesOnPath = [];

    console.log(`🎯 拉伸模式: 端点索引=${pointIndex}, 锚点=(${nodeDragState.anchorPoint.x}, ${nodeDragState.anchorPoint.y}), 原长度=${nodeDragState.originalPathLength.toFixed(1)}`);

    // 找到并记录路径上的所有设备及其与锚点的初始距离
    devices.forEach(device => {
      // 简化的设备归属判断：检查设备是否靠近路径上的任意一点
      let onThisPath = false;
      for (let i = 0; i < path.length - 1; i++) {
        const distToSegment = pointToLineSegmentDistance({x: device.x, y: device.y}, path[i], path[i + 1]);
        if (distToSegment < 30) { // 30px容差
          onThisPath = true;
          break;
        }
      }
      
      if (onThisPath) {
        const distanceFromAnchor = Math.sqrt(
          Math.pow(device.x - nodeDragState.anchorPoint.x, 2) + 
          Math.pow(device.y - nodeDragState.anchorPoint.y, 2)
        );
        nodeDragState.originalDevicesOnPath.push({ 
          device, 
          distanceFromAnchor,
          originalX: device.x,
          originalY: device.y
        });
        console.log(`📍 设备 ${device.id} 归属路径 ${pathKey}, 距锚点距离=${distanceFromAnchor.toFixed(1)}`);
      }
    });
  }
}

function handleNodeDragMove(e) {
  if (!nodeDragState.isDragging) return;

  const node = e.target;
  const pathKey = nodeDragState.pathKey;
  const pointIndex = nodeDragState.pointIndex;

  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) return;
  
  const path = pathObj.points;
  const isEndpoint = pointIndex === 0 || pointIndex === path.length - 1;

  // 现在只处理端点拉伸模式，因为中间点已被移除
  if (isEndpoint) {
    // --- 拉伸模式：端点拖拽时按比例重新分布所有中间点 ---
    const pointToMove = path[pointIndex];
    const anchorPoint = nodeDragState.anchorPoint;
    if (!anchorPoint) return;

    console.log(`🔧 拖拽端点: 新位置=(${node.x()}, ${node.y()}), 锚点=(${anchorPoint.x}, ${anchorPoint.y})`);

    // 1. 更新端点位置（保持路径方向约束）
    if (pathObj.direction === 'vertical') {
      pointToMove.x = anchorPoint.x; // 垂直线体：锁定X坐标
      pointToMove.y = node.y();
    } else { // horizontal
      pointToMove.x = node.x();
      pointToMove.y = anchorPoint.y; // 水平线体：锁定Y坐标
    }
    
    // 2. 按比例重新分布所有中间点（核心逻辑）
    const start = path[0];
    const end = path[path.length - 1];
    
    console.log(`📐 重新分布 ${path.length - 2} 个中间点，起点=(${start.x}, ${start.y}), 终点=(${end.x}, ${end.y})`);
    
    for (let i = 1; i < path.length - 1; i++) {
      const ratio = i / (path.length - 1); // 计算比例位置
      
      if (pathObj.direction === 'vertical') {
        path[i].x = start.x; // 保持X坐标一致
        path[i].y = start.y + (end.y - start.y) * ratio;
      } else { // horizontal
        path[i].x = start.x + (end.x - start.x) * ratio;
        path[i].y = start.y; // 保持Y坐标一致
      }
      
      console.log(`  中间点${i}: 比例=${ratio.toFixed(2)}, 新位置=(${path[i].x.toFixed(1)}, ${path[i].y.toFixed(1)})`);
    }

    // 3. 按比例重新分布所有设备（核心逻辑）
    const newPathLength = getPathLength(path);
    const stretchRatio = nodeDragState.originalPathLength > 0 ? newPathLength / nodeDragState.originalPathLength : 1;
    
    const pathVector = { 
      x: pointToMove.x - anchorPoint.x, 
      y: pointToMove.y - anchorPoint.y 
    };

    console.log(`🚀 设备重新分布: 新长度=${newPathLength.toFixed(1)}, 拉伸比例=${stretchRatio.toFixed(3)}, 路径向量=(${pathVector.x.toFixed(1)}, ${pathVector.y.toFixed(1)})`);

    nodeDragState.originalDevicesOnPath.forEach((item, index) => {
      const newDistanceFromAnchor = item.distanceFromAnchor * stretchRatio;
      const positionRatio = newPathLength > 0 ? newDistanceFromAnchor / newPathLength : 0;
      
      const newX = anchorPoint.x + pathVector.x * positionRatio;
      const newY = anchorPoint.y + pathVector.y * positionRatio;
      
      item.device.x = newX;
      item.device.y = newY;
      
      console.log(`  设备${index} ${item.device.id}: 原距离=${item.distanceFromAnchor.toFixed(1)} -> 新距离=${newDistanceFromAnchor.toFixed(1)}, 比例=${positionRatio.toFixed(3)}, 新位置=(${newX.toFixed(1)}, ${newY.toFixed(1)})`);
    });
  }
}

function handleNodeDragEnd(e) {
  if (nodeDragState.isDragging) {
    console.log(`✅ 拖拽结束: 路径=${nodeDragState.pathKey}, 点索引=${nodeDragState.pointIndex}`);
    
    saveLayout();
    
    // 重置拖拽状态
    nodeDragState.isDragging = false;
    nodeDragState.pathKey = null;
    nodeDragState.pointIndex = -1;
    nodeDragState.anchorPoint = null;
    nodeDragState.originalPathLength = 0;
    nodeDragState.originalDevicesOnPath = [];
    
    // 强制触发editPoints重新计算，确保UI更新
    editPointsUpdateTrigger.value++;
  }
}


// =================================================================
// --- 线体拖拽核心逻辑 (Path Dragging Core Logic) - 新增 ---
// =================================================================

// 处理线体拖拽开始
function handlePathDragStart(e, pathKey) {
  if (!props.isEditMode) return;
  
  // 阻止事件冒泡到Stage
  e.cancelBubble = true;
  
  console.log(`🖱️ 开始拖拽线体: ${pathKey}`);
  
  // 获取当前鼠标位置（相对于stage）
  const stage = e.target.getStage();
  const pointerPos = stage.getPointerPosition();
  
  pathDragState.isDragging = true;
  pathDragState.pathKey = pathKey;
  pathDragState.startX = pointerPos.x;
  pathDragState.startY = pointerPos.y;
  pathDragState.originalDevicesOnPath = [];
  
  const pathObj = paths[pathKey];
  if (!pathObj || !pathObj.points) return;
  
  const path = pathObj.points;
  
  // 记录路径上的所有设备
  devices.forEach(device => {
    let onThisPath = false;
    for (let i = 0; i < path.length - 1; i++) {
      const distToSegment = pointToLineSegmentDistance({x: device.x, y: device.y}, path[i], path[i + 1]);
      if (distToSegment < 30) { // 30px容差
        onThisPath = true;
        break;
      }
    }
    if (onThisPath) {
      pathDragState.originalDevicesOnPath.push({ 
        device,
        originalX: device.x,
        originalY: device.y
      });
      console.log(`📍 线体拖拽模式设备 ${device.id} 归属路径 ${pathKey}`);
    }
  });
  
  // 绑定全局鼠标事件来处理拖拽
  const handleGlobalMouseMove = (e) => {
    if (!pathDragState.isDragging) return;
    
    const currentPos = stage.getPointerPosition();
    const rawDeltaX = currentPos.x - pathDragState.startX;
    const rawDeltaY = currentPos.y - pathDragState.startY;
    
    // 🔧 关键修复：根据当前缩放级别调整移动距离
    const currentScale = stage.scaleX(); // 获取当前缩放级别
    const deltaX = rawDeltaX / currentScale; // 除以缩放级别得到真实的世界坐标偏移
    const deltaY = rawDeltaY / currentScale;
    
    console.log(`🖱️ 线体拖拽: 原始偏移=(${rawDeltaX.toFixed(1)}, ${rawDeltaY.toFixed(1)}), 缩放=${currentScale.toFixed(3)}, 修正后偏移=(${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})`);
    
    // 移动路径上所有点
    path.forEach((p, i) => {
      p.x += deltaX;
      p.y += deltaY;
    });
    
    // 移动路径上所有设备
    pathDragState.originalDevicesOnPath.forEach(item => {
      const device = item.device;
      device.x += deltaX;
      device.y += deltaY;
    });
    
    // 更新拖拽起始位置
    pathDragState.startX = currentPos.x;
    pathDragState.startY = currentPos.y;
    
    // 强制重新渲染
    stage.batchDraw();
  };
  
  const handleGlobalMouseUp = (e) => {
    if (pathDragState.isDragging) {
      console.log(`✅ 线体拖拽结束: 路径=${pathDragState.pathKey}`);
      
      saveLayout();
      
      // 重置拖拽状态
      pathDragState.isDragging = false;
      pathDragState.pathKey = null;
      pathDragState.startX = 0;
      pathDragState.startY = 0;
      pathDragState.originalDevicesOnPath = [];
      
      // 强制触发editPoints重新计算，确保UI更新
      editPointsUpdateTrigger.value++;
      
      // 移除全局事件监听
      stage.off('mousemove', handleGlobalMouseMove);
      stage.off('mouseup', handleGlobalMouseUp);
      stage.off('mouseleave', handleGlobalMouseUp);
    }
  };
  
  // 绑定全局事件
  stage.on('mousemove', handleGlobalMouseMove);
  stage.on('mouseup', handleGlobalMouseUp);
  stage.on('mouseleave', handleGlobalMouseUp);
}

// Bounding function to keep nodes within a reasonable area (不再限制在画布内，因为画布大小现在是窗口大小)
const dragBoundFunc = (pos) => {
  // 允许在更大的区域内拖拽，不再限制在窗口大小内
  const maxWidth = 5000;  // 允许拖拽的最大宽度
  const maxHeight = 5000; // 允许拖拽的最大高度
  const newX = Math.max(-1000, Math.min(pos.x, maxWidth));
  const newY = Math.max(-1000, Math.min(pos.y, maxHeight));
  return { x: newX, y: newY };
};

// --- 新增：编辑工具栏状态管理 ---
const editToolbar = reactive({
  showAddMenu: false,
  selectedTool: null, // 'camera', 'sorter', 'path'
  isPlacingDevice: false,
  placementPreview: null
});

// --- 新增：获取下一个可用的设备ID ---
function getNextDeviceId(type) {
  const existingIds = devices.filter(d => d.type === type).map(d => d.id);
  let counter = 1;
  let newId;
  
  do {
    if (type === 'camera') {
      newId = `camera-${counter}`;
    } else if (type === 'sorter') {
      newId = `sorter-${counter}`;
    }
    counter++;
  } while (existingIds.includes(newId));
  
  return newId;
}

// --- 新增：获取下一个可用的路径ID ---
function getNextPathId() {
  const existingKeys = Object.keys(paths).filter(key => !key.startsWith('layout_'));
  let counter = 1;
  let newKey;
  
  do {
    newKey = `custom_path_${counter}`;
    counter++;
  } while (existingKeys.includes(newKey));
  
  return newKey;
}

// --- 新增：添加新设备 ---
function addNewDevice(type, x = null, y = null) {
  const newId = getNextDeviceId(type);
  
  // 如果没有指定位置，使用屏幕中心
  if (x === null || y === null) {
    const stage = getStage();
    if (stage) {
      const stageBox = stage.getClientRect();
      x = stageBox.width / 2;
      y = stageBox.height / 2;
      // 转换为世界坐标
      const worldPos = {
        x: (x - stage.x()) / stage.scaleX(),
        y: (y - stage.y()) / stage.scaleY()
      };
      x = worldPos.x;
      y = worldPos.y;
    } else {
      x = 800;
      y = 600;
    }
  }
  
  const newDevice = {
    id: newId,
    type: type,
    x: x,
    y: y,
    offline: false
  };
  
  // 为设备添加默认方向
  if (type === 'sorter' || type === 'camera') {
    // 🔧 根据设备所在传送带的方向来设置设备默认方向
    const devicePathDirection = getDevicePathDirection(newDevice);
    if (type === 'sorter') {
      // 摆轮应该与传送带垂直
      newDevice.orientation = devicePathDirection === 'vertical' ? 'horizontal' : 'vertical';
    } else {
      // 相机跟随传送带方向
      newDevice.orientation = devicePathDirection;
    }
  }
  
  devices.push(newDevice);
  saveLayout();
  
  console.log(`✅ 已添加新${type === 'camera' ? '相机' : '摆轮'}:`, newId);
  return newDevice;
}

// --- 新增：添加新路径 ---
function addNewPath() {
  const newKey = getNextPathId();
  
  // 创建一个默认的垂直路径
  const stage = getStage();
  let centerX = 1000, centerY = 800;
  
  if (stage) {
    const stageBox = stage.getClientRect();
    const worldPos = {
      x: (stageBox.width / 2 - stage.x()) / stage.scaleX(),
      y: (stageBox.height / 2 - stage.y()) / stage.scaleY()
    };
    centerX = worldPos.x;
    centerY = worldPos.y;
  }
  
  const newPath = {
    name: `传送带${Object.keys(paths).filter(k => !k.startsWith('layout_')).length + 1}`,
    direction: 'vertical',
    points: [
      { x: centerX, y: centerY - 200 },
      { x: centerX, y: centerY },
      { x: centerX, y: centerY + 200 }
    ]
  };
  
  paths[newKey] = newPath;
  saveLayout();
  
  // 强制触发editPoints重新计算
  editPointsUpdateTrigger.value++;
  
  console.log(`✅ 已添加新传送带路径:`, newKey);
  return { key: newKey, path: newPath };
}

// --- 新增：编辑传送带名称 ---
function editPathName(pathKey) {
  const pathObj = paths[pathKey];
  if (!pathObj || pathKey.startsWith('layout_')) {
    console.warn('无法编辑系统路径名称');
    return;
  }
  
  const currentName = pathObj.name || pathKey;
  const newName = prompt(`请输入传送带名称:`, currentName);
  
  if (newName !== null && newName.trim() !== '') {
    pathObj.name = newName.trim();
    saveLayout();
    console.log(`✅ 传送带 ${pathKey} 名称已更新为: ${newName}`);
  }
}

// --- 新增：通过名称查找传送带 ---
function findPathByName(pathName) {
  for (const [pathKey, pathObj] of Object.entries(paths)) {
    if (pathObj.name === pathName) {
      return { key: pathKey, path: pathObj };
    }
  }
  return null;
}

// --- 新增：获取传送带显示名称 ---
function getPathDisplayName(pathKey, pathObj) {
  return pathObj.name || pathKey;
}

// --- 新增：通过传送带名称触发包裹动画 ---
function triggerPackageByPathName(pathName, packageInfo) {
  const pathResult = findPathByName(pathName);
  if (!pathResult) {
    console.error(`❌ 找不到名称为 "${pathName}" 的传送带`);
    return false;
  }
  
  const { key: pathKey, path: pathObj } = pathResult;
  console.log(`🚀 通过传送带名称 "${pathName}" (${pathKey}) 触发包裹动画`, packageInfo);
  
  // 创建包裹动画事件数据
  const eventData = {
    packageInfo: packageInfo,
    _startPathId: pathKey
  };
  
  // 调用现有的包裹创建函数
  createNewPackage(eventData);
  return true;
}

// --- 新增：获取所有传送带名称列表 ---
function getAllPathNames() {
  const pathNames = [];
  for (const [pathKey, pathObj] of Object.entries(paths)) {
    if (!pathKey.startsWith('layout_')) {
      pathNames.push({
        key: pathKey,
        name: pathObj.name || pathKey,
        direction: pathObj.direction
      });
    }
  }
  return pathNames;
}

// --- 新增：删除路径 ---
function deletePath(pathKey) {
  if (!pathKey || pathKey.startsWith('layout_')) {
    console.warn('无法删除系统路径');
    return;
  }
  
  if (confirm(`确定要删除路径 "${pathKey}" 吗？此操作将同时删除路径上的所有设备。`)) {
    // 删除路径上的所有设备
    const pathObj = paths[pathKey];
    if (pathObj && pathObj.points) {
      const devicesToRemove = [];
      devices.forEach((device, index) => {
        // 检查设备是否在该路径上
        let onThisPath = false;
        for (let i = 0; i < pathObj.points.length - 1; i++) {
          const distToSegment = pointToLineSegmentDistance(
            { x: device.x, y: device.y },
            pathObj.points[i],
            pathObj.points[i + 1]
          );
          if (distToSegment < 30) {
            onThisPath = true;
            break;
          }
        }
        if (onThisPath) {
          devicesToRemove.push(index);
        }
      });
      
      // 从后往前删除设备，避免索引变化
      devicesToRemove.reverse().forEach(index => {
        const removedDevice = devices.splice(index, 1)[0];
        console.log(`  删除设备: ${removedDevice.id}`);
      });
    }
    
    // 删除路径
    delete paths[pathKey];
    saveLayout();
    
    // 强制触发editPoints重新计算
    editPointsUpdateTrigger.value++;
    
    console.log(`✅ 已删除路径 "${pathKey}" 及其上的 ${devicesToRemove.length} 个设备`);
  }
}

// --- 新增：切换添加菜单 ---
function toggleAddMenu() {
  editToolbar.showAddMenu = !editToolbar.showAddMenu;
  if (!editToolbar.showAddMenu) {
    editToolbar.selectedTool = null;
    editToolbar.isPlacingDevice = false;
    editToolbar.placementPreview = null;
  }
}

// --- 新增：开始设备放置模式 ---
function startDevicePlacement(deviceType) {
  editToolbar.selectedTool = deviceType;
  editToolbar.isPlacingDevice = true;
  editToolbar.showAddMenu = false;
  console.log(`🎯 开始放置 ${deviceType === 'camera' ? '相机' : '摆轮'} 模式`);
}

// --- 新增：处理画布点击放置设备 ---
function handleStageClick(e) {
  if (!props.isEditMode || !editToolbar.isPlacingDevice) return;
  
  // 阻止事件冒泡
  e.cancelBubble = true;
  
  const stage = e.target.getStage();
  const pointerPos = stage.getPointerPosition();
  
  // 转换为世界坐标
  const worldPos = {
    x: (pointerPos.x - stage.x()) / stage.scaleX(),
    y: (pointerPos.y - stage.y()) / stage.scaleY()
  };
  
  if (editToolbar.selectedTool === 'camera' || editToolbar.selectedTool === 'sorter') {
    addNewDevice(editToolbar.selectedTool, worldPos.x, worldPos.y);
  }
  
  // 退出放置模式
  editToolbar.isPlacingDevice = false;
  editToolbar.selectedTool = null;
}
</script>

<template>
  <v-stage 
    :config="{ 
      ...stageConfig, 
      draggable: !isEditMode,
      listening: true
    }"
    @wheel="handleWheel"
    @dragstart="handleStageDragStart"
    @dragend="handleStageDragEnd"
    @click="handleStageClick"
    @tap="handleStageClick"
    :style="{ cursor: editToolbar.isPlacingDevice ? 'crosshair' : (isEditMode && !stageTransform ? 'grab' : 'default') }"
  >
    <v-layer>
      <!-- 移除画布背景，改为透明 -->

      <!-- Draw STATIC layout paths (thin lines) -->
      <template v-for="(path, key) in paths" :key="`layout-${key}`">
        <v-line
          v-if="key.startsWith('layout_')"
          :config="{
            points: path.flatMap(p => [p.x, p.y]),
            stroke: props.themeConfig.textColor === '#E8E8E8' ? '#3A3A5C' : '#DCDFE6',
            strokeWidth: 2,
            strokeScaleEnabled: true,
          }"
        />
      </template>

      <!-- Draw DYNAMIC conveyor belts (multi-layer realistic effect) -->
      <template v-for="(path, key) in paths" :key="`conveyor-${key}`">
        <template v-if="!key.startsWith('layout_')">
          <!-- Belt Shadow (底层阴影) -->
          <v-line
            :config="{
              points: path.points.flatMap(p => [p.x + 2, p.y + 2]),
              stroke: 'rgba(0, 0, 0, 0.2)',
              strokeWidth: 18,
              strokeScaleEnabled: true,
              lineCap: 'round',
              lineJoin: 'round',
            }"
          />
          <!-- Belt Base (基础带体) -->
          <v-line
            :config="{
              points: path.points.flatMap(p => [p.x, p.y]),
              stroke: props.themeConfig.textColor === '#E8E8E8' ? '#1A252F' : '#2C3E50',
              strokeWidth: 16,
              strokeScaleEnabled: true,
              lineCap: 'round',
              lineJoin: 'round',
            }"
          />
                    <!-- Belt Surface (表面纹理) -->
          <v-line
            :config="{
              points: path.points.flatMap(p => [p.x, p.y]),
              stroke: props.themeConfig.textColor === '#E8E8E8' ? '#2C3E50' : '#34495E',
              strokeWidth: 12,
              strokeScaleEnabled: true,
              lineCap: 'round',
              lineJoin: 'round',
              hitStrokeWidth: 20, // 增大点击区域，确保能被选中
            }"
            @mousedown="e => handlePathDragStart(e, key)"
          />
          <!-- Belt Active Indicator (活跃指示) -->
          <v-line
            v-if="activeConveyors.has(key)"
            :config="{
              points: path.points.flatMap(p => [p.x, p.y]),
              stroke: 'rgba(52, 152, 219, 0.3)',
              strokeWidth: 8,
              strokeScaleEnabled: true,
              lineCap: 'round',
              lineJoin: 'round',
            }"
          />
          <!-- Moving Directional Arrows (移动方向箭头) -->
          <v-line
            :ref="(el) => setLineRef(el, key)"
            :config="{
              points: path.points.flatMap(p => [p.x, p.y]),
              stroke: activeConveyors.has(key) ? '#3498DB' : '#7F8C8D',
              strokeWidth: 2,
              strokeScaleEnabled: true,
              lineCap: 'round',
              lineJoin: 'round',
              dash: [Math.max(1, getPathLength(path.points) / 20), 12], // 动态虚线
              dashEnabled: true,
            }"
          />
        </template>
      </template>

      <!-- 渲染包裹轨迹粒子效果 -->
      <template v-for="(particle, pkgId) in particles" :key="`trail-${pkgId}`">
        <v-circle
          v-for="(point, index) in particle.trail"
          :key="`trail-${pkgId}-${index}`"
          :config="{
            x: point.x,
            y: point.y,
            radius: Math.max(1, (index / particle.trail.length) * 4),
            fill: particle.color,
            opacity: point.opacity * 0.6,
          }"
        />
      </template>

      <!-- Draw Active Packages -->
      <v-group
        v-for="pkg in activePackages"
        :key="pkg.id"
        :config="pkg.konvaConfig.group"
      >
        <v-rect :config="pkg.konvaConfig.rect" />
        <v-text :config="pkg.konvaConfig.text" />
      </v-group>

      <!-- 渲染相机并传递扫描状态 -->
      <CameraDevice
        v-for="device in cameraDevices"
        :key="device.id"
        :config="device"
        :is-scanning="cameraStates[device.id]?.isScanning"
        :is-offline="isDeviceOffline(device.id)"
        :online-status="getDeviceOnlineStatus(device.id)"
        :conveyor-direction="getCameraConveyorDirection(device)"
        :device-orientation="device.orientation || 'vertical'"
        :is-edit-mode="isEditMode"
        @update:position="handleDeviceMove"
        @duplicate="handleDuplicateDevice"
        @delete="handleDeleteDevice"
        @toggle-orientation="handleToggleDeviceOrientation"
        :drag-bound-func="dragBoundFunc"
      />

      <!-- 4. 渲染分拣器并监听所有事件 -->
      <Sorter
        v-for="device in sorterDevices"
        :key="device.id"
        :config="device"
        :direction="sorterStates[device.id]?.direction"
        :is-offline="isDeviceOffline(device.id)"
        :online-status="getDeviceOnlineStatus(device.id)"
        :conveyor-direction="getSorterConveyorDirection(device)"
        :device-orientation="device.orientation || 'vertical'"
        :is-edit-mode="isEditMode"
        @update:position="handleDeviceMove"
        @duplicate="handleDuplicateDevice"
        @delete="handleDeleteDevice"
        @toggle-orientation="handleToggleDeviceOrientation"
        :drag-bound-func="dragBoundFunc"
      />

      <!-- 编辑模式下的路径控制按钮 -->
      <template v-if="isEditMode" v-for="(pathObj, key) in paths" :key="`path-controls-${key}`">
        <v-group v-if="!key.startsWith('layout_')" :config="{ x: getPathCenter(pathObj).x, y: getPathCenter(pathObj).y }">
          <!-- 反转按钮背景 -->
          <v-circle 
            :config="{ 
              x: -25,
              radius: 18, 
              fill: props.themeConfig.textColor === '#E8E8E8' ? '#2C3E50' : '#3498DB',
              stroke: 'white',
              strokeWidth: 2,
              opacity: 0.9,
              shadowColor: 'rgba(0,0,0,0.3)',
              shadowBlur: 5,
              shadowOffsetX: 2,
              shadowOffsetY: 2
            }"
            @click="() => reversePath(key)"
            @tap="() => reversePath(key)"
          />
          <!-- 反转图标 -->
          <v-text 
            :config="{ 
              x: -25,
              text: '⟲', 
              fontSize: 18, 
              fill: 'white', 
              offsetX: 9, 
              offsetY: 9,
              align: 'center'
            }"
            @click="() => reversePath(key)"
            @tap="() => reversePath(key)"
          />
          
          <!-- 删除按钮背景 -->
          <v-circle 
            :config="{ 
              x: 25,
              radius: 18, 
              fill: '#e74c3c',
              stroke: 'white',
              strokeWidth: 2,
              opacity: 0.9,
              shadowColor: 'rgba(0,0,0,0.3)',
              shadowBlur: 5,
              shadowOffsetX: 2,
              shadowOffsetY: 2
            }"
            @click="() => deletePath(key)"
            @tap="() => deletePath(key)"
          />
          <!-- 删除图标 -->
          <v-text 
            :config="{ 
              x: 25,
              text: '×', 
              fontSize: 18, 
              fill: 'white', 
              offsetX: 9, 
              offsetY: 9,
              align: 'center',
              fontStyle: 'bold'
            }"
            @click="() => deletePath(key)"
            @tap="() => deletePath(key)"
          />
          
          <!-- 方向切换按钮背景 -->
          <v-circle 
            :config="{ 
              x: 0,
              y: -25,
              radius: 16, 
              fill: '#9b59b6',
              stroke: 'white',
              strokeWidth: 2,
              opacity: 0.9,
              shadowColor: 'rgba(0,0,0,0.3)',
              shadowBlur: 5,
              shadowOffsetX: 2,
              shadowOffsetY: 2
            }"
            @click="() => togglePathDirection(key)"
            @tap="() => togglePathDirection(key)"
          />
          <!-- 方向切换图标 -->
          <v-text 
            :config="{ 
              x: 0,
              y: -25,
              text: pathObj.direction === 'vertical' ? '↔️' : '↕️', 
              fontSize: 14, 
              fill: 'white', 
              offsetX: 7, 
              offsetY: 7,
              align: 'center'
            }"
            @click="() => togglePathDirection(key)"
            @tap="() => togglePathDirection(key)"
          />
          
          <!-- 编辑名称按钮背景 -->
          <v-circle 
            :config="{ 
              x: 0,
              y: 25,
              radius: 14, 
              fill: '#3498db',
              stroke: 'white',
              strokeWidth: 2,
              opacity: 0.9,
              shadowColor: 'rgba(0,0,0,0.3)',
              shadowBlur: 3,
              shadowOffsetX: 1,
              shadowOffsetY: 1
            }"
            @click="() => editPathName(key)"
            @tap="() => editPathName(key)"
          />
          <!-- 编辑名称图标 -->
          <v-text 
            :config="{ 
              x: 0,
              y: 25,
              text: '✏️', 
              fontSize: 12, 
              fill: 'white', 
              offsetX: 6, 
              offsetY: 6,
              align: 'center'
            }"
            @click="() => editPathName(key)"
            @tap="() => editPathName(key)"
          />
          
          <!-- 路径名称标签 -->
          <v-text 
            :config="{ 
              text: getPathDisplayName(key, pathObj), 
              fontSize: 11, 
              fill: props.themeConfig.textColor === '#E8E8E8' ? '#E8E8E8' : '#2C3E50', 
              offsetX: getPathDisplayName(key, pathObj).length * 5.5, 
              offsetY: -5,
              y: 45,
              align: 'center',
              fontStyle: 'bold'
            }"
          />
        </v-group>
      </template>

      <!-- Draggable Path Nodes (only in edit mode) -->
      <template v-if="isEditMode">
        <v-circle
          v-for="point in editPoints"
          :key="point.id"
          :config="{ ...point }"
          @dragstart="handleNodeDragStart"
          @dragmove="handleNodeDragMove"
          @dragend="handleNodeDragEnd"
          :drag-bound-func="dragBoundFunc"
        />
      </template>

      <!-- Devices are rendered above using cameraDevices and sorterDevices computed properties -->

      <!-- Packages (parcels) are now rendered in the "Draw Active Packages" section above -->

      <!-- 所有文字标签已删除，界面更加简洁 -->
    </v-layer>
  </v-stage>
  
  <!-- 编辑工具栏（覆盖在画布上） -->
  <div v-if="isEditMode" class="edit-toolbar" :class="{ 'toolbar-dark': props.themeConfig.textColor === '#E8E8E8' }">
    <div class="toolbar-header">
      <h4>🛠️ 编辑工具栏</h4>
      <div class="toolbar-status" v-if="editToolbar.isPlacingDevice">
        <span class="placing-hint">📍 点击画布放置 {{ editToolbar.selectedTool === 'camera' ? '相机' : '摆轮' }}</span>
        <button @click="() => { editToolbar.isPlacingDevice = false; editToolbar.selectedTool = null; }" class="cancel-btn">取消</button>
      </div>
    </div>
    
    <div class="toolbar-content">
      <!-- 添加设备按钮组 -->
      <div class="tool-group">
        <div class="group-title">新增设备</div>
        <div class="button-row">
          <button 
            @click="startDevicePlacement('camera')" 
            class="tool-btn camera-btn"
            :class="{ active: editToolbar.selectedTool === 'camera' }"
          >
            <span class="btn-icon">📷</span>
            新增相机
          </button>
          <button 
            @click="startDevicePlacement('sorter')" 
            class="tool-btn sorter-btn"
            :class="{ active: editToolbar.selectedTool === 'sorter' }"
          >
            <span class="btn-icon">🔄</span>
            新增摆轮
          </button>
        </div>
      </div>
      
      <!-- 添加路径按钮 -->
      <div class="tool-group">
        <div class="group-title">新增分拣线</div>
        <button @click="addNewPath" class="tool-btn path-btn">
          <span class="btn-icon">➡️</span>
          新增传送带
        </button>
      </div>
      
      <!-- 快捷操作 -->
      <div class="tool-group">
        <div class="group-title">快捷操作</div>
        <div class="button-row">
          <button @click="() => addNewDevice('camera')" class="tool-btn quick-btn">
            <span class="btn-icon">📷</span>
            快速添加相机
          </button>
          <button @click="() => addNewDevice('sorter')" class="tool-btn quick-btn">
            <span class="btn-icon">🔄</span>
            快速添加摆轮
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 编辑工具栏样式 */
.edit-toolbar {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  min-width: 280px;
  max-width: 320px;
  z-index: 1000;
  font-size: 14px;
}

.edit-toolbar.toolbar-dark {
  background: rgba(30, 30, 50, 0.95);
  color: #E8E8E8;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.toolbar-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.toolbar-dark .toolbar-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.toolbar-header h4 {
  margin: 0 0 8px 0;
  font-size: 16px;
  font-weight: 600;
  color: #2c3e50;
}

.toolbar-dark .toolbar-header h4 {
  color: #E8E8E8;
}

.toolbar-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 12px;
  background: rgba(52, 152, 219, 0.1);
  border-radius: 6px;
  border: 1px solid rgba(52, 152, 219, 0.2);
}

.placing-hint {
  flex: 1;
  font-size: 12px;
  color: #3498db;
  font-weight: 500;
}

.cancel-btn {
  background: #e74c3c;
  color: white;
  border: none;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.cancel-btn:hover {
  background: #c0392b;
}

.toolbar-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tool-group {
  background: rgba(0, 0, 0, 0.02);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.toolbar-dark .tool-group {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  margin-bottom: 8px;
  text-align: center;
}

.toolbar-dark .group-title {
  color: #ccc;
}

.button-row {
  display: flex;
  gap: 8px;
}

.tool-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  background: #f8f9fa;
  color: #2c3e50;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  text-align: center;
  min-height: 40px;
}

.tool-btn:hover {
  background: #e9ecef;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.tool-btn.active {
  background: #3498db;
  color: white;
  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
}

.camera-btn {
  background: #27ae60;
  color: white;
}

.camera-btn:hover {
  background: #219a52;
}

.sorter-btn {
  background: #e67e22;
  color: white;
}

.sorter-btn:hover {
  background: #d35400;
}

.path-btn {
  background: #8e44ad;
  color: white;
}

.path-btn:hover {
  background: #7d3c98;
}

.quick-btn {
  background: #34495e;
  color: white;
  font-size: 12px;
}

.quick-btn:hover {
  background: #2c3e50;
}

.btn-icon {
  font-size: 16px;
}

/* 移动端优化 */
@media (max-width: 768px) {
  .edit-toolbar {
    top: 10px;
    left: 10px;
    right: 10px;
    max-width: none;
    width: auto;
  }
  
  .button-row {
    flex-direction: column;
    gap: 6px;
  }
  
  .tool-btn {
    font-size: 12px;
    padding: 8px 10px;
    min-height: 36px;
  }
}

/* 大屏优化 */
@media (min-width: 1920px) {
  .edit-toolbar {
    top: 30px;
    left: 30px;
    min-width: 320px;
    max-width: 380px;
    padding: 20px;
  }
  
  .toolbar-header h4 {
    font-size: 18px;
  }
  
  .tool-btn {
    font-size: 14px;
    padding: 12px 14px;
    min-height: 44px;
  }
  
  .group-title {
    font-size: 13px;
  }
}
</style> 