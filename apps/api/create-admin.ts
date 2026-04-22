/**
 * Tek-sefer admin kullanıcı oluşturma scripti
 * Muzaffer Ören — MOREN Mali Müşavirlik
 *
 * Çalıştırma:
 *   Railway:  railway run --service mali-musavir-api "npx tsx create-admin.ts"
 *   Lokal:    DATABASE_URL="postgresql://..." npx tsx create-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = 'muzaffer@morenmusavirlik.com';
  const password = 'Mo.001127';
  const firstName = 'Muzaffer';
  const lastName = 'Ören';
  const tenantName = 'MOREN Mali Müşavirlik';

  // 1) Tenant bul veya oluştur
  let tenant = await prisma.tenant.findFirst({
    where: { OR: [{ name: tenantName }, { email }] },
  });
  if (!tenant) {
    const slug = tenantName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    tenant = await prisma.tenant.create({
      data: { name: tenantName, slug, email },
    });
    console.log('✔ Tenant oluşturuldu:', tenant.id);
  } else {
    console.log('✔ Mevcut tenant bulundu:', tenant.id);
  }

  // 2) ADMIN + STAFF + READONLY rolleri upsert
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    create: { name: 'ADMIN', description: 'Tam yetkili yönetici' },
    update: {},
  });
  await prisma.role.upsert({
    where: { name: 'STAFF' },
    create: { name: 'STAFF', description: 'Ofis personeli' },
    update: {},
  });
  await prisma.role.upsert({
    where: { name: 'READONLY' },
    create: { name: 'READONLY', description: 'Sadece görüntüleme' },
    update: {},
  });

  // 3) Kullanıcı var mı kontrol et
  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email },
  });

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  if (existing) {
    console.log('⚠ Kullanıcı zaten var, şifre + rol güncelleniyor...');
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, isActive: true, firstName, lastName },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: adminRole.id } },
      create: { userId: existing.id, roleId: adminRole.id },
      update: {},
    });
    console.log('✔ Kullanıcı güncellendi ve ADMIN rolü atandı:', existing.id);
  } else {
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash,
        firstName,
        lastName,
        isActive: true,
        userRoles: { create: { roleId: adminRole.id } },
      },
    });
    console.log('✔ Yeni admin oluşturuldu:', user.id);
  }

  console.log('\n════════ GİRİŞ BİLGİLERİ ════════');
  console.log('URL      : https://portal.morenmusavirlik.com');
  console.log('Email    :', email);
  console.log('Password :', password);
  console.log('Role     : ADMIN');
  console.log('Tenant   :', tenant.name, '(' + tenant.id + ')');
  console.log('═══════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('✗ Hata:', e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
