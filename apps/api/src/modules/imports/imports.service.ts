import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ImportType } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../database/prisma/prisma.service';
import { StorageService, UploadedFileLike } from '../storage/storage.service';

export const IMPORT_QUEUE = 'imports';
export const PROCESS_IMPORT_JOB = 'process-import';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * multer decodes the multipart file name as latin1, so "Exportação.xlsx" arrives
 * as "ExportaÃ§Ã£o.xlsx". Undo it when the bytes really are UTF-8; a name that
 * was already right does not survive the round trip, so it is left alone.
 */
function repairFileName(name: string): string {
  const repaired = Buffer.from(name, 'latin1').toString('utf8');
  return repaired.includes('\uFFFD') ? name : repaired;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(IMPORT_QUEUE) private readonly queue: Queue,
  ) {}

  /** Stores the CSV in MinIO, records an ImportJob and enqueues background processing. */
  async createImport(
    tenantId: string,
    userId: string,
    type: ImportType,
    file?: UploadedFileLike,
  ) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo enviado');
    }
    const originalName = repairFileName(file.originalname);
    const name = originalName.toLowerCase();
    const isCsv =
      file.mimetype.includes('csv') ||
      file.mimetype === 'application/vnd.ms-excel' ||
      name.endsWith('.csv');
    // Browsers often send .xlsx as application/octet-stream: trust the extension.
    const isSpreadsheet = name.endsWith('.xlsx');
    if (type === 'PRODUCTS') {
      if (!isCsv && !isSpreadsheet) {
        throw new BadRequestException('O arquivo deve ser um CSV ou uma planilha do Excel (.xlsx)');
      }
    } else if (!isCsv) {
      throw new BadRequestException('O arquivo deve ser um CSV');
    }
    if (file.size > MAX_CSV_BYTES) {
      throw new BadRequestException('O arquivo deve ter no máximo 10 MB');
    }

    const objectName = `imports/${tenantId}/${type.toLowerCase()}/${Date.now()}-${originalName}`;
    const stored = await this.storage.uploadBuffer(
      objectName,
      file.buffer,
      file.mimetype || (isSpreadsheet ? XLSX_MIME : 'text/csv'),
    );

    const job = await this.prisma.importJob.create({
      data: {
        tenantId,
        type,
        status: 'PENDING',
        fileName: originalName,
        fileKey: stored.key,
        createdBy: userId,
      },
    });

    await this.queue.add(PROCESS_IMPORT_JOB, { importJobId: job.id });

    this.logger.log(`Import ${job.id} (${type}) enqueued for tenant ${tenantId}`);

    return job;
  }

  async findAll(tenantId: string, type?: ImportType) {
    return this.prisma.importJob.findMany({
      where: { tenantId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findOne(tenantId: string, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, tenantId },
    });
    if (!job) {
      throw new NotFoundException('Importação não encontrada');
    }
    return job;
  }
}
