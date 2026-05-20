import { IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum AutomationTriggerTypeDto {
  CRON = 'CRON',
  EVENT = 'EVENT',
  WEBHOOK = 'WEBHOOK',
  MANUAL = 'MANUAL',
}

/**
 * Faz 1 — el ile (Moren AI parser olmadan) otomasyon oluşturmak için kullanılır.
 * Faz 2'de cümleden otomatik üretim eklendiğinde, parser bu DTO'yu doldurup
 * AutomationsService.create()'i çağıracak.
 */
export class CreateAutomationDto {
  /** Kullanıcının yazdığı orijinal cümle (Faz 2'de parser'a verilecek) */
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(2000)
  prompt!: string;

  /** AI'nın ürettiği veya kullanıcının verdiği başlık */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(AutomationTriggerTypeDto)
  triggerType!: AutomationTriggerTypeDto;

  /** { cron: "0 10 22 * *" } veya { eventName: "...", filters: {} } veya { secret: "..." } */
  @IsObject()
  triggerConfig!: Record<string, unknown>;

  /** { schemaVersion: 1, steps: [...] } — workflow JSON */
  @IsObject()
  steps!: Record<string, unknown>;

  /** "notify" (varsayılan) | "pause_after_3" | "ignore" */
  @IsOptional()
  @IsString()
  failurePolicy?: string;
}
