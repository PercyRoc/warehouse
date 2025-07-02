const Service = require('node-windows').Service;
const path = require('path');

console.log('正在卸载仓储配置管理服务...');

// 创建服务对象（与安装时相同的配置）
const svc = new Service({
  name: 'WarehouseConfigServer',
  description: '仓储监控系统配置管理服务 - 提供跨浏览器配置同步功能',
  script: path.join(__dirname, 'server.js')
});

// 监听卸载完成事件
svc.on('uninstall', function() {
  console.log('✅ 服务卸载成功！');
  console.log('🔧 服务已从系统中移除，不再开机自启');
  console.log('');
  console.log('💡 如需重新安装，请运行: node install-service.js');
  
  // 等待2秒后退出
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

// 监听错误事件
svc.on('error', function(err) {
  console.error('❌ 服务卸载失败:', err);
  process.exit(1);
});

// 检查服务是否存在
svc.on('doesnotexist', function() {
  console.log('⚠️ 服务不存在或已经被卸载！');
  console.log('如需安装服务，请运行: node install-service.js');
  process.exit(0);
});

console.log('⏳ 正在停止并卸载服务...');
console.log('💡 注意: 此操作需要管理员权限，请确保以管理员身份运行！');

// 卸载服务
svc.uninstall(); 