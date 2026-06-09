/**
 * Mesaj Şablonları API client — owner'ın portalda tanımladığı WhatsApp/e-posta şablonları.
 */
import { api } from './api';

export type TemplateKanal = 'WHATSAPP' | 'EMAIL' | 'BOTH';

export interface MessageTemplate {
  id: string;
  ad: string;
  kanal: TemplateKanal;
  kategori: string;
  emailSubject?: string | null;
  body: string;
  attachPdf: boolean;
  auto: boolean;
  autoEvent?: string | null;
  sirano: number;
  isActive: boolean;
}

export type TemplateInput = Partial<Omit<MessageTemplate, 'id'>>;

export async function listTemplates(): Promise<MessageTemplate[]> {
  const { data } = await api.get('/message-templates');
  return data;
}

export async function createTemplate(dto: TemplateInput): Promise<MessageTemplate> {
  const { data } = await api.post('/message-templates', dto);
  return data;
}

export async function updateTemplate(id: string, dto: TemplateInput): Promise<MessageTemplate> {
  const { data } = await api.put(`/message-templates/${id}`, dto);
  return data;
}

export async function deleteTemplate(id: string): Promise<void> {
  await api.delete(`/message-templates/${id}`);
}
