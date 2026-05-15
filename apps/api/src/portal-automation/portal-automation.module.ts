import { Module } from '@nestjs/common';
import { PortalAutomationController, PortalAutomationAgentController } from './portal-automation.controller';
import { PortalAutomationService } from './portal-automation.service';
import { PortalAutomationRailwayRunnerService } from './portal-automation-railway-runner.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [PortalAutomationController, PortalAutomationAgentController],
  providers: [PortalAutomationService, PortalAutomationRailwayRunnerService],
  exports: [PortalAutomationService],
})
export class PortalAutomationModule {}
