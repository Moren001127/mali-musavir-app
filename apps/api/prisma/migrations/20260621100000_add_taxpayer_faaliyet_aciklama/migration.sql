-- Serbest faaliyet/sektör açıklaması — fatura hesap eşleştirmede öncelikli sinyal (NACE koddan daha güvenilir).
ALTER TABLE "taxpayers" ADD COLUMN IF NOT EXISTS "faaliyetAciklama" TEXT;
