import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ProductLookupQueryDto } from './dto/product-lookup.dto';
import { ProductLookupService } from './product-lookup.service';

/**
 * Registered before `ProductsController` in the module: its `GET :id` would
 * otherwise read "lookup" as a product id.
 */
@ApiTags('Products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('products')
export class ProductLookupController {
  constructor(private readonly lookupService: ProductLookupService) {}

  @Get('barcode-duplicates')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Códigos de barras cadastrados em mais de um produto/variação' })
  async duplicates(@CurrentTenant() tenantId: string) {
    return { success: true, data: await this.lookupService.findDuplicates(tenantId) };
  }

  @Get('lookup')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: 'Busca exata pelo código lido (EAN/SKU) ou pelo produto/variação' })
  async lookup(@CurrentTenant() tenantId: string, @Query() query: ProductLookupQueryDto) {
    if (query.code !== undefined) {
      return { success: true, data: await this.lookupService.findByCode(tenantId, query.code) };
    }
    if (query.productId) {
      return {
        success: true,
        data: await this.lookupService.findForSale(tenantId, query.productId, query.variantId),
      };
    }
    throw new BadRequestException('Informe o código lido ou o produto');
  }
}
