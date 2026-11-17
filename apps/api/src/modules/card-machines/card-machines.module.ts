import { Module } from '@nestjs/common';
import { CardMachinesController } from './card-machines.controller';
import { CardMachinesService } from './card-machines.service';

@Module({
  controllers: [CardMachinesController],
  providers: [CardMachinesService],
  exports: [CardMachinesService],
})
export class CardMachinesModule {}
