import { Module } from '@nestjs/common';
import { GundemController } from './gundem.controller';
import { GundemService } from './gundem.service';

@Module({
  controllers: [GundemController],
  providers: [GundemService],
  exports: [GundemService],
})
export class GundemModule {}
