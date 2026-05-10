ALTER TABLE "sms_templates"
ADD COLUMN IF NOT EXISTS "tahsilatHatirlatmaMesaji" TEXT NOT NULL
DEFAULT 'Sayin {ad}, cari hesabinizda {bakiye} acik bakiye gorunmektedir. Odeme yaptiysaniz dekontu iletmenizi rica ederiz. Moren Mali Musavirlik';
