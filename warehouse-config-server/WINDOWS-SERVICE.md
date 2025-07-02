# Windows服务自启配置指南

本指南提供多种方式在Windows系统上配置配置管理服务开机自启。

## 🚀 方案1：Windows服务方式（推荐）

### 特点
- ✅ 后台运行，不依赖用户登录
- ✅ 自动重启，故障恢复能力强
- ✅ 统一的服务管理界面
- ✅ 完整的日志记录

### 安装步骤

#### 方法A：使用批处理脚本（推荐）
1. **以管理员身份运行**：右键点击 `install-service-admin.bat` → "以管理员身份运行"
2. 等待安装完成

#### 方法B：手动安装
1. **安装依赖**：
   ```bash
   npm install
   ```

2. **以管理员身份运行PowerShell/CMD**，执行：
   ```bash
   node install-service.js
   ```

### 服务管理

#### 查看服务状态
- **图形界面**：Win+R → 输入 `services.msc` → 查找 "WarehouseConfigServer"
- **命令行**：
  ```bash
  sc query WarehouseConfigServer
  # 或
  npm run service-status
  ```

#### 启动/停止服务
```bash
# 启动服务
net start WarehouseConfigServer

# 停止服务
net stop WarehouseConfigServer

# 重启服务
net stop WarehouseConfigServer && net start WarehouseConfigServer
```

#### 卸载服务
- **批处理脚本**：以管理员身份运行 `uninstall-service-admin.bat`
- **手动卸载**：
  ```bash
  node uninstall-service.js
  ```

### 服务配置

服务安装后的配置信息：
- **服务名称**：WarehouseConfigServer
- **显示名称**：WarehouseConfigServer
- **描述**：仓储监控系统配置管理服务 - 提供跨浏览器配置同步功能
- **启动类型**：自动
- **服务端口**：3001
- **日志目录**：`./logs/`

### 故障排除

#### 常见问题

1. **权限不足**
   ```
   错误：Access is denied
   解决：确保以管理员身份运行安装脚本
   ```

2. **端口占用**
   ```bash
   # 检查端口占用
   netstat -ano | findstr 3001
   
   # 修改端口（可选）
   # 编辑 install-service.js 中的 PORT 环境变量
   ```

3. **Node.js未找到**
   ```
   错误：'node' 不是内部或外部命令
   解决：确保Node.js已正确安装并添加到PATH环境变量
   ```

4. **服务启动失败**
   ```bash
   # 查看服务日志
   type logs\WarehouseConfigServer.err.log
   type logs\WarehouseConfigServer.out.log
   ```

#### 手动检查服务状态
```bash
# 检查服务是否存在
sc query WarehouseConfigServer

# 检查端口是否监听
netstat -ano | findstr 3001

# 测试服务响应
curl http://localhost:3001/health
```

## 📋 方案2：任务计划程序方式

### 适用场景
- 需要在特定用户登录时启动
- 不需要系统级别的服务权限

### 设置步骤
1. **打开任务计划程序**：Win+R → `taskschd.msc`
2. **创建基本任务**：
   - 名称：`WarehouseConfigServer`
   - 描述：`仓储配置管理服务`
3. **触发器**：选择"计算机启动时"
4. **操作**：选择"启动程序"
   - 程序：`node.exe`
   - 参数：`server.js`
   - 起始位置：`D:\Projects\warehouse\warehouse-config-server`
5. **设置**：勾选"如果意外停止，重新启动"

### 管理命令
```bash
# 启用任务
schtasks /change /tn "WarehouseConfigServer" /enable

# 禁用任务
schtasks /change /tn "WarehouseConfigServer" /disable

# 手动运行任务
schtasks /run /tn "WarehouseConfigServer"

# 删除任务
schtasks /delete /tn "WarehouseConfigServer"
```

## 🔄 方案3：启动文件夹方式

### 适用场景
- 简单快速的用户级自启
- 仅在用户登录时启动

### 设置步骤
1. **创建启动脚本** `startup.bat`：
   ```batch
   @echo off
   cd /d "D:\Projects\warehouse\warehouse-config-server"
   npm start
   ```

2. **复制到启动文件夹**：
   - 按 Win+R → 输入 `shell:startup`
   - 将 `startup.bat` 复制到打开的文件夹

3. **设置权限**：确保脚本有执行权限

## 📊 对比总结

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Windows服务** | 稳定可靠、自动重启、后台运行 | 需要管理员权限 | ⭐⭐⭐⭐⭐ |
| **任务计划程序** | 灵活配置、无需登录 | 配置复杂、重启能力有限 | ⭐⭐⭐ |
| **启动文件夹** | 简单易用 | 依赖用户登录、稳定性差 | ⭐⭐ |

## 🎯 推荐配置

**生产环境**：使用Windows服务方式
**开发环境**：使用任务计划程序或启动文件夹
**测试环境**：手动启动或使用启动文件夹

## 📞 技术支持

如遇问题，请检查：
1. 管理员权限是否足够
2. Node.js环境是否正确
3. 端口3001是否被占用
4. 防火墙是否阻止了服务
5. 服务日志中的错误信息

---

💡 **建议**：首次部署建议使用批处理脚本 `install-service-admin.bat`，简单可靠！ 