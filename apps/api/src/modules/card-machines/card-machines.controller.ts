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
import { CardMachinesService } from './card-machines.service';
import {
  CreateCardMachineDto,
  UpdateCardMachineDto,
  CardMachineQueryDto,
} from './dto/card-machine.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('Card Machines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('card-machines')
export class CardMachinesController {
  constructor(
    private readonly cardMachinesService: CardMachinesService,
  ) {}

  @Get()
  @RequirePermissions('financial:read')
  @ApiOperation({ summary: 'List card machines with filters' })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: CardMachineQueryDto,
  ) {
    return this.cardMachinesService.findAll(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('financial:read')
  @ApiOperation({ summary: 'Get a card machine by ID' })
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const machine = await this.cardMachinesService.findOne(tenantId, id);
    return { success: true, data: machine };
  }

  @Post()
  @RequirePermissions('financial:create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new card machine' })
  async create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateCardMachineDto,
  ) {
    const machine = await this.cardMachinesService.create(tenantId, dto);
    return { success: true, data: machine };
  }

  @Patch(':id')
  @RequirePermissions('financial:update')
  @ApiOperation({ summary: 'Update a card machine' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCardMachineDto,
  ) {
    const machine = await this.cardMachinesService.update(tenantId, id, dto);
    return { success: true, data: machine };
  }

  @Delete(':id')
  @RequirePermissions('financial:delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exclui a maquininha. Se está vinculada a alguma forma de pagamento, é inativada em vez de excluída.',
  })
  async remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const result = await this.cardMachinesService.remove(tenantId, id);
    return { success: true, data: result };
  }
}
