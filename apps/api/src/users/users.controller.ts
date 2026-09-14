import { Controller, Get, Post, Param, Body, UseGuards, Req, Delete, Patch } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('ADMIN')
  findAll(@Req() req: any) {
    return this.usersService.findAllByTenant(req.user.tenantId);
  }

  @Post('invite')
  @Roles('ADMIN')
  invite(@Req() req: any, @Body() dto: any) {
    return this.usersService.invite(req.user.tenantId, dto);
  }

  @Post('create')
  @Roles('ADMIN')
  create(@Req() req: any, @Body() dto: any) {
    return this.usersService.createWithPassword(req.user.tenantId, dto);
  }

  /** WhatsApp telefonu (görev hatırlatması — ofis personeline de hatırlat). */
  @Patch(':id')
  @Roles('ADMIN')
  updatePhone(@Req() req: any, @Param('id') id: string, @Body() dto: { phone?: string | null }) {
    return this.usersService.updatePhone(id, req.user.tenantId, dto?.phone ?? null);
  }

  @Delete(':id')
  @Roles('ADMIN')
  deactivate(@Req() req: any, @Param('id') id: string) {
    return this.usersService.deactivate(id, req.user.tenantId);
  }
}
