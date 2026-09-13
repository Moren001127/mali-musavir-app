import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /notifications/push-token gövdesi (ValidationPipe whitelist+forbidNonWhitelisted açık → her alan burada olmalı). */
export class PushTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;

  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';

  /** Mobil uygulamanın bildirdiği taraf; kayıtta kimlikten türetilen persona esas alınır. */
  @IsOptional()
  @IsIn(['adv', 'tax'])
  persona?: 'adv' | 'tax';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}

/** DELETE /notifications/push-token gövdesi */
export class PushTokenSilDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  token!: string;
}
