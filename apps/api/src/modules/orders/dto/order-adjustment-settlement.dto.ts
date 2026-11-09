import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Baixa da diferença de uma troca/devolução no mesmo ato, no balcão.
 *
 * O operador escolhe a forma de pagamento — não a conta. A conta sai dela como
 * numa venda: dinheiro vai para a gaveta do caixa, PIX/débito para a conta da
 * forma de pagamento. Formas que liquidam depois (cartão de crédito, boleto)
 * deixam o título em aberto, vinculado à forma escolhida.
 */
export class OrderAdjustmentSettlementDto {
  @ApiProperty({ description: 'Forma de pagamento usada para receber ou devolver a diferença' })
  @IsString()
  @IsNotEmpty()
  paymentMethodId: string;

  @ApiPropertyOptional({
    description:
      'Caixa por onde passa o dinheiro. Obrigatório só em dinheiro quando há mais de um caixa aberto e o da venda já fechou.',
  })
  @IsOptional()
  @IsString()
  cashRegisterSessionId?: string;
}
