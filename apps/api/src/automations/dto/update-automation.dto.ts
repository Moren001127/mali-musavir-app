import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AutomationTriggerTypeDto } from './create-automation.dto';

export enum AutomationStatusDto {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR',
  ARCHIVED = 'ARCHIVED',
}

/**
 * PATCH için kullanılır — tüm alanlar opsiyonel.
 * Durum değişikliği (PAUSED ↔ ACTIVE) için ayrı bir endpoint daha vardır
 * (controller'da @Patch(':id/status'), tek alanlı sade istek için).
 */
export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsEnum(AutomationTriggerTypeDto)
  triggerType?: AutomationTriggerTypeDto;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  steps?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(AutomationStatusDto)
  status?: AutomationStatusDto;

  @IsOptional()
  @IsString()
  failurePolicy?: string;
}
