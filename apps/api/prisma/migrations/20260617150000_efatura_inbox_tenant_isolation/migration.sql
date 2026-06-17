-- e-Fatura inbox: unique (entegrator,uuid) -> (tenantId,taxpayerId,entegrator,uuid)
-- Aynı UUID'yi farklı mükellef/tenant çekince ikincisinin sessizce atlanması (fatura kaybı) önlenir.
-- Yeni kısıt eskisinin üst kümesi olduğundan mevcut satırlar ihlal etmez.
ALTER TABLE "efatura_inbox" DROP CONSTRAINT IF EXISTS "efatura_inbox_entegrator_uuid_key";
ALTER TABLE "efatura_inbox" ADD CONSTRAINT "efatura_inbox_tenantId_taxpayerId_entegrator_uuid_key" UNIQUE ("tenantId", "taxpayerId", "entegrator", "uuid");
