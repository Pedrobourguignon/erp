import {
  IsString,
  IsOptional,
  IsIn,
  IsNumber,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePaymentConditionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @ApiPropertyOptional({ enum: ['CASH', 'INSTALLMENT', 'ENTRY_PLUS_INSTALLMENT'] })
  @IsOptional()
  @IsIn(['CASH', 'INSTALLMENT', 'ENTRY_PLUS_INSTALLMENT'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  installments?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  daysBetweenInstallments?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  entryPercentage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description:
      'Métodos de pagamento a que esta condição fica restrita. Lista vazia remove todos os vínculos; omitir o campo mantém os vínculos atuais.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentMethodIds?: string[];
}
