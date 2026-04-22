import { Module } from '@nestjs/common';
import { BeyannameTakipService } from './beyanname-takip.service';
import { BeyannameTakipController } from './beyanname-takip.controller';

@Module({
  providers: [BeyannameTakipService],
  controllers: [BeyannameTakipController],
  exports: [BeyannameTakipService],
})
export class BeyannameTakipModule {}
