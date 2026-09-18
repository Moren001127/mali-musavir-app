import { Module } from '@nestjs/common';
import { BeyannameTakipModule } from '../beyanname-takip/beyanname-takip.module';
import { BugunController } from './bugun.controller';
import { BugunService } from './bugun.service';

@Module({
  imports: [BeyannameTakipModule],
  controllers: [BugunController],
  providers: [BugunService],
  exports: [BugunService],
})
export class BugunModule {}
