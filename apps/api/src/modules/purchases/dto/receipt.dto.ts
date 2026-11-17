import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Produto novo, confirmado pelo lojista a partir de um item da nota. */
export class NewProductDto {
  @IsString({ message: 'Informe o nome do produto novo' })
  @IsNotEmpty({ message: 'Informe o nome do produto novo' })
  @MaxLength(255)
  name: string;

  @IsString({ message: 'Informe o SKU do produto novo' })
  @IsNotEmpty({ message: 'Informe o SKU do produto novo' })
  @MaxLength(50)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  ean?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  ncm?: string;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Informe o preço de venda do produto novo' })
  @Min(0)
  @Max(9_999_999)
  salePrice: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;
}

export const RECEIPT_ACTIONS = ['LINK', 'CREATE', 'SKIP'] as const;
export type ReceiptAction = (typeof RECEIPT_ACTIONS)[number];

/** A decisão do lojista sobre UM item da nota. */
export class ReceiptItemDecisionDto {
  @IsInt()
  @Min(1)
  line: number;

  @IsIn(RECEIPT_ACTIONS, { message: 'Decida o item: vincular, criar ou ignorar' })
  action: ReceiptAction;

  @ValidateIf((o: ReceiptItemDecisionDto) => o.action === 'LINK')
  @IsString({ message: 'Escolha o produto a vincular' })
  @IsNotEmpty({ message: 'Escolha o produto a vincular' })
  productId?: string;

  @IsOptional()
  @IsString()
  variantId?: string | null;

  /** Quantidade que entra no estoque; ausente, a da nota. */
  @IsOptional()
  @IsInt({ message: 'A quantidade precisa ser um número inteiro' })
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  /** Custo unitário digitado; ausente, o custo de aquisição calculado da nota. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(9_999_999)
  unitCost?: number;

  @ValidateIf((o: ReceiptItemDecisionDto) => o.action === 'CREATE')
  @IsDefined({ message: 'Informe os dados do produto novo' })
  @ValidateNested()
  @Type(() => NewProductDto)
  product?: NewProductDto;
}

/** Uma parcela a pagar ao fornecedor. */
export class ReceiptPayableDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Informe o vencimento no formato AAAA-MM-DD' })
  dueDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'O valor da parcela deve ser maior que zero' })
  @Max(999_999_999)
  amount: number;
}

export class ConfirmReceiptDto {
  @IsString({ message: 'Escolha o depósito de destino' })
  @IsNotEmpty({ message: 'Escolha o depósito de destino' })
  warehouseId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Decida os itens da nota' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDecisionDto)
  items: ReceiptItemDecisionDto[];

  /** Contas a pagar a gerar; vazio ou ausente = não gerar. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptPayableDto)
  payables?: ReceiptPayableDto[];
}
