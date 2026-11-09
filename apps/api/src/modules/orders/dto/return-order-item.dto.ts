import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderAdjustmentSettlementDto } from './order-adjustment-settlement.dto';

/** Devolução de parte de um pedido, sem produto em troca. */
export class ReturnOrderItemDto {
  @ApiProperty({ description: 'OrderItem de onde saem as unidades devolvidas' })
  @IsString()
  @IsNotEmpty()
  orderItemId: string;

  @ApiPropertyOptional({
    description: 'Unidades devolvidas (default: todas as unidades do item)',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ maxLength: 500, example: 'Produto com defeito' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({
    type: OrderAdjustmentSettlementDto,
    description: 'Devolve o dinheiro na hora. Ausente = reembolso fica em aberto em contas a pagar.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderAdjustmentSettlementDto)
  settlement?: OrderAdjustmentSettlementDto;
}
