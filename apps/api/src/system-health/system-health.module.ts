import { Module, OnModuleInit } from '@nestjs/common';
import { SystemHealthService } from './system-health.service';
import { LockedModulesService } from './locked-modules.service';
import { SystemHealthController } from './system-health.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SystemHealthService, LockedModulesService],
  controllers: [SystemHealthController],
  exports: [SystemHealthService, LockedModulesService],
})
export class SystemHealthModule implements OnModuleInit {
  constructor(private readonly locked: LockedModulesService) {}

  async onModuleInit() {
    // İlk başlatmada DB boşsa .locked-modules.json'dan seed yap
    await this.locked.seedFromJsonIfEmpty();
  }
}
