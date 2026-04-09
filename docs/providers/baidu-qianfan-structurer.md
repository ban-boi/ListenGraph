# 百度千帆 ERNIE-Speed 接入开发文档

> 状态：历史选型 / 参考实现
>
> 百度 provider 仍保留为可选 provider，但当前 extension 默认 structurer 已切到 `aliyun`。
> 本文档适合用来查看当时的接入思路、限流判断和参数差异，不应直接视为当前默认方案说明。

> 用于 ListenGraph Structurer 模块，替代智谱 API（解决 429 限流问题）

## 1. 为什么选百度千帆

| 对比项 | 智谱 (glm-4.7-flash) | 百度千帆 (ERNIE-Speed-8K) |
|---|---|---|
| 价格 | 免费，但有严格并发限制 | 免费，长期开放 |
| RPM | 不公开，实测极易触发 429 | **300**（官方明确） |
| TPM | 未公开 | **300,000** |
| 429 恢复 | 很慢（分钟~小时级） | **0-60s 自动刷新** |
| OpenAI 兼容 | ✅ | ✅ V2 接口兼容 |
| `response_format: json_object` | ✅ | ⚠️ 不支持（见第5节） |

## 2. 前置准备

### 2.1 注册与认证

1. 注册百度智能云账号：https://cloud.baidu.com
2. 完成实名认证（个人或企业均可）
3. 进入千帆控制台：https://console.bce.baidu.com/qianfan/ais/console/onlineService
4. 找到 ERNIE-Speed-8K，点击「免费开通」

### 2.2 获取 API Key

1. 进入 IAM 安全认证页面：https://console.bce.baidu.com/iam/#/iam/apikey/list
2. 点击「创建 API Key」
3. 资源权限选择「所有资源」（或指定 V2 应用的 appid）
4. 创建成功后复制 API Key（格式：`bce-v3/ALTAK-xxx/xxx`）

### 2.3 AppID（可选但推荐）

- 用于多应用管理，区分调用量和账单
- 在千帆控制台创建应用后获取
- 如果只用于开发测试，可以不配置

## 3. API 接口规范

### 3.1 Base URL

```
https://qianfan.baidubce.com/v2
```

### 3.2 认证方式

**方式一：Header 认证（推荐）**
```
Authorization: Bearer bce-v3/ALTAK-xxx/xxx
```

**方式二：Header + AppID**
```
Authorization: Bearer bce-v3/ALTAK-xxx/xxx
appid: app-xxxxxx
```

### 3.3 可用模型

| 模型名 | 上下文 | 说明 |
|---|---|---|
| `ernie-speed-8k` | 8K tokens | 推荐，RPM=300, TPM=300K |
| `ernie-speed-128k` | 128K tokens | 长文本，RPM=60（配额较低） |
| `ernie-lite-8k` | 8K tokens | 轻量版，RPM=300, TPM=300K |
| `ernie-tiny-8k` | 8K tokens | 极轻量，不推荐结构化任务 |

### 3.4 请求格式

```typescript
// POST https://qianfan.baidubce.com/v2/chat/completions
{
  "model": "ernie-speed-8k",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": false,
  "temperature": 0.1  // 结构化任务建议低温度
}
```

### 3.5 响应格式

```json
{
  "id": "as-xxx",
  "object": "chat.completion",
  "created": 1716000000,
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "{\"topic\":\"...\",\"nodes\":[],\"edges\":[]}"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 100,
    "total_tokens": 600
  }
}
```

### 3.6 限流响应

当触发限流时，响应 Header 会包含：
```
X-Ratelimit-Remaining-Requests: 0
X-Ratelimit-Remaining-Tokens: 0
```

HTTP 状态码 `429`，0-60s 内自动恢复配额。

## 4. 限流与错误处理

### 4.1 配额详情

| 模型 | RPM（每分钟请求） | TPM（每分钟 Token） |
|---|---|---|
| ERNIE-Speed-8K | 300 | 300,000 |
| ERNIE-Speed-128K | 60 | 较低 |
| ERNIE-Lite-8K | 300 | 300,000 |

### 4.2 错误码

| HTTP 状态码 | 含义 | 处理建议 |
|---|---|---|
| 200 | 成功 | - |
| 400 | 请求参数错误 | 检查 model、messages 格式 |
| 401 | 认证失败 | 检查 API Key |
| 403 | 权限不足 | 检查 API Key 资源权限 |
| 429 | 限流 | 等待 0-60s 后重试 |
| 500 | 服务端错误 | 重试 |
| 502/503 | 网关/服务不可用 | 重试 |

### 4.3 与现有 retry 策略的兼容性

现有代码中 `DEFAULT_STRUCTURER_RETRY_POLICY` 故意将 429 从 `retryableStatusCodes` 中移除：

```typescript
// config.ts
retryableStatusCodes: DEFAULT_RETRY_POLICY.retryableStatusCodes.filter(
  (status) => status !== 429
),
```

**切换到百度后，建议把 429 加回重试列表**，因为百度的限流恢复很快（0-60s），自动重试比直接失败更合理。

## 5. ⚠️ 关键差异：JSON 输出模式

### 5.1 问题

百度千帆 V2 接口**不支持** `response_format: { type: "json_object" }` 参数。传入会报错或被忽略。

### 5.2 解决方案

依赖现有的 prompt 工程 + 后处理兜底（代码已具备）：

1. **System prompt 已强制要求 JSON 输出**：
   > "You are a strict JSON structurer for ListenGraph. Return only one JSON object. No markdown, no explanation, no code fences."

2. **`stripCodeFences()` 已处理模型返回 markdown 代码块的情况**：
   ```typescript
   function stripCodeFences(content: string) {
     return content
       .replace(/^```json\s*/i, '')
       .replace(/^```\s*/i, '')
       .replace(/\s*```$/, '');
   }
   ```

3. **JSON.parse 失败时已有错误处理**，会抛出 `INVALID_RESPONSE` 错误。

4. **可选优化**：在 system prompt 末尾追加 `Do NOT wrap the JSON in markdown code fences.` 强化指令。

### 5.3 不需要改动的部分

- `normalizeSegmentGraphPayload()` — 已处理多种 payload 结构
- `normalizeNode()` / `normalizeEdge()` — 已做宽松的字段匹配
- `materializeNodes()` — 已有 fallback 机制

## 6. 代码实现

### 6.1 新增 BaiduStructurerProvider

文件路径：`packages/providers/src/structurer/baidu-structurer.ts`

```typescript
import type { StructurerProviderConfig } from '@listen-graphic/schema';
import { OpenAIStructurerProvider } from './openai-structurer';

export class BaiduStructurerProvider extends OpenAIStructurerProvider {
  override name = 'baidu-structurer';

  constructor(config: StructurerProviderConfig) {
    super({
      ...config,
      endpoint: config.endpoint ?? 'https://qianfan.baidubce.com/v2',
      model: config.model ?? 'ernie-speed-8k',
    });
  }
}
```

### 6.2 修改 openai-structurer.ts

需要移除智谱专用的 `thinking` 参数逻辑，或改为按 type 判断：

```typescript
// 修改前（当前代码）
...(this.config.type === 'zhipu'
  ? { thinking: { type: 'disabled' } }
  : {}),

// 修改后
...(this.config.type === 'zhipu'
  ? { thinking: { type: 'disabled' } }
  : this.config.type === 'baidu'
  ? { temperature: 0.1 }  // 百度结构化任务建议低温度
  : {}),
```

或者直接在 `BaiduStructurerProvider` 中 override 整个请求逻辑。

### 6.3 修改 config.ts

在 `normalizeEntry` 中添加 baidu 分支：

```typescript
} else if (merged.type === 'baidu') {
  merged.endpoint = merged.endpoint ?? 'https://qianfan.baidubce.com/v2';
  if (!params.input?.model || params.input.type === 'baidu') {
    merged.model = params.input?.model ?? 'ernie-speed-8k';
  }
}
```

### 6.4 修改 registry.ts

```typescript
import { BaiduStructurerProvider } from './structurer/baidu-structurer';

// getStructurerProvider 中添加：
if (config.type === 'baidu') {
  requireProviderCredential(config, 'Baidu structurer provider');
  return new BaiduStructurerProvider(config);
}
```

### 6.5 移除 429 重试排除（可选）

```typescript
// config.ts — 如果希望百度 429 时自动重试
const DEFAULT_STRUCTURER_RETRY_POLICY: ProviderRetryPolicy = {
  ...DEFAULT_RETRY_POLICY,
  timeoutMs: 90_000,
  // 百度限流恢复快（0-60s），429 可以重试
  // retryableStatusCodes: DEFAULT_RETRY_POLICY.retryableStatusCodes.filter(s => s !== 429),
  retryableStatusCodes: DEFAULT_RETRY_POLICY.retryableStatusCodes,
};
```

## 7. 配置使用

### 7.1 环境变量

```bash
LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE=baidu
LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY=bce-v3/ALTAK-xxx/xxx
```

### 7.2 代码配置

```typescript
const config = {
  structurer: {
    type: 'baidu',
    mode: 'direct',
    model: 'ernie-speed-8k',
    endpoint: 'https://qianfan.baidubce.com/v2',
    apiKey: 'bce-v3/ALTAK-xxx/xxx',
    language: 'zh',
  },
};
```

### 7.3 Schema 类型

`StructurerProviderConfig.type` 需要在 schema 包中添加 `'baidu'` 联合类型。

## 8. 测试

### 8.1 快速验证 API 连通性

```bash
curl -X POST 'https://qianfan.baidubce.com/v2/chat/completions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer bce-v3/ALTAK-你的KEY' \
  -d '{
    "model": "ernie-speed-8k",
    "messages": [
      {"role": "system", "content": "Return only JSON. No markdown."},
      {"role": "user", "content": "Return {\"status\":\"ok\"}"}
    ]
  }'
```

### 8.2 运行 E2E 测试

```bash
LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE=baidu \
LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY=bce-v3/ALTAK-xxx/xxx \
pnpm --filter extension test:structure:real
```

### 8.3 并发压测

```bash
# 并发 10 个请求测试限流
for i in $(seq 1 10); do
  curl -s -o /dev/null -w "Request $i: %{http_code}\n" \
    -X POST 'https://qianfan.baidubce.com/v2/chat/completions' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $BAIDU_KEY" \
    -d '{"model":"ernie-speed-8k","messages":[{"role":"user","content":"hi"}]}' &
done
wait
```

## 9. 参考链接

- 免费开放公告：https://ai.baidu.com/ai-doc/WENXINWORKSHOP/wlwg8f1i3
- OpenAI 兼容接口：https://ai.baidu.com/ai-doc/WENXINWORKSHOP/2m3fihw8s
- ERNIE-Speed-8K 文档：https://ai.baidu.com/ai-doc/WENXINWORKSHOP/klqx7b1xf
- QPS/RPM/TPM 说明：https://qianfan.cloud.baidu.com/qianfandev/topic/362162
- 控制台（开通服务）：https://console.bce.baidu.com/qianfan/ais/console/onlineService
- API Key 管理：https://console.bce.baidu.com/iam/#/iam/apikey/list
