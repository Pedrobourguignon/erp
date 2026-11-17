import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

/** Teto da tabela — nenhuma maquininha parcela além disso. */
export const MAX_CARD_INSTALLMENTS = 24;

const RECEIVE_MODES = ['FLOW', 'ANTICIPATED'] as const;

export class CardMachineRateDto {
  @ApiProperty({ example: 3 })
  @IsInt({ message: 'O número de parcelas precisa ser inteiro' })
  @Min(1, { message: 'O número de parcelas é pelo menos 1' })
  @Max(MAX_CARD_INSTALLMENTS, {
    message: `A maquininha parcela em no máximo ${MAX_CARD_INSTALLMENTS}x`,
  })
  installments: number;

  @ApiProperty({ example: 4.99, description: 'Taxa total desta quantidade de parcelas (%).' })
  @IsNumber({}, { message: 'A taxa precisa ser um número' })
  @Min(0, { message: 'A taxa não pode ser negativa' })
  @Max(100, { message: 'A taxa não pode passar de 100%' })
  feePercentage: number;
}

export class CreateCardMachineDto {
  @ApiProperty({ example: 'Stone Loja Centro' })
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome da maquininha' })
  @MaxLength(100, { message: 'O nome tem no máximo 100 caracteres' })
  name: string;

  @ApiPropertyOptional({ example: 'Stone' })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'A operadora tem no máximo 50 caracteres' })
  provider?: string;

  @ApiPropertyOptional({ example: 1.5, default: 0 })
  @IsOptional()
  @IsNumber({}, { message: 'A taxa do débito precisa ser um número' })
  @Min(0, { message: 'A taxa do débito não pode ser negativa' })
  @Max(100, { message: 'A taxa do débito não pode passar de 100%' })
  debitFeePercentage?: number;

  @ApiPropertyOptional({ example: 1, default: 1, description: '0 = cai na hora.' })
  @IsOptional()
  @IsInt({ message: 'O prazo do débito precisa ser um número inteiro de dias' })
  @Min(0, { message: 'O prazo do débito não pode ser negativo' })
  @Max(365, { message: 'O prazo máximo é 365 dias' })
  debitSettlementDays?: number;

  @ApiPropertyOptional({ enum: RECEIVE_MODES, default: 'FLOW' })
  @IsOptional()
  @IsIn(RECEIVE_MODES, { message: 'Recebimento do crédito inválido' })
  creditReceiveMode?: (typeof RECEIVE_MODES)[number];

  @ApiPropertyOptional({
    example: 30,
    default: 30,
    description: 'Dias até o 1º repasse (no fluxo) ou até o repasse total (antecipado).',
  })
  @IsOptional()
  @IsInt({ message: 'O prazo do crédito precisa ser um número inteiro de dias' })
  @Min(0, { message: 'O prazo do crédito não pode ser negativo' })
  @Max(365, { message: 'O prazo máximo é 365 dias' })
  creditSettlementDays?: number;

  @ApiPropertyOptional({ type: [CardMachineRateDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CARD_INSTALLMENTS)
  @ValidateNested({ each: true })
  @Type(() => CardMachineRateDto)
  rates?: CardMachineRateDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCardMachineDto extends PartialType(CreateCardMachineDto) {}

export class CardMachineQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}
