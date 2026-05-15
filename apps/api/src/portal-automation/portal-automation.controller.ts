import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PortalAutomationService } from './portal-automation.service';

@Controller('portal-automation')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PortalAutomationController {
  constructor(private readonly service: PortalAutomationService) {}

  @Get('summary')
  summary(@Req() req: any) {
    return this.service.summary(req.user.tenantId);
  }

  @Get('credentials')
  credentials(@Req() req: any) {
    return this.service.credentialStatus(req.user.tenantId);
  }

  @Post('credentials')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  saveCredential(@Req() req: any, @Body() body: any) {
    return this.service.saveCredential(
      req.user.tenantId,
      req.user.userId || req.user.sub || null,
      body,
    );
  }

  @Get('jobs')
  jobs(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('jobType') jobType?: string,
  ) {
    return this.service.listJobs(req.user.tenantId, {
      limit: limit ? Number(limit) : undefined,
      status,
      jobType,
    });
  }

  @Post('manual-run')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  manualRun(@Req() req: any, @Body() body: any) {
    return this.service.manualRun(
      req.user.tenantId,
      req.user.userId || req.user.sub || null,
      body || {},
    );
  }

  @Post('nightly-run')
  @Roles('ADMIN', 'STAFF')
  @HttpCode(HttpStatus.OK)
  nightlyRunNow(@Req() req: any) {
    return this.service.createNightlyJobsForTenant(req.user.tenantId);
  }

  @Get('documents')
  documents(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('taxpayerId') taxpayerId?: string,
    @Query('belgeTuru') belgeTuru?: string,
  ) {
    return this.service.listDocuments(req.user.tenantId, {
      limit: limit ? Number(limit) : undefined,
      taxpayerId,
      belgeTuru,
    });
  }
}

@Controller('agent/portal-automation')
export class PortalAutomationAgentController {
  constructor(private readonly service: PortalAutomationService) {}

  @Get('jobs/pending')
  async pending(
    @Headers('x-agent-token') agentToken: string,
    @Query('deviceId') deviceId?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = await this.service.resolveTenantFromAgentToken(agentToken);
    return this.service.pendingJobsForAgent(tenantId, {
      deviceId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('jobs/:id/credential')
  async credential(@Headers('x-agent-token') agentToken: string, @Param('id') id: string) {
    const tenantId = await this.service.resolveTenantFromAgentToken(agentToken);
    return this.service.getCredentialForJob(tenantId, id);
  }

  @Post('jobs/:id/running')
  @HttpCode(HttpStatus.OK)
  async running(
    @Headers('x-agent-token') agentToken: string,
    @Param('id') id: string,
    @Body() body: { deviceId?: string },
  ) {
    const tenantId = await this.service.resolveTenantFromAgentToken(agentToken);
    return this.service.markRunning(tenantId, id, body?.deviceId);
  }

  @Post('jobs/:id/complete')
  @HttpCode(HttpStatus.OK)
  async complete(@Headers('x-agent-token') agentToken: string, @Param('id') id: string, @Body() body: any) {
    const tenantId = await this.service.resolveTenantFromAgentToken(agentToken);
    return this.service.completeJob(tenantId, id, body || {});
  }

  @Post('jobs/:id/fail')
  @HttpCode(HttpStatus.OK)
  async fail(
    @Headers('x-agent-token') agentToken: string,
    @Param('id') id: string,
    @Body() body: { errorMessage?: string; error?: string },
  ) {
    const tenantId = await this.service.resolveTenantFromAgentToken(agentToken);
    return this.service.markFailed(tenantId, id, body?.errorMessage || body?.error || 'Agent hatasi');
  }
}
