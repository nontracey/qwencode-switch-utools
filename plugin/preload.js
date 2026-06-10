const fs = require('fs');
const path = require('path');

const QWEN_HOME = path.join(require('os').homedir(), '.qwen');
const SETTINGS_PATH = path.join(QWEN_HOME, 'settings.json');
const SETTINGS_ORIG_PATH = path.join(QWEN_HOME, 'settings.json.orig');
const META_PATH = path.join(QWEN_HOME, 'qwenswitch-meta.json');

// ====== 配置读取与写入 ======

function readSettings() {
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeSettings(settings) {
  const raw = JSON.stringify(settings, null, 2) + '\n';
  fs.writeFileSync(SETTINGS_PATH, raw, 'utf-8');
}

// ====== 元数据持久化（分组昵称、排序、折叠状态） ======

function readMeta() {
  try {
    if (!fs.existsSync(META_PATH)) return { groups: {} };
    const raw = fs.readFileSync(META_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { groups: {} };
  }
}

function writeMeta(meta) {
  const raw = JSON.stringify(meta, null, 2) + '\n';
  fs.writeFileSync(META_PATH, raw, 'utf-8');
}

/**
 * 获取分组元数据
 * groups[baseUrl] = { nickname, order, collapsed }
 */
function getGroupMeta() {
  return readMeta().groups || {};
}

function setGroupMeta(groups) {
  writeMeta({ groups });
}

/**
 * 更新单个分组的元数据
 */
function updateGroupMeta(baseUrl, patch) {
  const meta = readMeta();
  if (!meta.groups) meta.groups = {};
  if (!meta.groups[baseUrl]) meta.groups[baseUrl] = {};
  Object.assign(meta.groups[baseUrl], patch);
  writeMeta(meta);
  return meta.groups[baseUrl];
}

/**
 * 获取某个端点下已有配置的公共信息（用于快捷创建时预填）
 * 取该端点下第一个配置的 baseUrl、envKey、apiKey
 */
function getGroupDefaults(baseUrl) {
  const settings = readSettings();
  const providers = settings.modelProviders || {};
  for (const [, items] of Object.entries(providers)) {
    if (!Array.isArray(items)) continue;
    const found = items.find(item => item.baseUrl === baseUrl);
    if (found) {
      return {
        baseUrl: found.baseUrl,
        envKey: found.envKey,
        apiKey: (settings.env || {})[found.envKey] || '',
      };
    }
  }
  return null;
}

// ====== 模型配置管理 ======

/**
 * 精确匹配当前激活的配置项（providerType + index）
 * 因为多个配置可能共享同一个 model id（不同端点），
 * 仅靠 model.name 无法区分，需要结合 generationConfig 匹配
 */
function findActiveConfigKey(settings) {
  if (!settings.model || !settings.model.name) return null;
  const modelName = settings.model.name;
  const modelGC = settings.model.generationConfig;
  const providers = settings.modelProviders || {};

  // 优先匹配 id + generationConfig 完全一致的
  for (const [providerType, items] of Object.entries(providers)) {
    if (!Array.isArray(items)) continue;
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === modelName && genConfigEqual(items[i].generationConfig, modelGC)) {
        return { providerType, index: i };
      }
    }
  }

  // 降级：仅匹配 id，取第一个
  for (const [providerType, items] of Object.entries(providers)) {
    if (!Array.isArray(items)) continue;
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === modelName) {
        return { providerType, index: i };
      }
    }
  }

  return null;
}

function genConfigEqual(a, b) {
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * 获取所有模型配置（扁平化列表）
 * 每个配置项包含源 provider 类型和索引
 */
function getAllConfigs() {
  const settings = readSettings();
  const configs = [];
  const providers = settings.modelProviders || {};
  const activeKey = findActiveConfigKey(settings);

  for (const [providerType, items] of Object.entries(providers)) {
    if (Array.isArray(items)) {
      items.forEach((item, index) => {
        const envValue = (settings.env || {})[item.envKey] || '';
        const isActive = activeKey
          && activeKey.providerType === providerType
          && activeKey.index === index;
        configs.push({
          providerType,
          index,
          id: item.id,
          name: item.name,
          envKey: item.envKey,
          apiKey: maskApiKey(envValue),
          baseUrl: item.baseUrl || '',
          generationConfig: item.generationConfig || getDefaultGenConfig(),
          enabled: isActive,
          // 实际值用于编辑时回填
          _apiKeyRaw: envValue,
        });
      });
    }
  }

  return configs;
}

function getActiveConfig() {
  const settings = readSettings();
  const activeKey = findActiveConfigKey(settings);
  if (!activeKey) return null;

  const items = (settings.modelProviders || {})[activeKey.providerType];
  if (!items || !items[activeKey.index]) return null;

  const found = items[activeKey.index];
  const envValue = (settings.env || {})[found.envKey] || '';
  return {
    ...found,
    providerType: activeKey.providerType,
    index: activeKey.index,
    apiKey: envValue,
  };
}

/**
 * 切换激活的模型（按 providerType + index 精确定位）
 */
function switchModel(providerType, index) {
  const settings = readSettings();
  const providers = settings.modelProviders || {};
  const items = providers[providerType];
  if (!items || !items[index]) {
    return { success: false, error: `未找到配置: ${providerType}[${index}]` };
  }

  const target = items[index];
  settings.model = {
    name: target.id,
    generationConfig: target.generationConfig || getDefaultGenConfig(),
  };
  writeSettings(settings);
  return { success: true, name: target.name };
}

/**
 * 添加新配置（OpenAI 格式）
 */
function addConfig({ name, modelId, baseUrl, envKey, apiKey, generationConfig }) {
  const settings = readSettings();
  if (!settings.modelProviders) settings.modelProviders = {};
  if (!settings.modelProviders.openai) settings.modelProviders.openai = [];
  if (!settings.env) settings.env = {};

  // 检查是否有同名配置（名称是唯一标识，同端点同模型ID但不同参数是允许的）
  const existing = settings.modelProviders.openai.find(item => item.name === name);
  if (existing) {
    return { success: false, error: `配置 "${name}" 已存在` };
  }

  const newConfig = {
    id: modelId,
    name: name,
    envKey: envKey,
    baseUrl: baseUrl,
    generationConfig: generationConfig || getDefaultGenConfig(),
  };

  settings.modelProviders.openai.push(newConfig);
  settings.env[envKey] = apiKey;
  writeSettings(settings);
  return { success: true };
}

/**
 * 更新配置
 */
function updateConfig({ providerType, index, name, modelId, envKey, apiKey, baseUrl, generationConfig }) {
  const settings = readSettings();
  const items = settings.modelProviders[providerType];
  if (!items || !items[index]) {
    return { success: false, error: '未找到配置' };
  }

  const oldItem = items[index];

  // 如果当前正在使用此配置，需要同步更新 model
  const activeKey = findActiveConfigKey(settings);
  const wasActive = activeKey
    && activeKey.providerType === providerType
    && activeKey.index === index;

  items[index] = {
    ...oldItem,
    id: modelId,
    name: name,
    envKey: envKey,
    baseUrl: baseUrl,
    generationConfig: generationConfig || getDefaultGenConfig(),
  };

  if (!settings.env) settings.env = {};
  settings.env[envKey] = apiKey;

  if (wasActive) {
    settings.model = {
      name: modelId,
      generationConfig: items[index].generationConfig,
    };
  }

  writeSettings(settings);
  return { success: true };
}

/**
 * 删除配置
 */
function deleteConfig(providerType, index) {
  const settings = readSettings();
  const items = settings.modelProviders[providerType];
  if (!items || !items[index]) {
    return { success: false, error: '未找到配置' };
  }

  const deleted = items[index];
  const activeKey = findActiveConfigKey(settings);
  const wasActive = activeKey
    && activeKey.providerType === providerType
    && activeKey.index === index;

  items.splice(index, 1);

  if (wasActive) {
    // 如果删除的是当前激活的配置，尝试切换到第一个可用配置
    const firstAvailable = findFirstAvailable(settings);
    if (firstAvailable) {
      settings.model = {
        name: firstAvailable.id,
        generationConfig: firstAvailable.generationConfig || getDefaultGenConfig(),
      };
    } else {
      delete settings.model;
    }
  }

  writeSettings(settings);
  return { success: true, wasActive };
}

/**
 * 复制配置
 */
function duplicateConfig(providerType, index) {
  const settings = readSettings();
  const items = settings.modelProviders[providerType];
  if (!items || !items[index]) {
    return { success: false, error: '未找到配置' };
  }

  const source = items[index];
  const newName = source.name + ' (副本)';

  const newConfig = JSON.parse(JSON.stringify(source));
  newConfig.name = newName;
  // 保持原 id 不变，复制的目的是在同一端点下改模型参数
  // 用户可自行在编辑中修改 id

  items.push(newConfig);
  writeSettings(settings);
  return { success: true, config: newConfig };
}

// ====== 工具函数 ======

function maskApiKey(key) {
  if (!key || key.length < 8) return key || '';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

function getDefaultGenConfig() {
  return {
    timeout: 120000,
    maxRetries: 3,
    contextWindowSize: 128000,
    samplingParams: {
      temperature: 0.7,
      max_tokens: 8192,
      top_p: 0.9,
    },
  };
}

function findFirstAvailable(settings) {
  const providers = settings.modelProviders || {};
  for (const [, items] of Object.entries(providers)) {
    if (Array.isArray(items) && items.length > 0) {
      return items[0];
    }
  }
  return null;
}

function getEnvVars() {
  const settings = readSettings();
  return settings.env || {};
}

// ====== 导出到渲染进程 ======

window.__qwenswitch = {
  getAllConfigs,
  getActiveConfig,
  switchModel,
  addConfig,
  updateConfig,
  deleteConfig,
  duplicateConfig,
  getEnvVars,
  readSettings,
  getDefaultGenConfig,
  getGroupMeta,
  setGroupMeta,
  updateGroupMeta,
  getGroupDefaults,
};