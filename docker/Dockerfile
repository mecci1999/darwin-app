# 使用 Node.js 官方镜像
FROM node:20.18.1 AS build

# 设置工作目录
WORKDIR /usr/src/app

# 安装构建工具，包括 Python、make 和 g++
# RUN apk add --no-cache \
#     python3 \
#     py3-pip \
#     make \
#     g++ \
#     && apk add --no-cache --virtual .build-deps gcc libc-dev python3-dev \
#     && apk add --no-cache libmagic

# 安装构建工具
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    && apt-get clean

# 复制 package.json 和 yarn.lock
COPY package.json yarn.lock ./

# 删除任何现有的 node_modules，强制重新安装所有依赖
RUN rm -rf node_modules

# 安装依赖
RUN yarn install --frozen-lockfile --build-from-source

# 将源代码复制到容器内
COPY . .

# 安装 pm2 作为全局依赖
RUN yarn global add pm2 prebuild-install node-gyp

# 设置环境变量为生产环境
ENV NODE_ENV=production

# 构建项目
RUN yarn build:fengyuServer

# 使用 pm2 启动 gateway.js 和 custom.js 文件
CMD ["pm2-runtime", "ecosystem.config.js"]

EXPOSE 6666

