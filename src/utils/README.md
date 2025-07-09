# 响应工具类迁移指南

## 概述

`ResponseUtils` 类已从网关专用工具类中提取到公共工具类中，现在可以被所有微服务使用。

## 使用方法

### 导入

```typescript
import { ResponseUtils } from '../utils';
// 或者
import { ResponseUtils } from 'utils';
```

### 创建标准响应

```typescript
const response = ResponseUtils.createResponse(
  200,
  { userId: 123, name: 'John' },
  'success',
  ResponseCode.Success,
  true
);
```

### 创建错误响应

```typescript
const errorResponse = ResponseUtils.createErrorResponse({
  code: 500,
  message: 'Internal Server Error',
  data: { code: ResponseCode.ServiceActionFaild }
});
```

## 迁移说明

### 从 GatewayUtils 迁移

**旧方式：**
```typescript
import { GatewayUtils } from '../gateway/utils/gateway-utils';

const response = GatewayUtils.createResponse(200, data, 'success', ResponseCode.Success);
const errorResponse = GatewayUtils.createErrorResponse(error);
```

**新方式：**
```typescript
import { ResponseUtils } from '../utils';

const response = ResponseUtils.createResponse(200, data, 'success', ResponseCode.Success);
const errorResponse = ResponseUtils.createErrorResponse(error);
```

### 向后兼容性

为了保持向后兼容性，`GatewayUtils` 中的响应方法仍然可用，但已标记为 `@deprecated`。建议逐步迁移到新的 `ResponseUtils` 类。

## 优势

1. **代码复用**：所有微服务都可以使用相同的响应格式
2. **一致性**：确保整个应用的响应格式统一
3. **维护性**：集中管理响应格式逻辑
4. **可扩展性**：更容易添加新的响应工具方法