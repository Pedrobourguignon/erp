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

/**
 * Troca de item de um pedido por outro produto ou outra variante do mesmo
 * produto (troca de tamanho/cor) — SCRUM-21.
 */
export class ExchangeOrderItemDto {
  @ApiProperty({ description: 'OrderItem de onde saem as unidades devolvidas' })
  @IsString()
  @IsNotEmpty()
  orderItemId: string;

  @ApiProperty({ description: 'Produto que entra no lugar (o mesmo, numa troca de tamanho)' })
  @IsString()
  @IsNotEmpty()
  newProductId: string;

  @ApiPropertyOptional({ description: 'Variante do novo produto (se houver)' })
  @IsOptional()
  @IsString()
  newVariantId?: string;

  @ApiPropertyOptional({
    description: 'Unidades trocadas (default: todas as unidades do item)',
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: 500, description: 'Motivo, registrado no histórico' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({
    type: OrderAdjustmentSettlementDto,
    description: 'Recebe/devolve a diferença na hora. Ausente = título fica em aberto.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrderAdjustmentSettlementDto)
  settlement?: OrderAdjustmentSettlementDto;
}
