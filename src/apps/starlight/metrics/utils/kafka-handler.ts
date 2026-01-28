import { Consumer, Kafka, Producer, ProducerRecord } from 'kafkajs';
import { KAFKA_BROKERS, KAFKA_CLIENT_ID, KAFKA_PASSWORD, KAFKA_USER } from '../constants';

export class KafkaHandler {
  private static instance: KafkaHandler;
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumers: Consumer[] = [];
  private isConnected: boolean = false;

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

    try {
      const record: ProducerRecord = {
        topic,
        messages: messages.map((msg) => ({
          value: typeof msg === 'string' ? msg : JSON.stringify(msg),
        })),
      };

      await this.producer!.send(record);
    } catch (error) {
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

    for (const config of configs) {
      const consumer = handler.kafka.consumer({ groupId: config.groupId });
      await consumer.connect();
      await consumer.subscribe({ topic: config.topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const value = message.value?.toString();
            if (value) {
              const data = JSON.parse(value);
              await config.handler(data);
            }
          } catch (error) {
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
    await handler.connect();
  }
}
