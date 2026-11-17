import { OrderStatus } from '@erp/shared-types';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
  // IsUUID removed: DB uses cuid(), not uuid
  IsDateString,
  Min,
  MaxLength,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrderItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;
}

export class CreateOrderPaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentConditionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  financialAccountId?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01, { message: 'Payment amount must be greater than zero' })
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt({ message: 'O número de parcelas precisa ser inteiro' })
  @Min(1, { message: 'O número de parcelas é pelo menos 1' })
  installments?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  authorizationCode?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ enum: ['MANUAL', 'BALCAO', 'MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'SHOPIFY', 'NUVEMSHOP', 'WOOCOMMERCE', 'API'] })
  @IsOptional()
  @IsIn(['MANUAL', 'BALCAO', 'MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'SHOPIFY', 'NUVEMSHOP', 'WOOCOMMERCE', 'API'])
  origin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salesChannelId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sellerId?: string;

  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'Order must have at least one item' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingCost?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shippingMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  shippingAddress?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  internalNotes?: string;

  @ApiPropertyOptional({
    description: 'Open cash-register session the sale is registered in; required when more than one is open',
  })
  @IsOptional()
  @IsString()
  cashRegisterSessionId?: string;

  @ApiPropertyOptional({ type: [CreateOrderPaymentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderPaymentDto)
  payments?: CreateOrderPaymentDto[];
}

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: ['DRAFT', 'PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURNED'],
  })
  @IsIn(['DRAFT', 'PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURNED'])
  status: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelOrderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class OrderQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ enum: ['DRAFT', 'PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURNED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'PENDING', 'CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'RETURNED'])
  status?: string;

  @ApiPropertyOptional({ enum: ['MANUAL', 'BALCAO', 'MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'SHOPIFY', 'NUVEMSHOP', 'WOOCOMMERCE', 'API'] })
  @IsOptional()
  @IsIn(['MANUAL', 'BALCAO', 'MERCADO_LIVRE', 'SHOPEE', 'AMAZON', 'MAGALU', 'SHOPIFY', 'NUVEMSHOP', 'WOOCOMMERCE', 'API'])
  origin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
