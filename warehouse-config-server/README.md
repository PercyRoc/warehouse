# 仓储监控系统 - 配置管理服务

专门用于跨浏览器、跨设备同步仓储监控系统配置的后端服务。

## 🚀 快速开始

### 安装依赖
```bash
cd warehouse-config-server
npm install
```

### 启动服务
```bash
# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

服务将在 `http://localhost:3001` 启动。

## 📡 API接口

### 基础信息
- **基础URL**: `http://localhost:3001/api`
- **支持格式**: JSON
- **跨域**: 已启用CORS

### 接口列表

#### 1. 获取所有配置列表
```http
GET /api/configs
```

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-here",
      "name": "我的布局配置",
      "description": "包含自定义背景色和设备位置",
      "created": "2024-01-15T10:30:00.000Z",
      "updated": "2024-01-15T10:30:00.000Z",
      "version": "1.0"
    }
  ],
  "total": 1
}
```

#### 2. 获取特定配置
```http
GET /api/configs/:id
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": "uuid-here",
    "name": "我的布局配置",
    "description": "...",
    "settings": {
      "backgroundColor": "#2c3e50",
      "layout": "...",
      "isDarkMode": false
    }
  }
}
```

#### 3. 保存新配置
```http
POST /api/configs
```

**请求体**:
```json
{
  "name": "配置名称",
  "description": "可选的配置描述",
  "config": {
    "settings": {
      "backgroundColor": "#2c3e50",
      "layout": "布局JSON字符串",
      "isDarkMode": false
    }
  }
}
```

#### 4. 更新配置
```http
PUT /api/configs/:id
```

#### 5. 删除配置
```http
DELETE /api/configs/:id
```

#### 6. 获取最新配置
```http
GET /api/configs/latest
```

### 健康检查
```http
GET /health
```

## 🔧 配置与部署

### 环境变量
- `PORT`: 服务端口，默认 3001

### 数据存储
- 配置文件存储在 `./configs/` 目录
- 元数据文件: `./configs/_metadata.json`
- 每个配置一个独立的JSON文件

### 目录结构
```
warehouse-config-server/
├── server.js           # 主服务器文件
├── package.json        # 依赖配置
├── README.md          # 本文档
└── configs/           # 配置存储目录
    ├── _metadata.json # 元数据索引
    ├── uuid1.json     # 配置文件1
    └── uuid2.json     # 配置文件2
```

## 🌐 前端集成

在前端应用中，可以这样使用配置服务：

```javascript
// 保存配置
async function saveConfig(name, description, config) {
  const response = await fetch('http://localhost:3001/api/configs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, config })
  });
  return response.json();
}

// 获取配置列表
async function getConfigs() {
  const response = await fetch('http://localhost:3001/api/configs');
  return response.json();
}

// 获取最新配置
async function getLatestConfig() {
  const response = await fetch('http://localhost:3001/api/configs/latest');
  return response.json();
}
```

## 🛡️ 安全说明

当前版本为开发版本，不包含以下生产安全特性：
- 身份验证
- 访问控制
- 数据加密
- 速率限制

生产环境部署时请添加相应的安全措施。

## 📝 日志

服务器会在控制台输出以下日志：
- 配置保存/更新/删除操作
- API请求错误
- 服务器启动信息

## 🔄 版本控制

每个配置都包含版本信息，便于后续实现版本对比和回滚功能。

## 🚀 扩展功能

未来可以添加：
- 配置版本历史
- 配置分享链接
- 配置模板系统
- 批量导入/导出
- 实时配置同步（WebSocket） 