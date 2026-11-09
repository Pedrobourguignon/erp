import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { redisConnection } from '../config/runtime-config';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({ connection: redisConnection() }),
    }),
    BullModule.registerQueue(
      { name: 'notifications' },
      { name: 'reports' },
      { name: 'integrations' },
    ),
  ],
  providers: [],
  exports: [BullModule],
})
export class JobsModule {}
