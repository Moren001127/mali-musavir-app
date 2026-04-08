import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SmsTemplatesService {
  constructor(private prisma: PrismaService) {}

  async getTemplate(tenantId: string) {
    let template = await this.prisma.smsTemplate.findUnique({ where: { tenantId } });
    if (!template) {
      template = await this.prisma.smsTemplate.create({ data: { tenantId } });
    }
    return template;
  }

  async updateTemplate(tenantId: string, data: { evrakTalepMesaji?: string; evrakGeldiMesaji?: string }) {
    const existing = await this.prisma.smsTemplate.findUnique({ where: { tenantId } });
    if (!existing) {
      return this.prisma.smsTemplate.create({ data: { tenantId, ...data } });
    }
    return this.prisma.smsTemplate.update({ where: { tenantId }, data });
  }
}
