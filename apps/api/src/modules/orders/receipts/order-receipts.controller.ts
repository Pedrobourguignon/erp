import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentTenant, CurrentUser } from '../../../common/decorators/tenant.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { OrderReceiptsService } from './order-receipts.service';

/**
 * POST, not GET: each call issues one more copy (counted and audited), so it
 * is not a safe, repeatable read. Whoever can see the order can print it.
 */
@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orders')
export class OrderReceiptsController {
  constructor(private readonly receipts: OrderReceiptsService) {}

  @Post(':id/receipt')
  @RequirePermissions('orders:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Emitir o recibo (não fiscal) da venda; da 2ª vez em diante é 2ª via' })
  async printSale(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ) {
    return { success: true, data: await this.receipts.printSale(tenantId, userId, id) };
  }

  @Post(':id/adjustments/:adjustmentId/receipt')
  @RequirePermissions('orders:read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Emitir o comprovante (não fiscal) de uma troca ou devolução' })
  async printAdjustment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('adjustmentId') adjustmentId: string,
  ) {
    return {
      success: true,
      data: await this.receipts.printAdjustment(tenantId, userId, id, adjustmentId),
    };
  }
}
