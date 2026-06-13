-- e-Tebligat belgesinin ilk kez "Görüntüle" ile açıldığı an.
-- Buton rengi: NULL ise kırmızı (indirildi, henüz görüntülenmedi), dolu ise yeşil (kalıcı).
ALTER TABLE "portal_documents" ADD COLUMN "viewedAt" TIMESTAMP(3);
