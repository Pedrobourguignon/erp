import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';
import { FinancialAccountsController } from './financial-accounts.controller';
import { FinancialAccountsService } from './financial-accounts.service';
import { FinancialEntriesController } from './financial-entries.controller';
import { FinancialEntriesService } from './financial-entries.service';
import { FinancialSettlementsService } from './financial-settlements.service';
import { ChartOfAccountsController } from './chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { OverdueTitlesJob } from './overdue-titles.job';
import { AutoSettleTitlesJob } from './auto-settle-titles.job';
import { FinancialReversalsService } from './financial-reversals.service';

@Module({
  imports: [AuditModule, CashRegistersModule],
  controllers: [
    FinancialAccountsController,
    FinancialEntriesController,
    ChartOfAccountsController,
  ],
  providers: [
    FinancialAccountsService,
    FinancialEntriesService,
    FinancialSettlementsService,
    ChartOfAccountsService,
    OverdueTitlesJob,
    AutoSettleTitlesJob,
    FinancialReversalsService,
  ],
  exports: [
    FinancialAccountsService,
    FinancialEntriesService,
    FinancialSettlementsService,
    FinancialReversalsService,
  ],
})
export class FinancialModule {}
