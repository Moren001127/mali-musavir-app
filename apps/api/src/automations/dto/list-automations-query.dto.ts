import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AutomationTriggerTypeDto } from './create-automation.dto';
import { AutomationStatusDto } from './update-automation.dto';

/**
 * GET /automations?status=ACTIVE&triggerType=CRON&search=KDV&page=1&pageSize=20
 */
export class ListAutomationsQueryDto {
  @IsOptional()
  @IsEnum(AutomationStatusDto)
  status?: AutomationStatusDto;

  @IsOptional()
  @IsEnum(AutomationTriggerTypeDto)
  triggerType?: AutomationTriggerTypeDto;

  /** Başlık veya cümle içinde arama */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
