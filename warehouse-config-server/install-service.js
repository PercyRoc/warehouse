const Service = require('node-windows').Service;
const path = require('path');

console.log('正在安装仓储配置管理服务...');

// 创建服务对象
const svc = new Service({
  name: 'WarehouseConfigServer',
  description: '仓储监控系统配置管理服务 - 提供跨浏览器配置同步功能',
  script: path.join(__dirname, 'server.js'),
  env: [
    {
      name: "NODE_ENV",
      value: "production"
    },
    {
      name: "PORT", 
      value: "3001"
    }
  ],
  wait: 2,
  grow: 0.5,
  maxRestarts: 10, // 最大重启次数
  abortOnError: false, // 出错时不中止
  logpath: path.join(__dirname, 'logs'),
  logOnAs: {
    domain: '',
    account: '', 
    password: ''
  }
});

// 监听安装完成事件
svc.on('install', function() {
  console.log('✅ 服务安装成功！');
  console.log('🚀 正在启动服务...');
  
  // 安装完成后自动启动服务
  svc.start();
});

// 监听服务启动事件
svc.on('start', function() {
  console.log('🎉 服务启动成功！');
  console.log('📋 服务详情:');
  console.log(`   - 服务名称: ${svc.name}`);
  console.log(`   - 描述: ${svc.description}`);
  console.log(`   - 脚本路径: ${svc.script}`);
  console.log(`   - 服务端口: http://localhost:3001`);
  console.log('');
  console.log('✨ 配置管理服务现在将在系统启动时自动运行！');
  console.log('');
  console.log('📝 管理命令:');
  console.log('   - 查看服务状态: services.msc (搜索 WarehouseConfigServer)');
  console.log('   - 停止服务: net stop WarehouseConfigServer');
  console.log('   - 启动服务: net start WarehouseConfigServer');
  console.log('   - 卸载服务: node uninstall-service.js');
  console.log('');
  
  // 等待几秒后退出
  setTimeout(() => {
    process.exit(0);
  }, 2000);
});

// 监听错误事件
svc.on('error', function(err) {
  console.error('❌ 服务安装失败:', err);
  process.exit(1);
});

// 检查服务是否已经存在
svc.on('alreadyinstalled', function() {
  console.log('⚠️ 服务已经安装过了！');
  console.log('如需重新安装，请先运行: node uninstall-service.js');
  process.exit(1);
});

console.log('⏳ 正在检查依赖和权限...');
console.log('💡 注意: 此操作需要管理员权限，请确保以管理员身份运行！');

// 安装服务
svc.install(); 