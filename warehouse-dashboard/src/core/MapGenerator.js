const NODE_SPACING_X = 40; // 节点水平间距
const NODE_SPACING_Y = 60; // 节点垂直间距

/**
 * 生成一个水平的路径
 * @param {number} startX 起始X坐标
 * @param {number} y Y坐标
 * @param {number} count 节点数量
 * @returns {Array} 坐标点数组
 */
export function generateHorizontalPath(startX, y, count) {
  const path = [];
  for (let i = 0; i < count; i++) {
    path.push({ x: startX + i * NODE_SPACING_X, y });
  }
  return path;
}

/**
 * 生成一个完整的货架区网格
 * @param {string} idPrefix ID前缀，如 'shelf_A'
 * @param {number} startX 左上角起始X
 * @param {number} startY 左上角起始Y
 * @param {number} rows 行数
 * @param {number} cols 列数
 * @returns {Object} 路径对象，如 { shelf_A_row_0: [...], shelf_A_row_1: [...] }
 */
export function generateShelfArea(idPrefix, startX, startY, rows, cols) {
  const areaPaths = {};
  for (let i = 0; i < rows; i++) {
    const pathId = `${idPrefix}_row_${i}`;
    const pathY = startY + i * NODE_SPACING_Y;
    areaPaths[pathId] = generateHorizontalPath(startX, pathY, cols);
  }
  return areaPaths;
} 