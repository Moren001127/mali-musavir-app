import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /automations/parse body'si.
 *
 * Sadece cümle alıyoruz. Hiç kayıt YAPMAZ — parser'ı çağırıp
 * yapılandırılmış bir öneri döner. Kullanıcı onayladıktan sonra
 * POST /automations'a yollanır.
 */
export class ParsePromptDto {
  @IsString()
  @IsNotEmpty({ message: 'prompt boş olamaz.' })
  @MinLength(5, { message: 'En az 5 karakter olmalı.' })
  @MaxLength(2000, { message: 'En fazla 2000 karakter olabilir.' })
  prompt!: string;
}
