// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './dist/index.js', // 打包后的文件
      instances: 1, // 你可以设置多个实例
      autorestart: true,
      watch: false, // 不需要监听文件变动
      max_memory_restart: '2G', // 设置内存限制
    },
    {
      name: 'custom',
      script: './dist/index2.js', // 另一个打包后的文件
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
    },
  ],
};
