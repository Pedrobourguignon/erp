import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CashRegistersService } from './cash-registers.service';
import {
  CreateCashRegisterDto,
  UpdateCashRegisterDto,
  OpenSessionDto,
  CloseSessionDto,
  SupplyDto,
  WithdrawDto,
  CashRegisterQueryDto,
  SessionQueryDto,
} from './dto/cash-register.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  CurrentPermissions,
  CurrentTenant,
  CurrentUser,
} from '../../common/decorators/tenant.decorator';

@ApiTags('Cash Registers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class CashRegistersController {
  constructor(private readonly cashRegistersService: CashRegistersService) {}

  // ─── Cash Registers CRUD ─────────────────────────────────────────────

  @Get('cash-registers')
  @RequirePermissions('financial:read')
  @ApiOperation({ summary: 'List cash registers' })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: CashRegisterQueryDto,
  ) {
    return this.cashRegistersService.findAll(tenantId, query);
  }

  @Post('cash-registers')
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a cash register' })
  async create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateCashRegisterDto,
  ) {
    const cashRegister = await this.cashRegistersService.create(tenantId, dto);
    return { success: true, data: cashRegister };
  }

  @Patch('cash-registers/:id')
  @RequirePermissions('financial:update')
  @ApiOperation({ summary: 'Update a cash register' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCashRegisterDto,
  ) {
    const cashRegister = await this.cashRegistersService.update(tenantId, id, dto);
    return { success: true, data: cashRegister };
  }

  // ─── Session Operations ──────────────────────────────────────────────

  @Post('cash-registers/:id/open')
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Open a cash register session' })
  async openSession(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: OpenSessionDto,
  ) {
    const session = await this.cashRegistersService.openSession(
      tenantId,
      id,
      userId,
      dto,
    );
    return { success: true, data: session };
  }

  @Post('cash-registers/:id/close')
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a cash register session' })
  async closeSession(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: CloseSessionDto,
  ) {
    const session = await this.cashRegistersService.closeSession(
      tenantId,
      id,
      userId,
      dto,
    );
    return { success: true, data: session };
  }

  @Post('cash-registers/:id/supply')
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a supply (suprimento) to the open session' })
  async supply(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SupplyDto,
  ) {
    const movement = await this.cashRegistersService.supply(
      tenantId,
      id,
      userId,
      dto,
    );
    return { success: true, data: movement };
  }

  @Post('cash-registers/:id/withdraw')
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Sangria: transfere dinheiro da gaveta para a conta de destino' })
  async withdraw(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: WithdrawDto,
  ) {
    const movement = await this.cashRegistersService.withdraw(
      tenantId,
      id,
      userId,
      dto,
    );
    return { success: true, data: movement };
  }

  @Get('cash-registers/:id/session')
  @RequirePermissions('cash-registers:read-session')
  @ApiOperation({ summary: 'Get current open session with movements and totals' })
  async getCurrentSession(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const session = await this.cashRegistersService.getCurrentSession(
      tenantId,
      id,
    );
    return { success: true, data: session };
  }

  // ─── Session History ─────────────────────────────────────────────────

  @Get('cash-register-sessions')
  @RequirePermissions('cash-registers:read-session')
  @ApiOperation({ summary: 'List cash register sessions with filters' })
  async findAllSessions(
    @CurrentTenant() tenantId: string,
    @CurrentPermissions() permissions: string[],
    @Query() query: SessionQueryDto,
  ) {
    return this.cashRegistersService.findAllSessions(tenantId, query, {
      openSessionsOnly: !permissions.includes('financial:read'),
    });
  }

  @Get('cash-register-sessions/:id')
  @RequirePermissions('financial:read')
  @ApiOperation({ summary: 'Get session detail with movements and totals' })
  async findOneSession(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const session = await this.cashRegistersService.findOneSession(
      tenantId,
      id,
    );
    return { success: true, data: session };
  }
}
