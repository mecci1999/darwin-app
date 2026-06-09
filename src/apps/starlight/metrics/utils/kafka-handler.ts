import { Consumer, Kafka, Producer, ProducerRecord } from 'kafkajs';
import { KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_PASSWORD, KAFKA_USER } from '../constants';

export class KafkaHandler {
  private static instance: KafkaHandler;
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Consumer[] = [];
  private isConnected: boolean = false;
  private star: any = null;

  private constructor() {
    this.kafka = new Kafka({
      clientId: KAFKA_CLIENT_ID || 'metrics-service',
      brokers: (KAFKA_BROKERS || 'localhost:9092').split(','),
      sasl:
        KAFKA_USER && KAFKA_PASSWORD
          ? {
              mechanism: 'plain',
              username: KAFKA_USER,
              password: KAFKA_PASSWORD,
            }
          : undefined,
    });
  }

  public static getInstance(): KafkaHandler {
    if (!KafkaHandler.instance) {
      KafkaHandler.instance = new KafkaHandler();
    }
    return KafkaHandler.instance;
  }

  private emitMessagingMetrics(params: {
    topic: string;
    direction: 'produce' | 'consume';
    count: number;
    durationMs: number;
    groupId?: string;
    status?: 'success' | 'error';
  }) {
    if (!this.star || typeof this.star.emit !== 'function') return;
    if (params.topic === 'metrics.raw') return;

    const timestamp = Date.now();
    const service = KAFKA_CLIENT_ID || 'metrics-service';
    const tags = {
      tenantId: 'system',
      appKeyId: 'system',
      visibilityScope: 'system-admin',
      sourceType: 'darwin-system',
      source: 'kafka-handler',
      service,
      serviceId: `system:${service}`,
      protocol: 'messaging',
      'messaging.system': 'kafka',
      topic: params.topic,
      direction: params.direction,
      status: params.status || 'success',
      ...(params.groupId ? { groupId: params.groupId } : {}),
    };

    const emitResult = this.star.emit('metrics.raw', {
      tenantId: 'system',
      data: {
        measurement: 'messaging_requests_total',
        tags,
        fields: { value: params.count, count: params.count },
        timestamp,
      },
    });

    Promise.resolve(emitResult).catch((error: unknown) => {
      this.star?.logger?.warn('Failed to emit messaging request metric', error);
    });

    const durationEmitResult = this.star.emit('metrics.raw', {
      tenantId: 'system',
      data: {
        measurement: 'messaging_duration_ms',
        tags: { ...tags, unit: 'ms' },
        fields: { value: params.durationMs, duration: params.durationMs },
        timestamp,
      },
    });

    Promise.resolve(durationEmitResult).catch((error: unknown) => {
      this.star?.logger?.warn('Failed to emit messaging duration metric', error);
    });
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;

    try {
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.isConnected = true;
      console.log('Kafka producer connected successfully');
    } catch (error) {
      console.error('Failed to connect to Kafka:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected || !this.producer) return;

    try {
      await this.producer.disconnect();
      this.isConnected = false;
      this.producer = null;
      console.log('Kafka producer disconnected');
    } catch (error) {
      console.error('Failed to disconnect from Kafka:', error);
    }
  }

  public async send(topic: string, messages: any[]): Promise<void> {
    if (!this.isConnected || !this.producer) {
      await this.connect();
    }

    const startedAt = Date.now();
    try {
      const record: ProducerRecord = {
        topic,
        messages: messages.map((msg) => ({
          value: typeof msg === 'string' ? msg : JSON.stringify(msg),
        })),
      };

      await this.producer!.send(record);
      this.emitMessagingMetrics({
        topic,
        direction: 'produce',
        count: messages.length,
        durationMs: Date.now() - startedAt,
        status: 'success',
      });
    } catch (error) {
      this.emitMessagingMetrics({
        topic,
        direction: 'produce',
        count: messages.length,
        durationMs: Date.now() - startedAt,
        status: 'error',
      });
      console.error(`Failed to send messages to topic ${topic}:`, error);
      throw error;
    }
  }

  /**
   * 设置消费者
   */
  public static async setupConsumers(
    configs: Array<{ topic: string; groupId: string; handler: (data: any) => Promise<void> }>,
    star: any,
    state: any,
  ): Promise<void> {
    const handler = KafkaHandler.getInstance();
    handler.star = star;

    for (const config of configs) {
      const consumer = handler.kafka.consumer({ groupId: config.groupId });
      await consumer.connect();
      await consumer.subscribe({ topic: config.topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, message }) => {
          const startedAt = Date.now();
          try {
            const value = message.value?.toString();
            if (value) {
              const data = JSON.parse(value);
              await config.handler(data);
              handler.emitMessagingMetrics({
                topic,
                direction: 'consume',
                count: 1,
                durationMs: Date.now() - startedAt,
                groupId: config.groupId,
                status: 'success',
              });
            }
          } catch (error) {
            handler.emitMessagingMetrics({
              topic,
              direction: 'consume',
              count: 1,
              durationMs: Date.now() - startedAt,
              groupId: config.groupId,
              status: 'error',
            });
            star.logger?.error(`Failed to process message from topic ${topic}:`, error);
          }
        },
      });

      handler.consumers.push(consumer);
      state.kafkaConsumers.push(consumer);
    }
  }

  /**
   * 设置生产者
   */
  public static async setupProducer(star: any): Promise<void> {
    const handler = KafkaHandler.getInstance();
    handler.star = star;
    await handler.connect();
  }
}
