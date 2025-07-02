<script setup>
import { computed } from 'vue';

const props = defineProps({
  config: {
    type: Object,
    required: true,
  },
  direction: {
    type: String,
    default: 'straight', // 'left', 'right', 'straight'
  },
  conveyorDirection: {
    type: String,
    default: 'vertical', // 'horizontal' or 'vertical'
  },
  deviceOrientation: {
    type: String,
    default: 'vertical', // 'vertical' or 'horizontal' - 设备本身的朝向
  },
  isEditMode: {
    type: Boolean,
    default: false,
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

// Data for the individual wheels' positions - adjust based on device orientation
const wheelsData = computed(() => {
  if (props.deviceOrientation === 'horizontal') {
    // 水平摆轮：轮子水平排列
    return [
      { x: -15, y: 0 },
      { x: 0, y: 0 },
      { x: 15, y: 0 },
    ];
  } else {
    // 垂直摆轮：轮子垂直排列
    return [
      { x: 0, y: -15 },
      { x: 0, y: 0 },
      { x: 0, y: 15 },
    ];
  }
});

// Calculate the rotation angle for each individual wheel
const wheelRotation = computed(() => {
  if (props.conveyorDirection === 'horizontal') {
    // For horizontal conveyors: up/down directions
    if (props.direction === 'up') {
      return -45;
    }
    if (props.direction === 'down') {
      return 45;
    }
  } else {
    // For vertical conveyors: left/right directions
    if (props.direction === 'left') {
      return -45;
    }
    if (props.direction === 'right') {
      return 45;
    }
  }
  return 0; // Straight
});

// Calculate the base size and orientation based on device orientation
const baseConfig = computed(() => {
  if (props.deviceOrientation === 'horizontal') {
    // 水平摆轮：基座是水平的（宽大于高）
    return {
      x: -25,
      y: -10,
      width: 50,
      height: 20,
    };
  } else {
    // 垂直摆轮：基座是垂直的（高大于宽）
    return {
      x: -10,
      y: -25,
      width: 20,
      height: 50,
    };
  }
});

// 移除了设备状态指示器颜色配置（不再需要显示连接状态）

// 设备基座颜色
const baseColor = computed(() => {
  return props.isOffline ? '#606060' : '#A9A9A9';
});

// 摆轮颜色
const wheelColor = computed(() => {
  if (props.isOffline) {
    return '#808080'; // 离线时显示灰色
  }
  return props.direction === 'straight' ? '#FFFF00' : '#FF6B6B';
});

// 移除了状态指示器位置配置（不再显示连接状态）
</script>

<template>
  <v-group :config="groupConfig" @dragstart="handleDragStart" @dragend="handleDragEnd">
    <!-- Sorter Base -->
    <v-rect :config="{ ...baseConfig, fill: baseColor, cornerRadius: 2 }" />

    <!-- Control Buttons -->
    <v-group v-if="isEditMode">
      <!-- Duplicate Button (+) -->
      <v-text 
        :config="{ 
          x: props.deviceOrientation === 'horizontal' ? -30 : -30, 
          y: props.deviceOrientation === 'horizontal' ? -25 : -40, 
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
          x: props.deviceOrientation === 'horizontal' ? 15 : 15, 
          y: props.deviceOrientation === 'horizontal' ? -25 : -40, 
          text: '×', fill: 'red', fontSize: 16, padding: 2,
          shadowColor: 'rgba(0,0,0,0.5)',
          shadowBlur: 3,
          shadowOffsetX: 1,
          shadowOffsetY: 1
        }"
        @click="handleDelete"
        @tap="handleDelete"
      />
      <!-- Orientation Toggle Button (⟲) -->
      <v-text
        :config="{ 
          x: props.deviceOrientation === 'horizontal' ? -7 : -7, 
          y: props.deviceOrientation === 'horizontal' ? -25 : -40, 
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

    <!-- Pivoting Wheels (each one rotates in place) -->
    <v-rect
      v-for="(wheel, index) in wheelsData"
      :key="index"
      :config="{
        x: wheel.x,
        y: wheel.y,
        width: 10,
        height: 10,
        fill: wheelColor,
        offsetX: 5, // Set offset to half of width to rotate around center
        offsetY: 5, // Set offset to half of height to rotate around center
        rotation: wheelRotation,
        scaleX: props.direction === 'straight' ? 1 : 1.2,
        scaleY: props.direction === 'straight' ? 1 : 1.2,
        shadowColor: props.direction === 'straight' ? 'transparent' : 'rgba(255, 107, 107, 0.5)',
        shadowBlur: props.direction === 'straight' ? 0 : 8,
      }"
    />

    <!-- 移除了状态指示器显示（不再需要显示连接状态） -->
  </v-group>
</template> 