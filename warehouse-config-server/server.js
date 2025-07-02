const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 在生产环境中应配置为前端的实际地址
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8, // 100 MB，增加消息大小限制
  pingTimeout: 60000,     // 60秒超时
  pingInterval: 25000     // 25秒心跳间隔
});

const PORT = process.env.PORT || 3001;

// 配置存储目录
const CONFIG_DIR = path.join(__dirname, 'configs');
const METADATA_FILE = path.join(CONFIG_DIR, '_metadata.json');

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 确保配置目录存在
async function ensureConfigDir() {
  await fs.ensureDir(CONFIG_DIR);
  
  // 初始化元数据文件
  if (!await fs.pathExists(METADATA_FILE)) {
    await fs.writeJson(METADATA_FILE, {
      version: '1.0.0',
      created: new Date().toISOString(),
      configs: {}
    });
  }
}

// 获取元数据
async function getMetadata() {
  try {
    return await fs.readJson(METADATA_FILE);
  } catch (error) {
    console.error('读取元数据失败:', error);
    return { version: '1.0.0', created: new Date().toISOString(), configs: {} };
  }
}

// 保存元数据
async function saveMetadata(metadata) {
  await fs.writeJson(METADATA_FILE, metadata, { spaces: 2 });
}

// 验证配置格式
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, error: '配置必须是一个对象' };
  }
  
  if (!config.settings) {
    return { valid: false, error: '配置缺少settings字段' };
  }
  
  return { valid: true };
}

// API路由

// 1. 获取所有配置列表
app.get('/api/configs', async (req, res) => {
  try {
    const metadata = await getMetadata();
    const configList = Object.values(metadata.configs).map(config => ({
      id: config.id,
      name: config.name,
      description: config.description,
      created: config.created,
      updated: config.updated,
      version: config.version
    }));
    
    console.log(`📋 返回配置列表: ${configList.length} 个配置`);
    res.json({
      success: true,
      data: configList,
      total: configList.length
    });
  } catch (error) {
    console.error('获取配置列表失败:', error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 2. 获取最新配置（必须在 :id 路由之前定义）
app.get('/api/configs/latest', async (req, res) => {
  try {
    console.log('🔍 请求获取最新配置');
    const metadata = await getMetadata();
    const configs = Object.values(metadata.configs);
    
    console.log(`📊 找到配置数量: ${configs.length}`);
    
    if (configs.length === 0) {
      console.log('📭 没有找到任何配置');
      return res.json({ success: true, data: null });
    }
    
    // 按更新时间排序，获取最新的
    const latestConfig = configs.sort((a, b) => 
      new Date(b.updated) - new Date(a.updated)
    )[0];
    
    console.log(`✨ 最新配置: ${latestConfig.name} (${latestConfig.id})`);
    
    // 读取完整配置
    const configPath = path.join(CONFIG_DIR, `${latestConfig.id}.json`);
    
    if (!await fs.pathExists(configPath)) {
      console.error(`❌ 配置文件不存在: ${configPath}`);
      return res.status(404).json({ success: false, error: '最新配置文件不存在' });
    }
    
    const fullConfig = await fs.readJson(configPath);
    console.log(`✅ 成功返回最新配置: ${latestConfig.name}`);
    
    res.json({ success: true, data: fullConfig });
  } catch (error) {
    console.error('获取最新配置失败:', error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 2.5. 按设备ID查找配置
app.get('/api/configs/device/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`🔍 正在按设备ID查找配置: ${deviceId}`);
    const targetName = `自动同步配置-${deviceId}`;
    
    const metadata = await getMetadata();
    const configs = Object.values(metadata.configs);
    
    const deviceConfigMeta = configs.find(c => c.name === targetName);
    
    if (!deviceConfigMeta) {
      console.log(`📭 未找到设备 ${deviceId} 的自动同步配置`);
      return res.json({ success: true, data: null, message: 'Device config not found' });
    }
    
    console.log(`✨ 找到设备配置: ${deviceConfigMeta.name} (${deviceConfigMeta.id})`);
    
    // 读取完整配置
    const configPath = path.join(CONFIG_DIR, `${deviceConfigMeta.id}.json`);
    
    if (!await fs.pathExists(configPath)) {
      console.error(`❌ 配置文件不存在，但元数据存在: ${configPath}`);
      return res.status(404).json({ success: false, error: '配置文件不存在，数据不一致' });
    }
    
    const fullConfig = await fs.readJson(configPath);
    console.log(`✅ 成功返回设备 ${deviceId} 的配置`);
    
    res.json({ success: true, data: fullConfig });
  } catch (error) {
    console.error(`按设备ID查找配置失败: ${deviceId}`, error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 3. 获取特定配置
app.get('/api/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🔍 请求获取配置: ${id}`);
    
    const configPath = path.join(CONFIG_DIR, `${id}.json`);
    
    if (!await fs.pathExists(configPath)) {
      console.log(`❌ 配置文件不存在: ${configPath}`);
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    
    const config = await fs.readJson(configPath);
    console.log(`✅ 成功返回配置: ${config.name || id}`);
    res.json({ success: true, data: config });
  } catch (error) {
    console.error('获取配置失败:', error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 4. 保存配置
app.post('/api/configs', async (req, res) => {
  try {
    const { name, description, config, sourceDeviceId } = req.body;
    
    // 验证输入
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: '配置名称不能为空' });
    }
    
    const validation = validateConfig(config);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }
    
    // 生成配置ID
    const configId = uuidv4();
    const now = new Date().toISOString();
    
    // 准备配置数据
    const configData = {
      id: configId,
      name: name.trim(),
      description: description || '',
      version: '1.0',
      created: now,
      updated: now,
      ...config
    };
    
    // 保存配置文件
    const configPath = path.join(CONFIG_DIR, `${configId}.json`);
    try {
      await fs.writeJson(configPath, configData, { spaces: 2 });
      console.log(`📝 文件写入成功: ${configPath}`);
    } catch (writeError) {
      console.error(`❌ 保存配置文件失败: ${configPath}`, writeError);
      // 即使写入失败，也继续尝试更新元数据，但这会导致不一致
      // 理想情况下应在此处返回错误，但为保持原有逻辑，仅记录错误
    }
    
    // 更新元数据
    const metadata = await getMetadata();
    metadata.configs[configId] = {
      id: configId,
      name: configData.name,
      description: configData.description,
      version: configData.version,
      created: configData.created,
      updated: configData.updated
    };
    await saveMetadata(metadata);
    
    console.log(`✅ 保存配置: ${name} (ID: ${configId})`);

    // 广播配置变更通知（方案A：仅发送精简信息）
    const changePayload = {
      id: configId,
      name: configData.name,
      version: configData.version,
      updated: configData.updated,
      sourceDeviceId
    };
    broadcastToOtherDevices('config:changed', changePayload, sourceDeviceId);
    console.log(`📢 已广播新配置通知: ${name} (排除源设备: ${sourceDeviceId || 'Unknown'})`);

    res.json({ 
      success: true, 
      data: { 
        id: configId, 
        name: configData.name,
        created: configData.created 
      } 
    });
  } catch (error) {
    console.error('保存配置失败:', error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 5. 更新配置
app.put('/api/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, config, sourceDeviceId } = req.body;
    
    const configPath = path.join(CONFIG_DIR, `${id}.json`);
    if (!await fs.pathExists(configPath)) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    
    // 验证输入
    if (config) {
      const validation = validateConfig(config);
      if (!validation.valid) {
        return res.status(400).json({ success: false, error: validation.error });
      }
    }
    
    // 读取现有配置
    const existingConfig = await fs.readJson(configPath);
    const now = new Date().toISOString();
    
    // 更新配置
    const updatedConfig = {
      ...existingConfig,
      ...(config || {}),
      id,
      name: name || existingConfig.name,
      description: description !== undefined ? description : existingConfig.description,
      updated: now
    };
    
    // 保存更新后的配置
    try {
      await fs.writeJson(configPath, updatedConfig, { spaces: 2 });
      console.log(`📝 文件更新成功: ${configPath}`);
    } catch (writeError) {
      console.error(`❌ 更新配置文件失败: ${configPath}`, writeError);
    }
    
    // 更新元数据
    const metadata = await getMetadata();
    if (metadata.configs[id]) {
      metadata.configs[id] = {
        ...metadata.configs[id],
        name: updatedConfig.name,
        description: updatedConfig.description,
        updated: updatedConfig.updated
      };
      await saveMetadata(metadata);
    }
    
    console.log(`✅ 更新配置: ${updatedConfig.name} (ID: ${id})`);

    // 广播配置变更通知（方案A：仅发送精简信息）
    const changePayload2 = {
      id: id,
      name: updatedConfig.name,
      version: updatedConfig.version || '1.0',
      updated: updatedConfig.updated,
      sourceDeviceId
    };
    broadcastToOtherDevices('config:changed', changePayload2, sourceDeviceId);
    console.log(`📢 已广播配置更新通知: ${updatedConfig.name} (排除源设备: ${sourceDeviceId || 'Unknown'})`);

    res.json({ success: true, data: { id, updated: now } });
  } catch (error) {
    console.error('更新配置失败:', error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 6. 删除配置
app.delete('/api/configs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const configPath = path.join(CONFIG_DIR, `${id}.json`);
    
    if (!await fs.pathExists(configPath)) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }
    
    // 删除配置文件
    await fs.remove(configPath);
    
    // 更新元数据
    const metadata = await getMetadata();
    const configName = metadata.configs[id]?.name || 'Unknown';
    delete metadata.configs[id];
    await saveMetadata(metadata);
    
    console.log(`🗑️ 删除配置: ${configName} (ID: ${id})`);
    res.json({ success: true, message: '配置已删除' });
  } catch (error) {
    console.error('删除配置失败:', error);
    res.status(500).json({ success: false, error: '服务器内部错误' });
  }
});

// 广播函数：向除了源设备之外的所有设备发送消息
function broadcastToOtherDevices(event, data, excludeDeviceId) {
  if (!excludeDeviceId) {
    // 如果没有指定排除设备，就广播给所有设备
    io.emit(event, data);
    return;
  }
  
  // 向除了源设备之外的所有连接的客户端发送消息
  io.sockets.sockets.forEach((socket) => {
    if (socket.deviceId !== excludeDeviceId) {
      socket.emit(event, data);
    }
  });
}

// Socket.IO 连接处理
io.on('connection', (socket) => {
  console.log(`🔌 客户端已连接: ${socket.id}`);
  
  // 监听客户端注册设备ID
  socket.on('register-device', (deviceId) => {
    socket.deviceId = deviceId;
    console.log(`📱 客户端 ${socket.id} 注册设备ID: ${deviceId}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 客户端已断开: ${socket.id} (设备: ${socket.deviceId || 'Unknown'})`);
  });
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'warehouse-config-server',
    version: '1.0.0'
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ success: false, error: '服务器内部错误' });
});

// 404处理
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'API接口不存在' });
});

// 启动服务器
async function startServer() {
  try {
    await ensureConfigDir();
    
    server.listen(PORT, () => {
      console.log(`🚀 配置管理服务器启动成功!`);
      console.log(`   - 端口: ${PORT}`);
      console.log(`   - WebSocket 实时同步已启用`);
      console.log(`   - 健康检查: http://localhost:${PORT}/health`);
      console.log(`   - API文档: http://localhost:${PORT}/api/configs`);
      console.log(`   - 配置目录: ${CONFIG_DIR}`);
    });
  } catch (error) {
    console.error('❌ 服务器启动失败:', error);
    process.exit(1);
  }
}

startServer(); 