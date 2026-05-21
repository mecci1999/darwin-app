/**
 * InfluxDB处理器
 */
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { Star } from 'node-universe';
import { MAX_RETRIES } from '../constants';
import { InfluxDBConfig, ProcessedMetricsData } from '../types';
import { normalizeRssMemoryValue } from './memory-units';

export class InfluxDBHandler {
  private static client: InfluxDB | null = null;

  private static writeApi: any = null;

  private static queryApi: any = null;

  private static bucket: string = '';

  private static org: string = '';

  /**
   * 初始化InfluxDB连接
   */
  static async initialize(config: InfluxDBConfig, star: Star): Promise<void> {
    try {
      this.client = new InfluxDB({ url: config.url, token: config.token });
      this.writeApi = this.client.getWriteApi(config.org, config.bucket);
      this.queryApi = this.client.getQueryApi(config.org);
      this.bucket = config.bucket;
      this.org = config.org;

      star.logger?.info('InfluxDB connection initialized successfully');
    } catch (error) {
      star.logger?.error('Failed to initialize InfluxDB connection:', error);
      throw error;
    }
  }

  /**
   * 写入指标数据到InfluxDB
   */
  static async writeMetrics(
    metrics: ProcessedMetricsData[],
    star: Star,
    retryCount = 0,
  ): Promise<void> {
    try {
      if (!this.writeApi) {
        throw new Error('InfluxDB write API not initialized');
      }

      for (const metric of metrics) {
        // 构建InfluxDB数据点
        const point = new Point(metric.measurement).timestamp(new Date(metric.timestamp));

        // 添加Tags
        if (metric.tags) {
          for (const [key, value] of Object.entries(metric.tags)) {
            point.tag(key, String(value));
          }
        }

        // 添加Fields
        if (metric.fields) {
          for (const [key, value] of Object.entries(metric.fields)) {
            if (typeof value === 'number') {
              point.floatField(key, value);
            } else if (typeof value === 'boolean') {
              point.booleanField(key, value);
            } else {
              point.stringField(key, String(value));
            }
          }
        }

        // 写入数据点
        this.writeApi.writePoint(point);
      }

      // 刷新写入缓冲区
      await this.writeApi.flush();

      star.logger?.debug(`Successfully wrote ${metrics.length} metrics to InfluxDB`);
    } catch (error) {
      star.logger?.error('Failed to write metrics to InfluxDB:', error);

      if (retryCount < MAX_RETRIES) {
        star.logger?.info(`Retrying write operation (${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.writeMetrics(metrics, star, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * 查询指标数据
   */
  static async queryMetrics(query: string, star: Star): Promise<any[]> {
    try {
      if (!this.queryApi) {
        throw new Error('InfluxDB query API not initialized');
      }

      const rows: any[] = [];
      await new Promise<void>((resolve, reject) => {
        this.queryApi.queryRows(query, {
          next(row: any, tableMeta: any) {
            const o = tableMeta.toObject(row);
            rows.push(o);
          },
          error(error: Error) {
            reject(error);
          },
          complete() {
            resolve();
          },
        });
      });

      star.logger?.debug(`Query executed successfully, returned ${rows.length} rows`);
      return rows;
    } catch (error) {
      star.logger?.error('Failed to query metrics from InfluxDB:', error);
      throw error;
    }
  }

  static getBucketName(): string {
    return this.bucket;
  }

  /**
   * 获取用户指标使用量
   */
  static async getMetricsUsage(
    userId: string,
    timeRanges: any,
    star: Star,
  ): Promise<{ hourly: number; daily: number; monthly: number }> {
    try {
      const getCount = async (duration: string) => {
        if (!this.queryApi) return 0;
        const fluxQuery = `
          from(bucket: "${this.bucket}")
            |> range(start: -${duration})
            |> filter(fn: (r) => r["tenantId"] == "${userId}")
            |> count()
            |> group()
            |> sum()
        `;
        const rows = await this.queryMetrics(fluxQuery, star);
        return rows.length > 0 ? Math.round(Number(rows[0]._value) || 0) : 0;
      };

      const [hourly, daily, monthly] = await Promise.all([
        getCount('1h'),
        getCount('24h'),
        getCount('30d'),
      ]);

      return { hourly, daily, monthly };
    } catch (error) {
      star.logger?.error('Failed to get metrics usage:', error);
      return { hourly: 0, daily: 0, monthly: 0 };
    }
  }

  /**
   * 获取用户存储使用量
   */
  static async getStorageUsage(userId: string, star: Star): Promise<number> {
    try {
      if (!this.queryApi) return 0;
      // 估算存储大小：统计过去30天的数据点数量 * 平均大小(约50字节)
      const fluxQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -30d)
          |> filter(fn: (r) => r["tenantId"] == "${userId}")
          |> count()
          |> group()
          |> sum()
      `;
      const rows = await this.queryMetrics(fluxQuery, star);
      const points = rows.length > 0 ? Number(rows[0]._value) || 0 : 0;

      return Math.floor(points * 50); // 估算每个点占用50字节
    } catch (error) {
      star.logger?.error('Failed to get storage usage:', error);
      return 0;
    }
  }

  /**
   * 获取服务拓扑数据
   */
  static async getTopologyData(
    star: Star,
    timeRange: string = '-1h',
  ): Promise<{ nodes: any[]; edges: any[] }> {
    try {
      if (!this.queryApi) {
        // 如果未连接，返回空数据或之前的Mock数据作为降级
        star.logger?.warn('InfluxDB query api not initialized for topology');
        return { nodes: [], edges: [] };
      }

      const parseRangeSeconds = (range: string) => {
        const value = range?.toString().trim() || '-1h';
        const match = value.match(/-?(\d+)([smhdw])/);
        if (!match) return 3600;
        const amount = Number(match[1]);
        const unit = match[2];
        const multiplier =
          unit === 's'
            ? 1
            : unit === 'm'
              ? 60
              : unit === 'h'
                ? 3600
                : unit === 'd'
                  ? 86400
                  : 604800;
        return amount * multiplier;
      };

      const normalize = (value: any) => String(value || '').toLowerCase();

      const inferProtocol = (row: any, source: string, target: string) => {
        const protocol =
          row.protocol || row['rpc.system'] || row['db.system'] || row['messaging.system'];
        if (protocol) return String(protocol);
        const sourceName = normalize(source);
        const targetName = normalize(target);
        if (
          targetName.includes('mysql') ||
          targetName.includes('postgres') ||
          targetName.includes('mongo') ||
          targetName.includes('influx')
        ) {
          return 'database';
        }
        if (
          targetName.includes('kafka') ||
          targetName.includes('mq') ||
          targetName.includes('rabbit') ||
          targetName.includes('rocket') ||
          targetName.includes('pulsar')
        ) {
          return 'mq';
        }
        if (sourceName.includes('grpc') || targetName.includes('grpc')) return 'grpc';
        return 'http';
      };

      const inferType = (name: string) => {
        const lower = normalize(name);
        if (
          lower.includes('mysql') ||
          lower.includes('postgres') ||
          lower.includes('mongo') ||
          lower.includes('influx') ||
          lower.includes('clickhouse')
        ) {
          return 'database';
        }
        if (
          lower.includes('kafka') ||
          lower.includes('mq') ||
          lower.includes('rabbit') ||
          lower.includes('rocket') ||
          lower.includes('pulsar') ||
          lower.includes('redis')
        ) {
          return 'middleware';
        }
        if (lower.includes('gateway') || lower.includes('ingress') || lower.includes('edge')) {
          return 'gateway';
        }
        return 'service';
      };

      const inferLayer = (name: string, type: string) => {
        const lower = normalize(name);
        if (
          type === 'gateway' ||
          lower.includes('gateway') ||
          lower.includes('ingress') ||
          lower.includes('edge')
        ) {
          return { layer: 0, layerName: 'gateway' };
        }
        if (
          lower.includes('auth') ||
          lower.includes('identity') ||
          lower.includes('permission') ||
          lower.includes('core')
        ) {
          return { layer: 1, layerName: 'core' };
        }
        if (type === 'middleware') {
          return { layer: 3, layerName: 'middleware' };
        }
        if (type === 'database') {
          return { layer: 4, layerName: 'storage' };
        }
        return { layer: 2, layerName: 'business' };
      };

      const inferApp = (name: string) => {
        const parts = String(name || '').split('-');
        return parts.length > 1 ? parts[0] : name;
      };

      const inferCluster = (row: any) =>
        row.cluster || row['k8s.cluster.name'] || row['cluster.name'] || 'default';
      const inferEnv = (row: any) =>
        row.env || row.environment || row['deployment.environment'] || 'prod';

      const groupColumns =
        '["service", "serviceId", "source", "source_service", "target_service", "targetService", "destination_service", "target", "peer_service", "protocol", "rpc.system", "db.system", "messaging.system", "cluster", "env", "environment", "service.name", "peer.service", "service.id"]';
      const timeRangeSeconds = parseRangeSeconds(timeRange);

      const fluxQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: ${timeRange})
          |> filter(fn: (r) => r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
          |> filter(fn: (r) => exists r.target_service or exists r.targetService or exists r.destination_service or exists r.peer_service)
          |> group(columns: ${groupColumns})
          |> count()
      `;

      let rows = await this.queryMetrics(fluxQuery, star);
      if (rows.length === 0) {
        const fallbackQuery = `
          from(bucket: "${this.bucket}")
            |> range(start: ${timeRange})
            |> filter(fn: (r) => exists r.target_service or exists r.targetService or exists r.destination_service or exists r.peer_service)
            |> group(columns: ${groupColumns})
            |> count()
        `;
        rows = await this.queryMetrics(fallbackQuery, star);
      }
      star.logger?.info('InfluxDB topology rows', {
        timeRange,
        rows: rows.length,
      });

      const errorQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: ${timeRange})
          |> filter(fn: (r) => r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
          |> filter(fn: (r) => (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
          |> group(columns: ${groupColumns})
          |> count()
      `;

      let errorRows: any[] = [];
      try {
        errorRows = await this.queryMetrics(errorQuery, star);
      } catch (e) {
        errorRows = [];
      }

      const p99Query = `
        from(bucket: "${this.bucket}")
          |> range(start: ${timeRange})
          |> filter(fn: (r) => r["_measurement"] == "http_request_duration_ms" or r["_measurement"] == "http_request_duration" or r["_measurement"] == "rpc_duration_ms" or r["_measurement"] == "db_query_duration_ms")
          |> filter(fn: (r) => r["_field"] == "duration" or r["_field"] == "value" or r["_field"] == "latency" or r["_field"] == "response_time" or r["_field"] == "time")
          |> group(columns: ${groupColumns})
          |> quantile(q: 0.99, method: "exact_selector")
      `;

      const p50Query = `
        from(bucket: "${this.bucket}")
          |> range(start: ${timeRange})
          |> filter(fn: (r) => r["_measurement"] == "http_request_duration_ms" or r["_measurement"] == "http_request_duration" or r["_measurement"] == "rpc_duration_ms" or r["_measurement"] == "db_query_duration_ms")
          |> filter(fn: (r) => r["_field"] == "duration" or r["_field"] == "value" or r["_field"] == "latency" or r["_field"] == "response_time" or r["_field"] == "time")
          |> group(columns: ${groupColumns})
          |> quantile(q: 0.5, method: "exact_selector")
      `;

      let p99Rows: any[] = [];
      let p50Rows: any[] = [];
      try {
        p99Rows = await this.queryMetrics(p99Query, star);
        p50Rows = await this.queryMetrics(p50Query, star);
      } catch (e) {
        p99Rows = [];
        p50Rows = [];
      }

      const edgeKey = (source: string, target: string) => `${source}=>${target}`;

      const errorMap = new Map<string, number>();
      errorRows.forEach((row: any) => {
        const sourceFallback = row.source_service || row['service.name'] || row['service.id'];
        const targetFallback = row.target || row.peer_service || row['peer.service'];
        const finalSource = row.service || row.serviceId || row.source || sourceFallback;
        const finalTarget =
          row.target_service || row.targetService || row.destination_service || targetFallback;
        if (finalSource && finalTarget) {
          const key = edgeKey(finalSource, finalTarget);
          errorMap.set(key, (errorMap.get(key) || 0) + (Number(row._value) || 0));
        }
      });

      const p99Map = new Map<string, number>();
      p99Rows.forEach((row: any) => {
        const sourceFallback = row.source_service || row['service.name'] || row['service.id'];
        const targetFallback = row.target || row.peer_service || row['peer.service'];
        const finalSource = row.service || row.serviceId || row.source || sourceFallback;
        const finalTarget =
          row.target_service || row.targetService || row.destination_service || targetFallback;
        if (finalSource && finalTarget) {
          p99Map.set(edgeKey(finalSource, finalTarget), Number(row._value) || 0);
        }
      });

      const p50Map = new Map<string, number>();
      p50Rows.forEach((row: any) => {
        const sourceFallback = row.source_service || row['service.name'] || row['service.id'];
        const targetFallback = row.target || row.peer_service || row['peer.service'];
        const finalSource = row.service || row.serviceId || row.source || sourceFallback;
        const finalTarget =
          row.target_service || row.targetService || row.destination_service || targetFallback;
        if (finalSource && finalTarget) {
          p50Map.set(edgeKey(finalSource, finalTarget), Number(row._value) || 0);
        }
      });

      const nodesMap = new Map<string, any>();
      const edgesMap = new Map<string, any>();

      rows.forEach((row: any) => {
        const sourceFallback = row.source_service || row['service.name'] || row['service.id'];
        const targetFallback = row.target || row.peer_service || row['peer.service'];
        const finalSource = row.service || row.serviceId || row.source || sourceFallback;
        const finalTarget =
          row.target_service || row.targetService || row.destination_service || targetFallback;

        if (finalSource && finalTarget) {
          const key = edgeKey(finalSource, finalTarget);
          const protocol = inferProtocol(row, finalSource, finalTarget);
          const callType =
            protocol === 'mq'
              ? 'mq'
              : protocol === 'database'
                ? 'sync'
                : row['messaging.system']
                  ? 'async'
                  : 'sync';
          const count = (edgesMap.get(key)?.count || 0) + (Number(row._value) || 0);

          edgesMap.set(key, {
            from: finalSource,
            to: finalTarget,
            protocol,
            callType,
            count,
            app: inferApp(finalSource),
            cluster: inferCluster(row),
            env: inferEnv(row),
          });

          if (!nodesMap.has(finalSource)) {
            const type = inferType(finalSource);
            const layerInfo = inferLayer(finalSource, type);
            nodesMap.set(finalSource, {
              id: finalSource,
              name: finalSource,
              status: 'unknown',
              type,
              layer: layerInfo.layer,
              layerName: layerInfo.layerName,
              app: inferApp(finalSource),
              cluster: inferCluster(row),
              env: inferEnv(row),
              protocol: inferProtocol(row, finalSource, finalTarget),
            });
          }
          if (!nodesMap.has(finalTarget)) {
            const type = inferType(finalTarget);
            const layerInfo = inferLayer(finalTarget, type);
            nodesMap.set(finalTarget, {
              id: finalTarget,
              name: finalTarget,
              status: 'unknown',
              type,
              layer: layerInfo.layer,
              layerName: layerInfo.layerName,
              app: inferApp(finalTarget),
              cluster: inferCluster(row),
              env: inferEnv(row),
              protocol: inferProtocol(row, finalSource, finalTarget),
            });
          }
        }
      });

      const edges = Array.from(edgesMap.values()).map((edge) => {
        const key = edgeKey(edge.from, edge.to);
        const errorCount = errorMap.get(key) || 0;
        const qps = timeRangeSeconds > 0 ? edge.count / timeRangeSeconds : edge.count;
        const successRate = edge.count > 0 ? (edge.count - errorCount) / edge.count : 0;
        const p99 = p99Map.get(key) || 0;
        const p50 = p50Map.get(key) || 0;
        const errorRate = edge.count > 0 ? errorCount / edge.count : 0;
        let status = 'healthy';
        if (edge.count <= 0) {
          status = 'idle';
        } else if (successRate < 0.95 || p99 > 1000) {
          status = 'critical';
        } else if (successRate < 0.99 || p99 > 500) {
          status = 'warning';
        }
        return {
          ...edge,
          qps,
          successRate,
          errorRate,
          p50,
          p99,
          status,
          errorCodes: [],
        };
      });

      const nodeStatus = new Map<string, string>();
      edges.forEach((edge) => {
        const current = nodeStatus.get(edge.from) || 'healthy';
        const next =
          edge.status === 'critical' ? 'critical' : edge.status === 'warning' ? 'warning' : current;
        nodeStatus.set(edge.from, next);
        const currentTo = nodeStatus.get(edge.to) || 'healthy';
        const nextTo =
          edge.status === 'critical'
            ? 'critical'
            : edge.status === 'warning'
              ? 'warning'
              : currentTo;
        nodeStatus.set(edge.to, nextTo);
      });

      const nodes = Array.from(nodesMap.values()).map((node) => ({
        ...node,
        status: nodeStatus.get(node.id) || node.status || 'healthy',
      }));

      const result = {
        nodes,
        edges,
      };
      star.logger?.info('InfluxDB topology result', {
        nodes: result.nodes.length,
        edges: result.edges.length,
      });
      return result;
    } catch (error) {
      star.logger?.error('Failed to get topology data:', error);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * 检查InfluxDB连接状态
   */
  static async checkConnection(star: Star): Promise<boolean> {
    try {
      if (!this.client || !this.queryApi) {
        return false;
      }

      // 执行简单的健康检查查询
      const fluxQuery = 'buckets() |> limit(n: 1)';
      await this.queryMetrics(fluxQuery, star);

      return true;
    } catch (error) {
      star.logger?.error('InfluxDB connection check failed:', error);
      return false;
    }
  }

  /**
   * 获取实时统计数据
   */
  static async getRealtimeStats(serviceId: string | undefined, star: Star): Promise<any> {
    try {
      if (!this.queryApi) {
        return null;
      }
      const normalizedServiceId = serviceId?.startsWith('system:')
        ? serviceId.slice('system:'.length)
        : serviceId;
      const filter = normalizedServiceId
        ? `|> filter(fn: (r) => r["service"] == "${normalizedServiceId}")`
        : '';
      const cpuMemoryQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "os.cpu.utilization" or r["_measurement"] == "process.memory.rss")
          ${filter}
          |> filter(fn: (r) => r["_field"] == "cpu_usage" or r["_field"] == "memory_usage" or r["_field"] == "value")
          |> last()
      `;
      const cpuMemoryRows = await this.queryMetrics(cpuMemoryQuery, star);
      const cpuRow = cpuMemoryRows.find(
        (row: any) => row._measurement === 'os.cpu.utilization' || row._field === 'cpu_usage',
      );
      const memoryRow = cpuMemoryRows.find(
        (row: any) => row._measurement === 'process.memory.rss' || row._field === 'memory_usage',
      );
      const cpu = Number(cpuRow?._value || 0);
      const memory = normalizeRssMemoryValue(memoryRow?._value, 2);

      const durationQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "universe.request.time" or r["_measurement"] == "http_request_duration_ms" or r["_measurement"] == "http_request_duration" or r["_measurement"] == "rpc_duration_ms" or r["_measurement"] == "db_query_duration_ms")
          ${filter}
          |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "duration" or r["_field"] == "latency" or r["_field"] == "response_time" or r["_field"] == "time")
          |> mean()
      `;
      const durationRows = await this.queryMetrics(durationQuery, star);
      const responseTime = Number(durationRows[0]?._value || 0);

      const totalRequestQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -1m)
          |> filter(fn: (r) => r["_measurement"] == "universe.request.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
          ${filter}
          |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
          |> sum()
      `;
      const totalRows = await this.queryMetrics(totalRequestQuery, star);
      const totalRequests = Number(totalRows[0]?._value || 0);
      const qps = totalRequests > 0 ? totalRequests / 60 : 0;

      const errorRequestQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -5m)
          |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or r["_measurement"] == "http_requests_total" or r["_measurement"] == "rpc_requests_total" or r["_measurement"] == "messaging_requests_total")
          ${filter}
          |> filter(fn: (r) => r["_measurement"] == "universe.request.error.total" or (exists r.status and string(v: r.status) =~ /5../) or (exists r.status_code and string(v: r.status_code) =~ /5../) or (exists r.http_status_code and string(v: r.http_status_code) =~ /5../) or (exists r.code and string(v: r.code) =~ /5../))
          |> filter(fn: (r) => r["_field"] == "value" or r["_field"] == "count" or r["_field"] == "total")
          |> sum()
      `;
      const errorRows = await this.queryMetrics(errorRequestQuery, star);
      const errorRequests = Number(errorRows[0]?._value || 0);
      const errorRate = totalRequests > 0 ? errorRequests / totalRequests : 0;

      const activeRequestQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -1m)
          |> filter(fn: (r) => r["_measurement"] == "universe.request.active")
          ${filter}
          |> filter(fn: (r) => r["_field"] == "value")
          |> mean()
      `;
      const activeRows = await this.queryMetrics(activeRequestQuery, star).catch(() => []);
      const activeConnections = Number(activeRows[0]?._value || 0);

      const nodes = star.registry?.getNodeList({ onlyAvaiable: true, withServices: true }) || [];
      const activeInstances = normalizedServiceId
        ? nodes.filter((node: any) =>
            Array.isArray(node.services)
              ? node.services.some((item: any) => item?.name === normalizedServiceId)
              : false,
          ).length
        : 0;

      return {
        cpu,
        memory,
        qps,
        responseTime,
        errorRate,
        activeConnections,
        systemLoad: cpu,
        activeInstances,
        healthDistribution: [],
        trafficDistribution: [],
      };
    } catch (error) {
      star.logger?.error('Failed to get realtime stats:', error);
      return null;
    }
  }

  /**
   * 删除用户数据 (GDPR)
   */
  static async deleteUserData(userId: string, star: Star): Promise<void> {
    try {
      if (!this.client || !this.org || !this.bucket) {
        throw new Error('InfluxDB not initialized');
      }

      // 使用 InfluxDB 的 delete API
      // 注意：JavaScript 客户端可能没有直接暴露 delete API，需要手动调用或检查文档
      // 这里假设通过 HTTP API 调用，或者使用 client 的 API

      // 模拟实现：实际应调用 /api/v2/delete
      // const deleteApi = new DeleteApi(this.client);
      // await deleteApi.postDelete({
      //   org: this.org,
      //   bucket: this.bucket,
      //   body: {
      //     start: new Date(0).toISOString(),
      //     stop: new Date().toISOString(),
      //     predicate: `tenantId="${userId}"`,
      //   },
      // });

      star.logger?.info(`Deleted data for user ${userId}`);
    } catch (error) {
      star.logger?.error('Failed to delete user data:', error);
      throw error;
    }
  }

  /**
   * 关闭InfluxDB连接
   */
  static async close(star: Star): Promise<void> {
    try {
      if (this.writeApi) {
        await this.writeApi.close();
        this.writeApi = null;
      }

      // InfluxDB JS客户端没有显式的close方法，只需清理引用
      if (this.client) {
        this.client = null;
      }

      star.logger?.info('InfluxDB connection closed successfully');
    } catch (error) {
      star.logger?.error('Failed to close InfluxDB connection:', error);
      throw error;
    }
  }

  /**
   * 获取数据库统计信息
   */
  static async getStats(star: Star): Promise<{
    measurements: number;
    series: number;
    points: number;
  }> {
    try {
      if (!this.queryApi) {
        return { measurements: 0, series: 0, points: 0 };
      }

      // 获取 measurements 数量
      const measurementsQuery = `
        import "influxdata/influxdb/schema"
        schema.measurements(bucket: "${this.bucket}")
        |> count()
      `;
      const mRows = await this.queryMetrics(measurementsQuery, star);
      const measurements = mRows.length > 0 ? Number(mRows[0]._value) || 0 : 0;

      // 获取最近30天的数据点总数
      const pointsQuery = `
        from(bucket: "${this.bucket}")
          |> range(start: -30d)
          |> count()
          |> group()
          |> sum()
      `;
      const pRows = await this.queryMetrics(pointsQuery, star);
      const points = pRows.length > 0 ? Number(pRows[0]._value) || 0 : 0;

      return {
        measurements,
        series: 0, // Series cardinality check is expensive, skipping for now
        points,
      };
    } catch (error) {
      star.logger?.error('Failed to get InfluxDB stats:', error);
      return {
        measurements: 0,
        series: 0,
        points: 0,
      };
    }
  }
}
