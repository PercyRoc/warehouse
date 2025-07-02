# 仓储监控系统 - 随机分拣机制

## 📋 概述

随机分拣机制解决了后端设备只能提供简单触发信号（如`OCCH2:1`），而无法提供具体包裹条码、格口等详细信息的问题。前端接收到触发信号后，会在指定的分拣线上生成模拟包裹，并智能地随机分拣到各个摆轮。

## 🎯 设计理念

### 问题场景
- **设备限制**：许多现场设备只能发送简单的触发信号
- **信息缺失**：无法获取包裹的具体条码、目标格口等信息  
- **分拣需求**：仍需要模拟真实的分拣过程和效果

### 解决方案
- **前端智能分拣**：前端接收触发信号后自主生成分拣决策
- **随机化模拟**：通过概率算法模拟真实分拣场景
- **可配置策略**：支持不同线路的差异化分拣策略

## 🔧 技术实现

### 信号流程

```
设备信号 → 后端处理 → 前端接收 → 随机分拣 → 包裹动画
OCCH2:1     包裹创建    触发信号    智能决策    摆轮动作
```

### 后端简化处理

```javascript
// 后端只需发送基本触发信息
handleDeviceSignal(signalData) {
  const packageInfo = this.packageManager.createPackageFromSignal(
    signalData, 
    this.config.deviceConfig
  );
  
  // 发送简化的包裹报告（不包含格口信息）
  this.webSocketServer.broadcastPackageReport(
    packageInfo.packageId,
    packageInfo.sourceDeviceId,
    packageInfo.signalValue // 原始信号值
  );
}
```

### 前端智能分拣

```javascript
// 前端随机生成分拣信息
generateRandomSorterInfo(pathId) {
  // 1. 检查是否启用随机分拣
  if (!WpfConfig.randomSortingConfig.enabled) {
    return { action: 'straight' };
  }
  
  // 2. 获取路径摆轮配置
  const sorterCount = WpfConfig.pathSorterCount[pathId];
  
  // 3. 根据概率决定是否分拣
  const sortingProbability = WpfConfig.randomSortingConfig
    .pathSpecificProbability[pathId];
  const shouldSort = Math.random() < sortingProbability;
  
  // 4. 随机选择摆轮和方向
  const randomSorterIndex = Math.floor(Math.random() * sorterCount);
  const randomDirection = Math.random() < 0.5 ? 'left' : 'right';
  
  return {
    action: 'sort',
    sorterIndex: randomSorterIndex,
    direction: randomDirection,
    targetSortCode: randomSorterIndex * 2 + (randomDirection === 'left' ? 1 : 2)
  };
}
```

## ⚙️ 配置参数

### 基础配置

```javascript
// 摆轮数量配置
pathSorterCount: {
  'scan_line_1_start': 1,    // 扫码线1：1个摆轮
  'scan_line_2_start': 1,    // 扫码线2：1个摆轮
  'sku_line_1': 6,           // SKU线1：6个摆轮
  'sku_line_2': 6,           // SKU线2：6个摆轮  
  'region_sort_line': 6      // 大区线：6个摆轮
}
```

### 随机分拣配置

```javascript
randomSortingConfig: {
  enabled: true,              // 启用随机分拣
  sortingProbability: 0.8,    // 默认分拣概率80%
  leftRightBalance: 0.5,      // 左右摆轮50%平衡（仅用于无限制路径）
  
  // 路径特定概率
  pathSpecificProbability: {
    'scan_line_1_start': 0.9,   // 扫码线：90%分拣率
    'scan_line_2_start': 0.9,   
    'sku_line_1': 0.8,          // SKU线：80%分拣率
    'sku_line_2': 0.8,
    'region_sort_line': 0.7     // 大区线：70%分拣率
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
```

## 📊 分拣策略

### 负载平衡算法

系统采用智能负载平衡算法，确保每个摆轮的使用次数尽可能平均：

- **负载跟踪**：实时记录每个路径上每个摆轮的使用次数
- **平衡选择**：优先选择使用次数最少的摆轮进行分拣
- **统计报告**：每100次分拣后输出负载平衡统计信息
- **平衡度评分**：提供0-100的平衡度评分，100表示完全平均

### 概率分布

| 线路类型 | 分拣概率 | 直行概率 | 摆轮选择 | 说明 |
|----------|----------|----------|----------|------|
| 扫码复核线 | 95% | 5% | 负载平衡 | 高分拣率，确保充分验证 |
| SKU分拣线 | 95% | 5% | 负载平衡 | 高分拣率，平衡效率 |
| 大区分拣线 | 95% | 5% | 负载平衡 | 高分拣率，避免过载 |

### 方向限制策略

不同的传送带线路有不同的分拣方向限制，以符合实际生产线布局：

| 线路 | 允许方向 | 限制原因 |
|------|----------|----------|
| 扫码线1 | 仅左摆 | 左侧为A区格口 |
| 扫码线2 | 仅右摆 | 右侧为B区格口 |
| SKU线1 | 仅左摆 | 设备布局限制 |
| SKU线2 | 仅右摆 | 设备布局限制 |
| 大区线 | 左右摆轮 | 双向分拣能力 |

### 摆轮选择算法

1. **路径方向检查**：首先检查路径的分拣方向限制
2. **随机摆轮选择**：在可用摆轮中等概率随机选择
3. **方向约束应用**：根据路径限制选择分拣方向
4. **格口映射**：`格口号 = 摆轮索引 × 2 + (左摆:1, 右摆:2)`

### 示例场景

```
SKU线1 (6个摆轮，80%分拣概率，仅左摆)：
┌─────┬─────┬─────┬─────┬─────┬─────┐
│摆轮1│摆轮2│摆轮3│摆轮4│摆轮5│摆轮6│
│格口1│格口3│格口5│格口7│格口9│格口11│ ← 只能左摆分拣
│ ❌ │ ❌ │ ❌ │ ❌ │ ❌ │ ❌ │ ← 右摆被限制
└─────┴─────┴─────┴─────┴─────┴─────┘

SKU线2 (6个摆轮，80%分拣概率，仅右摆)：
┌─────┬─────┬─────┬─────┬─────┬─────┐
│摆轮1│摆轮2│摆轮3│摆轮4│摆轮5│摆轮6│
│ ❌ │ ❌ │ ❌ │ ❌ │ ❌ │ ❌ │ ← 左摆被限制
│格口2│格口4│格口6│格口8│格口10│格口12│ ← 只能右摆分拣
└─────┴─────┴─────┴─────┴─────┴─────┘

包裹分拣结果示例：
- 包裹A (SKU线1) → 摆轮3左摆 → 格口5 ✅
- 包裹B (SKU线2) → 摆轮1右摆 → 格口2 ✅ 
- 包裹C (SKU线1) → 直行通过
- 包裹D (大区线) → 摆轮6右摆 → 格口12 ✅
- 包裹E (扫码线1) → 摆轮1左摆 → 格口1 ✅
```

## 🔍 调试和监控

### 日志示例

```
📊 [负载平衡] 初始化路径 sku_line_1 摆轮使用统计 (6个摆轮)
🎯 [平衡分拣] 路径 sku_line_1 分拣到第1个摆轮左摆 (格口1) [使用1次] [概率95%] [限制:仅左摆]
🎯 [平衡分拣] 路径 sku_line_1 分拣到第2个摆轮左摆 (格口3) [使用1次] [概率95%] [限制:仅左摆]
🎯 [平衡分拣] 路径 sku_line_2 分拣到第1个摆轮右摆 (格口2) [使用1次] [概率95%] [限制:仅右摆]
📊 [负载平衡] 路径 sku_line_1 摆轮使用统计 (总计100次): 摆轮1:17次, 摆轮2:16次, 摆轮3:17次, 摆轮4:16次, 摆轮5:17次, 摆轮6:17次
```

### 前端控制台监控

```javascript
// 查看随机分拣配置
console.log(WpfConfig.randomSortingConfig);

// 查看路径摆轮配置  
console.log(WpfConfig.pathSorterCount);

// 手动触发分拣测试
webSocketClient.generateRandomSorterInfo('sku_line_1');

// 查看摆轮使用统计
webSocketClient.getSorterUsageOverview();

// 查看详细的负载平衡报告
webSocketClient.printSorterUsageReport();

// 重置摆轮使用统计
webSocketClient.resetAllSorterStats();

// 重置指定路径的统计
webSocketClient.resetPathSorterStats('sku_line_1');
```

## 🎛️ 配置优化建议

### 分拣概率调优

| 业务场景 | 推荐配置 | 理由 |
|----------|----------|------|
| **演示环境** | 90% | 高分拣率展示设备动作 |
| **测试环境** | 70% | 平衡分拣与直行测试 |
| **生产模拟** | 60-80% | 接近真实业务比例 |

### 方向限制自定义

```javascript
// 自定义方向限制配置
pathDirectionConstraints: {
  'custom_line_1': ['left'],           // 仅左分拣
  'custom_line_2': ['right'],          // 仅右分拣  
  'custom_line_3': ['left', 'right'],  // 双向分拣
  'custom_line_4': []                  // 禁止分拣（仅直行）
}
```

### 性能考量

- **高频场景**：降低分拣概率避免摆轮过载
- **低频场景**：提高分拣概率增加动作展示
- **多线并行**：均衡各线路分拣概率
- **方向约束**：避免不必要的双向分拣检查

## 🔧 高级配置

### 时间段差异化

```javascript
// 可扩展的时间段配置
timeBasedProbability: {
  peak: { // 高峰期
    hours: [9, 12, 14, 17],
    probability: 0.9
  },
  normal: { // 正常期
    probability: 0.7
  }
}
```

### 设备状态联动

```javascript
// 根据设备状态调整分拣概率
deviceStatusBasedSorting: {
  offline: { probability: 0.0 },    // 离线设备不分拣
  online: { probability: 0.8 },     // 在线设备正常分拣
  maintenance: { probability: 0.3 } // 维护设备低概率分拣
}
```

## 🚀 未来扩展

### 1. 智能学习
- 根据历史数据优化分拣概率
- 自适应调整摆轮负载平衡
- 异常模式识别和自动调整

### 2. 业务规则引擎
- 支持基于包裹属性的分拣规则
- 优先级队列和插队机制
- 特殊包裹处理流程

### 3. 性能优化
- 分拣决策缓存机制
- 批量分拣策略
- 智能负载均衡算法

## 🎯 负载平衡特性

### 工作原理
1. **初始化**：系统启动时为每条路径初始化摆轮使用统计
2. **选择算法**：每次分拣时选择使用次数最少的摆轮
3. **实时统计**：持续跟踪每个摆轮的使用次数
4. **平衡报告**：定期输出负载平衡统计和评分

### 平衡效果
- **短期**：前几十次分拣可能看起来不够平均
- **中期**：100次分拣后各摆轮使用次数趋于平衡
- **长期**：1000次以上分拣时平衡度可达95%以上

### 统计指标
- **平衡度评分**：0-100分，100表示完全平均分布
- **使用方差**：数值越小表示分布越平均
- **最大最小差值**：理想情况下不超过1-2次

---

💡 **提示**: 负载平衡算法确保长期运行时每个摆轮的使用次数保持平均，可通过浏览器控制台实时查看统计数据和平衡度评分。 