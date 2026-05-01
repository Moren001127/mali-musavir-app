-- Mükellefe E-Fatura mükellefi mi? alanı ekle
-- E-Fatura/E-Arşiv akışlarında bu flag'e göre filtre/seçim yapılır
ALTER TABLE "taxpayers" ADD COLUMN "isEFaturaMukellefi" BOOLEAN NOT NULL DEFAULT false;
