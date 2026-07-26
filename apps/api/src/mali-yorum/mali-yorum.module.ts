import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MizanModule } from '../mizan/mizan.module';
import { IsletmeHesapOzetiModule } from '../isletme-hesap-ozeti/isletme-hesap-ozeti.module';
import { MaliYorumController } from './mali-yorum.controller';
import { MaliYorumService } from './mali-yorum.service';

/**
 * Mali Yorum — Mizan/Bilanço/Gelir Tablosu/İşletme Hesap Özeti verisini OKUYUP
 * (kilitli modüllere dokunmadan) yapay zeka değerlendirmesi üreten ayrı modül.
 * Kaynak servisleri yalnızca enjekte edip okur.
 */
@Module({
  imports: [PrismaModule, MizanModule, IsletmeHesapOzetiModule],
  controllers: [MaliYorumController],
  providers: [MaliYorumService],
  exports: [MaliYorumService],
})
export class MaliYorumModule {}
