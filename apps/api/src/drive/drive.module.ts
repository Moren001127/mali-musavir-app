import { Module } from '@nestjs/common';
import { DriveController } from './drive.controller';
import { DriveService } from './drive.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MihsapModule } from '../mihsap/mihsap.module';

@Module({
  imports: [PrismaModule, MihsapModule],
  controllers: [DriveController],
  providers: [DriveService],
  exports: [DriveService],
})
export class DriveModule {}
