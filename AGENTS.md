# Ticket Hunter v2.0

高并发文体娱抢票系统（Fastify 5 + Redis 7 Lua 原子扣减 + PostgreSQL 16 + 微信小程序）。

## 用途与 Target 判定

| 平台 | 需要? | 方式 |
|------|-------|------|
| 移动端 | 可选 | 微信小程序（`miniapp/`）为主客户端；原生 Android/iOS 壳可选（未做） |
| 智能硬件 | 不适用 | 票务库存与交易服务，无穿戴传感器输入需求 |

## 命令

```bash
make install          # 安装 backend/ 与 worker/ 依赖
make dev-db           # 启动 PostgreSQL 16 + Redis 7 容器
make migrate          # 执行数据库迁移
make seed             # 灌入演示数据
make dev-backend      # 启动 Fastify API + WebSocket (:4000)
make dev-worker       # 启动异步落库 Worker
```

## Harness / Loop（助手）

- 遵循根 `/Users/skat/AGENTS.md`：**Harness Engineering** + **Loop Engineering**
- Guide = 本文件；Sensor = 后端构建与自动化测试 / 压测脚本
- 同类失误第二次 → 沉淀进规则或测试（棘轮）

## 验证环 / Done

```bash
cd backend && npm run build
# 需本地 Redis/PG 运行时：
cd backend && npx tsx src/benchmark.ts
```

**Done 示例**：`backend` TypeScript 编译通过；Redis/PG 就绪时预检与 Lua 原子抢票零超卖。
