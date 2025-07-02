# Windows服务更新指南

当配置管理服务安装为Windows服务后，更新代码需要按照以下步骤进行。

## 🚀 方法一：使用更新脚本（推荐）

### 步骤：
1. **右键点击** `update-service-admin.bat`
2. **选择** "以管理员身份运行"
3. **等待** 脚本自动完成所有更新步骤

### 更新脚本会自动执行：
- ✅ 停止Windows服务
- ✅ 更新依赖包（如果需要）
- ✅ 重新启动服务
- ✅ 验证服务状态
- ✅ 测试服务连接

---

## 🛠️ 方法二：手动更新

### 1. 停止服务
```cmd
# 以管理员身份运行命令提示符
sc stop WarehouseConfigServer
```

### 2. 更新代码文件
- 直接编辑 `server.js` 或其他文件
- 或者覆盖整个项目文件夹

### 3. 更新依赖（如果需要）
```cmd
cd warehouse-config-server
npm install
```

### 4. 启动服务
```cmd
sc start WarehouseConfigServer
```

### 5. 验证服务状态
```cmd
sc query WarehouseConfigServer
```

---

## 🎛️ 方法三：使用Windows服务管理器

### 步骤：
1. **Win + R** → 输入 `services.msc` → 回车
2. **找到** "WarehouseConfigServer" 服务
3. **右键** → 选择 "停止"
4. **更新代码文件**
5. **右键** → 选择 "启动"

---

## 🔍 验证更新是否成功

### 1. 检查服务状态
```cmd
sc query WarehouseConfigServer
```
应该显示 `STATE: 4 RUNNING`

### 2. 测试健康检查
```cmd
curl http://localhost:3001/health
```
或在浏览器中访问: http://localhost:3001/health

### 3. 检查日志
查看 `logs/` 目录下的日志文件

---

## ⚠️ 常见问题

### 问题1: 服务启动失败
**解决方法:**
- 检查代码语法错误
- 查看Windows事件日志
- 检查端口3001是否被占用

### 问题2: 权限不足
**解决方法:**
- 确保以管理员身份运行批处理脚本
- 或以管理员身份运行命令提示符

### 问题3: 依赖包问题
**解决方法:**
```cmd
cd warehouse-config-server
npm ci  # 清理安装依赖
```

### 问题4: 端口被占用
**解决方法:**
```cmd
# 查找占用3001端口的进程
netstat -ano | findstr :3001

# 结束占用进程（替换<PID>为实际进程ID）
taskkill /f /pid <PID>
```

---

## 📋 重要提醒

1. **备份配置**: 更新前建议备份 `configs/` 目录
2. **测试代码**: 更新前先在开发环境测试代码
3. **服务日志**: 更新后检查日志确保正常运行
4. **依赖管理**: 如果修改了 `package.json`，记得运行 `npm install`

---

## 🔄 完整更新流程示例

```cmd
# 1. 停止服务
sc stop WarehouseConfigServer

# 2. 等待3秒
timeout /t 3

# 3. 更新依赖（如果需要）
npm install

# 4. 启动服务
sc start WarehouseConfigServer

# 5. 验证状态
sc query WarehouseConfigServer

# 6. 测试连接
curl http://localhost:3001/health
```

---

## 📞 需要帮助？

如果遇到问题，请检查：
1. Windows事件日志
2. `logs/` 目录下的服务日志
3. 确保Node.js环境正常
4. 确保端口3001未被其他程序占用 