<script setup>
import { computed } from 'vue';

const props = defineProps({
  config: {
    type: Object,
    required: true,
  },
  isScanning: {
    type: Boolean,
    default: false,
  },
  isEditMode: {
    type: Boolean,
    default: false,
  },
  conveyorDirection: {
    type: String,
    default: 'vertical', // 'horizontal' or 'vertical'
  },
  deviceOrientation: {
    type: String,
    default: 'vertical', // 'vertical' or 'horizontal' - 设备本身的朝向
  },
  isOffline: {
    type: Boolean,
    default: false,
  },
  onlineStatus: {
    type: Object,
    default: () => ({ status: 'UNKNOWN' }),
  },
  dragBoundFunc: {
    type: Function,
    default: null,
  },
});

const emit = defineEmits(['update:position', 'duplicate', 'delete', 'toggle-orientation']);

const groupConfig = computed(() => ({
  x: props.config.x,
  y: props.config.y,
  draggable: props.isEditMode,
  opacity: props.isOffline ? 0.5 : 1, // 离线时降低透明度
  dragBoundFunc: props.dragBoundFunc,
}));

const lensColor = computed(() => {
  if (props.isOffline) {
    return '#808080'; // 离线时显示灰色
  }
  return props.isScanning ? '#32CD32' : '#FF2E63';
});

// 设备状态指示器颜色
const statusIndicatorColor = computed(() => {
  switch (props.onlineStatus.status) {
    case 'ONLINE':
      return '#32CD32'; // 绿色：在线
    case 'OFFLINE':
      return '#FF2E63'; // 红色：离线
    case 'TIMEOUT':
      return '#FFA500'; // 橙色：心跳超时
    default:
      return '#808080'; // 灰色：未知状态
  }
});

// 设备主体颜色
const deviceBodyColor = computed(() => {
  if (props.isOffline) {
    return '#606060'; // 离线时显示深灰色
  }
  return '#08D9D6'; // 正常时显示青色
});

// 龙门架颜色
const gantryColor = computed(() => {
  return props.isOffline ? '#404040' : 'white';
});

// 根据设备方向计算龙门架配置
const gantryConfig = computed(() => {
  if (props.deviceOrientation === 'horizontal') {
    // 水平相机：龙门架水平排列
    return {
      leftLeg: { x: -25, y: -20, width: 25, height: 5 },
      rightLeg: { x: 0, y: -20, width: 25, height: 5 },
      topBeam: { x: -25, y: -25, width: 50, height: 5 },
      cameraBody: { x: -20, y: -15, width: 40, height: 20 },
      lens: { x: 0, y: -5 },
      indicator: { x: 0, y: 5 },
      statusIndicator: { x: 18, y: -35 } // 状态指示器位置
    };
  } else {
    // 垂直相机：龙门架垂直排列
    return {
      leftLeg: { x: -20, y: -25, width: 5, height: 25 },
      rightLeg: { x: 15, y: -25, width: 5, height: 25 },
      topBeam: { x: -20, y: -30, width: 40, height: 5 },
      cameraBody: { x: -20, y: -50, width: 40, height: 20 },
      lens: { x: 0, y: -40 },
      indicator: { x: 17.5, y: 5 },
      statusIndicator: { x: 25, y: -55 } // 状态指示器位置
    };
  }
});

function handleDragStart(e) {
  // 阻止事件冒泡，防止拖拽设备时意外移动整个画布
  e.cancelBubble = true;
}

function handleDragEnd(e) {
  // 阻止事件冒泡
  e.cancelBubble = true;
  
  emit('update:position', {
    id: props.config.id,
    x: e.target.x(),
    y: e.target.y(),
  });
}

function handleDuplicate() {
  emit('duplicate', props.config.id);
}

function handleDelete() {
  emit('delete', props.config.id);
}

function handleToggleOrientation() {
  emit('toggle-orientation', props.config.id);
}
</script>

<template>
  <v-group :config="groupConfig" @dragstart="handleDragStart" @dragend="handleDragEnd">
    <!-- Gantry Left Leg -->
    <v-rect :config="{ ...gantryConfig.leftLeg, fill: gantryColor }" />
    <!-- Gantry Right Leg -->
    <v-rect :config="{ ...gantryConfig.rightLeg, fill: gantryColor }" />
    <!-- Gantry Top Beam -->
    <v-rect :config="{ ...gantryConfig.topBeam, fill: gantryColor }" />
    
    <!-- Camera Body -->
    <v-rect :config="{ ...gantryConfig.cameraBody, fill: deviceBodyColor, cornerRadius: 2 }" />

    <!-- Camera Lens (color now dynamic) -->
    <v-circle :config="{ 
      ...gantryConfig.lens, 
      radius: props.isScanning ? 4 : 3, 
      fill: lensColor,
      shadowColor: props.isScanning ? lensColor : 'transparent',
      shadowBlur: props.isScanning ? 10 : 0,
      scaleX: props.isScanning ? 1.3 : 1,
      scaleY: props.isScanning ? 1.3 : 1,
    }" />

    <!-- Scanning Effect Ring -->
    <v-circle 
      v-if="props.isScanning"
      :config="{ 
        ...gantryConfig.lens, 
        radius: 8, 
        stroke: lensColor,
        strokeWidth: 2,
        opacity: 0.7,
      }" 
    />

    <!-- Indicator Light (Green Dot) -->
    <v-circle :config="{ 
      ...gantryConfig.indicator, 
      radius: props.isScanning ? 5 : 4, 
      fill: props.isScanning ? '#FF6B6B' : '#32CD32',
      shadowColor: props.isScanning ? '#FF6B6B' : 'transparent',
      shadowBlur: props.isScanning ? 6 : 0,
    }" />

    <!-- Status Indicator -->
    <v-circle :config="{ 
      ...gantryConfig.statusIndicator, 
      radius: 5, 
      fill: statusIndicatorColor,
    }" />

    <!-- Control Buttons (Edit Mode Only) -->
    <v-group v-if="isEditMode">
      <!-- Duplicate Button (+) -->
      <v-text 
        :config="{ 
          x: props.deviceOrientation === 'horizontal' ? -35 : -35, 
          y: props.deviceOrientation === 'horizontal' ? -45 : -75, 
          text: '+', fill: 'green', fontSize: 16, padding: 2,
          shadowColor: 'rgba(0,0,0,0.5)',
          shadowBlur: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1
        }"
        @click="handleDuplicate"
        @tap="handleDuplicate"
      />
      <!-- Delete Button (×) -->
      <v-text
        :config="{ 
          x: props.deviceOrientation === 'horizontal' ? 20 : 20, 
          y: props.deviceOrientation === 'horizontal' ? -45 : -75, 
          text: '×', fill: 'red', fontSize: 16, padding: 2,
          shadowColor: 'rgba(0,0,0,0.5)',
          shadowBlur: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1
        }"
        @click="handleDelete"
        @tap="handleDelete"
      />
      <!-- Orientation Toggle Button (↔️/↕️) -->
      <v-text
        :config="{ 
          x: props.deviceOrientation === 'horizontal' ? -7 : -7, 
          y: props.deviceOrientation === 'horizontal' ? -45 : -75, 
          text: props.deviceOrientation === 'horizontal' ? '↕️' : '↔️', 
          fill: '#3498db', 
          fontSize: 14, 
          padding: 2,
          shadowColor: 'rgba(0,0,0,0.5)',
          shadowBlur: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1
        }"
        @click="handleToggleOrientation"
        @tap="handleToggleOrientation"
      />
    </v-group>
  </v-group>
</template> 