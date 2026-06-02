# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Darwin App** is a distributed microservices-based monitoring and analytics platform (similar to Datadog) built on the Node-Universe framework (a Moleculer-based fork). It's designed as a SaaS solution providing metrics collection, log management, and subscription billing capabilities.

## Commands

### Development

```bash
# Start infrastructure (Kafka, MySQL, Redis, InfluxDB, Elasticsearch)
npm run start:infra

# Stop infrastructure
npm run stop:infra

# Start all services sequentially
npm run start:all

# Start individual services
npm run start:gateway
npm run start:auth
npm run start:user
npm run start:file
npm run start:metrics
npm run start:logs
npm run start:subscription
```

### Testing

```bash
# Run Jest tests
jest

# Run tests from a specific file
jest path/to/file.test.ts
```

### Build

```bash
# Build the gateway bundle
npm run build
```

### Database

```bash
# Run migrations
npm run migrate

# Seed database
npm run seed
```

## Architecture

### Microservices

The application consists of **7 independent microservices** communicating through Apache Kafka:

| Service | Path | Purpose |
|---------|------|---------|
| **Gateway** | `src/core/gateway/` | API entry point, request routing, WebSocket support |
| **Auth** | `src/core/auth/` | User authentication, JWT token management |
| **User** | `src/core/user/` | User profile management, tenant organization |
| **Metrics** | `src/apps/starlight/metrics/` | Metrics collection/processing (Prometheus, StatsD, DataDog, OTLP) |
| **Logs** | `src/apps/starlight/logs/` | Log ingestion, storage, search (Elasticsearch) |
| **Subscription** | `src/apps/starlight/subscription/` | Subscription plans, billing, quota management |
| **File** | `src/core/file/` | File upload and management |

### API Routing

- **Format**: `/api/:service/:version/:action`
- **Example**: `/api/metrics/v1/ingest`, `/api/logs/v1/search`

### Service Directory Structure

Each microservice follows this structure:

```
service-directory/
├── actions/          # API endpoints (public interface)
├── methods/          # Internal service methods (RPC)
├── events/           # Event handlers
├── types/            # TypeScript interfaces and types
├── constants/        # Service-specific constants
├── utils/            # Service-specific utilities
├── validators/       # Input validation (Joi schemas)
└── index.ts          # Service entry point
```

### Key Technologies

- **Framework**: Node-Universe (Moleculer fork)
- **Language**: TypeScript
- **Message Broker**: Apache Kafka
- **Databases**:
  - MySQL (Sequelize ORM) - Core business data
  - InfluxDB - Time-series metrics
  - Elasticsearch - Log storage and search
  - Redis - Caching and session management

### Database Tables

- **Core**: User, EmailAuth, WechatAuth, ScanAuth, IPBlackList
- **SaaS**: SubscriptionPlan, UserSubscription, UserQuota, QuotaUsageHistory, ApiKey, ApiKeyStats, PaymentOrder, Bill, BillItem

## Configuration

- **Main Config**: `src/config/index.ts`
- **Environment Files**: `.env.development`, `.env.production`, `.env.example`
- **Docker**: `docker/docker-compose.yml` for infrastructure services

## Important Conventions

- **Multi-Tenancy**: All data includes `tenantId` for tenant isolation
- **Service Isolation**: Each microservice has independent database connections
- **Event-Driven**: Services communicate via Kafka topics (`metrics-raw`, `logs-raw`, `subscription-events`, etc.)
- **Input Validation**: Use Joi schemas in `validators/` directories
- **State Management**: Each service maintains a `*State` type for in-memory state
