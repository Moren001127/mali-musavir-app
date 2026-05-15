import { Module } from '@nestjs/common';
import { PortalAutomationController, PortalAutomationAgentController } from './portal-automation.controller';
import { PortalAutomationService } from './portal-automation.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [PortalAutomationController, PortalAutomationAgentController],
  providers: [PortalAutomationService],
  exports: [PortalAutomationService],
})
export class PortalAutomationModule {}
