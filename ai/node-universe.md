# Node-Universe

> 基于 Node.js 环境的微服务框架

[![npm version](https://badge.fury.io/js/node-universe.svg)](https://badge.fury.io/js/node-universe)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)

## 🌟 简介

灵感来自宇宙中的恒星与行星，一个星系中可以有一个或多个恒星，恒星作为服务主体，为行星之间提供服务。Node-Universe 是一个现代化的微服务框架，提供了完整的微服务开发解决方案。

### ✨ 特性

- 🚀 **高性能**: 基于事件驱动的异步架构
- 🔧 **模块化**: 插件化设计，按需加载
- 🌐 **分布式**: 支持多种传输协议和服务发现
- 📊 **监控**: 内置性能指标和链路追踪
- 🛡️ **可靠性**: 熔断器、重试机制、负载均衡
- 🎯 **AOP支持**: 强大的钩子系统，支持面向切面编程
- 📝 **TypeScript**: 完整的类型定义支持

## 📦 安装

```bash
npm install node-universe
# 或
yarn add node-universe
```

## 🚀 快速开始

### 创建基本服务

```javascript
import { Star } from 'node-universe';

// 创建用户服务
const userService = {
  name: 'user',
  
  actions: {
    // 创建用户
    create: {
      params: {
        name: 'string',
        email: 'email'
      },
      handler(ctx) {
        const user = {
          id: Date.now(),
          ...ctx.params,
          createdAt: new Date()
        };
        this.logger.info('用户创建成功', user);
        return user;
      }
    },
    
    // 获取用户列表
    list: {
      cache: true, // 启用缓存
      handler(ctx) {
        return [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' }
        ];
      }
    }
  },
  
  // 钩子函数 - AOP支持
  hooks: {
    before: {
      '*': 'validateAuth', // 所有动作前验证权限
      'create': 'validateParams' // 创建前额外验证
    },
    after: {
      '*': 'logOperation', // 所有动作后记录日志
      'create': 'sendWelcomeEmail' // 创建后发送欢迎邮件
    },
    error: {
      '*': 'handleError' // 统一错误处理
    }
  },
  
  methods: {
    validateAuth(ctx) {
      // 权限验证逻辑
      if (!ctx.meta.user) {
        throw new Error('未授权访问');
      }
    },
    
    validateParams(ctx) {
      // 参数验证逻辑
      if (!ctx.params.name || ctx.params.name.length < 2) {
        throw new Error('用户名至少2个字符');
      }
    },
    
    logOperation(ctx, res) {
      this.logger.info(`操作完成: ${ctx.action.name}`, {
        params: ctx.params,
        result: res
      });
    },
    
    sendWelcomeEmail(ctx, res) {
      // 发送欢迎邮件逻辑
      this.logger.info(`发送欢迎邮件给: ${res.email}`);
    },
    
    handleError(ctx, err) {
      this.logger.error('操作失败', {
        action: ctx.action.name,
        error: err.message,
        params: ctx.params
      });
    }
  },
  
  // 生命周期钩子
  created() {
    this.logger.info('用户服务已创建');
  },
  
  started() {
    this.logger.info('用户服务已启动');
  }
};

// 创建并启动框架
const star = new Star({
  namespace: 'my-app',
  nodeID: 'node-1'
});

// 注册服务
star.createService(userService);

// 启动服务
star.start().then(() => {
  console.log('🚀 微服务启动成功!');
  
  // 调用服务
  star.call('user.create', {
    name: 'John Doe',
    email: 'john@example.com'
  }, {
    meta: { user: { id: 1 } } // 模拟用户认证信息
  }).then(result => {
    console.log('创建用户结果:', result);
  });
});
```

### 分布式服务示例

```javascript
// 服务A - 用户服务
const userStar = new Star({
  namespace: 'ecommerce',
  nodeID: 'user-service',
  transporter: {
    type: 'KAFKA',
    host: 'localhost:9092'
  }
});

// 服务B - 订单服务
const orderStar = new Star({
  namespace: 'ecommerce',
  nodeID: 'order-service',
  transporter: {
    type: 'KAFKA',
    host: 'localhost:9092'
  }
});

// 订单服务调用用户服务
const orderService = {
  name: 'order',
  actions: {
    create: {
      async handler(ctx) {
        // 验证用户是否存在
        const user = await ctx.call('user.get', { id: ctx.params.userId });
        
        // 创建订单
        const order = {
          id: Date.now(),
          userId: user.id,
          items: ctx.params.items,
          total: ctx.params.total,
          createdAt: new Date()
        };
        
        // 发送订单创建事件
        ctx.emit('order.created', order);
        
        return order;
      }
    }
  }
};

orderStar.createService(orderService);
```

## ⚙️ 配置选项

### 完整配置示例

```javascript
const options = {
  namespace: 'my-app', // 命名空间，用于服务隔离
  nodeID: 'node-1', // 节点ID，默认自动生成
  metadata: { // 节点元数据
    region: 'us-west-1',
    version: '1.0.0'
  },
  
  // 性能指标
  metrics: {
    enabled: true,
    reporter: {
      type: 'Console', // Console | Prometheus | Datadog
      options: {
        interval: 5000 // 报告间隔(ms)
      }
    }
  },
  
  // 日志配置
  logger: {
    type: 'console', // console | file | log4js | pino
    level: 'info', // trace | debug | info | warn | error | fatal
    options: {
      colors: true,
      moduleColors: false,
      formatter: 'full', // full | short | simple | json
      objectPrinter: null,
      autoPadding: false
    }
  },
  
  // 传输层配置
  transporter: {
    type: 'TCP', // TCP | NATS | MQTT | Redis | AMQP | KAFKA
    options: {
      host: 'localhost',
      port: 4222
    }
  },
  
  // 服务注册与发现
  registry: {
    strategy: 'RoundRobin', // RoundRobin | Random | CpuUsage | Latency
    preferLocal: true,
    discoverer: {
      type: 'Local', // Local | Etcd | Consul
      options: {
        heartbeatInterval: 15,
        heartbeatTimeout: 30,
        disableHeartbeatChecks: false,
        disableOfflineNodeRemoving: false,
        cleanOfflineNodesTimeout: 600
      }
    }
  },
  
  // 缓存配置
  cacher: {
    type: 'Memory', // Memory | Redis
    options: {
      ttl: 30, // 默认TTL(秒)
      maxKeys: 1000 // 最大缓存键数
    }
  },
  
  // 序列化器
  serializer: {
    type: 'JSON' // JSON | Avro | MsgPack | Notepack | ProtoBuf | Thrift
  },
  
  // 验证器
  validator: {
    type: 'Fastest' // Fastest | Joi
  },
  
  // 链路追踪
  tracing: {
    enabled: true,
    exporter: {
      type: 'Console', // Console | Jaeger | Zipkin | Datadog
      options: {
        endpoint: 'http://localhost:14268/api/traces'
      }
    }
  },
  
  // 熔断器
  circuitBreaker: {
    enabled: true,
    threshold: 0.5,
    minRequestCount: 20,
    windowTime: 60,
    halfOpenTime: 10
  },
  
  // 重试策略
  retryPolicy: {
    enabled: true,
    retries: 5,
    delay: 100,
    maxDelay: 1000,
    factor: 2
  },
  
  // 请求超时
  requestTimeout: 5000,
  
  // 最大调用级别(防止循环调用)
  maxCallLevel: 100,
  
  // 心跳间隔
  heartbeatInterval: 10,
  heartbeatTimeout: 30,
  
  // 跟踪参数变化
  tracking: {
    enabled: false,
    shutdownTimeout: 5000
  },
  
  // 关闭超时
  shutdownTimeout: 5000,
  
  // 中间件
  middlewares: [
    // 自定义中间件
  ]
};

const star = new Star(options);
```

## 📚 核心概念

### 服务 (Service)

服务是 Node-Universe 的基本构建块，每个服务包含一组相关的动作 (Actions)。

```javascript
const mathService = {
  name: 'math',
  version: '1.0.0',
  
  settings: {
    // 服务级别的设置
    precision: 2
  },
  
  actions: {
    add: {
      params: {
        a: 'number',
        b: 'number'
      },
      handler(ctx) {
        return ctx.params.a + ctx.params.b;
      }
    },
    
    divide: {
      params: {
        a: 'number',
        b: { type: 'number', min: 0.001 } // 避免除零
      },
      cache: {
        keys: ['a', 'b'],
        ttl: 60
      },
      handler(ctx) {
        const result = ctx.params.a / ctx.params.b;
        return Number(result.toFixed(this.settings.precision));
      }
    }
  },
  
  methods: {
    // 内部方法，不对外暴露
    formatNumber(num) {
      return Number(num.toFixed(this.settings.precision));
    }
  },
  
  events: {
    // 事件监听器
    'user.created'(payload, sender, eventName) {
      this.logger.info('收到用户创建事件', payload);
    }
  }
};
```

### 动作 (Actions)

动作是服务对外提供的接口，类似于 REST API 的端点。

```javascript
const userService = {
  name: 'user',
  actions: {
    // 基本动作
    get: {
      params: {
        id: 'number'
      },
      handler(ctx) {
        return this.users.find(u => u.id === ctx.params.id);
      }
    },
    
    // 带缓存的动作
    list: {
      cache: true, // 使用默认缓存设置
      handler(ctx) {
        return this.users;
      }
    },
    
    // 自定义缓存配置
    search: {
      params: {
        query: 'string'
      },
      cache: {
        keys: ['query'], // 缓存键
        ttl: 300 // 5分钟过期
      },
      handler(ctx) {
        return this.users.filter(u => 
          u.name.includes(ctx.params.query)
        );
      }
    },
    
    // 流式响应
    export: {
      handler(ctx) {
        const stream = new Readable({
          objectMode: true,
          read() {}
        });
        
        // 异步发送数据
        this.users.forEach(user => {
          stream.push(user);
        });
        stream.push(null); // 结束流
        
        return stream;
      }
    }
  }
};
```

### 上下文 (Context)

上下文对象包含了动作执行所需的所有信息。

```javascript
const service = {
  name: 'example',
  actions: {
    demo: {
      handler(ctx) {
        // 请求参数
        console.log('参数:', ctx.params);
        
        // 元数据 (用户信息、请求ID等)
        console.log('元数据:', ctx.meta);
        
        // 调用其他服务
        const user = await ctx.call('user.get', { id: 1 });
        
        // 发送事件
        ctx.emit('demo.executed', { userId: 1 });
        
        // 广播事件到所有节点
        ctx.broadcast('global.event', { data: 'test' });
        
        return { success: true };
      }
    }
  }
};
```

## 🎯 钩子系统 (Hooks) - AOP 支持

钩子系统提供了强大的面向切面编程能力，允许在动作执行的不同阶段插入自定义逻辑。

### 钩子类型

```javascript
const service = {
  name: 'user',
  
  hooks: {
    // 前置钩子 - 在动作执行前运行
    before: {
      '*': ['authenticate', 'rateLimit'], // 所有动作
      'create': 'validateInput', // 特定动作
      'update': ['validateInput', 'checkPermission']
    },
    
    // 后置钩子 - 在动作成功执行后运行
    after: {
      '*': 'logAccess',
      'create': ['sendNotification', 'updateCache'],
      'delete': 'clearCache'
    },
    
    // 错误钩子 - 在动作执行出错时运行
    error: {
      '*': 'logError',
      'payment.*': 'handlePaymentError' // 支持通配符
    }
  },
  
  methods: {
    // 认证钩子
    authenticate(ctx) {
      if (!ctx.meta.user) {
        throw new Error('未授权访问');
      }
    },
    
    // 限流钩子
    rateLimit(ctx) {
      const key = `rate_limit:${ctx.meta.user.id}`;
      // 实现限流逻辑
    },
    
    // 输入验证钩子
    validateInput(ctx) {
      // 自定义验证逻辑
      if (ctx.action.name === 'create' && !ctx.params.email) {
        throw new Error('邮箱不能为空');
      }
    },
    
    // 权限检查钩子
    checkPermission(ctx) {
      const action = ctx.action.name;
      const userRole = ctx.meta.user.role;
      
      if (action === 'delete' && userRole !== 'admin') {
        throw new Error('权限不足');
      }
    },
    
    // 访问日志钩子
    logAccess(ctx, res) {
      this.logger.info('动作执行完成', {
        action: ctx.action.name,
        user: ctx.meta.user?.id,
        duration: ctx.duration,
        success: true
      });
    },
    
    // 错误处理钩子
    logError(ctx, err) {
      this.logger.error('动作执行失败', {
        action: ctx.action.name,
        error: err.message,
        stack: err.stack,
        params: ctx.params
      });
    }
  }
};
```

### 动作级别钩子

```javascript
const service = {
  name: 'order',
  actions: {
    create: {
      // 动作级别的钩子
      hooks: {
        before: 'validateOrder',
        after: ['sendConfirmation', 'updateInventory'],
        error: 'rollbackOrder'
      },
      
      handler(ctx) {
        // 创建订单逻辑
        return { id: Date.now(), ...ctx.params };
      }
    }
  },
  
  methods: {
    validateOrder(ctx) {
      // 订单验证逻辑
    },
    
    sendConfirmation(ctx, result) {
      // 发送确认邮件
    },
    
    updateInventory(ctx, result) {
      // 更新库存
    },
    
    rollbackOrder(ctx, err) {
      // 回滚订单
    }
  }
};
```

## 🔄 事件系统

事件系统支持服务间的异步通信和解耦。

### 发送事件

```javascript
const userService = {
  name: 'user',
  actions: {
    create: {
      async handler(ctx) {
        const user = await this.createUser(ctx.params);
        
        // 发送本地事件
        ctx.emit('user.created', user);
        
        // 广播到所有节点
        ctx.broadcast('user.registered', {
          userId: user.id,
          timestamp: Date.now()
        });
        
        return user;
      }
    }
  }
};
```

### 监听事件

```javascript
const emailService = {
  name: 'email',
  
  events: {
    // 监听用户创建事件
    'user.created': {
      group: 'email', // 事件组，用于负载均衡
      handler(payload, sender, eventName, ctx) {
        return this.sendWelcomeEmail(payload.email);
      }
    },
    
    // 监听多个事件
    'user.*': {
      handler(payload, sender, eventName, ctx) {
        this.logger.info(`收到用户事件: ${eventName}`, payload);
      }
    },
    
    // 异步事件处理
    'order.created': {
      async handler(payload) {
        await this.processOrder(payload);
      }
    }
  },
  
  methods: {
    sendWelcomeEmail(email) {
      this.logger.info(`发送欢迎邮件到: ${email}`);
      // 实际发送邮件逻辑
    },
    
    async processOrder(order) {
      // 处理订单逻辑
    }
  }
};
```

## 🔌 中间件系统

中间件提供了扩展框架功能的机制。

### 内置中间件

```javascript
const star = new Star({
  middlewares: [
    // 请求ID中间件
    {
      name: 'RequestID',
      localAction(handler, action) {
        return function(ctx) {
          ctx.requestID = ctx.requestID || generateUUID();
          return handler(ctx);
        };
      }
    },
    
    // 性能监控中间件
    {
      name: 'Metrics',
      localAction(handler, action) {
        return async function(ctx) {
          const start = Date.now();
          try {
            const result = await handler(ctx);
            this.metrics.increment(`action.${action.name}.success`);
            this.metrics.timing(`action.${action.name}.duration`, Date.now() - start);
            return result;
          } catch (err) {
            this.metrics.increment(`action.${action.name}.error`);
            throw err;
          }
        };
      }
    },
    
    // 缓存中间件
    {
      name: 'Cache',
      localAction(handler, action) {
        if (!action.cache) return handler;
        
        return async function(ctx) {
          const cacheKey = this.getCacheKey(action.name, ctx.params);
          
          // 尝试从缓存获取
          let result = await this.cacher.get(cacheKey);
          if (result) {
            return result;
          }
          
          // 执行动作并缓存结果
          result = await handler(ctx);
          await this.cacher.set(cacheKey, result, action.cache.ttl);
          
          return result;
        };
      }
    }
  ]
});
```

### 自定义中间件

```javascript
// 自定义认证中间件
const AuthMiddleware = {
  name: 'Auth',
  
  // 本地动作中间件
  localAction(handler, action) {
    // 跳过不需要认证的动作
    if (action.auth === false) {
      return handler;
    }
    
    return async function(ctx) {
      const token = ctx.meta.authorization;
      if (!token) {
        throw new Error('缺少认证令牌');
      }
      
      try {
        const user = await this.verifyToken(token);
        ctx.meta.user = user;
        return handler(ctx);
      } catch (err) {
        throw new Error('认证失败');
      }
    };
  },
  
  // 远程调用中间件
  remoteAction(handler, action) {
    return function(ctx) {
      // 传递认证信息到远程服务
      if (ctx.meta.user) {
        ctx.meta.authorization = ctx.meta.authorization;
      }
      return handler(ctx);
    };
  },
  
  // 事件中间件
  localEvent(handler, event) {
    return function(payload, sender, eventName, ctx) {
      this.logger.debug(`处理事件: ${eventName}`, { sender, payload });
      return handler(payload, sender, eventName, ctx);
    };
  }
};

// 使用中间件
const star = new Star({
  middlewares: [AuthMiddleware]
});
```

## 🚦 错误处理

### 错误类型

```javascript
import { 
  ValidationError, 
  ServiceNotFoundError, 
  RequestTimeoutError,
  MaxCallLevelError,
  ServiceNotAvailableError
} from 'node-universe';

const service = {
  name: 'user',
  actions: {
    create: {
      params: {
        name: 'string',
        email: 'email'
      },
      handler(ctx) {
        // 业务逻辑错误
        if (this.userExists(ctx.params.email)) {
          throw new ValidationError('用户已存在', 'USER_EXISTS', {
            email: ctx.params.email
          });
        }
        
        try {
          return this.createUser(ctx.params);
        } catch (err) {
          // 包装系统错误
          throw new Error(`创建用户失败: ${err.message}`);
        }
      }
    }
  },
  
  // 全局错误处理
  errorHandler(err, ctx) {
    if (err instanceof ValidationError) {
      this.logger.warn('验证错误', {
        action: ctx.action.name,
        error: err.message,
        data: err.data
      });
    } else {
      this.logger.error('未知错误', {
        action: ctx.action.name,
        error: err.message,
        stack: err.stack
      });
    }
    
    // 重新抛出错误
    throw err;
  }
};
```

### 熔断器

```javascript
const star = new Star({
  circuitBreaker: {
    enabled: true,
    threshold: 0.5, // 50% 错误率触发熔断
    minRequestCount: 20, // 最小请求数
    windowTime: 60, // 时间窗口(秒)
    halfOpenTime: 10 // 半开状态持续时间(秒)
  }
});

// 服务级别熔断器配置
const service = {
  name: 'external-api',
  settings: {
    circuitBreaker: {
      threshold: 0.3, // 覆盖全局配置
      windowTime: 30
    }
  },
  
  actions: {
    call: {
      // 动作级别熔断器
      circuitBreaker: {
        enabled: true,
        threshold: 0.2
      },
      handler(ctx) {
        // 调用外部API
        return this.callExternalAPI(ctx.params);
      }
    }
  }
};
```

## 📊 监控和指标

### 内置指标

```javascript
const star = new Star({
  metrics: {
    enabled: true,
    reporter: {
      type: 'Prometheus',
      options: {
        port: 3030,
        path: '/metrics'
      }
    }
  }
});

// 自定义指标
const service = {
  name: 'user',
  
  created() {
    // 注册自定义指标
    this.metrics.register({
      name: 'user_registrations_total',
      type: 'counter',
      help: '用户注册总数'
    });
    
    this.metrics.register({
      name: 'user_login_duration',
      type: 'histogram',
      help: '用户登录耗时',
      buckets: [0.1, 0.5, 1, 2, 5]
    });
  },
  
  actions: {
    register: {
      handler(ctx) {
        const user = this.createUser(ctx.params);
        
        // 增加计数器
        this.metrics.increment('user_registrations_total', {
          method: 'email'
        });
        
        return user;
      }
    },
    
    login: {
      handler(ctx) {
        const timer = this.metrics.timer('user_login_duration');
        
        try {
          const result = this.authenticateUser(ctx.params);
          timer.end({ status: 'success' });
          return result;
        } catch (err) {
          timer.end({ status: 'error' });
          throw err;
        }
      }
    }
  }
};
```

## 🔍 链路追踪

```javascript
const star = new Star({
  tracing: {
    enabled: true,
    exporter: {
      type: 'Jaeger',
      options: {
        endpoint: 'http://localhost:14268/api/traces',
        serviceName: 'my-service'
      }
    },
    sampling: {
      rate: 1.0 // 100% 采样率
    }
  }
});

// 在服务中使用追踪
const service = {
  name: 'order',
  actions: {
    create: {
      async handler(ctx) {
        // 创建子span
        const span = ctx.startSpan('validate-order');
        try {
          await this.validateOrder(ctx.params);
          span.setTag('validation', 'success');
        } catch (err) {
          span.setTag('error', true);
          span.log({ error: err.message });
          throw err;
        } finally {
          span.finish();
        }
        
        // 调用其他服务会自动传播追踪上下文
        const user = await ctx.call('user.get', { id: ctx.params.userId });
        
        return this.createOrder(ctx.params, user);
      }
    }
  }
};
```

## 🏗️ 最佳实践

### 1. 服务设计原则

```javascript
// ✅ 好的服务设计
const userService = {
  name: 'user',
  version: '1.0.0',
  
  // 明确的设置
  settings: {
    defaultFields: ['id', 'name', 'email'],
    maxPageSize: 100
  },
  
  actions: {
    // 单一职责
    get: {
      params: {
        id: 'number',
        fields: { type: 'array', optional: true }
      },
      handler(ctx) {
        const fields = ctx.params.fields || this.settings.defaultFields;
        return this.getUserById(ctx.params.id, fields);
      }
    },
    
    // 输入验证
    create: {
      params: {
        name: { type: 'string', min: 2, max: 50 },
        email: 'email',
        age: { type: 'number', min: 0, max: 150, optional: true }
      },
      handler(ctx) {
        return this.createUser(ctx.params);
      }
    }
  },
  
  methods: {
    // 可复用的方法
    getUserById(id, fields) {
      const user = this.users.find(u => u.id === id);
      if (!user) {
        throw new Error('用户不存在');
      }
      return this.selectFields(user, fields);
    },
    
    selectFields(obj, fields) {
      const result = {};
      fields.forEach(field => {
        if (obj.hasOwnProperty(field)) {
          result[field] = obj[field];
        }
      });
      return result;
    }
  }
};
```

### 2. 错误处理最佳实践

```javascript
const service = {
  name: 'payment',
  
  actions: {
    process: {
      params: {
        amount: 'number',
        currency: 'string',
        cardToken: 'string'
      },
      
      async handler(ctx) {
        try {
          // 验证支付信息
          await this.validatePayment(ctx.params);
          
          // 处理支付
          const result = await this.processPayment(ctx.params);
          
          // 记录成功
          this.logger.info('支付成功', {
            amount: ctx.params.amount,
            transactionId: result.id
          });
          
          return result;
          
        } catch (err) {
          // 分类错误处理
          if (err.code === 'INSUFFICIENT_FUNDS') {
            throw new ValidationError('余额不足', err.code, {
              available: err.available,
              required: ctx.params.amount
            });
          } else if (err.code === 'CARD_DECLINED') {
            throw new ValidationError('银行卡被拒绝', err.code);
          } else {
            // 记录未知错误
            this.logger.error('支付处理失败', {
              error: err.message,
              params: ctx.params
            });
            throw new Error('支付处理失败，请稍后重试');
          }
        }
      }
    }
  }
};
```

### 3. 性能优化

```javascript
const service = {
  name: 'product',
  
  actions: {
    // 使用缓存
    list: {
      cache: {
        keys: ['category', 'page', 'limit'],
        ttl: 300 // 5分钟缓存
      },
      params: {
        category: { type: 'string', optional: true },
        page: { type: 'number', default: 1, min: 1 },
        limit: { type: 'number', default: 20, min: 1, max: 100 }
      },
      handler(ctx) {
        return this.getProducts(ctx.params);
      }
    },
    
    // 批量操作
    getBatch: {
      params: {
        ids: { type: 'array', items: 'number', max: 100 }
      },
      handler(ctx) {
        // 一次查询多个产品，而不是循环调用单个查询
        return this.getProductsByIds(ctx.params.ids);
      }
    }
  },
  
  methods: {
    async getProducts({ category, page, limit }) {
      // 使用数据库分页而不是内存分页
      const offset = (page - 1) * limit;
      return this.db.products.find({
        category,
        limit,
        offset
      });
    }
  }
};
```

## 🧪 测试

### 单元测试

```javascript
import { ServiceBroker } from 'node-universe';
import UserService from '../services/user.service';

describe('用户服务测试', () => {
  let broker;
  
  beforeAll(async () => {
    broker = new ServiceBroker({ logger: false });
    broker.createService(UserService);
    await broker.start();
  });
  
  afterAll(async () => {
    await broker.stop();
  });
  
  test('应该创建用户', async () => {
    const user = await broker.call('user.create', {
      name: 'Test User',
      email: 'test@example.com'
    });
    
    expect(user).toHaveProperty('id');
    expect(user.name).toBe('Test User');
    expect(user.email).toBe('test@example.com');
  });
  
  test('应该验证邮箱格式', async () => {
    await expect(
      broker.call('user.create', {
        name: 'Test User',
        email: 'invalid-email'
      })
    ).rejects.toThrow('邮箱格式不正确');
  });
});
```

### 集成测试

```javascript
import { ServiceBroker } from 'node-universe';
import UserService from '../services/user.service';
import EmailService from '../services/email.service';

describe('用户注册流程测试', () => {
  let broker;
  
  beforeAll(async () => {
    broker = new ServiceBroker({
      logger: false,
      transporter: 'fake' // 使用假传输器进行测试
    });
    
    broker.createService(UserService);
    broker.createService(EmailService);
    
    await broker.start();
  });
  
  test('用户注册应该发送欢迎邮件', async () => {
    const emailSpy = jest.spyOn(broker.getLocalService('email'), 'sendWelcomeEmail');
    
    await broker.call('user.register', {
      name: 'New User',
      email: 'newuser@example.com'
    });
    
    // 等待事件处理
    await broker.Promise.delay(100);
    
    expect(emailSpy).toHaveBeenCalledWith('newuser@example.com');
  });
});
```

## 📖 API 参考

### Star 类

```typescript
class Star {
  constructor(options?: StarOptions);
  
  // 创建服务
  createService(schema: ServiceSchema): Service;
  
  // 启动框架
  start(): Promise<void>;
  
  // 停止框架
  stop(): Promise<void>;
  
  // 调用服务动作
  call<T = any>(actionName: string, params?: any, opts?: CallOptions): Promise<T>;
  
  // 发送事件
  emit(eventName: string, payload?: any, groups?: string[]): void;
  
  // 广播事件
  broadcast(eventName: string, payload?: any, groups?: string[]): void;
  
  // 等待服务
  waitForServices(serviceNames: string[], timeout?: number): Promise<void>;
}
```

### 服务模式

```typescript
interface ServiceSchema {
  name: string;
  version?: string;
  settings?: any;
  metadata?: any;
  
  actions?: { [key: string]: ActionSchema };
  methods?: { [key: string]: Function };
  events?: { [key: string]: EventSchema };
  
  hooks?: ServiceHooks;
  
  created?(): void;
  started?(): Promise<void>;
  stopped?(): Promise<void>;
}

interface ActionSchema {
  params?: any;
  handler: ActionHandler;
  cache?: boolean | CacheOptions;
  hooks?: ActionHooks;
}
```

## 🤝 贡献

我们欢迎所有形式的贡献！请查看 [贡献指南](CONTRIBUTING.md) 了解详情。

### 开发环境设置

```bash
# 克隆仓库
git clone https://github.com/your-org/node-universe.git
cd node-universe

# 安装依赖
npm install

# 运行测试
npm test

# 构建项目
npm run build

# 运行示例
npm run example
```

## 📄 许可证

本项目采用 [ISC 许可证](LICENSE)。

## 🔗 相关链接

- [官方文档](https://node-universe.docs.com)
- [示例项目](https://github.com/your-org/node-universe-examples)
- [更新日志](CHANGELOG.md)
- [问题反馈](https://github.com/your-org/node-universe/issues)

## ❓ 常见问题

### Q: 如何在生产环境中部署？

A: 推荐使用 Docker 容器化部署，配置适当的环境变量和健康检查。

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Q: 如何处理服务间的认证？

A: 使用 JWT 令牌在服务间传递认证信息，配合中间件进行统一处理。

### Q: 如何实现服务的版本控制？

A: 在服务名称中包含版本号，如 `user.v1.create`，或使用服务的 `version` 属性。

---

**Node-Universe** - 让微服务开发变得简单而强大！ 🚀
s