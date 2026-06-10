# QwenSwitch

Qwen Code 配置切换器 — 一个 uTools 插件，用于管理和快速切换 Qwen Code 的模型提供商配置。

## 功能

- **查看配置** — 列表展示所有模型提供商，激活配置置顶高亮，点击卡片展开查看完整参数
- **切换模型** — 点击单选按钮即时切换当前使用的模型
- **添加配置** — 通过 OpenAI 兼容格式添加新的模型端点，支持自定义 baseUrl、API Key、模型 ID
- **编辑配置** — 修改名称、模型 ID、端点、密钥及生成参数
- **复制节点** — 一键复制现有配置，方便在相同端点下切换不同模型
- **删除配置** — 带确认对话框，删除当前激活配置时自动切换到下一个可用配置
- **搜索筛选** — 按名称 / 模型 ID / 端点 / 环境变量模糊搜索，支持按激活状态筛选
- **高级参数** — 可编辑 timeout、maxRetries、contextWindow、temperature、max_tokens、top_p

## 安装

### 方式二：打包安装

```bash
# 在项目目录下打包 plugin 子目录
npx asar pack plugin qwenswitch.asar
```

将 `qwenswitch.asar` 拖入 uTools 插件管理界面安装。

### 方式一：本地开发模式

1. 克隆仓库

```bash
git clone https://github.com/nontracey/qwencode-switch-utools.git
```

2. 打开 uTools → 设置 → 插件 → 开发者工具
3. 选择「加载本地插件」→ 选择项目下的 `plugin` 目录

## 使用

在 uTools 输入框中键入以下任一关键词即可触发：

- `qwenswitch`
- `qwen switch`
- `Qwen 配置`

## 工作原理

插件直接读写 `~/.qwen/settings.json`，操作方式与 Qwen Code 原生配置格式完全兼容：

- 切换模型 → 修改 `model.name` 和 `model.generationConfig`
- 添加配置 → 向 `modelProviders.openai` 数组追加条目，同时写入 `env` 段的 API Key
- 编辑/删除 → 直接操作对应 provider 数组中的条目

每次写入时自动同步备份到 `settings.json.orig`。

## 配置文件格式

Qwen Code 的 `settings.json` 中模型配置结构如下：

```json
{
  "model": {
    "name": "deepseek-v4-flash",
    "generationConfig": { ... }
  },
  "modelProviders": {
    "openai": [
      {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "envKey": "DEEPSEEK_API_KEY",
        "baseUrl": "https://api.deepseek.com/v1",
        "generationConfig": {
          "timeout": 120000,
          "maxRetries": 3,
          "contextWindowSize": 128000,
          "samplingParams": {
            "temperature": 0.7,
            "max_tokens": 8192,
            "top_p": 0.9
          }
        }
      }
    ]
  },
  "env": {
    "DEEPSEEK_API_KEY": "sk-..."
  }
}
```

## 技术栈

- uTools 插件 API（preload + renderer）
- 原生 HTML / CSS / JavaScript，零依赖
- Node.js 文件系统操作（preload）

## License

MIT
