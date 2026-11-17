import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import {
  CurrentPermissions,
  CurrentTenant,
  CurrentUser,
} from '../../common/decorators/tenant.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { UploadedFileLike } from '../storage/storage.service';
import { ConfirmReceiptDto } from './dto/receipt.dto';
import { PurchasesService } from './purchases.service';

/** Uma NF-e grande (centenas de itens) fica longe disto; o resto é arquivo errado. */
const MAX_XML_BYTES = 5 * 1024 * 1024;

function xmlTextOf(file: UploadedFileLike | undefined): string {
  if (!file) {
    throw new BadRequestException('Envie o arquivo XML da nota.');
  }
  const looksLikeXml =
    file.originalname.toLowerCase().endsWith('.xml') || /xml/i.test(file.mimetype);
  if (!looksLikeXml) {
    throw new BadRequestException('O arquivo precisa ser o XML da NF-e (não PDF nem imagem).');
  }
  return file.buffer.toString('utf8');
}

function messagesOf(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...messagesOf(error.children ?? []),
  ]);
}

/** As decisões vêm como texto JSON ao lado do arquivo (multipart). */
async function decisionsOf(payload: string | undefined): Promise<ConfirmReceiptDto> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload ?? '');
  } catch {
    throw new BadRequestException('Envie as decisões da nota (itens e depósito).');
  }
  const dto = plainToInstance(ConfirmReceiptDto, parsed);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: false });
  if (errors.length > 0) {
    throw new BadRequestException(messagesOf(errors).join('; '));
  }
  return dto;
}

@ApiTags('Purchases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post('receipts/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('purchases:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_XML_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Ler o XML de uma NF-e e sugerir o casamento dos itens (não grava nada)',
  })
  async preview(@CurrentTenant() tenantId: string, @UploadedFile() file: UploadedFileLike) {
    const data = await this.purchases.previewReceipt(tenantId, xmlTextOf(file));
    return { success: true, data };
  }

  @Post('receipts')
  @RequirePermissions('purchases:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_XML_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Dar entrada da NF-e: vincula/cria produtos, move o estoque e gera as contas a pagar',
  })
  async confirm(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @CurrentPermissions() permissions: string[],
    @UploadedFile() file: UploadedFileLike,
    @Body('payload') payload: string,
  ) {
    const xml = xmlTextOf(file);
    const decisions = await decisionsOf(payload);
    const data = await this.purchases.confirmReceipt(tenantId, userId, permissions, xml, decisions);
    return { success: true, data };
  }
}
