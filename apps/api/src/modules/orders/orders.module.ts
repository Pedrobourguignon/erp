import { Module } from '@nestjs/common';
import { FinancialModule } from '../financial/financial.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AdjustOrderItemUseCase } from './use-cases/adjust-order-item.use-case';
import { OrderAdjustmentFinance } from './use-cases/order-adjustment.finance';
import { ReverseSaleUseCase } from './use-cases/reverse-sale.use-case';

@Module({
  // A baixa da diferença de uma troca usa o mesmo serviço de baixa de
  // /financeiro/lancamentos, dentro da transação da troca.
  imports: [FinancialModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    AdjustOrderItemUseCase,
    OrderAdjustmentFinance,
    ReverseSaleUseCase,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
