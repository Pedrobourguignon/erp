import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './database/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { SearchModule } from './modules/search/search.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SalesModule } from './modules/sales/sales.module';
import { PurchasesModule } from './modules/purchases/purchases.module';
import { FinancialModule } from './modules/financial/financial.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { CrmModule } from './modules/crm/crm.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditModule } from './modules/audit/audit.module';
import { CashRegistersModule } from './modules/cash-registers/cash-registers.module';
import { PaymentMethodsModule } from './modules/payment-methods/payment-methods.module';
import { PaymentConditionsModule } from './modules/payment-conditions/payment-conditions.module';
import { HealthModule } from './modules/health/health.module';
import { EventsModule } from './events/events.module';
import { JobsModule } from './jobs/jobs.module';
import { StorageModule } from './modules/storage/storage.module';
import { ImportsModule } from './modules/imports/imports.module';
import { appConfig } from './config/app.config';
import { redisConnection } from './config/runtime-config';

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),

    // Rate limiting global
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,
        limit: 20,
      },
      {
        name: 'medium',
        ttl: 10000,
        limit: 100,
      },
      {
        name: 'long',
        ttl: 60000,
        limit: 300,
      },
    ]),

    // Scheduler
    ScheduleModule.forRoot(),

    // BullMQ
    BullModule.forRoot({
      connection: redisConnection(),
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),

    // Database
    DatabaseModule,
    RedisModule,

    // Domain modules
    AuthModule,
    TenantsModule,
    UsersModule,
    SearchModule,
    ProductsModule,
    InventoryModule,
    OrdersModule,
    SalesModule,
    PurchasesModule,
    FinancialModule,
    FiscalModule,
    CrmModule,
    IntegrationsModule,
    NotificationsModule,
    ReportsModule,
    AuditModule,
    CashRegistersModule,
    PaymentMethodsModule,
    PaymentConditionsModule,
    HealthModule,

    // Infrastructure
    EventsModule,
    JobsModule,
    StorageModule,
    ImportsModule,
  ],
})
export class AppModule {}
