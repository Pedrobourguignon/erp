import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinancialEntriesService } from './financial-entries.service';
import { FinancialSettlementsService } from './financial-settlements.service';
import {
  CreateFinancialEntryDto,
  FinancialEntryQueryDto,
} from './dto/financial-entry.dto';
import { SettleFinancialEntryDto } from './dto/settle-financial-entry.dto';
import { FinancialReversalsService } from './financial-reversals.service';
import {
  DeleteFinancialEntryDto,
  ReverseSettlementDto,
  UpdateFinancialEntryDto,
} from './dto/reverse-settlement.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  CurrentTenant,
  CurrentUser,
} from '../../common/decorators/tenant.decorator';

@ApiTags('Financial Entries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('financial-entries')
export class FinancialEntriesController {
  constructor(
    private readonly financialEntriesService: FinancialEntriesService,
    private readonly financialSettlementsService: FinancialSettlementsService,
    private readonly financialReversalsService: FinancialReversalsService,
  ) {}

  @Get()
  @RequirePermissions('financial:read')
  @ApiOperation({
    summary: 'List financial entries (despesas/receitas) with filters and totals',
  })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: FinancialEntryQueryDto,
  ) {
    return this.financialEntriesService.findAll(tenantId, query);
  }

  @Post()
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a manual financial entry (despesa/receita)' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateFinancialEntryDto,
  ) {
    const entry = await this.financialEntriesService.create(
      tenantId,
      dto,
      userId,
    );
    return { success: true, data: entry };
  }

  @Post(':id/settle')
  @RequirePermissions('financial:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Settle (baixar) an open título — credits/debits the linked account',
  })
  async settle(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SettleFinancialEntryDto,
  ) {
    const result = await this.financialSettlementsService.settle(
      tenantId,
      id,
      dto,
      userId,
    );
    return { success: true, data: result };
  }

  // ─── FN-04: reversibilidade ─────────────────────────────────────────────

  @Get(':id/settlements')
  @RequirePermissions('financial:read')
  @ApiOperation({ summary: 'Histórico de baixas de um título, com estado de estorno' })
  async listSettlements(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const data = await this.financialReversalsService.listSettlements(tenantId, id);
    return { success: true, data };
  }

  @Post(':id/settlements/:settlementId/reverse')
  @RequirePermissions('financial:update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Estorna uma baixa: devolve o saldo em aberto e lança a transação contrária',
  })
  async reverseSettlement(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('settlementId') settlementId: string,
    @Body() dto: ReverseSettlementDto,
  ) {
    const result = await this.financialReversalsService.reverseSettlement(
      tenantId,
      userId,
      id,
      settlementId,
      dto,
    );
    return { success: true, data: result };
  }

  @Patch(':id')
  @RequirePermissions('financial:update')
  @ApiOperation({
    summary:
      'Edita um título. Com baixa registrada, apenas descrição e categoria.',
  })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFinancialEntryDto,
  ) {
    const result = await this.financialReversalsService.update(
      tenantId,
      userId,
      id,
      dto,
    );
    return { success: true, data: result };
  }

  @Delete(':id')
  @RequirePermissions('financial:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exclui (soft delete) um título sem baixa e sem origem em pedido',
  })
  async remove(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: DeleteFinancialEntryDto,
  ) {
    const result = await this.financialReversalsService.remove(
      tenantId,
      userId,
      id,
      dto,
    );
    return { success: true, data: result };
  }
}
