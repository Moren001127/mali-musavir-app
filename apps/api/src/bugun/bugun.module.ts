import { Module } from '@nestjs/common';
import { BugunController } from './bugun.controller';
import { BugunService } from './bugun.service';

@Module({
  controllers: [BugunController],
  providers: [BugunService],
  exports: [BugunService],
})
export class BugunModule {}
