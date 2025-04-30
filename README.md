## 微服务应用

底层框架使用的是node-universe，是基于moleculer微服务框架二次开发，使用TypeScript语言开发。

### 项目启动

需要使用docker部署启动对应的服务，例如kafka、mysql等，然后执行以下命令启动对应的服务，具体启动的服务根据实际项目的启动配置项

```bash
npm install
npm start:`${服务名}`
```

#### 注意

请先启动网关服务gateway