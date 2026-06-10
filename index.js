// ====== 状态 ======
let configs = [];
let filterMode = 'all'; // 'all' | 'active'
let editMode = null;    // null = 添加, {providerType, index} = 编辑

// ====== 初始化 ======
document.addEventListener('DOMContentLoaded', () => {
  // 等待一小段时间让 preload 准备好
  setTimeout(loadAndRender, 100);
});

function loadAndRender() {
  if (typeof window.__qwenswitch === 'undefined') {
    // preload 还没准备好，重试
    setTimeout(loadAndRender, 200);
    return;
  }
  configs = window.__qwenswitch.getAllConfigs();
  updateActiveIndicator();
  renderList();
}

// ====== 渲染配置列表 ======
function renderList() {
  const searchText = (document.getElementById('searchInput').value || '').toLowerCase();
  const list = document.getElementById('configList');

  // 筛选
  let filtered = configs.filter(c => {
    if (filterMode === 'active' && !c.enabled) return false;
    if (searchText) {
      const matchStr = `${c.name} ${c.id} ${c.baseUrl} ${c.envKey}`.toLowerCase();
      if (!matchStr.includes(searchText)) return false;
    }
    return true;
  });

  // 排序：激活的排最前面，其他按名称
  filtered.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // 更新计数
  document.getElementById('configCount').textContent = `${filtered.length}/${configs.length}`;
  // 重新激活 filter badge 样式
  document.querySelectorAll('.filter-badge').forEach(el => el.classList.remove('active'));
  if (filterMode !== 'all') {
    document.getElementById('countBadge').classList.add('active');
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">${searchText ? '🔍' : '📋'}</div>
        <p>${searchText ? '没有匹配的配置' : '还没有任何配置，点击右上角添加'}</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map((cfg, idx) => renderCard(cfg, idx)).join('');

  // 展开/折叠事件
  document.querySelectorAll('.config-card-header').forEach(el => {
    el.addEventListener('click', (e) => {
      // 如果点击的是按钮区域，不触发折叠
      if (e.target.closest('.config-actions')) return;
      const card = el.closest('.config-card');
      if (card) card.classList.toggle('expanded');
    });
  });

  // 切换事件
  document.querySelectorAll('.config-radio').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = el.closest('.config-card');
      const index = parseInt(card.dataset.index);
      const providerType = card.dataset.provider;
      const configIdx = findConfigIndex(providerType, index);
      if (configIdx !== -1) {
        switchToConfig(configIdx);
      }
    });
  });
}

function renderCard(cfg, idx) {
  const activeClass = cfg.enabled ? 'active' : '';
  const badge = cfg.enabled
    ? '<span class="badge active-badge">&#x25CF; 当前</span>'
    : '';

  // 截断过长的 baseUrl 和 apiKey
  const shortUrl = cfg.baseUrl.length > 40 ? cfg.baseUrl.slice(0, 40) + '...' : cfg.baseUrl;

  return `
    <div class="config-card ${activeClass}" data-index="${cfg.index}" data-provider="${cfg.providerType}" data-array-index="${idx}">
      <div class="config-card-header">
        <div class="config-radio ${activeClass}"></div>
        <div class="config-info">
          <div class="config-name">
            ${escapeHtml(cfg.name)}
            ${badge}
          </div>
          <div class="config-meta">
            <span class="meta-item">
              <span class="meta-key">模型</span> ${escapeHtml(cfg.id)}
            </span>
            <span class="meta-item">
              <span class="meta-key">端点</span> ${escapeHtml(shortUrl)}
            </span>
            <span class="meta-item">
              <span class="meta-key">Key</span> ${escapeHtml(cfg.apiKey || '未设置')}
            </span>
          </div>
        </div>
        <div class="config-actions">
          <button class="btn-icon primary" onclick="event.stopPropagation(); openEditModal(${idx})" title="编辑">&#x270E;</button>
          <button class="btn-icon" onclick="event.stopPropagation(); duplicateConfig(${idx})" title="复制">&#x1F4CB;</button>
          <button class="btn-icon danger" onclick="event.stopPropagation(); openDeleteModal(${idx})" title="删除">&#x1F5D1;</button>
        </div>
      </div>
      <div class="config-detail">
        <div class="detail-grid">
          <div class="detail-field">
            <label>名称</label>
            <span class="value">${escapeHtml(cfg.name)}</span>
          </div>
          <div class="detail-field">
            <label>模型 ID</label>
            <span class="value">${escapeHtml(cfg.id)}</span>
          </div>
          <div class="detail-field full-width">
            <label>API Endpoint</label>
            <span class="value">${escapeHtml(cfg.baseUrl)}</span>
          </div>
          <div class="detail-field full-width">
            <label>API Key (环境变量: ${escapeHtml(cfg.envKey)})</label>
            <span class="value api-key">${escapeHtml(cfg.apiKey || '未设置')}</span>
          </div>
          <div class="detail-field">
            <label>Timeout</label>
            <span class="value">${cfg.generationConfig.timeout}ms</span>
          </div>
          <div class="detail-field">
            <label>Max Retries</label>
            <span class="value">${cfg.generationConfig.maxRetries}</span>
          </div>
          <div class="detail-field">
            <label>Context Window</label>
            <span class="value">${(cfg.generationConfig.contextWindowSize / 1000).toFixed(0)}K</span>
          </div>
          <div class="detail-field">
            <label>Temperature</label>
            <span class="value">${cfg.generationConfig.samplingParams.temperature}</span>
          </div>
          <div class="detail-field">
            <label>Max Tokens</label>
            <span class="value">${cfg.generationConfig.samplingParams.max_tokens}</span>
          </div>
          <div class="detail-field">
            <label>Top P</label>
            <span class="value">${cfg.generationConfig.samplingParams.top_p}</span>
          </div>
        </div>
      </div>
    </div>`;
}

// ====== 切换配置 ======
function switchToConfig(configIdx) {
  const cfg = configs[configIdx];
  if (!cfg) return;

  const result = window.__qwenswitch.switchModel(cfg.id);
  if (result.success) {
    showToast(`已切换到 ${result.name}`, 'success');
    loadAndRender();
  } else {
    showToast(result.error, 'error');
  }
}

// ====== 复制配置 ======
function duplicateConfig(idx) {
  const cfg = configs[idx];
  if (!cfg) return;

  const result = window.__qwenswitch.duplicateConfig(cfg.providerType, cfg.index);
  if (result.success) {
    showToast(`已复制为 "${result.config.name}"`, 'success');
    loadAndRender();
  } else {
    showToast(result.error, 'error');
  }
}

// ====== 切换筛选 ======
function toggleFilter() {
  filterMode = filterMode === 'all' ? 'active' : 'all';
  renderList();
}

// ====== 激活模型指示器 ======
function updateActiveIndicator() {
  const active = window.__qwenswitch.getActiveConfig();
  const nameEl = document.getElementById('activeModelName');
  const infoEl = document.getElementById('activeProviderInfo');

  if (active) {
    nameEl.textContent = active.name;
    infoEl.textContent = `${active.baseUrl}`;
  } else {
    nameEl.textContent = '- 未选择';
    infoEl.textContent = '';
  }
}

// ====== 添加/编辑模态框 ======
function openAddModal() {
  editMode = null;
  document.getElementById('modalTitle').textContent = '添加配置';
  document.getElementById('modalConfirmBtn').textContent = '添加';
  resetForm();
  document.getElementById('modalOverlay').classList.add('open');
}

function openEditModal(idx) {
  const cfg = configs[idx];
  if (!cfg) return;

  editMode = { providerType: cfg.providerType, index: cfg.index };
  document.getElementById('modalTitle').textContent = '编辑配置';
  document.getElementById('modalConfirmBtn').textContent = '保存';

  document.getElementById('formName').value = cfg.name;
  document.getElementById('formModelId').value = cfg.id;
  document.getElementById('formEnvKey').value = cfg.envKey;
  document.getElementById('formBaseUrl').value = cfg.baseUrl;
  document.getElementById('formApiKey').value = cfg._apiKeyRaw || '';

  const gc = cfg.generationConfig;
  document.getElementById('formTimeout').value = gc.timeout;
  document.getElementById('formMaxRetries').value = gc.maxRetries;
  document.getElementById('formContextWindow').value = gc.contextWindowSize;
  document.getElementById('formTemperature').value = gc.samplingParams.temperature;
  document.getElementById('formMaxTokens').value = gc.samplingParams.max_tokens;
  document.getElementById('formTopP').value = gc.samplingParams.top_p;

  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  editMode = null;
}

function resetForm() {
  document.getElementById('formName').value = '';
  document.getElementById('formModelId').value = '';
  document.getElementById('formEnvKey').value = '';
  document.getElementById('formBaseUrl').value = '';
  document.getElementById('formApiKey').value = '';
  document.getElementById('formTimeout').value = '120000';
  document.getElementById('formMaxRetries').value = '3';
  document.getElementById('formContextWindow').value = '128000';
  document.getElementById('formTemperature').value = '0.7';
  document.getElementById('formMaxTokens').value = '8192';
  document.getElementById('formTopP').value = '0.9';
}

function confirmModal() {
  const name = document.getElementById('formName').value.trim();
  const modelId = document.getElementById('formModelId').value.trim();
  const envKey = document.getElementById('formEnvKey').value.trim();
  const baseUrl = document.getElementById('formBaseUrl').value.trim();
  const apiKey = document.getElementById('formApiKey').value.trim();

  // 验证
  if (!name) { showToast('请输入配置名称', 'error'); return; }
  if (!modelId) { showToast('请输入模型 ID', 'error'); return; }
  if (!envKey) { showToast('请输入环境变量名', 'error'); return; }
  if (!baseUrl) { showToast('请输入 API Endpoint', 'error'); return; }
  if (!apiKey) { showToast('请输入 API Key', 'error'); return; }

  const genConfig = {
    timeout: parseInt(document.getElementById('formTimeout').value) || 120000,
    maxRetries: parseInt(document.getElementById('formMaxRetries').value) || 3,
    contextWindowSize: parseInt(document.getElementById('formContextWindow').value) || 128000,
    samplingParams: {
      temperature: parseFloat(document.getElementById('formTemperature').value) || 0.7,
      max_tokens: parseInt(document.getElementById('formMaxTokens').value) || 8192,
      top_p: parseFloat(document.getElementById('formTopP').value) || 0.9,
    },
  };

  if (editMode) {
    // 编辑模式
    const result = window.__qwenswitch.updateConfig({
      providerType: editMode.providerType,
      index: editMode.index,
      name,
      modelId,
      envKey,
      apiKey,
      baseUrl,
      generationConfig: genConfig,
    });

    if (result.success) {
      showToast('配置已更新', 'success');
      closeModal();
      loadAndRender();
    } else {
      showToast(result.error, 'error');
    }
  } else {
    // 添加模式
    const result = window.__qwenswitch.addConfig({
      name,
      modelId,
      baseUrl,
      envKey,
      apiKey,
      generationConfig: genConfig,
    });

    if (result.success) {
      showToast('配置已添加', 'success');
      closeModal();
      loadAndRender();
    } else {
      showToast(result.error, 'error');
    }
  }
}

// ====== 删除模态框 ======
let deleteTargetIdx = -1;

function openDeleteModal(idx) {
  const cfg = configs[idx];
  if (!cfg) return;

  deleteTargetIdx = idx;
  document.getElementById('deleteTargetName').textContent = cfg.name;
  document.getElementById('deleteModalOverlay').classList.add('open');
}

function closeDeleteModal() {
  document.getElementById('deleteModalOverlay').classList.remove('open');
  deleteTargetIdx = -1;
}

function confirmDelete() {
  if (deleteTargetIdx === -1) return;
  const cfg = configs[deleteTargetIdx];
  if (!cfg) return;

  const result = window.__qwenswitch.deleteConfig(cfg.providerType, cfg.index);
  if (result.success) {
    showToast('配置已删除', 'success');
    closeDeleteModal();
    loadAndRender();
  } else {
    showToast(result.error, 'error');
  }
}

// ====== 高级参数折叠 ======
function toggleGenConfig() {
  const panel = document.getElementById('genConfigPanel');
  const toggle = document.getElementById('genConfigToggle');
  panel.classList.toggle('open');
  toggle.textContent = panel.classList.contains('open')
    ? '\u25BC 隐藏高级参数'
    : '\u25B6 高级参数设置';
}

// ====== Toast 通知 ======
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('exit');
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// ====== 工具函数 ======
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function findConfigIndex(providerType, index) {
  return configs.findIndex(c => c.providerType === providerType && c.index === index);
}

// 点击遮罩层关闭模态框
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});
document.getElementById('deleteModalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeDeleteModal();
});

// 回车键在搜索框中触发搜索
document.getElementById('searchInput').addEventListener('keyup', () => renderList());