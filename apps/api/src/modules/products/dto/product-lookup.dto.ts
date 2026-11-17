import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `code` (what the reader read) or `productId` (+ `variantId`) for a cart line. */
export class ProductLookupQueryDto {
  @ApiPropertyOptional({ example: '7891000000017' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variantId?: string;
}
