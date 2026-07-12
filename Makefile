# ====== Ticket Hunter — 抢票小程序 Makefile ======

.PHONY: help up down logs restart ps seed

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' Makefile | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

up: ## 启动全部服务
	docker compose -f docker-compose.ticket.yml up -d --build

down: ## 停止全部服务
	docker compose -f docker-compose.ticket.yml down

logs: ## 查看所有日志
	docker compose -f docker-compose.ticket.yml logs -f

restart: ## 重启全部服务
	docker compose -f docker-compose.ticket.yml down && docker compose -f docker-compose.ticket.yml up -d --build

ps: ## 查看服务状态
	docker compose -f docker-compose.ticket.yml ps

seed: ## 灌入演示数据
	cd worker && npx tsx src/seed.ts

# ---- 本地开发 ----
dev-db: ## 仅启动数据库和Redis
	docker compose -f docker-compose.ticket.yml up -d ticket-db ticket-redis

dev-backend: ## 本地启动后端 (先执行 make dev-db)
	cd backend && npx tsx src/index.ts

dev-worker: ## 本地启动Worker (先执行 make dev-db)
	cd worker && npx tsx src/index.ts

install: ## 安装后端和Worker依赖
	cd backend && npm install
	cd worker && npm install

migrate: ## 运行数据库迁移
	cd backend && npx tsx src/db/migrate.ts
