const fs = require('fs');
const path = require('path');

const QWEN_HOME = path.join(require('os').homedir(), '.qwen');
const SETTINGS_PATH = path.join(QWEN_HOME, 'settings.json');
const SETTINGS_ORIG_PATH = path.join(QWEN_HOME, 'settings.json.orig');

// ====== 配置读取与写入 ======

function readSettings() {
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeSettings(settings) {
  const raw = JSON.stringify(settings, null, 2) + '\n';
  fs.writeFileSync(SETTINGS_PATH, raw, 'utf-8');
  // 同步写入备份
  fs.writeFileSync(SETTINGS_ORIG_PATH, raw, 'utf-8');
}

// ====== 模型配置管理 ======

/**
 * 获取所有模型配置（扁平化列表）
 * 每个配置项包含源 provider 类型和索引
 */
function getAllConfigs() {
  const settings = readSettings();
  const configs = [];
  const providers = settings.modelProviders || {};

  for (const [providerType, items] of Object.entries(providers)) {
    if (Array.isArray(items)) {
      items.forEach((item, index) => {
        const envValue = (settings.env || {})[item.envKey] || '';
        const isActive = settings.model && settings.model.name === item.id;
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
  const activeModelId = settings.model && settings.model.name;
  const providers = settings.modelProviders || {};

  for (const [, items] of Object.entries(providers)) {
    if (Array.isArray(items)) {
      const found = items.find(item => item.id === activeModelId);
      if (found) {
        const envValue = (settings.env || {})[found.envKey] || '';
        return {
          ...found,
          providerType: Object.keys(providers).find(k => providers[k] === items),
          index: items.indexOf(found),
          apiKey: envValue,
        };
      }
    }
  }
  return null;
}

/**
 * 切换激活的模型
 */
function switchModel(configId) {
  const settings = readSettings();
  const providers = settings.modelProviders || {};

  for (const [, items] of Object.entries(providers)) {
    if (Array.isArray(items)) {
      const target = items.find(item => item.id === configId);
      if (target) {
        settings.model = {
          name: target.id,
          generationConfig: target.generationConfig || getDefaultGenConfig(),
        };
        writeSettings(settings);
        return { success: true, name: target.name };
      }
    }
  }
  return { success: false, error: `未找到配置: ${configId}` };
}

/**
 * 添加新配置（OpenAI 格式）
 */
function addConfig({ name, modelId, baseUrl, envKey, apiKey, generationConfig }) {
  const settings = readSettings();
  if (!settings.modelProviders) settings.modelProviders = {};
  if (!settings.modelProviders.openai) settings.modelProviders.openai = [];
  if (!settings.env) settings.env = {};

  // 检查是否有同名配置
  const existing = settings.modelProviders.openai.find(
    item => item.name === name || (item.id === modelId && item.baseUrl === baseUrl)
  );
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

  // 如果更改了 modelId，需要同时更新 model.name 如果当前正在使用此配置
  const oldItem = items[index];
  const wasActive = settings.model && settings.model.name === oldItem.id;

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
  const wasActive = settings.model && settings.model.name === deleted.id;

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
  const newId = source.id + '-copy';

  const newConfig = JSON.parse(JSON.stringify(source));
  newConfig.name = newName;
  newConfig.id = newId;

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
};