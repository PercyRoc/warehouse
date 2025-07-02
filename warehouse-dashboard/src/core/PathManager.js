// src/core/PathManager.js

// --- 动态路径：包裹会在这里移动 - 针对3048x2160分辨率优化 ---
const dynamicPaths = {
  // 1. 扫码复核区 (左侧区域)
  scan_line_1_start: { 
    name: '扫码线1',
    direction: 'vertical', 
    points: [
      { x: 400, y: 1800 }, { x: 400, y: 1400 }, { x: 400, y: 1000, id: 'SORTER_1_DP' }, { x: 400, y: 600 }, // 末端点
    ]
  },
  scan_line_2_start: { 
    name: '扫码线2',
    direction: 'vertical', 
    points: [
      { x: 700, y: 1800 }, { x: 700, y: 1400 }, { x: 700, y: 1000, id: 'SORTER_2_DP' }, { x: 700, y: 600 }, // 末端点
    ]
  },

  // 2. SKU分拣主线 (中央区域)
  sku_line_1: { 
    name: 'SKU主线1',
    direction: 'vertical', 
    points: [
      { x: 1200, y: 1600 }, { x: 1200, y: 1200 }, { x: 1200, y: 1100, id: 'SKU_SORTER_1_1_DP' },
      { x: 1200, y: 1000, id: 'SKU_SORTER_1_2_DP' }, { x: 1200, y: 900, id: 'SKU_SORTER_1_3_DP' },
      { x: 1200, y: 800, id: 'SKU_SORTER_1_4_DP' }, { x: 1200, y: 700, id: 'SKU_SORTER_1_5_DP' },
      { x: 1200, y: 600, id: 'SKU_SORTER_1_6_DP' }, { x: 1200, y: 400 }, // 末端点
    ]
  },
  sku_line_2: { 
    name: 'SKU主线2',
    direction: 'vertical', 
    points: [
      { x: 1600, y: 1600 }, { x: 1600, y: 1200 }, { x: 1600, y: 1100, id: 'SKU_SORTER_2_1_DP' },
      { x: 1600, y: 1000, id: 'SKU_SORTER_2_2_DP' }, { x: 1600, y: 900, id: 'SKU_SORTER_2_3_DP' },
      { x: 1600, y: 800, id: 'SKU_SORTER_2_4_DP' }, { x: 1600, y: 700, id: 'SKU_SORTER_2_5_DP' },
      { x: 1600, y: 600, id: 'SKU_SORTER_2_6_DP' }, { x: 1600, y: 400 }, // 末端点
    ]
  },
  
  // 3. 大区分拣主线 (右侧区域，水平布局)
  region_sort_line: { 
    name: '大区分拣线',
    direction: 'horizontal', 
    points: [
      { x: 2000, y: 300 }, { x: 2200, y: 300 }, { x: 2400, y: 300 }, { x: 2600, y: 300 }, 
      { x: 2800, y: 300 }, { x: 2900, y: 300 }, // 末端点
    ]
  },
};

// --- 静态设备 (针对3048x2160分辨率重新布局) ---
export const devices = [
  // 扫码复核区设备 (左侧)
  { id: 'camera-1', type: 'camera', x: 400, y: 1300 },
  { id: 'camera-2', type: 'camera', x: 700, y: 1300 },
  { id: 'sorter-1', type: 'sorter', x: 400, y: 1000 },
  { id: 'sorter-2', type: 'sorter', x: 700, y: 1000 },
  
  // SKU分拣区设备 (中央)
  { id: 'sku-camera-1', type: 'camera', x: 1200, y: 1400 },
  { id: 'sku-camera-2', type: 'camera', x: 1600, y: 1400 },
  
  // SKU线1的6个摆轮
  { id: 'sku-sorter-1-1', type: 'sorter', x: 1200, y: 1100 },
  { id: 'sku-sorter-1-2', type: 'sorter', x: 1200, y: 1000 },
  { id: 'sku-sorter-1-3', type: 'sorter', x: 1200, y: 900 },
  { id: 'sku-sorter-1-4', type: 'sorter', x: 1200, y: 800 },
  { id: 'sku-sorter-1-5', type: 'sorter', x: 1200, y: 700 },
  { id: 'sku-sorter-1-6', type: 'sorter', x: 1200, y: 600 },
  
  // SKU线2的6个摆轮
  { id: 'sku-sorter-2-1', type: 'sorter', x: 1600, y: 1100 },
  { id: 'sku-sorter-2-2', type: 'sorter', x: 1600, y: 1000 },
  { id: 'sku-sorter-2-3', type: 'sorter', x: 1600, y: 900 },
  { id: 'sku-sorter-2-4', type: 'sorter', x: 1600, y: 800 },
  { id: 'sku-sorter-2-5', type: 'sorter', x: 1600, y: 700 },
  { id: 'sku-sorter-2-6', type: 'sorter', x: 1600, y: 600 },
  
  // 大区分拣器 (右侧水平排列)
  { id: 'region-camera-1', type: 'camera', x: 1900, y: 300 },
  { id: 'region-sorter-1', type: 'sorter', x: 2200, y: 300 },
  { id: 'region-sorter-2', type: 'sorter', x: 2400, y: 300 },
  { id: 'region-sorter-3', type: 'sorter', x: 2600, y: 300 },
  { id: 'region-sorter-4', type: 'sorter', x: 2800, y: 300 },
];

export const allPaths = dynamicPaths;

// Helper to get the points array from the new structure
export function getPathById(id) {
  return allPaths[id]?.points;
}