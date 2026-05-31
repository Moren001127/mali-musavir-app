/**
 * One-time admin user bootstrap.
 *
 * Required env:
 *   ADMIN_EMAIL
 *   ADMIN_PASSWORD
 *
 * Optional env:
 *   ADMIN_FIRST_NAME
 *   ADMIN_LAST_NAME
 *   ADMIN_TENANT_NAME
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} env is required`);
  return value;
}

async function main() {
  const email = required('ADMIN_EMAIL').toLowerCase();
  const password = required('ADMIN_PASSWORD');
  const firstName = process.env.ADMIN_FIRST_NAME?.trim() || 'Admin';
  const lastName = process.env.ADMIN_LAST_NAME?.trim() || 'User';
  const tenantName = process.env.ADMIN_TENANT_NAME?.trim() || 'Moren Mali Musavirlik';

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
    console.log('Tenant created:', tenant.id);
  } else {
    console.log('Tenant found:', tenant.id);
  }

  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    create: { name: 'ADMIN', description: 'Tam yetkili yonetici' },
    update: {},
  });
  await prisma.role.upsert({
    where: { name: 'STAFF' },
    create: { name: 'STAFF', description: 'Ofis personeli' },
    update: {},
  });
  await prisma.role.upsert({
    where: { name: 'READONLY' },
    create: { name: 'READONLY', description: 'Sadece goruntuleme' },
    update: {},
  });

  const existing = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email },
  });

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, isActive: true, firstName, lastName },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: adminRole.id } },
      create: { userId: existing.id, roleId: adminRole.id },
      update: {},
    });
    await prisma.refreshToken.updateMany({
      where: { userId: existing.id, isRevoked: false },
      data: { isRevoked: true },
    });
    console.log('Admin user updated and active sessions revoked:', existing.id);
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
    console.log('Admin user created:', user.id);
  }

  console.log('Admin email:', email);
  console.log('Tenant:', tenant.name, `(${tenant.id})`);
}

main()
  .catch((e) => {
    console.error('Bootstrap failed:', e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
