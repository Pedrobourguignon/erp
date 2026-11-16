import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsIn,
  IsArray,
  IsUUID,
  IsEmail,
  Min,
  MaxLength,
  IsObject,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsBrDocument } from '../../../common/validators/is-br-document.validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  email?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(15)
  phone?: string;

  @ApiPropertyOptional({ description: 'CPF or CNPJ', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(18)
  // Opcional, mas válido quando informado: o dígito verificador, não a contagem.
  @IsBrDocument('documentType', {
    message: 'Documento inválido: confira o CPF ou o CNPJ informado',
  })
  document?: string | null;

  @ApiPropertyOptional({ enum: ['CPF', 'CNPJ'], nullable: true })
  @IsOptional()
  @IsIn(['CPF', 'CNPJ'])
  documentType?: string | null;

  @ApiPropertyOptional({
    example: '1990-05-20',
    nullable: true,
    description: 'Data de nascimento (YYYY-MM-DD). null remove.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Informe a data de nascimento no formato AAAA-MM-DD',
  })
  birthDate?: string | null;

  @ApiPropertyOptional({ description: 'Trade name (PJ)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  tradeName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  segment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ enum: ['CPF', 'CNPJ'] })
  @IsOptional()
  @IsIn(['CPF', 'CNPJ'])
  documentType?: string;
}

export class CreateCustomerAddressDto {
  @ApiPropertyOptional({ description: 'Label (Casa, Trabalho, Entrega)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  street: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  number: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  complement?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  neighborhood: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;

  @ApiProperty({ description: 'UF with 2 letters; stored uppercased' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 2)
  state: string;

  @ApiProperty({ description: 'CEP, with or without mask; stored as digits only' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(9)
  zipCode: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerAddressDto extends PartialType(CreateCustomerAddressDto) {}
