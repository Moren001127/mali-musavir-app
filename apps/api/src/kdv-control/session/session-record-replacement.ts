export async function replaceSessionLucaRecordsInDb(
  prisma: any,
  sessionId: string,
  rows: any[],
) {
  await prisma.$transaction(async (tx: any) => {
    await tx.reconciliationResult.deleteMany({ where: { sessionId } });
    await tx.kdvRecord.deleteMany({ where: { sessionId } });
    if (rows.length > 0) {
      await tx.kdvRecord.createMany({ data: rows });
    }
  });
}
