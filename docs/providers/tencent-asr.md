# 腾讯云 ASR 开发文档

> 本文档汇总了 ListenGraph 项目集成腾讯云 ASR 服务所需的所有官方文档、API 规范、示例代码和最佳实践。

## 📚 目录

- [联调 Checklist](./tencent-asr-smoke.md)
- [产品概述](#产品概述)
- [免费额度与定价](#免费额度与定价)
- [API 接入方式](#api-接入方式)
- [签名算法 TC3-HMAC-SHA256](#签名算法-tc3-hmac-sha256)
- [录音文件识别 API](#录音文件识别-api)
- [错误码参考](#错误码参考)
- [最佳实践](#最佳实践)
- [官方资源](#官方资源)

---

## 产品概述

### 服务类型

腾讯云 ASR 提供以下产品：

| 产品 | 描述 | 适用场景 |
|------|------|---------|
| **录音文件识别** | 提交录音文件，异步获取识别结果 | 会议录音、长视频字幕 |
| **录音文件识别极速版** | 更快的识别速度（10秒内） | 快速转写需求 |
| **实时语音识别** | WebSocket 流式识别，实时返回 | 语音输入、直播字幕 |
| **一句话识别** | 60秒内短语音，同步返回 | 语音搜索、语音指令 |
| **语音流异步识别** | 音频流异步识别 | 长音频流处理 |

### 引擎类型

| 引擎类型 | 描述 | 采样率 |
|---------|------|--------|
| `16k_zh` | 中文普通话 | 16kHz |
| `16k_zh_en` | 中英混合 | 16kHz |
| `16k_zh_large` | 中文大模型版 | 16kHz |
| `8k_zh` | 中文普通话 | 8kHz |
| `16k_en` | 英文 | 16kHz |

### 产品限制

- **音频格式**：PCM、WAV、MP3、OGG 等
- **音频时长**：录音文件识别 ≤ 5 小时
- **文件大小**：Base64 方式 ≤ 5MB，URL 方式 ≤ 1GB
- **声道数**：支持单声道和双声道
- **采样率**：8kHz 或 16kHz

---

## 免费额度与定价

### 免费额度（每月）

| 产品 | 免费额度 |
|------|---------|
| 录音文件识别 | **10 小时** |
| 实时语音识别 | **5 小时** |
| 一句话识别 | **5000 次** |
| 录音文件识别极速版 | **5 小时** |
| 语音流异步识别 | **5 小时** |

⚠️ **注意**：大模型版引擎**无免费额度**

### 价格（预付费）

| 产品 | 价格（元/小时） |
|------|----------------|
| 录音文件识别 | 1.5 ~ 0.7（阶梯价） |
| 实时语音识别 | 3.0 ~ 1.0 |
| 一句话识别 | 3.0 ~ 1.2 元/千次 |

### 价格（后付费）

| 产品 | 价格（元/小时） |
|------|----------------|
| 录音文件识别 | 1.75 ~ 0.95 |
| 实时语音识别 | 3.2 ~ 1.2 |
| 一句话识别 | 3.2 ~ 1.2 元/千次 |

### 免费并发

| 产品 | 免费额度 |
|------|---------|
| 实时语音识别 | 200 路 |
| 录音文件识别极速版 | 20 路 |
| 一句话识别 | 30 QPS |

---

## API 接入方式

### 接入方式选择

腾讯云 ASR 支持两种接入方式：

| 方式 | 优点 | 缺点 |
|------|------|------|
| **API（推荐）** | • 无需安装 SDK<br>• 直接 HTTP 调用<br>• 适合浏览器环境 | • 需自己实现签名 |
| **SDK** | • 封装好的签名<br>• 更简单的调用 | • **不适合 Web 前端**<br>• 会暴露密钥 |

⚠️ **安全警告**：
> 腾讯云官方明确警告：**请务必不要将 SDK 直接用于 Web 前端（包括小程序等），暴露密钥在这些环境非常不安全**

### ListenGraph 项目选择

本项目使用 **API 直接调用**，原因：

1. ✅ Chrome Extension 是浏览器环境，不能使用 SDK
2. ✅ OpenAI provider 也是直接 API 模式，保持一致
3. ✅ 使用 Web Crypto API 实现签名，安全可靠

### API 域名

```
https://asr.tencentcloudapi.com
```

### 公共参数（签名方法 v3）

所有 API 请求都需要在 HTTP Header 中携带：

| 参数 | 说明 | 示例 |
|------|------|------|
| `Authorization` | 签名 | `TC3-HMAC-SHA256 Credential=...` |
| `X-TC-Action` | 接口名称 | `CreateRecTask` |
| `X-TC-Version` | API 版本 | `2019-06-14` |
| `X-TC-Timestamp` | UNIX 时间戳 | `1527672334` |
| `X-TC-Region` | 地域（可选） | `ap-shanghai` |
| `Content-Type` | 内容类型 | `application/json` |

### 地域列表

| 地域 | 取值 |
|------|------|
| 华东地区(上海) | `ap-shanghai` ⭐ 推荐 |
| 华南地区(广州) | `ap-guangzhou` |
| 华北地区(北京) | `ap-beijing` |
| 西南地区(成都) | `ap-chengdu` |

---

## 签名算法 TC3-HMAC-SHA256

### 签名流程

```
┌─────────────────────────────────────────────────────┐
│ Step 1: 构建 CanonicalRequest                       │
│   HTTPRequestMethod + '\n'                          │
│   CanonicalURI + '\n'                               │
│   CanonicalQueryString + '\n'                       │
│   CanonicalHeaders + '\n'                           │
│   SignedHeaders + '\n'                              │
│   HashedRequestPayload                              │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Step 2: 构建 StringToSign                           │
│   Algorithm + '\n'                                  │
│   RequestTimestamp + '\n'                           │
│   CredentialScope + '\n'                            │
│   HashedCanonicalRequest                            │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Step 3: 计算签名                                    │
│   SecretDate = HMAC-SHA256("TC3"+SecretKey, Date)  │
│   SecretService = HMAC-SHA256(SecretDate, Service) │
│   SecretSigning = HMAC-SHA256(SecretService,       │
│                               "tc3_request")        │
│   Signature = Hex(HMAC-SHA256(SecretSigning,       │
│                               StringToSign))        │
└─────────────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────────────┐
│ Step 4: 构建 Authorization Header                   │
│   Algorithm Credential=SecretId/CredentialScope,   │
│   SignedHeaders=SignedHeaders,                     │
│   Signature=Signature                               │
└─────────────────────────────────────────────────────┘
```

### 代码示例（Web Crypto API）

```typescript
/**
 * 构建 Authorization Header
 */
async function buildAuthorization(
  payload: any,
  timestamp: number,
  secretId: string,
  secretKey: string,
  service: string = 'asr',
): Promise<string> {
  const date = new Date(timestamp * 1000).toISOString().split('T')[0];

  // Step 1: Canonical Request
  const httpRequestMethod = 'POST';
  const canonicalUri = '/';
  const canonicalQueryString = '';
  const canonicalHeaders = `content-type:application/json\nhost:asr.tencentcloudapi.com\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = await sha256Hex(JSON.stringify(payload));

  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  // Step 2: String To Sign
  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  
  const stringToSign = [
    algorithm,
    timestamp.toString(),
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  // Step 3: Calculate Signature
  const kDate = await hmacSha256(date, `TC3${secretKey}`);
  const kService = await hmacSha256(service, kDate);
  const kSigning = await hmacSha256('tc3_request', kService);
  const signature = await hmacSha256Hex(stringToSign, kSigning);

  // Step 4: Build Authorization
  return [
    `${algorithm} Credential=${secretId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');
}

/**
 * SHA256 Hash (返回 hex 字符串)
 */
async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 (返回 ArrayBuffer)
 */
async function hmacSha256(
  message: string,
  key: string | ArrayBuffer,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' 
    ? encoder.encode(key) 
    : new Uint8Array(key);
  const messageData = encoder.encode(message);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return await crypto.subtle.sign('HMAC', cryptoKey, messageData);
}

/**
 * HMAC-SHA256 (返回 hex 字符串)
 */
async function hmacSha256Hex(
  message: string,
  key: string | ArrayBuffer,
): Promise<string> {
  const signature = await hmacSha256(message, key);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

### 签名注意事项

1. **时间戳一致性**：`X-TC-Timestamp` 必须和签名中的 timestamp 一致
2. **时间戳误差**：与服务器时间差不能超过 **5 分钟**
3. **编码方式**：所有字符串使用 **UTF-8** 编码
4. **HTTP 方法**：录音文件识别使用 **POST**
5. **Content-Type**：必须包含在 SignedHeaders 中

---

## 录音文件识别 API

### API 1: CreateRecTask（创建识别任务）

#### 请求

```http
POST https://asr.tencentcloudapi.com
Content-Type: application/json
Authorization: TC3-HMAC-SHA256 Credential=...
X-TC-Action: CreateRecTask
X-TC-Version: 2019-06-14
X-TC-Timestamp: 1527672334
X-TC-Region: ap-shanghai

{
  "EngineModelType": "16k_zh",
  "ChannelNum": 1,
  "ResTextFormat": 0,
  "SourceType": 1,
  "Data": "base64_audio_data...",
  "DataLen": 12345
}
```

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `EngineModelType` | string | 是 | 引擎类型：`16k_zh`、`16k_zh_en` 等 |
| `ChannelNum` | integer | 是 | 声道数：1（单声道）或 2（双声道） |
| `ResTextFormat` | integer | 是 | 结果格式：0-词级详细，1-词级，2-句子级 |
| `SourceType` | integer | 是 | 音频来源：1-音频数据，0-URL |
| `Data` | string | 条件 | Base64 编码的音频数据（SourceType=1） |
| `DataLen` | integer | 条件 | 原始音频数据长度（字节） |
| `Url` | string | 条件 | 音频 URL（SourceType=0） |
| `SpeakerDiarization` | integer | 否 | 说话人分离：0-关闭，1-开启（仅双声道） |
| `FilterDirty` | integer | 否 | 脏话过滤：0-不过滤，1-过滤 |
| `FilterModal` | integer | 否 | 语气词过滤：0-不过滤，1-过滤 |
| `ConvertNumMode` | integer | 否 | 数字转换：0-不转换，1-转阿拉伯数字 |

#### 响应

```json
{
  "Response": {
    "RequestId": "req-xxx",
    "Data": {
      "TaskId": 1393265
    }
  }
}
```

#### 响应参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `RequestId` | string | 请求唯一标识 |
| `Data.TaskId` | integer | 任务 ID，用于查询状态 |

---

### API 2: DescribeTaskStatus（查询任务状态）

#### 请求

```http
POST https://asr.tencentcloudapi.com
Content-Type: application/json
Authorization: TC3-HMAC-SHA256 Credential=...
X-TC-Action: DescribeTaskStatus
X-TC-Version: 2019-06-14
X-TC-Timestamp: 1527672334
X-TC-Region: ap-shanghai

{
  "TaskId": 1393265
}
```

#### 响应（处理中）

```json
{
  "Response": {
    "RequestId": "req-xxx",
    "Data": {
      "TaskId": 1393265,
      "TaskStatus": 1,
      "StatusStr": "processing",
      "Result": null
    }
  }
}
```

#### 响应（完成）

```json
{
  "Response": {
    "RequestId": "req-xxx",
    "Data": {
      "TaskId": 1393265,
      "TaskStatus": 2,
      "StatusStr": "success",
      "Result": "这是识别出的完整文本...",
      "ResultDetail": [
        {
          "FinalSentence": "这是第一句话。",
          "StartMs": 0,
          "EndMs": 1500,
          "Confidence": 0.95,
          "Words": [
            {
              "Word": "这是",
              "OffsetMs": 0,
              "DurationMs": 400,
              "Confidence": 0.98
            }
          ]
        }
      ]
    }
  }
}
```

#### 任务状态

| 状态值 | 说明 |
|--------|------|
| 0 | 等待中 |
| 1 | 处理中 |
| 2 | 成功 |
| 3 | 失败 |
| 4 | 已取消 |

#### 响应参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `TaskId` | integer | 任务 ID |
| `TaskStatus` | integer | 任务状态（0-4） |
| `StatusStr` | string | 状态描述 |
| `Result` | string | 完整识别文本 |
| `ResultDetail` | array | 句子级详细信息 |
| `ResultDetail[].FinalSentence` | string | 单句文本 |
| `ResultDetail[].StartMs` | integer | 句子开始时间（毫秒） |
| `ResultDetail[].EndMs` | integer | 句子结束时间（毫秒） |
| `ResultDetail[].Confidence` | float | 识别置信度（0-1） |

---

## 错误码参考

### 公共错误码

| 错误码 | 说明 |
|--------|------|
| `AuthFailure` | 认证失败 |
| `AuthFailure.InvalidSecretId` | SecretId 不正确 |
| `AuthFailure.SignatureFailure` | 签名错误 |
| `AuthFailure.TokenFailure` | Token 错误 |
| `AuthFailure.MFAFailure` | MFA 错误 |
| `AuthFailure.SecretIdNotFound` | SecretId 不存在 |
| `AuthFailure.RequestTimeExpired` | 请求时间过期 |

### 业务错误码

| 错误码 | 说明 |
|--------|------|
| `InvalidParameter` | 参数错误 |
| `InvalidParameter.InvalidData` | 音频数据无效 |
| `InvalidParameter.InvalidUrl` | URL 无效 |
| `InvalidParameter.AudioTooLong` | 音频过长 |
| `InvalidParameter.AudioTooLarge` | 音频过大 |
| `InvalidParameter.AudioFormatInvalid` | 音频格式无效 |
| `InvalidParameter.AudioSilence` | 音频静音 |
| `RequestLimitExceeded` | 请求频率超限 |
| `ResourceNotFound` | 资源不存在 |
| `ResourceNotFound.TaskIdNotFound` | TaskId 不存在 |
| `InternalError` | 内部错误 |

### 错误响应格式

```json
{
  "Response": {
    "RequestId": "req-xxx",
    "Error": {
      "Code": "AuthFailure.SignatureFailure",
      "Message": "签名验证失败"
    }
  }
}
```

---

## 最佳实践

### 1. 音频预处理

```typescript
// 推荐音频参数
const RECOMMENDED_AUDIO_CONFIG = {
  sampleRate: 16000,    // 16kHz
  channels: 1,          // 单声道
  format: 'wav',        // WAV 格式
  bitDepth: 16,         // 16-bit
};
```

### 2. 切片策略

```typescript
// ListenGraph 项目采用 30 秒切片
const CHUNK_DURATION_SECONDS = 30;
const CHUNK_DURATION_SAMPLES = 16000 * 30; // 480,000 samples
```

### 3. 轮询策略

```typescript
// 推荐轮询参数
const POLL_CONFIG = {
  maxAttempts: 30,      // 最多轮询 30 次
  intervalMs: 2000,     // 每 2 秒查询一次
  totalTimeout: 60000,  // 总超时 60 秒
};
```

### 4. 错误重试

```typescript
// 可重试的错误
const RETRIABLE_ERRORS = [
  429,  // Rate limit
  500,  // Internal error
  502,  // Bad gateway
  503,  // Service unavailable
  504,  // Gateway timeout
];

// 不可重试的错误
const NON_RETRIABLE_ERRORS = [
  'AuthFailure',
  'InvalidParameter',
  'ResourceNotFound',
];
```

### 5. Base64 编码优化

```typescript
// 浏览器环境：使用原生 btoa
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 大文件优化：使用 FileReader + Blob
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // 移除 data:audio/wav;base64, 前缀
      resolve(base64.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

### 6. 成本优化

```typescript
// 1. 使用 16k_zh 而不是 16k_zh_large（更便宜）
// 2. 合并短音频，减少 API 调用次数
// 3. 利用每月 10 小时免费额度
// 4. 监控使用量，避免超额
```

---

## 官方资源

### 文档

- [产品文档](https://cloud.tencent.com/document/product/1093)
- [API 文档](https://cloud.tencent.com/document/api/1093)
- [录音文件识别](https://cloud.tencent.com/document/product/1093/48982)
- [签名方法 v3](https://cloud.tencent.com/document/api/1093/35641)
- [SDK 文档](https://cloud.tencent.com/document/sdk/Node.js)

### 控制台

- [ASR 控制台](https://console.cloud.tencent.com/asr)
- [API 密钥管理](https://console.cloud.tencent.com/cam/capi)
- [费用中心](https://console.cloud.tencent.com/expense)

### SDK 和示例

- [Node.js SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs)
- [签名实现](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/common/sign.ts)
- [ASR Client](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/master/src/services/asr/v20190614/asr_client.ts)

### 定价

- [产品定价](https://cloud.tencent.com/document/product/1093/35686)
- [价格计算器](https://buy.cloud.tencent.com/price/asr)

### 其他

- [服务等级协议 SLA](https://cloud.tencent.com/document/product/1093/39483)
- [常见问题 FAQ](https://cloud.tencent.com/document/product/1093/38831)

---

## 附录：完整示例代码

### TypeScript 实现

参见项目源代码：
- [TencentAsrProvider](../../packages/providers/src/asr/tencent-asr.ts)
- [签名实现](../../packages/providers/src/asr/tencent-asr.ts#L286)

### 测试代码

参见：
- [单元测试](../../packages/providers/src/asr/tencent-asr.test.ts)

---

## 更新记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-03-23 | 1.0.0 | 初始版本，集成录音文件识别 |

---

## 联系方式

如有问题，请联系：
- 项目：ListenGraph
- 集成者：AI Assistant
- 集成日期：2026-03-23
