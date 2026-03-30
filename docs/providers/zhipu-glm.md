# 智谱 GLM Structurer 开发文档

> 本文档汇总了 ListenGraph 项目集成智谱 GLM 作为 Structurer Provider 所需的所有官方文档、API 规范、示例代码和最佳实践。

## 📚 目录

- [产品概述](#产品概述)
- [模型列表与定价](#模型列表与定价)
- [API 基础配置](#api-基础配置)
- [OpenAI API 兼容模式](#openai-api-兼容模式)
- [结构化输出（JSON Mode）](#结构化输出json-mode)
- [Function Calling](#function-calling)
- [错误码参考](#错误码参考)
- [最佳实践](#最佳实践)
- [官方资源](#官方资源)

---

## 产品概述

### 核心优势

智谱 AI 提供与 **OpenAI API 完全兼容**的接口，这意味着：

- ✅ 可以使用现有的 OpenAI SDK 代码
- ✅ 只需修改 API 密钥和 Base URL
- ✅ 支持 JSON Mode 结构化输出
- ✅ 支持 Function Calling 工具调用
- ✅ 支持流式响应

### 适用场景

| 场景 | 推荐模型 | 说明 |
|------|---------|------|
| 开发测试 | `glm-4.7-flash` | 免费，无成本调试 |
| 生产环境（高速） | `glm-4.7-flashx` | 高速低价 |
| 生产环境（最强） | `glm-5` | 旗舰模型，编程能力强 |
| 长文本处理 | `glm-4-long` | 支持 1M 上下文 |

---

## 模型列表与定价

### 文本模型

| 模型 | 定位 | 上下文 | 最大输出 | 价格（元/百万 tokens）|
|------|------|--------|----------|---------------------|
| **GLM-5** | 最新旗舰 | 200K | 128K | 输入 ¥4 / 输出 ¥18 |
| **GLM-5-Turbo** | 龙虾增强 | 200K | 128K | - |
| **GLM-4.7** | 高智能 | 200K | 128K | - |
| **GLM-4.7-FlashX** | 轻量高速 | 200K | 128K | 输入 ¥0.15 / 输出 ¥1.5 |
| **GLM-4.6** | 超强性能 | 200K | 128K | - |
| **GLM-4.5-Air** | 高性价比 | 128K | 96K | - |
| **GLM-4.5-AirX** | 高性价比-极速版 | 128K | 96K | - |
| **GLM-4-Long** | 超长输入 | 1M | 4K | - |
| **GLM-4-FlashX-250414** | 高速低价 | 128K | 16K | - |

### 免费模型

| 模型 | 上下文 | 最大输出 | 说明 |
|------|--------|----------|------|
| **GLM-4.7-Flash** | 200K | 128K | 最新基座普惠版 |
| **GLM-4.5-Flash** | 128K | 96K | 支持深度思考（即将下线） |
| **GLM-4-Flash-250414** | 128K | 16K | 超长上下文 |

### 推荐配置

**开发测试：**
```typescript
model: 'glm-4.7-flash'  // 免费
```

**生产环境：**
```typescript
model: 'glm-4.7-flashx'  // 高速低价，¥0.15/¥1.5
// 或
model: 'glm-5'  // 旗舰，编程能力强
```

---

## API 基础配置

### 端点

| 项目 | 值 | 说明 |
|------|-----|------|
| **Base URL** | `https://open.bigmodel.cn/api/paas/v4/` | 所有接口的前缀，**不能直接请求** |
| **Chat Completions** | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | 同步对话补全（推荐） |
| **Async Chat Completions** | `https://open.bigmodel.cn/api/paas/v4/async/chat/completions` | 异步对话补全（长任务场景） |

> **⚠️ Base URL vs 完整 URL**
>
> Base URL（`https://open.bigmodel.cn/api/paas/v4/`）只是一个前缀，直接请求会返回 404。
> 所有具体接口都在 Base URL 后面拼接路径：
>
> | 用途 | 完整 URL | 拼接方式 |
> |------|----------|----------|
> | 对话补全 | `{base_url}chat/completions` | Base URL + `chat/completions` |
> | 异步对话补全 | `{base_url}async/chat/completions` | Base URL + `async/chat/completions` |
> | Embeddings | `{base_url}embeddings` | Base URL + `embeddings` |
> | 模型列表 | `{base_url}models` | Base URL + `models` |
>
> **使用 SDK 时**：只需传 Base URL，SDK 会自动拼接路径。
> **使用 cURL / HTTP 请求时**：必须传完整 URL。

### 同步 vs 异步接口

| | 同步（推荐） | 异步 |
|---|---|---|
| **端点** | `/paas/v4/chat/completions` | `/paas/v4/async/chat/completions` |
| **方式** | 请求后直接返回结果 | 请求后返回任务 ID，需轮询获取结果 |
| **流式** | ✅ 支持 `stream: true` | ❌ 不支持 |
| **适用场景** | 实时对话、结构化提取 | 长文本生成、批量处理（避免 HTTP 超时） |

> ListenGraph 的 Structurer 场景属于实时处理，**应使用同步接口**。

### 认证方式

**Bearer Token（API Key）：**

```bash
Authorization: Bearer YOUR_API_KEY
```

### 请求头

```http
Content-Type: application/json
Authorization: Bearer YOUR_API_KEY
```

### 获取 API Key

1. 访问 [智谱AI 开放平台](https://bigmodel.cn)
2. 注册并登录账户
3. 在 [API Keys](https://bigmodel.cn/usercenter/proj-mgmt/apikeys) 管理页面创建 API Key
4. 复制 API Key 供使用

---

## OpenAI API 兼容模式

### 核心优势

智谱 AI 提供与 OpenAI API 兼容的接口，只需修改两个参数即可迁移：

| 参数 | OpenAI | 智谱 AI |
|------|--------|---------|
| `api_key` | `sk-...` | 智谱 API Key |
| `base_url` | 默认 | `https://open.bigmodel.cn/api/paas/v4/` |

### Python 示例

> SDK 示例中传的是 **Base URL**，SDK 内部会自动拼接 `/chat/completions` 路径。

```python
from openai import OpenAI

# 创建智谱 AI 客户端
client = OpenAI(
    api_key="your-zhipuai-api-key",
    base_url="https://open.bigmodel.cn/api/paas/v4/"
)

# 调用方式完全一致
response = client.chat.completions.create(
    model="glm-4.7-flash",
    messages=[
        {"role": "system", "content": "你是一个结构化提取专家"},
        {"role": "user", "content": "从这段文字提取知识图谱..."}
    ]
)

print(response.choices[0].message.content)
```

### TypeScript 示例

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'your-zhipuai-api-key',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
});

const response = await client.chat.completions.create({
  model: 'glm-4.7-flash',
  messages: [
    { role: 'system', content: '你是一个结构化提取专家' },
    { role: 'user', content: '从这段文字提取知识图谱...' }
  ],
});

console.log(response.choices[0].message.content);
```

### cURL 示例

> cURL 是直接 HTTP 请求，所以要用**完整 URL**（不是 Base URL）。

```bash
curl https://open.bigmodel.cn/api/paas/v4/chat/completions \
  --header 'Authorization: Bearer YOUR_API_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "glm-4.7-flash",
    "messages": [
      {"role": "system", "content": "你是一个结构化提取专家"},
      {"role": "user", "content": "从这段文字提取知识图谱..."}
    ],
    "temperature": 0.7
  }'
```

### 响应格式

```json
{
  "id": "cnmuo7mcp7f9hjcmihn0",
  "object": "chat.completion",
  "model": "glm-4.7-flash",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "{\"nodes\": [...], \"edges\": [...]}"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150
  },
  "created": 1710152062
}
```

---

## 结构化输出（JSON Mode）

### 启用方式

在请求中添加 `response_format` 参数：

```python
response = client.chat.completions.create(
    model="glm-4.7",
    messages=[...],
    response_format={"type": "json_object"}  # 强制返回 JSON
)
```

### 指定 JSON 结构

在 system message 中定义期望的 JSON 结构：

```python
schema = {
    "type": "object",
    "properties": {
        "sentiment": {
            "type": "string",
            "enum": ["positive", "negative", "neutral"]
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["sentiment", "confidence"]
}

response = client.chat.completions.create(
    model="glm-4.7",
    messages=[
        {
            "role": "system",
            "content": f"请按照以下 JSON Schema 格式返回：\n{json.dumps(schema, indent=2, ensure_ascii=False)}"
        },
        {
            "role": "user",
            "content": "分析这段文字的情感..."
        }
    ],
    response_format={"type": "json_object"}
)

result = json.loads(response.choices[0].message.content)
```

### Structurer 场景示例

```typescript
const response = await client.chat.completions.create({
  model: 'glm-4.7-flash',
  messages: [
    {
      role: 'system',
      content: `你是知识图谱提取专家。从文本中提取结构化信息，返回以下 JSON 格式：
{
  "nodes": [
    {"id": "string", "label": "string", "type": "string"}
  ],
  "edges": [
    {"source": "string", "target": "string", "label": "string"}
  ]
}`
    },
    {
      role: 'user',
      content: `文本内容：${transcriptText}`
    }
  ],
  response_format: { type: 'json_object' }
});

const graph = JSON.parse(response.choices[0].message.content);
```

---

## Function Calling

### 定义工具

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "extract_knowledge_graph",
            "description": "从文本中提取知识图谱结构",
            "parameters": {
                "type": "object",
                "properties": {
                    "nodes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "type": {"type": "string"}
                            }
                        }
                    },
                    "edges": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": {"type": "string"},
                                "target": {"type": "string"},
                                "label": {"type": "string"}
                            }
                        }
                    }
                },
                "required": ["nodes", "edges"]
            }
        }
    }
]
```

### 调用工具

```python
response = client.chat.completions.create(
    model="glm-4.7",
    messages=[
        {"role": "user", "content": "从这段文字提取知识图谱..."}
    ],
    tools=tools,
    tool_choice="auto"  # 或 "required" 强制调用
)

message = response.choices[0].message
if message.tool_calls:
    for tool_call in message.tool_calls:
        function_name = tool_call.function.name
        arguments = json.loads(tool_call.function.arguments)
        # 处理提取结果
        print(f"提取到的图谱: {arguments}")
```

---

## 推理模式（Thinking）

GLM-4.7 支持深度思考模式，适合复杂推理任务：

```python
response = client.chat.completions.create(
    model="glm-4.7",
    messages=[...],
    stream=True,
    extra_body={
        "thinking": {
            "type": "enabled"
        }
    }
)

for chunk in response:
    if chunk.choices[0].delta.reasoning_content:
        print(chunk.choices[0].delta.reasoning_content, end='')  # 思考过程
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='')  # 最终回答
```

---

## 常用参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `model` | string | 必填 | 模型名称 |
| `messages` | array | 必填 | 对话消息列表 |
| `temperature` | float | 0.6 | 随机性 (0-1) |
| `top_p` | float | 0.95 | 核采样 (0-1) |
| `max_tokens` | int | - | 最大输出 token |
| `stream` | bool | false | 流式输出 |
| `stop` | string/array | - | 停止标记 |
| `response_format` | object | - | `{"type": "json_object"}` |
| `tools` | array | - | Function Calling 工具定义 |
| `tool_choice` | string | - | `"auto"` / `"required"` |

---

## 错误码参考

| 状态码 | 说明 | 处理建议 |
|--------|------|----------|
| 401 | 未授权 | 检查 API Key 是否正确 |
| 429 | 请求过于频繁 | 降低请求频率，实施重试机制 |
| 500 | 服务器内部错误 | 稍后重试，持续出现请联系支持 |

### 错误响应格式

```json
{
  "error": {
    "message": "Invalid API key",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

---

## 最佳实践

### 性能优化

- ✅ 使用连接池和会话复用
- ✅ 合理设置超时时间
- ✅ 实施异步调用处理高并发
- ✅ 缓存常用的响应结果

### 成本控制

- ✅ 合理设置 `max_tokens` 限制
- ✅ 使用合适的模型（开发用免费，生产用高速）
- ✅ 实施请求去重机制
- ✅ 监控 API 使用量

### 安全性

- ✅ 使用环境变量存储 API 密钥
- ✅ 实施输入验证和过滤
- ✅ 记录和监控 API 调用
- ✅ 定期轮换 API 密钥

### 可靠性

- ✅ 实施重试机制和错误处理
- ✅ 设置合理的超时时间
- ✅ 监控 API 状态和响应时间
- ✅ 准备降级方案

---

## ListenGraph 集成方案

### 方案 1：复用 OpenAI Provider（推荐）

由于智谱完全兼容 OpenAI API，可直接复用现有实现：

```typescript
// 配置
const config: StructurerProviderConfig = {
  type: 'openai',  // 复用！
  mode: 'direct',
  endpoint: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY,
  model: 'glm-4.7-flash'  // 免费模型
};
```

### 方案 2：新增 ZhipuStructurerProvider

更规范的实现，增加类型区分：

```typescript
// 1. 扩展 schema
// packages/schema/src/provider.ts
export type StructurerProviderType = 'mock' | 'openai' | 'zhipu';

// 2. 注册路由（复用 OpenAI 实现）
// packages/providers/src/registry.ts
if (config.type === 'zhipu') {
  return new OpenAIStructurerProvider({
    ...config,
    endpoint: config.endpoint || 'https://open.bigmodel.cn/api/paas/v4',
  });
}
```

---

## 官方资源

### 文档

- [智谱AI 开放平台](https://bigmodel.cn)
- [API 文档](https://docs.bigmodel.cn/cn/api/introduction)
- [OpenAI 兼容模式](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)
- [HTTP API 调用](https://docs.bigmodel.cn/cn/guide/develop/http/introduction)
- [结构化输出](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)
- [模型概览](https://docs.bigmodel.cn/cn/guide/start/model-overview)
- [定价](https://bigmodel.cn/pricing)

### API Key 管理

- [API Keys 页面](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)

### SDK

- Python: `pip install zai-sdk` 或 `pip install openai>=1.0`
- TypeScript: `npm install openai`

---

## 更新日志

- **2026-03-30**: 补充 Base URL 与完整 URL 的区别说明，新增同步/异步接口对比
- **2026-03-25**: 初版创建，基于智谱 AI 官方文档整理
