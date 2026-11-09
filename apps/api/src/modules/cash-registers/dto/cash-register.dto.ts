import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsIn,
  Min,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCashRegisterDto {
  @ApiProperty({ example: 'Caixa 01' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  financialAccountId: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCashRegisterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  financialAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class OpenSessionDto {
  @ApiProperty({ description: 'Opening balance (fundo de troco)' })
  @IsNumber()
  @Min(0)
  openingBalance: number;
}

export class CloseSessionDto {
  @ApiProperty({ description: 'Closing balance (valor contado)' })
  @IsNumber()
  @Min(0)
  closingBalance: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Fundo de troco que fica na gaveta para a próxima abertura. O que passar
   * disso é transferido para `destinationAccountId` no mesmo fechamento —
   * assim a conta do caixa termina o dia valendo exatamente o que ficou lá
   * dentro, e a abertura de amanhã não precisa creditar nada.
   */
  @ApiPropertyOptional({
    description: 'Fundo de troco que permanece na gaveta (default: 0)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  retainedAmount?: number;

  @ApiPropertyOptional({
    description:
      'Conta de destino do valor que sai da gaveta. Sem ela, nada é transferido.',
  })
  @IsOptional()
  @IsString()
  destinationAccountId?: string;
}

export class CashMovementDto {
  @ApiProperty({ description: 'Movement amount' })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: 'Reason for the movement' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  reason: string;
}

export class CashRegisterQueryDto {
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
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;
}

export class SessionQueryDto {
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
  cashRegisterId?: string;

  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
