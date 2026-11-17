import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FinancialModule } from '../financial/financial.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderReceiptsController } from './receipts/order-receipts.controller';
import { OrderReceiptsService } from './receipts/order-receipts.service';
import { AdjustOrderItemUseCase } from './use-cases/adjust-order-item.use-case';
import { OrderAdjustmentFinance } from './use-cases/order-adjustment.finance';
import { ReverseSaleUseCase } from './use-cases/reverse-sale.use-case';

@Module({
  // A baixa da diferença de uma troca usa o mesmo serviço de baixa de
  // /financeiro/lancamentos, dentro da transação da troca.
  // Recibo: o cabeçalho da loja vem do serviço de tenants (dono do dado), e
  // cada via impressa vai para a auditoria.
  imports: [FinancialModule, TenantsModule, AuditModule],
  controllers: [OrdersController, OrderReceiptsController],
  providers: [
    OrdersService,
    AdjustOrderItemUseCase,
    OrderAdjustmentFinance,
    ReverseSaleUseCase,
    OrderReceiptsService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
