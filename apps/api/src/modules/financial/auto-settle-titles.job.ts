import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FinancialStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { PAYMENT_FEE_KIND } from '../../common/constants/payment.constants';
import {
  DEFAULT_TENANT_TIMEZONE,
  toLocalDateKey,
} from '../../common/utils/date-range.util';
import { startOfToday } from './financial-entries.service';
import { FinancialSettlementsService } from './financial-settlements.service';
import { SettleableKind } from './dto/settle-financial-entry.dto';

const OPEN_STATUSES: FinancialStatus[] = ['PENDING', 'PARTIALLY_PAID', 'OVERDUE'];

interface DueTitle {
  id: string;
  tenantId: string;
  dueDate: Date;
}

/**
 * Baixa automática dos títulos de uma forma de pagamento marcada com
 * `autoSettle` — o caso da antecipação combinada com a operadora: o dinheiro
 * cai no dia combinado e ninguém precisa dar baixa título a título.
 *
 * Baixa o recebível e a taxa da operadora (a pagar) da mesma forma, cada um na
 * conta que o fluxo manual já resolveria (`FinancialSettlementsService`), com a
 * data em que deveria ter caído — um título que ficou para trás entra no dia
 * certo, não no dia em que o job rodou.
 *
 * Roda às 06:00 no fuso do lojista, depois do job que marca vencidos (05:00).
 * Não filtra por empresa de propósito: é uma varredura de manutenção; cada
 * baixa usa o `tenantId` do próprio título.
 */
@Injectable()
export class AutoSettleTitlesJob {
  private readonly logger = new Logger(AutoSettleTitlesJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: FinancialSettlementsService,
  ) {}

  @Cron('0 6 * * *', {
    name: 'auto-settle-titles',
    timeZone: DEFAULT_TENANT_TIMEZONE,
  })
  async handleCron(): Promise<void> {
    const { settled, failed } = await this.settleDueTitles();
    this.logger.log(`Auto-settle: ${settled} título(s) baixado(s), ${failed} com falha`);
  }

  async settleDueTitles(): Promise<{ settled: number; failed: number }> {
    const where = {
      status: { in: OPEN_STATUSES },
      dueDate: { lte: startOfToday() },
      paymentMethod: { autoSettle: true },
    };
    const select = { id: true, tenantId: true, dueDate: true };

    const receivables = await this.prisma.accountsReceivable.findMany({
      where,
      select,
      orderBy: { dueDate: 'asc' },
    });
    const fees = await this.prisma.accountsPayable.findMany({
      where: { ...where, metadata: { path: ['kind'], equals: PAYMENT_FEE_KIND } },
      select,
      orderBy: { dueDate: 'asc' },
    });

    let settled = 0;
    let failed = 0;
    const run = async (titles: DueTitle[], kind: SettleableKind) => {
      for (const title of titles) {
        try {
          await this.settlements.settle(title.tenantId, title.id, {
            kind,
            paidAt: toLocalDateKey(title.dueDate),
          });
          settled++;
        } catch (error) {
          failed++;
          this.logger.warn(
            `Auto-settle: ${kind} ${title.id} (tenant ${title.tenantId}) não foi baixado: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    };

    await run(receivables, 'RECEIVABLE');
    await run(fees, 'PAYABLE');

    return { settled, failed };
  }
}
