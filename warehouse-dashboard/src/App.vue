<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import ConveyorCanvas from './components/ConveyorCanvas.vue';
import { io } from "socket.io-client";

const canvasRef = ref(null);
const isEditMode = ref(false); // Default to view mode

// 简化的数据管理
const activePackages = ref({});

// 主题控制
const isDarkMode = ref(false);

// 背景色控制
const customBackgroundColor = ref('transparent');
const showBackgroundPicker = ref(false);

// WebSocket连接状态
const wsConnected = ref(false);

function handleSave() {
  canvasRef.value?.saveLayout();
}

function handleReset() {
  if (confirm('确定要重置布局到默认状态吗？此操作无法撤销。')) {
    canvasRef.value?.resetLayout();
  }
}

function toggleEditMode() {
  isEditMode.value = !isEditMode.value;
}

// 处理包裹更新
function handlePackageUpdate(packageData) {
  activePackages.value = packageData;
}

// 处理布局保存事件
function handleLayoutSaved() {
  // 只在编辑模式下且自动同步启用时触发云端同步
  if (isEditMode.value && configSyncStatus.value.autoSyncEnabled) {
    console.log('📐 检测到布局保存，触发云端同步');
    scheduleAutoSave();
  }
}

// 主题切换
function toggleTheme() {
  isDarkMode.value = !isDarkMode.value;
  // 触发自动保存（防抖）
  scheduleAutoSave();
}

// 背景色预设色卡
const presetColors = [
  '#ffffff', '#f8f9fa', '#e9ecef', // 白色系
  '#2c3e50', '#3498db', '#2980b9', // 蓝色系
  '#27ae60', '#16a085', '#1abc9c', // 绿色系
  '#f39c12', '#e67e22', '#d35400', // 橙色系
  '#e74c3c', '#c0392b', '#8e44ad', // 红紫色系
  '#34495e', '#7f8c8d', '#95a5a6', // 灰色系
  '#1a1a2e', '#16213e', '#0f3460', // 深色系
  '#74b9ff', '#6c5ce7', '#a29bfe', // 浅紫蓝系
  '#fd79a8', '#fdcb6e', '#e17055'  // 暖色系
];

// 背景色控制功能
function toggleBackgroundPicker() {
  showBackgroundPicker.value = !showBackgroundPicker.value;
}

function selectPresetColor(color) {
  customBackgroundColor.value = color;
  saveBackgroundColor(color);
  showBackgroundPicker.value = false;
}

function removeBackgroundColor() {
  customBackgroundColor.value = 'transparent';
  saveBackgroundColor('transparent');
  showBackgroundPicker.value = false;
}

function saveBackgroundColor(color) {
  localStorage.setItem('warehouse-background-color', color);
  // 触发自动保存（防抖）
  scheduleAutoSave();
}

// 防抖自动保存
function scheduleAutoSave() {
  if (!configSyncStatus.value.autoSyncEnabled || configSyncStatus.value.syncInProgress) {
    return;
  }
  
  // 清除之前的定时器
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  // 设置新的定时器，2秒后执行自动保存
  autoSaveTimer = setTimeout(() => {
    // 再次检查是否在同步中，避免延迟执行时的竞态条件
    if (!configSyncStatus.value.syncInProgress) {
    autoSaveConfigToCloud();
    }
  }, 2000);
}

function loadBackgroundColor() {
  const savedColor = localStorage.getItem('warehouse-background-color');
  if (savedColor) {
    customBackgroundColor.value = savedColor;
  }
}

function handleCustomColorChange(event) {
  const color = event.target.value;
  customBackgroundColor.value = color;
  saveBackgroundColor(color);
}

// 配置服务器API
const CONFIG_SERVER_URL = 'http://10.52.1.21:3001';

// 云端配置同步功能
const configSyncStatus = ref({
  connected: false,
  lastSync: null,
  configs: [],
  autoSyncEnabled: true,
  syncInProgress: false,
  lastAutoSave: null,
  conflictResolution: 'newer' // 'newer', 'local', 'remote'
});

// 自动同步配置
let autoSaveTimer = null;
let configSocket = null; // WebSocket for config sync

// Toast通知系统
const toasts = ref([]);
let toastIdCounter = 0;

function showToast(message, type = 'info', duration = 5000) {
  const id = ++toastIdCounter;
  const toast = {
    id,
    message,
    type, // 'success', 'error', 'warning', 'info'
    duration,
    visible: true,
    createdAt: Date.now()
  };
  
  toasts.value.push(toast);
  
  // 自动隐藏
  if (duration > 0) {
    setTimeout(() => {
      hideToast(id);
    }, duration);
  }
  
  return id;
}

function hideToast(toastId) {
  const index = toasts.value.findIndex(toast => toast.id === toastId);
  if (index > -1) {
    toasts.value[index].visible = false;
    // 延迟移除，允许动画播放
    setTimeout(() => {
      const removeIndex = toasts.value.findIndex(toast => toast.id === toastId);
      if (removeIndex > -1) {
        toasts.value.splice(removeIndex, 1);
      }
    }, 300);
  }
}
async function checkConfigServer() {
  try {
    // 显示检查中状态
    const checkingToast = showToast('🔄 正在检查配置服务器连接...', 'info');
    
    const response = await fetch(`${CONFIG_SERVER_URL}/health`);
    const result = await response.json();
    configSyncStatus.value.connected = result.status === 'ok';
    
    // 隐藏检查中提示
    hideToast(checkingToast);
    
    if (configSyncStatus.value.connected) {
      showToast('✅ 配置服务器连接成功！', 'success', 3000);
      console.log('✅ 配置服务器连接成功:', result);
    } else {
      showToast('❌ 配置服务器响应异常', 'error', 5000);
    }
    
    return configSyncStatus.value.connected;
  } catch (error) {
    console.warn('配置服务器不可用:', error.message);
    configSyncStatus.value.connected = false;
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      showToast('❌ 无法连接到配置服务器\n请确认服务器已启动 (端口3001)', 'error', 8000);
    } else if (error.name === 'AbortError') {
      showToast('⏱️ 连接超时，请检查网络', 'warning', 5000);
    } else {
      showToast(`❌ 连接失败: ${error.message}`, 'error', 5000);
    }
    
    return false;
  }
}

// 自动保存配置到云端（无感保存）
async function autoSaveConfigToCloud() {
  if (!configSyncStatus.value.connected || !configSyncStatus.value.autoSyncEnabled) {
    return false;
  }

  if (configSyncStatus.value.syncInProgress) {
    console.log('⏳ 配置同步正在进行中，跳过本次自动保存');
    return false;
  }

  configSyncStatus.value.syncInProgress = true;

  const config = {
    settings: {
      backgroundColor: customBackgroundColor.value,
      layout: localStorage.getItem('conveyorLayout'),
      isDarkMode: isDarkMode.value,
      timestamp: new Date().toISOString()
    }
  };

  // 获取当前设备ID
  const sourceDeviceId = localStorage.getItem('dashboardId');

  try {
    // 检查是否已存在自动保存的配置
    const existingConfigId = localStorage.getItem('auto-config-id');
    
    if (existingConfigId) {
      // 更新现有配置
      const response = await fetch(`${CONFIG_SERVER_URL}/api/configs/${existingConfigId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          sourceDeviceId
        })
      });

      const result = await response.json();
      if (result.success) {
        configSyncStatus.value.lastAutoSave = new Date().toISOString();
        configSyncStatus.value.lastSync = configSyncStatus.value.lastAutoSave;
        console.log('✅ 配置已自动更新到云端');
        // 保存成功后，服务器会通过WebSocket广播，本地无需再提示
        // showToast('🔄 配置已自动同步', 'success', 2000);
        return true;
      }
    } else {
      // 创建新的自动保存配置
      const response = await fetch(`${CONFIG_SERVER_URL}/api/configs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `自动同步配置-${localStorage.getItem('dashboardId') || 'Default'}`,
          description: '自动同步的配置文件 - 包含背景色、布局和主题设置',
          config,
          sourceDeviceId
        })
      });

      const result = await response.json();
      if (result.success) {
        localStorage.setItem('auto-config-id', result.data.id);
        configSyncStatus.value.lastAutoSave = new Date().toISOString();
        configSyncStatus.value.lastSync = configSyncStatus.value.lastAutoSave;
        console.log('✅ 配置已自动保存到云端:', result.data.id);
        showToast('✅ 首次自动保存成功', 'success', 3000);
        return true;
      }
    }
  } catch (error) {
    console.warn('⚠️ 自动保存配置失败:', error);
  } finally {
    configSyncStatus.value.syncInProgress = false;
  }

  return false;
}

// 手动保存配置到云端（带用户确认）
async function saveConfigToCloud() {
  if (!configSyncStatus.value.connected) {
    showToast('❌ 配置服务器未连接，无法保存到云端', 'error', 5000);
    return false;
  }

  const configName = prompt('请输入配置名称:', `配置-${new Date().toLocaleString()}`);
  if (!configName) return false;

  const description = prompt('请输入配置描述（可选）:', '包含背景色、布局和主题设置');

  const savingToast = showToast('💾 正在保存配置到云端...', 'info');

  const config = {
    settings: {
      backgroundColor: customBackgroundColor.value,
      layout: localStorage.getItem('conveyorLayout'),
      isDarkMode: isDarkMode.value,
      timestamp: new Date().toISOString()
    }
  };

  // 获取当前设备ID
  const sourceDeviceId = localStorage.getItem('dashboardId');

  try {
    const response = await fetch(`${CONFIG_SERVER_URL}/api/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: configName,
        description: description || '',
        config,
        sourceDeviceId
      })
    });

    const result = await response.json();
    hideToast(savingToast);

    if (result.success) {
      console.log('✅ 配置已保存到云端:', result.data);
      configSyncStatus.value.lastSync = new Date().toISOString();
      await loadConfigList(); // 刷新配置列表
      showToast(`✅ 配置 "${configName}" 已成功保存到云端！`, 'success', 4000);
      return true;
    } else {
      showToast(`❌ 保存失败: ${result.error}`, 'error', 6000);
      return false;
    }
  } catch (error) {
    console.error('保存配置到云端失败:', error);
    hideToast(savingToast);
    showToast(`❌ 保存失败: ${error.message}`, 'error', 6000);
    return false;
  }
}

// 静默应用配置（不触发自动保存）
async function applyConfigSilently(config, isFromRealtime = false) {
  if (!config) {
    console.warn('applyConfigSilently: 收到空配置');
    return;
  }

  console.log('🔄 开始静默应用配置:', { isFromRealtime, hasLayout: !!config.layout, hasBackground: !!config.backgroundColor });
  
  // 使用同步进行中标志位来避免循环触发，而不是禁用自动同步
  const wasSyncInProgress = configSyncStatus.value.syncInProgress;
  configSyncStatus.value.syncInProgress = true;

  try {
    // 应用背景色
    if (config.backgroundColor !== undefined) {
      try {
      customBackgroundColor.value = config.backgroundColor;
        // 在同步标志位保护下安全更新localStorage
      localStorage.setItem('warehouse-background-color', config.backgroundColor);
        console.log('✅ 背景色已更新:', config.backgroundColor);
      } catch (e) {
        console.error('❌ 更新背景色失败:', e);
      }
    }
    
    // 应用布局，通过调用子组件方法实现无刷新更新
    if (config.layout) {
      try {
        // 在同步标志位保护下安全更新localStorage
      localStorage.setItem('conveyorLayout', config.layout);
        console.log('✅ 布局数据已保存到localStorage');
        
        if (isFromRealtime && canvasRef.value?.applyLayoutUpdate) {
          try {
            const layoutObject = JSON.parse(config.layout);
            canvasRef.value.applyLayoutUpdate(layoutObject);
            console.log('✅ 实时布局更新已应用');
          } catch(e) {
            console.error("❌ 解析或应用实时布局更新失败:", e);
          }
        }
      } catch (e) {
        console.error('❌ 布局更新过程中发生错误:', e);
      }
    }
    
    // 应用主题
    if (typeof config.isDarkMode === 'boolean') {
      try {
      isDarkMode.value = config.isDarkMode;
        console.log('✅ 主题已更新:', config.isDarkMode ? '夜间模式' : '白天模式');
      } catch (e) {
        console.error('❌ 更新主题失败:', e);
      }
    }

    // 更新最后同步时间
    if (config.timestamp) {
      try {
      configSyncStatus.value.lastAutoSave = config.timestamp;
        console.log('✅ 同步时间已更新:', config.timestamp);
      } catch (e) {
        console.error('❌ 更新同步时间失败:', e);
    }
    }
    
    console.log('✅ 静默配置应用完成');
  } catch (error) {
    console.error('❌ 静默应用配置时发生严重错误:', error);
  } finally {
    // 立即恢复同步状态，不需要延迟
    configSyncStatus.value.syncInProgress = wasSyncInProgress;
    console.log('🔄 配置同步状态已恢复');
  }
}

// 手动从云端加载最新配置（带用户确认）
async function loadLatestConfigFromCloud() {
  if (!configSyncStatus.value.connected) {
    showToast('❌ 配置服务器未连接，无法加载云端配置', 'error', 5000);
    return false;
  }

  const loadingToast = showToast('📥 正在从云端加载最新配置...', 'info');

  try {
    const response = await fetch(`${CONFIG_SERVER_URL}/api/configs/latest`);
    const result = await response.json();
    
    hideToast(loadingToast);
    
    console.log('📊 加载最新配置响应:', result);
    
    if (result.success && result.data) {
      const config = result.data.settings;
      
      showToast(`✅ 找到配置: ${result.data.name}`, 'success', 3000);
      
      if (confirm(`找到云端配置: ${result.data.name}\n创建时间: ${new Date(result.data.created).toLocaleString()}\n更新时间: ${new Date(result.data.updated).toLocaleString()}\n\n是否加载此配置？`)) {
        await applyConfigSilently(config);
        configSyncStatus.value.lastSync = new Date().toISOString();
        console.log('✅ 已从云端加载配置:', result.data.name);
        showToast(`✅ 配置 "${result.data.name}" 已成功加载！`, 'success', 4000);
        
        // 直接应用布局更改，无需刷新页面
        if (config.layout) {
          try {
            const layoutObject = JSON.parse(config.layout);
            canvasRef.value?.applyLayoutUpdate(layoutObject);
          } catch (e) {
            console.error("无法解析布局配置:", e);
          }
        }
        
        return true;
      } else {
        showToast('⏹️ 用户取消加载配置', 'info', 2000);
      }
    } else if (result.success && !result.data) {
      showToast('📭 云端没有找到任何配置文件\n请先保存一些配置', 'warning', 6000);
      return false;
    } else {
      showToast(`❌ 获取配置失败: ${result.error || '未知错误'}`, 'error', 5000);
      return false;
    }
  } catch (error) {
    console.error('从云端加载配置失败:', error);
    hideToast(loadingToast);
    showToast(`❌ 加载失败: ${error.message}`, 'error', 6000);
    return false;
  }
}

// 加载配置列表
async function loadConfigList() {
  if (!configSyncStatus.value.connected) {
    console.warn('⚠️ 配置服务器未连接，跳过配置列表加载');
    return;
  }

  try {
    console.log('🔄 正在请求配置列表:', `${CONFIG_SERVER_URL}/api/configs`);
    const response = await fetch(`${CONFIG_SERVER_URL}/api/configs`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('📊 配置列表响应:', result);
    
    if (result.success) {
      configSyncStatus.value.configs = result.data || [];
      console.log(`✅ 成功加载 ${configSyncStatus.value.configs.length} 个配置`);
    } else {
      console.error('❌ 配置列表响应失败:', result.error);
      configSyncStatus.value.configs = [];
    }
  } catch (error) {
    console.error('❌ 加载配置列表失败:', error);
    configSyncStatus.value.configs = [];
  }
}

// 从配置列表中选择配置
async function selectConfigFromList() {
  if (!configSyncStatus.value.connected) {
    showToast('❌ 配置服务器未连接', 'error', 5000);
    return;
  }

  const listLoadingToast = showToast('📋 正在获取配置列表...', 'info');

  await loadConfigList();
  const configs = configSyncStatus.value.configs;
  
  hideToast(listLoadingToast);
  
  console.log('📊 配置列表:', configs);
  
  if (configs.length === 0) {
    showToast('📭 云端没有保存的配置\n请先使用"保存到云端"功能保存配置', 'warning', 6000);
    return;
  }

  showToast(`✅ 找到 ${configs.length} 个云端配置`, 'success', 3000);

  // 简单的配置选择（在实际应用中可以做成更好的UI）
  const configOptions = configs.map((config, index) => 
    `${index + 1}. ${config.name} (${new Date(config.updated).toLocaleString()})`
  ).join('\n');

  const selection = prompt(`请选择要加载的配置:\n\n${configOptions}\n\n请输入配置编号:`);
  const index = parseInt(selection) - 1;

  if (isNaN(index) || index < 0 || index >= configs.length) {
    showToast('❌ 选择无效，请输入正确的配置编号', 'error', 4000);
    return;
  }

  const selectedConfig = configs[index];
  const detailLoadingToast = showToast(`📥 正在加载配置: ${selectedConfig.name}...`, 'info');
  
  try {
    const response = await fetch(`${CONFIG_SERVER_URL}/api/configs/${selectedConfig.id}`);
    const result = await response.json();
    
    hideToast(detailLoadingToast);
    
    console.log('📊 配置详情响应:', result);
    
    if (result.success && result.data) {
      const config = result.data.settings;
      
      if (confirm(`加载配置: ${result.data.name}\n描述: ${result.data.description || '无'}\n创建时间: ${new Date(result.data.created).toLocaleString()}\n更新时间: ${new Date(result.data.updated).toLocaleString()}\n\n确认加载？`)) {
        // 应用配置
        if (config.backgroundColor) {
          customBackgroundColor.value = config.backgroundColor;
          localStorage.setItem('warehouse-background-color', config.backgroundColor);
        }
        
        if (config.layout) {
          localStorage.setItem('conveyorLayout', config.layout);
        }
        
        if (typeof config.isDarkMode === 'boolean') {
          isDarkMode.value = config.isDarkMode;
        }

        configSyncStatus.value.lastSync = new Date().toISOString();
        console.log('✅ 已加载配置:', result.data.name);
        showToast(`✅ 配置 "${result.data.name}" 已成功加载！`, 'success', 4000);
        
        // 直接应用布局更改，无需刷新页面
        if (config.layout) {
          try {
            const layoutObject = JSON.parse(config.layout);
            canvasRef.value?.applyLayoutUpdate(layoutObject);
          } catch (e) {
            console.error("无法解析布局配置:", e);
          }
        }
      } else {
        showToast('⏹️ 用户取消加载配置', 'info', 2000);
      }
    } else {
      showToast(`❌ 获取配置详情失败: ${result.error || '未知错误'}`, 'error', 5000);
    }
  } catch (error) {
    console.error('加载配置失败:', error);
    hideToast(detailLoadingToast);
    showToast(`❌ 加载失败: ${error.message}`, 'error', 6000);
  }
}

// 点击外部关闭背景色选择器
function handleClickOutside(event) {
  if (!showBackgroundPicker.value) return;
  
  const backgroundControls = document.querySelector('.background-controls');
  
  if (backgroundControls && !backgroundControls.contains(event.target)) {
    showBackgroundPicker.value = false;
  }
}

// 缩放控制函数
function zoomIn() {
  canvasRef.value?.zoomIn();
}

function zoomOut() {
  canvasRef.value?.zoomOut();
}

function resetZoom() {
  canvasRef.value?.resetZoom();
}

function fitToScreen() {
  canvasRef.value?.fitToScreen();
}

// 更新连接状态
function updateConnectionStatus() {
  if (canvasRef.value?.wsConnectionStatus) {
    const status = canvasRef.value.wsConnectionStatus();
    wsConnected.value = status.connected;
  }
}

// 获取状态颜色
function getStatusColor() {
  return wsConnected.value ? '#27ae60' : '#e74c3c'; // 绿色(已连接) 或 红色(未连接)
}

// 获取状态文本
function getStatusText() {
  const theme = themeConfig.value.themeName;
  return wsConnected.value ? `${theme} | 实时模式已连接` : `${theme} | 连接中...`;
}

// 动态主题配置
const themeConfig = computed(() => {
  // 如果有自定义背景色，使用自定义背景色
  let backgroundStyle;
  if (customBackgroundColor.value && customBackgroundColor.value !== 'transparent') {
    backgroundStyle = customBackgroundColor.value;
  } else if (customBackgroundColor.value === 'transparent') {
    backgroundStyle = 'transparent';
  } else if (isDarkMode.value) {
    backgroundStyle = 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)';
  } else {
    backgroundStyle = 'linear-gradient(135deg, #2c3e50 0%, #3498db 50%, #2980b9 100%)';
  }
  
  if (isDarkMode.value) {
    return {
      background: backgroundStyle,
      panelBg: 'rgba(30, 30, 50, 0.95)',
      textColor: '#E8E8E8',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      statusDot: '#64FFDA',
      themeName: '夜间模式',
      themeIcon: '🌙'
    };
  } else {
    return {
      background: backgroundStyle,
      panelBg: 'rgba(255, 255, 255, 0.95)',
      textColor: '#2c3e50',
      borderColor: 'rgba(255, 255, 255, 0.2)',
      statusDot: '#27ae60',
      themeName: '白天模式',
      themeIcon: '☀️'
    };
  }
});

// 定期更新连接状态
setInterval(() => {
  updateConnectionStatus();
}, 2000); // 每2秒检查一次连接状态

// 启动实时同步（替换旧的startAutoSync）
async function startRealtimeSync() {
  if (!configSyncStatus.value.autoSyncEnabled) return;
  
  // 1. 检查HTTP服务器连接
  const connected = await checkConfigServer();
  if (!connected) {
    console.warn('⚠️ 配置服务器未连接，无法启动实时同步');
    return;
  }
  
  // 2. 建立WebSocket连接
  if (configSocket && configSocket.connected) {
    console.log('🔄 WebSocket已连接，无需重复操作');
    return;
  }
  
  configSocket = io(CONFIG_SERVER_URL, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    forceNew: false,
    transports: ['websocket', 'polling'],
    // 增加连接稳定性配置
    upgrade: true,
    rememberUpgrade: false,
    // 避免连接过程中的意外断开
    closeOnBeforeunload: false,
    // 增加消息大小限制和超时配置
    maxHttpBufferSize: 1e8, // 100 MB，与服务器保持一致
    pingTimeout: 60000,     // 60秒超时
    pingInterval: 25000     // 25秒心跳间隔
  });

  configSocket.on('connect', () => {
    console.log('✅ 已通过WebSocket连接到配置服务器:', configSocket.id);
    
    // 注册设备ID到服务器
    const deviceId = localStorage.getItem('dashboardId');
    if (deviceId) {
      configSocket.emit('register-device', deviceId);
      console.log('📱 已向服务器注册设备ID:', deviceId);
    }
    
    showToast('⚡️ 实时同步已连接', 'success', 3000);
    configSyncStatus.value.connected = true;
  });

  configSocket.on('disconnect', (reason) => {
    console.warn('❌ 与配置服务器的WebSocket连接断开, 原因:', reason);
    showToast('🔌 实时同步已断开', 'warning', 4000);
    configSyncStatus.value.connected = false;
    
    // 如果是意外断开（非用户主动），尝试重连
    if (reason !== 'io client disconnect') {
      console.log('🔄 准备重新连接...');
      setTimeout(() => {
        if (!configSocket.connected) {
          console.log('🔄 尝试重新连接到配置服务器...');
          configSocket.connect();
        }
      }, 3000);
    }
  });

  configSocket.on('connect_error', (err) => {
    console.error('WebSocket连接错误:', err.message);
    configSyncStatus.value.connected = false;
    showToast(`❌ 连接错误: ${err.message}`, 'error', 5000);
  });

  // 添加更多事件监听，帮助诊断问题
  configSocket.on('reconnect', (attemptNumber) => {
    console.log('🔄 WebSocket重连成功, 尝试次数:', attemptNumber);
    showToast('✅ 实时同步已重新连接', 'success', 3000);
  });

  configSocket.on('reconnect_attempt', (attemptNumber) => {
    console.log('🔄 正在尝试重连, 第', attemptNumber, '次');
  });

  configSocket.on('reconnect_error', (err) => {
    console.error('❌ 重连失败:', err.message);
  });

  configSocket.on('reconnect_failed', () => {
    console.error('❌ 重连失败，已达到最大尝试次数');
    showToast('❌ 实时同步连接失败，请检查网络', 'error', 8000);
  });

  // 添加错误处理，防止WebSocket错误影响应用
  configSocket.on('error', (error) => {
    console.error('❌ WebSocket发生错误:', error);
    // 不显示Toast，避免过多错误提示
  });

  // 添加连接健康检查
  const healthCheckInterval = setInterval(() => {
    if (configSocket && configSocket.connected) {
      try {
        configSocket.emit('ping', { timestamp: Date.now() });
      } catch (error) {
        console.warn('⚠️ 发送心跳失败:', error);
      }
    }
  }, 30000); // 每30秒发送一次心跳

  // 清理函数
  configSocket.on('disconnect', () => {
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
    }
  });

  // 3. 监听配置更新事件
  configSocket.on('config:changed', async (changeMsg) => {
    console.log('📡 收到配置变更通知:', changeMsg);

    // 忽略自己发送的变更
    const myDeviceId = localStorage.getItem('dashboardId');
    if (changeMsg.sourceDeviceId === myDeviceId) {
      return;
    }

    showToast(`🔄 检测到远程配置更新: ${changeMsg.name}`, 'info', 4000);

    try {
      const resp = await fetch(`${CONFIG_SERVER_URL}/api/configs/${changeMsg.id}`);
      const result = await resp.json();

      if (result.success && result.data && result.data.settings) {
        // 使用 nextTick 确保 Vue 已经完成当前渲染任务
        await nextTick();
        await applyConfigSilently(result.data.settings, true);
        configSyncStatus.value.lastSync = new Date().toISOString();
        console.log('✅ 已加载并应用远程配置:', result.data.name);
        showToast(`✅ 已应用配置: ${result.data.name}`, 'success', 3000);
      } else {
        console.warn('⚠️ 拉取配置失败或返回空:', result);
      }
    } catch (err) {
      console.error('❌ 拉取远程配置时发生错误:', err);
      showToast(`❌ 拉取配置失败: ${err.message}`, 'error', 6000);
    }
  });
  
  console.log('⚡️ 实时同步服务已启动');
}

// 停止实时同步
function stopRealtimeSync() {
  try {
    if (configSocket) {
      // 移除所有事件监听器，防止内存泄漏
      configSocket.removeAllListeners();
      
      // 断开连接
      configSocket.disconnect();
      configSocket = null;
  }
  
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  
    console.log('⏸️ 实时同步已停止');
  } catch (error) {
    console.error('❌ 停止实时同步时发生错误:', error);
  }
}

// 切换自动同步状态
function toggleAutoSync() {
  configSyncStatus.value.autoSyncEnabled = !configSyncStatus.value.autoSyncEnabled;
  
  if (configSyncStatus.value.autoSyncEnabled) {
    startRealtimeSync();
    showToast('🔄 自动同步已启用\n配置变更将自动保存到云端', 'success', 4000);
  } else {
    stopRealtimeSync();
    showToast('⏸️ 自动同步已禁用\n配置变更将仅保存在本地', 'warning', 4000);
  }
}

// 生成唯一设备ID
function generateDeviceId() {
  const id = 'DEVICE_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
  localStorage.setItem('dashboardId', id);
  return id;
}

// 监听布局变更
function watchLayoutChanges() {
  // 监听storage事件（其他窗口的localStorage变化）
  window.addEventListener('storage', (e) => {
    if (e.key === 'conveyorLayout' && 
        !configSyncStatus.value.syncInProgress && 
        isEditMode.value) {
      console.log('📐 检测到布局变更（其他窗口）');
      scheduleAutoSave();
    }
  });
  
  // 注意：不再需要重写localStorage.setItem，因为我们现在使用事件机制
  // ConveyorCanvas会在saveLayout后发送layout-saved事件，更加可靠
}

// 获取面板标题
function getPanelTitle() {
  switch (tvEditState.value.currentPanel) {
    case 'zoom': return '🔍 视图控制';
    case 'background': return '🎨 背景设置';
    case 'sync': return '☁️ 云端同步';
    default: return '📺 电视编辑模式';
  }
}

// 页面加载时初始化
onMounted(async () => {
  // 恢复背景色设置
  loadBackgroundColor();
  
  // 生成设备ID（如果不存在）
  if (!localStorage.getItem('dashboardId')) {
    generateDeviceId();
  }
  
  // 监听布局变更
  watchLayoutChanges();
  
  // 初始化电视模式控制
  if (isTVMode.value) {
    setupTVKeyboardControls();
    console.log('📺 检测到电视/大屏环境，启用电视模式控制');
  }
  
  // 延迟启动自动同步，等待页面完全加载
  setTimeout(async () => {
    await startRealtimeSync();
  }, 1000);
  
  // 添加点击外部关闭背景色选择器的事件监听
  document.addEventListener('click', handleClickOutside);
});

// 清理事件监听器
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  stopRealtimeSync(); // 停止实时同步
});

// 检测是否为电视/大屏环境
const isTVMode = computed(() => {
  return window.innerWidth >= 2560 || window.innerHeight >= 1440;
});

// 电视模式的编辑状态
const tvEditState = ref({
  showMainMenu: false,
  currentPanel: 'main', // 'main', 'zoom', 'background', 'sync'
  selectedIndex: 0
});

// 电视模式菜单项
const tvMenuItems = computed(() => [
  { id: 'theme', label: '切换主题', icon: themeConfig.value.themeIcon, action: toggleTheme },
  { id: 'zoom', label: '视图控制', icon: '🔍', action: () => showTVPanel('zoom') },
  { id: 'background', label: '背景设置', icon: '🎨', action: () => showTVPanel('background') },
  { id: 'sync', label: '云端同步', icon: '☁️', action: () => showTVPanel('sync') },
  { id: 'save', label: '保存布局', icon: '💾', action: handleSave },
  { id: 'reset', label: '重置布局', icon: '🔄', action: handleReset },
  { id: 'exit', label: '退出编辑', icon: '👁️', action: toggleEditMode }
]);

// 显示电视模式面板
function showTVPanel(panelName) {
  tvEditState.value.currentPanel = panelName;
  tvEditState.value.selectedIndex = 0;
}

// 返回主菜单
function backToTVMain() {
  tvEditState.value.currentPanel = 'main';
  tvEditState.value.selectedIndex = 0;
}

// 获取当前面板的项目
function getCurrentTVItems() {
  switch (tvEditState.value.currentPanel) {
    case 'zoom':
      return [
        { id: 'zoomIn', label: '放大视图', icon: '🔍', action: zoomIn },
        { id: 'zoomOut', label: '缩小视图', icon: '🔍', action: zoomOut },
        { id: 'resetZoom', label: '重置缩放', icon: '📍', action: resetZoom },
        { id: 'fitScreen', label: '适配屏幕', icon: '📐', action: fitToScreen },
        { id: 'back', label: '返回主菜单', icon: '↩️', action: backToTVMain }
      ];
    case 'background':
      return [
        { id: 'transparent', label: '透明背景', icon: '🔳', action: removeBackgroundColor },
        { id: 'preset1', label: '深蓝渐变', icon: '🌊', action: () => selectPresetColor('#2c3e50') },
        { id: 'preset2', label: '紫色渐变', icon: '🌌', action: () => selectPresetColor('#8e44ad') },
        { id: 'preset3', label: '绿色渐变', icon: '🌿', action: () => selectPresetColor('#27ae60') },
        { id: 'back', label: '返回主菜单', icon: '↩️', action: backToTVMain }
      ];
    case 'sync':
      return [
        { id: 'toggleSync', label: configSyncStatus.value.autoSyncEnabled ? '关闭自动同步' : '开启自动同步', icon: '🔄', action: toggleAutoSync },
        { id: 'save', label: '手动保存', icon: '📤', action: saveConfigToCloud },
        { id: 'load', label: '手动加载', icon: '📥', action: loadLatestConfigFromCloud },
        { id: 'check', label: '检查连接', icon: '🔄', action: checkConfigServer },
        { id: 'back', label: '返回主菜单', icon: '↩️', action: backToTVMain }
      ];
    default:
      return [];
  }
}

// 设置电视模式键盘控制
function setupTVKeyboardControls() {
  const handleTVKeyPress = (event) => {
    if (!isEditMode.value || !isTVMode.value) return;
    
    const currentItems = tvEditState.value.currentPanel === 'main' ? tvMenuItems.value : getCurrentTVItems();
    
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        tvEditState.value.selectedIndex = Math.max(0, tvEditState.value.selectedIndex - 1);
        break;
        
      case 'ArrowDown':
        event.preventDefault();
        tvEditState.value.selectedIndex = Math.min(currentItems.length - 1, tvEditState.value.selectedIndex + 1);
        break;
        
      case 'Enter':
        event.preventDefault();
        if (currentItems[tvEditState.value.selectedIndex]) {
          currentItems[tvEditState.value.selectedIndex].action();
        }
        break;
        
      case 'ArrowLeft':
        event.preventDefault();
        if (tvEditState.value.currentPanel !== 'main') {
          backToTVMain();
        }
        break;
        
      case 'Escape':
        event.preventDefault();
        toggleEditMode();
        break;
        
      case 'm':
      case 'M':
        event.preventDefault();
        if (tvEditState.value.currentPanel !== 'main') {
          backToTVMain();
        }
        break;
    }
  };
  
  document.addEventListener('keydown', handleTVKeyPress);
  
  // 返回清理函数
  return () => {
    document.removeEventListener('keydown', handleTVKeyPress);
  };
}
</script>

<template>
  <div class="dashboard-container" :style="{ background: themeConfig.background }">
    <!-- Toast通知区域 -->
    <div class="toast-container">
      <div 
        v-for="toast in toasts" 
        :key="toast.id"
        :class="['toast', `toast-${toast.type}`, { 'toast-hide': !toast.visible }]"
        @click="hideToast(toast.id)"
      >
        <div class="toast-content">
          <div class="toast-message">{{ toast.message }}</div>
          <button class="toast-close" @click.stop="hideToast(toast.id)">×</button>
        </div>
      </div>
    </div>

    <!-- Layer 1: The Konva Canvas (background) -->
    <ConveyorCanvas 
      ref="canvasRef" 
      :is-edit-mode="isEditMode" 
      :theme-config="themeConfig"
      @package-update="handlePackageUpdate"
      @toggle-edit-mode="toggleEditMode"
      @layout-saved="handleLayoutSaved"
    />

    <!-- Layer 2: Modern UI Overlay -->
    <div class="ui-overlay">
      <!-- 电视模式编辑界面 -->
      <div v-if="isEditMode && isTVMode" class="tv-edit-overlay">
        <!-- 主菜单 -->
        <div v-if="tvEditState.currentPanel === 'main'" class="tv-main-menu">
          <div class="tv-menu-header">
            <h2>📺 电视编辑模式</h2>
            <p>使用方向键导航，回车键确认，M键显示/隐藏菜单</p>
          </div>
          <div class="tv-menu-grid">
            <div 
              v-for="(item, index) in tvMenuItems" 
              :key="item.id"
              :class="['tv-menu-item', { 'tv-selected': tvEditState.selectedIndex === index }]"
              @click="item.action"
            >
              <div class="tv-menu-icon">{{ item.icon }}</div>
              <div class="tv-menu-label">{{ item.label }}</div>
            </div>
          </div>
        </div>

        <!-- 子面板 -->
        <div v-else class="tv-sub-panel">
          <div class="tv-panel-header">
            <h3>{{ getPanelTitle() }}</h3>
            <p>使用方向键选择，回车键确认，左键返回</p>
          </div>
          <div class="tv-panel-items">
            <div 
              v-for="(item, index) in getCurrentTVItems()" 
              :key="item.id"
              :class="['tv-panel-item', { 'tv-selected': tvEditState.selectedIndex === index }]"
              @click="item.action"
            >
              <span class="tv-item-icon">{{ item.icon }}</span>
              <span class="tv-item-label">{{ item.label }}</span>
            </div>
          </div>
        </div>

        <!-- 操作提示 -->
        <div class="tv-help-bar">
          <div class="tv-help-item">
            <span class="tv-key">↑↓</span>
            <span>选择</span>
          </div>
          <div class="tv-help-item">
            <span class="tv-key">Enter</span>
            <span>确认</span>
          </div>
          <div class="tv-help-item">
            <span class="tv-key">←</span>
            <span>返回</span>
          </div>
          <div class="tv-help-item">
            <span class="tv-key">M</span>
            <span>菜单</span>
          </div>
          <div class="tv-help-item">
            <span class="tv-key">Esc</span>
            <span>退出</span>
          </div>
        </div>
      </div>

      <!-- 普通模式控制面板 -->
      <div v-if="!isTVMode" class="control-panel-container">
        <!-- 触发区域 -->
        <div class="control-trigger"></div>
        
        <!-- Control Panel -->
        <div class="control-panel" :style="{ 
          background: themeConfig.panelBg, 
          color: themeConfig.textColor,
          borderColor: themeConfig.borderColor 
        }">
          <div class="panel-header">
            <h3>🏭 仓储监控系统</h3>
            <div class="status-indicator">
              <div class="status-dot" :class="{ 
                active: !wsConnected,
                connected: wsConnected 
              }" :style="{ background: getStatusColor() }"></div>
              <span>{{ getStatusText() }}</span>
            </div>
          </div>
          
          <div class="control-buttons">
            <button @click="toggleTheme" class="control-btn theme">
              <span class="btn-icon">{{ themeConfig.themeIcon }}</span>
              切换主题
            </button>
            
            <button @click="toggleEditMode" class="control-btn" :class="{ active: isEditMode }">
              <span class="btn-icon">{{ isEditMode ? '👁️' : '✏️' }}</span>
              {{ isEditMode ? '退出编辑' : '编辑布局' }}
            </button>
            
            <!-- 缩放控制组 -->
            <div v-if="isEditMode" class="zoom-controls">
              <div class="control-group-title">🔍 视图控制</div>
              <div class="button-row">
                <button @click="zoomIn" class="control-btn mini">
                  <span class="btn-icon">🔍</span>
                  放大
                </button>
                <button @click="zoomOut" class="control-btn mini">
                  <span class="btn-icon">🔍</span>
                  缩小
                </button>
              </div>
              <div class="button-row">
                <button @click="resetZoom" class="control-btn mini">
                  <span class="btn-icon">📍</span>
                  重置
                </button>
                <button @click="fitToScreen" class="control-btn mini">
                  <span class="btn-icon">📐</span>
                  适配
                </button>
              </div>
            </div>
            
            <!-- 背景色控制组 -->
            <div v-if="isEditMode" class="background-controls">
              <div class="control-group-title">🎨 背景设置</div>
              <button @click="toggleBackgroundPicker" class="control-btn mini" :class="{ active: showBackgroundPicker }">
                <span class="btn-icon">🎨</span>
                背景色
              </button>
              
              <!-- 背景色选择器 -->
              <div v-if="showBackgroundPicker" class="color-picker-panel">
                <!-- 透明背景按钮 -->
                <button @click="removeBackgroundColor" class="white-bg-btn">
                  <span class="btn-icon">🔳</span>
                  透明背景
                </button>
                
                <!-- 自定义颜色选择器 -->
                <div class="custom-color-row">
                  <label for="customColor" class="color-label">自定义:</label>
                  <input 
                    id="customColor"
                    type="color" 
                    :value="customBackgroundColor || '#2c3e50'"
                    @change="handleCustomColorChange"
                    class="custom-color-input"
                  />
                </div>
                
                <!-- 预设色卡 -->
                <div class="preset-colors-title">预设色卡:</div>
                <div class="preset-colors-grid">
                  <button
                    v-for="color in presetColors"
                    :key="color"
                    @click="selectPresetColor(color)"
                    class="preset-color-btn"
                    :style="{ backgroundColor: color }"
                    :class="{ selected: customBackgroundColor === color }"
                    :title="color"
                  ></button>
                </div>
              </div>
            </div>

            <!-- 云端配置同步控制组 -->
            <div v-if="isEditMode" class="sync-controls">
              <div class="control-group-title">
                ☁️ 云端同步
                <span class="sync-status" :class="{ connected: configSyncStatus.connected }">
                  {{ configSyncStatus.connected ? '已连接' : '离线' }}
                </span>
              </div>
              
              <!-- 自动同步开关 -->
              <div class="auto-sync-toggle">
                <label class="toggle-label">
                  <input 
                    type="checkbox" 
                    v-model="configSyncStatus.autoSyncEnabled" 
                    @change="toggleAutoSync"
                    class="toggle-input"
                  />
                  <span class="toggle-slider"></span>
                  <span class="toggle-text">
                    {{ configSyncStatus.autoSyncEnabled ? '🔄 自动同步已开启' : '⏸️ 自动同步已关闭' }}
                  </span>
                </label>
              </div>

              <!-- 同步状态指示 -->
              <div v-if="configSyncStatus.autoSyncEnabled" class="auto-sync-status">
                <div v-if="configSyncStatus.syncInProgress" class="sync-indicator syncing">
                  🔄 正在同步...
                </div>
                <div v-else-if="configSyncStatus.lastAutoSave" class="sync-indicator idle">
                  ✅ 自动同步活跃
                </div>
              </div>
              
              <!-- 手动操作按钮 -->
              <div class="button-row">
                <button @click="saveConfigToCloud" class="control-btn mini" :disabled="!configSyncStatus.connected">
                  <span class="btn-icon">📤</span>
                  手动保存
                </button>
                <button @click="loadLatestConfigFromCloud" class="control-btn mini" :disabled="!configSyncStatus.connected">
                  <span class="btn-icon">📥</span>
                  手动加载
                </button>
              </div>
              <div class="button-row">
                <button @click="selectConfigFromList" class="control-btn mini" :disabled="!configSyncStatus.connected">
                  <span class="btn-icon">📋</span>
                  选择配置
                </button>
                <button @click="checkConfigServer" class="control-btn mini">
                  <span class="btn-icon">🔄</span>
                  检查连接
                </button>
              </div>
              
              <!-- 同步信息 -->
              <div v-if="configSyncStatus.lastSync" class="sync-info">
                上次同步: {{ new Date(configSyncStatus.lastSync).toLocaleString() }}
              </div>
              <div v-if="configSyncStatus.autoSyncEnabled && configSyncStatus.lastAutoSave" class="sync-info">
                自动保存: {{ new Date(configSyncStatus.lastAutoSave).toLocaleString() }}
              </div>
            </div>
            
            <button @click="handleSave" class="control-btn save">
              <span class="btn-icon">💾</span>
              保存布局
            </button>
            
            <button @click="handleReset" class="control-btn danger">
              <span class="btn-icon">🔄</span>
              重置布局
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-container {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  transition: background 0.5s ease;
}

.ui-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

/* Control Panel Container - 贴边隐藏 */
.control-panel-container {
  position: absolute;
  top: 20px;
  right: 0;
  width: 320px;
  height: auto;
  pointer-events: auto;
  z-index: 1000;
  transform: translateX(280px); /* 默认完全隐藏，只露出40px触发区域 */
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.control-panel-container:hover {
  transform: translateX(0); /* 悬浮时完全显示 */
}

/* 触发区域 - 完全隐形 */
.control-trigger {
  position: absolute;
  top: 0;
  left: 0;
  width: 40px;
  height: 100%;
  background: transparent;
  cursor: pointer;
  z-index: 1001;
}

/* Control Panel */
.control-panel {
  position: relative;
  top: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 16px 0 0 16px; /* 只有左侧圆角 */
  padding: 20px;
  box-shadow: -4px 8px 32px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-right: none; /* 移除右边框 */
  min-width: 280px;
  margin-left: 20px;
}

.panel-header {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
}

.panel-header h3 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 16px;
  font-weight: 600;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #7f8c8d;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #95a5a6;
}

.status-dot.connected {
  background: #27ae60;
  animation: pulse 2s infinite;
}

.status-dot.active {
  background: #e74c3c;
  animation: blink 1s infinite;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
}

@keyframes blink {
  0% { opacity: 1; }
  50% { opacity: 0.3; }
  100% { opacity: 1; }
}

.control-buttons {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  background: #f8f9fa;
  color: #2c3e50;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
  text-align: left;
}

.control-btn:hover {
  background: #e9ecef;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.control-btn.active {
  background: #3498db;
  color: white;
}

.control-btn.save {
  background: #27ae60;
  color: white;
}

.control-btn.save:hover {
  background: #219a52;
}

.control-btn.danger {
  background: #e74c3c;
  color: white;
}

.control-btn.danger:hover {
  background: #c0392b;
}

.control-btn.theme {
  background: linear-gradient(45deg, #f39c12, #e67e22);
  color: white;
}

.control-btn.theme:hover {
  background: linear-gradient(45deg, #e67e22, #d35400);
}

.btn-icon {
  font-size: 16px;
}

/* 缩放控制组样式 */
.zoom-controls {
  margin: 12px 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.control-group-title {
  font-size: 12px;
  font-weight: 600;
  color: #666;
  margin-bottom: 8px;
  text-align: center;
}

.button-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.button-row:last-child {
  margin-bottom: 0;
}

.control-btn.mini {
  flex: 1;
  padding: 8px 12px;
  font-size: 12px;
  min-height: auto;
}

.control-btn.mini .btn-icon {
  font-size: 14px;
}

/* 背景色控制组样式 */
.background-controls {
  margin: 12px 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

/* 云端同步控制组样式 */
.sync-controls {
  margin: 12px 0;
  padding: 12px;
  background: rgba(52, 152, 219, 0.1);
  border-radius: 8px;
  border: 1px solid rgba(52, 152, 219, 0.2);
}

.sync-status {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 8px;
  background: rgba(231, 76, 60, 0.2);
  color: #e74c3c;
}

.sync-status.connected {
  background: rgba(39, 174, 96, 0.2);
  color: #27ae60;
}

.sync-info {
  font-size: 10px;
  color: #666;
  margin-top: 8px;
  text-align: center;
  font-style: italic;
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

/* 自动同步开关样式 */
.auto-sync-toggle {
  margin: 10px 0;
  padding: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.toggle-label {
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.toggle-input {
  display: none;
}

.toggle-slider {
  position: relative;
  width: 36px;
  height: 20px;
  background: #ccc;
  border-radius: 20px;
  margin-right: 10px;
  transition: background 0.3s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s;
}

.toggle-input:checked + .toggle-slider {
  background: #27ae60;
}

.toggle-input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.toggle-text {
  font-size: 12px;
  font-weight: 500;
}

/* 自动同步状态指示器 */
.auto-sync-status {
  margin: 8px 0;
  text-align: center;
}

.sync-indicator {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.sync-indicator.syncing {
  background: rgba(52, 152, 219, 0.2);
  color: #3498db;
  animation: pulse 1.5s infinite;
}

.sync-indicator.idle {
  background: rgba(39, 174, 96, 0.2);
  color: #27ae60;
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.6; }
  100% { opacity: 1; }
}

.color-picker-panel {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.15);
}

.white-bg-btn {
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px solid #dee2e6;
  border-radius: 6px;
  background: #ffffff;
  color: #2c3e50;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.white-bg-btn:hover {
  background: #f8f9fa;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.custom-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.color-label {
  font-size: 11px;
  font-weight: 500;
  color: #555;
  min-width: 45px;
}

.custom-color-input {
  width: 40px;
  height: 25px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  flex: 1;
  background: none;
}

.preset-colors-title {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  margin-bottom: 8px;
}

.preset-colors-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 6px;
}

.preset-color-btn {
  width: 26px;
  height: 26px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

/* 为白色系色卡添加浅色边框，确保在浅色面板上可见 */
.preset-color-btn[style*="#ffffff"],
.preset-color-btn[style*="#f8f9fa"],
.preset-color-btn[style*="#e9ecef"] {
  border-color: #dee2e6;
}

.preset-color-btn:hover {
  transform: scale(1.1);
  border-color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.preset-color-btn.selected {
  border-color: #fff;
  transform: scale(1.05);
  box-shadow: 0 0 0 2px #3498db, 0 2px 8px rgba(0, 0, 0, 0.3);
}

.preset-color-btn.selected::after {
  content: '✓';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-size: 12px;
  font-weight: bold;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
}

/* 为白色系色卡的选中状态设置深色勾号 */
.preset-color-btn.selected[style*="#ffffff"]::after,
.preset-color-btn.selected[style*="#f8f9fa"]::after,
.preset-color-btn.selected[style*="#e9ecef"]::after {
  color: #2c3e50;
  text-shadow: 0 0 2px rgba(255, 255, 255, 0.8);
}

/* Toast通知样式 */
.toast-container {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 90vw;
  width: 400px;
}

.toast {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  pointer-events: auto;
  cursor: pointer;
  transform: translateY(0);
  opacity: 1;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  animation: toastSlideIn 0.3s ease-out;
}

.toast-hide {
  transform: translateY(-20px);
  opacity: 0;
  pointer-events: none;
}

.toast-content {
  padding: 16px 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.toast-message {
  flex: 1;
  font-size: 14px;
  line-height: 1.4;
  color: #2c3e50;
  white-space: pre-line;
  word-break: break-word;
}

.toast-close {
  background: none;
  border: none;
  font-size: 18px;
  color: #7f8c8d;
  cursor: pointer;
  padding: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.toast-close:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #2c3e50;
}

/* Toast类型样式 */
.toast-success {
  border-left: 4px solid #27ae60;
}

.toast-success .toast-message {
  color: #27ae60;
}

.toast-error {
  border-left: 4px solid #e74c3c;
}

.toast-error .toast-message {
  color: #e74c3c;
}

.toast-warning {
  border-left: 4px solid #f39c12;
}

.toast-warning .toast-message {
  color: #f39c12;
}

.toast-info {
  border-left: 4px solid #3498db;
}

.toast-info .toast-message {
  color: #3498db;
}

/* Toast动画 */
@keyframes toastSlideIn {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* 移动端优化 */
@media (max-width: 768px) {
  .toast-container {
    top: 10px;
    left: 10px;
    right: 10px;
    transform: none;
    width: auto;
    max-width: none;
  }
  
  .toast-content {
    padding: 12px 16px;
  }
  
  .toast-message {
    font-size: 13px;
  }
}

/* 大屏优化 - 适配1920x1080及以上分辨率 */
@media (min-width: 1920px) {
  .control-panel {
    min-width: 360px;
    padding: 24px;
  }
  
  .panel-header h3 {
    font-size: 18px;
  }
  
  .control-btn {
    padding: 14px 18px;
    font-size: 16px;
  }
  
  .btn-icon {
    font-size: 18px;
  }
  
  .control-group-title {
    font-size: 14px;
  }
  
  .sync-info {
    font-size: 12px;
  }
  
  .toggle-text {
    font-size: 14px;
  }
  
  .toggle-slider {
    width: 42px;
    height: 24px;
  }
  
  .toggle-slider::before {
    width: 20px;
    height: 20px;
  }
  
  .toggle-input:checked + .toggle-slider::before {
    transform: translateX(18px);
  }
  
  .zoom-controls, .background-controls, .sync-controls {
    padding: 16px;
  }
}

/* 超宽屏优化 - 适配3048x2160及类似超宽分辨率 */
@media (min-width: 2560px) {
  .control-panel-container {
    width: 420px;
    transform: translateX(370px); /* 调整隐藏位置 */
  }
  
  .control-panel {
    min-width: 400px;
    padding: 32px;
    border-radius: 20px 0 0 20px;
  }
  
  .panel-header h3 {
    font-size: 22px;
    margin-bottom: 12px;
  }
  
  .status-indicator {
    font-size: 14px;
  }
  
  .status-dot {
    width: 10px;
    height: 10px;
  }
  
  .control-btn {
    padding: 16px 22px;
    font-size: 18px;
    margin-bottom: 10px;
    border-radius: 10px;
  }
  
  .control-btn.mini {
    padding: 12px 16px;
    font-size: 16px;
  }
  
  .btn-icon {
    font-size: 22px;
  }
  
  .control-group-title {
    font-size: 16px;
    margin-bottom: 12px;
  }
  
  .zoom-controls, .background-controls, .sync-controls {
    padding: 20px;
    margin: 16px 0;
    border-radius: 12px;
  }
  
  .button-row {
    gap: 8px;
    margin-bottom: 8px;
  }
  
  .toggle-slider {
    width: 48px;
    height: 28px;
  }
  
  .toggle-slider::before {
    width: 24px;
    height: 24px;
  }
  
  .toggle-input:checked + .toggle-slider::before {
    transform: translateX(20px);
  }
  
  .toggle-text {
    font-size: 16px;
  }
  
  .sync-info {
    font-size: 14px;
  }
  
  .auto-sync-toggle {
    padding: 12px;
    margin: 12px 0;
  }
  
  .preset-colors-grid {
    grid-template-columns: repeat(9, 1fr);
    gap: 8px;
  }
  
  .preset-color-btn {
    width: 32px;
    height: 32px;
  }
  
  .custom-color-input {
    width: 50px;
    height: 30px;
  }
  
  .white-bg-btn {
    padding: 12px 16px;
    font-size: 14px;
  }
}

/* 电视模式样式 */
.tv-edit-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.tv-main-menu {
  text-align: center;
  max-width: 90%;
}

.tv-menu-header {
  margin-bottom: 60px;
}

.tv-menu-header h2 {
  font-size: 48px;
  margin: 0 0 20px 0;
}

.tv-menu-header p {
  font-size: 24px;
  color: #ccc;
  margin: 0;
}

.tv-menu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 30px;
  max-width: 1200px;
}

.tv-menu-item {
  background: rgba(255, 255, 255, 0.1);
  border: 3px solid transparent;
  border-radius: 20px;
  padding: 40px 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
}

.tv-menu-item:hover,
.tv-menu-item.tv-selected {
  background: rgba(255, 255, 255, 0.2);
  border-color: #4CAF50;
  transform: scale(1.05);
  box-shadow: 0 10px 30px rgba(76, 175, 80, 0.3);
}

.tv-menu-icon {
  font-size: 64px;
  margin-bottom: 20px;
}

.tv-menu-label {
  font-size: 28px;
  font-weight: bold;
}

.tv-sub-panel {
  text-align: center;
  max-width: 800px;
}

.tv-panel-header {
  margin-bottom: 40px;
}

.tv-panel-header h3 {
  font-size: 36px;
  margin: 0 0 15px 0;
}

.tv-panel-header p {
  font-size: 20px;
  color: #ccc;
  margin: 0;
}

.tv-panel-items {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.tv-panel-item {
  background: rgba(255, 255, 255, 0.1);
  border: 3px solid transparent;
  border-radius: 15px;
  padding: 25px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.tv-panel-item:hover,
.tv-panel-item.tv-selected {
  background: rgba(255, 255, 255, 0.2);
  border-color: #4CAF50;
  transform: translateX(10px);
}

.tv-item-icon {
  font-size: 32px;
  margin-right: 20px;
  min-width: 50px;
}

.tv-item-label {
  font-size: 24px;
  font-weight: bold;
}

.tv-help-bar {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 40px;
  background: rgba(0, 0, 0, 0.8);
  padding: 20px 40px;
  border-radius: 15px;
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.tv-help-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.tv-key {
  background: #4CAF50;
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: bold;
  font-size: 16px;
  min-width: 50px;
  text-align: center;
}

.tv-help-item span:last-child {
  font-size: 14px;
  color: #ccc;
}

/* 移动端优化 */
@media (max-width: 768px) {
  .toast-container {
    top: 10px;
    left: 10px;
    right: 10px;
    transform: none;
    width: auto;
    max-width: none;
  }
  
  .toast-content {
    padding: 12px 16px;
  }
  
  .toast-message {
    font-size: 13px;
  }
  
  .tv-edit-overlay {
    padding: 20px;
  }
  
  .tv-menu-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  
  .tv-menu-item {
    padding: 30px 15px;
  }
  
  .tv-menu-icon {
    font-size: 48px;
  }
  
  .tv-menu-label {
    font-size: 24px;
  }
}

</style>
