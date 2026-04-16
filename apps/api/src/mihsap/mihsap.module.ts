import { Module } from '@nestjs/common';
import { MihsapController } from './mihsap.controller';
import { MihsapService } from './mihsap.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [MihsapController],
  providers: [MihsapService],
  exports: [MihsapService],
})
export class MihsapModule {}
