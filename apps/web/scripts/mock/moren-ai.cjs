// MOREN AI (Elif) sahte verisi — beyaz tema yeniden tasarım doğrulaması (2026-09-21).
//   Yerleşik `/moren-ai/conversations` ucu mock-api.cjs içinde BOŞ dizi döner ve eklentiden önce eşleşir;
//   bu yüzden liste burada `/moren-ai-sahte/conversations` yolunda sunulur, önizleme betiği tarayıcıda
//   `page.route` ile asıl yolu buraya yönlendirir. Diğer uçlar (tek sohbet, mesaj gönderme, hafıza, ofis beyni)
//   doğrudan asıl yollarında karşılanır.
const SIMDI = Date.now();
const dk = (n) => new Date(SIMDI - n * 60_000).toISOString();

function mesaj(id, conversationId, role, content, dakikaOnce, ek = {}) {
  return {
    id,
    conversationId,
    role,
    content,
    createdAt: dk(dakikaOnce),
    ...(role === 'assistant'
      ? { inputTokens: ek.inputTokens ?? 1840, outputTokens: ek.outputTokens ?? 410, costUsd: ek.costUsd ?? 0.0041 }
      : {}),
    ...(ek.toolResults ? { toolResults: ek.toolResults } : {}),
  };
}

const SOHBETLER = [
  {
    id: 'c1',
    title: 'KDV beyanı risk sıralaması — Eylül',
    taxpayerId: null,
    createdAt: dk(95),
    updatedAt: dk(12),
    mesajlar: [
      mesaj('c1m1', 'c1', 'user', 'Bu hafta beyanname riski en yüksek mükellefleri sırala.', 95),
      mesaj(
        'c1m2',
        'c1',
        'assistant',
        [
          'Eylül dönemi KDV beyanlarında **riskli 5 mükellef** şöyle (KDV Kontrol + evrak durumuna göre):',
          '',
          '| # | Mükellef | Durum | Eksik |',
          '|---|---|---|---|',
          '| 1 | Öz Ela Gıda Ltd. | KDV kontrolü yapılmadı | 14 alış faturası |',
          '| 2 | Balçık İnşaat A.Ş. | Tevkifatlı fatura eşleşmedi | 3 fatura |',
          '| 3 | Mert Reklam Ajansı | Evrak bekleniyor | Banka ekstresi |',
          '| 4 | Famcoffee Kahve A.Ş. | Mihsap aktarımı hatalı | 2 kayıt |',
          '| 5 | Ela Tekstil Ltd. | Kontrol tamam, onay bekliyor | — |',
          '',
          'İlk ikisi için bugün müdahale gerekir; son gün **26 Eylül**.',
        ].join('\n'),
        93,
        { inputTokens: 5210, outputTokens: 640, costUsd: 0.0112 },
      ),
      mesaj('c1m3', 'c1', 'user', 'Öz Ela için eksik faturaları WhatsApp ile iste, taslağı göster.', 40),
      mesaj(
        'c1m4',
        'c1',
        'assistant',
        [
          'Taslak hazır, göndermeden önce onayınızı bekliyor:',
          '',
          '> Merhaba, Eylül dönemi KDV beyanı için 14 alış faturanız eksik görünüyor. En geç **24 Eylül**e kadar portala yükleyebilir ya da bize iletebilirsiniz. Teşekkürler — MOREN Mali Müşavirlik',
          '',
          'Onaylarsanız mesajı Öz Ela Gıda yetkilisine (0532 ••• 41 18) iletirim.',
        ].join('\n'),
        38,
        {
          inputTokens: 2310,
          outputTokens: 280,
          costUsd: 0.0048,
          toolResults: [
            {
              name: 'preview_agent_command',
              input: { agent: 'whatsapp', action: 'send_message', payload: { taxpayerId: 'm1' } },
              result: {
                requiresConfirmation: true,
                ok: true,
                agent: 'whatsapp',
                action: 'send_message',
                payload: { taxpayerId: 'm1', text: 'Eylül dönemi KDV beyanı için 14 alış faturanız eksik…' },
                etki: 'Öz Ela Gıda yetkilisine 1 WhatsApp mesajı gönderilir; mesaj İletim Raporu’na işlenir.',
                confirmationText: 'ONAYLIYORUM',
              },
            },
          ],
        },
      ),
      mesaj('c1m5', 'c1', 'user', 'Balçık İnşaat’taki tevkifat eşleşmesi neden düşmedi?', 14),
      mesaj(
        'c1m6',
        'c1',
        'assistant',
        [
          '3 faturada tevkifat oranı **7/10** olarak okunmuş; Luca’daki cari kartta oran 5/10 tanımlı. Eşleştirme bu yüzden askıda.',
          '',
          '- Fatura no: BLC2026000000412, 413, 419',
          '- Toplam KDV: 18.640,00 ₺ · tevkifat farkı: 3.728,00 ₺',
          '',
          'İsterseniz cari kartı 7/10’a çekip yeniden eşleştireyim (onay kuyruğuna düşer).',
        ].join('\n'),
        12,
        { inputTokens: 3120, outputTokens: 360, costUsd: 0.0066 },
      ),
    ],
  },
  {
    id: 'c2',
    title: 'Öz Ela Gıda — evrak eksikleri',
    taxpayerId: 'm1',
    createdAt: dk(60 * 26),
    updatedAt: dk(60 * 3 + 20),
    mesajlar: [
      mesaj('c2m1', 'c2', 'user', 'Öz Ela Gıda’nın bu ay yüklemediği evrakları listele.', 60 * 26),
      mesaj(
        'c2m2',
        'c2',
        'assistant',
        'Eylül için **3 evrak** eksik: banka ekstresi (Ziraat), kira faturası ve Z raporları (1–15 Eylül). Yükleme bağlantısını mükellef portalına gönderdim; son yükleme 12 Eylül.',
        60 * 26 - 2,
      ),
      mesaj('c2m3', 'c2', 'user', 'Kira faturası her ay gecikiyor, hatırlatma kuralı var mı?', 60 * 3 + 22),
      mesaj(
        'c2m4',
        'c2',
        'assistant',
        'Evet — "Evrak otomasyonu" her ayın 5’inde WhatsApp hatırlatması gönderiyor; Öz Ela pilot listesinde. Son gönderim 5 Eylül 09:00, iletildi ancak yanıt gelmedi. İkinci hatırlatmayı elle tetikleyebilirim.',
        60 * 3 + 20,
      ),
    ],
  },
  {
    id: 'c3',
    title: 'Famcoffee tahsilat mesajı taslağı',
    taxpayerId: 'm5',
    createdAt: dk(60 * 30),
    updatedAt: dk(60 * 27),
    mesajlar: [
      mesaj('c3m1', 'c3', 'user', 'Famcoffee’nin 2 aylık ücret borcu için nazik bir tahsilat mesajı yaz.', 60 * 30),
      mesaj(
        'c3m2',
        'c3',
        'assistant',
        [
          '> Merhaba, Temmuz ve Ağustos aylarına ait müşavirlik ücretleriniz (toplam **9.000 ₺**) henüz ulaşmadı. Uygun olduğunuzda ödemenizi rica ederiz; dekontu bu numaraya iletebilirsiniz. İyi çalışmalar — MOREN Mali Müşavirlik',
          '',
          'Cari Kasa’daki bakiye ile uyumlu. Gönderim için onayınız yeterli.',
        ].join('\n'),
        60 * 27,
      ),
    ],
  },
  {
    id: 'c4',
    title: 'Luca aktarım hataları (bu sabah)',
    taxpayerId: null,
    createdAt: dk(60 * 6),
    updatedAt: dk(60 * 5 + 40),
    mesajlar: [
      mesaj('c4m1', 'c4', 'user', 'Bu sabahki Luca aktarım hatalarını özetle.', 60 * 6),
      mesaj(
        'c4m2',
        'c4',
        'assistant',
        [
          '06:10–06:45 arasında **4 iş** hata verdi:',
          '',
          '1. Balçık İnşaat — e-Arşiv sorgusu: oturum düştü (yeniden denendi, tamam).',
          '2. Mert Reklam — fiş aktarımı: 2 satırda cari bulunamadı.',
          '3. Ela Tekstil — mizan çekimi: zaman aşımı.',
          '4. Dilek Bayageldi — işletme defteri: dönem kilitli.',
          '',
          '2 ve 4 sizin kararınızı bekliyor; diğerleri kapandı.',
        ].join('\n'),
        60 * 5 + 40,
      ),
    ],
  },
  {
    id: 'c5',
    title: 'Mert Reklam — e-Tebligat',
    taxpayerId: 'm4',
    createdAt: dk(60 * 50),
    updatedAt: dk(60 * 49),
    mesajlar: [
      mesaj('c5m1', 'c5', 'user', 'Mert Reklam’a gelen e-Tebligat ne hakkında?', 60 * 50),
      mesaj(
        'c5m2',
        'c5',
        'assistant',
        '18 Eylül tarihli tebligat **2025/2. dönem geçici vergi** için bilgi isteme yazısı. Cevap süresi 15 gün (son gün 3 Ekim). Görevler’e "Mert Reklam — tebligat cevabı" kaydını açtım ve size atadım.',
        60 * 49,
      ),
    ],
  },
  {
    id: 'c6',
    title: 'MUHSGK son gün hatırlatması',
    taxpayerId: null,
    createdAt: dk(60 * 24 * 3),
    updatedAt: dk(60 * 24 * 3 - 15),
    mesajlar: [
      mesaj('c6m1', 'c6', 'user', 'MUHSGK’sı verilmeyen kaç mükellef kaldı?', 60 * 24 * 3),
      mesaj('c6m2', 'c6', 'assistant', '33 mükellefin **12’si** bekliyor. 9’unda bordro hazır, 3’ünde SGK bildirgesi eksik. Listeyi Beyannameler ekranına süzgeçli bağlantıyla koydum.', 60 * 24 * 3 - 15),
    ],
  },
  {
    id: 'c7',
    title: 'Ayşegül Kaya — işletme defteri',
    taxpayerId: 'm3',
    createdAt: dk(60 * 24 * 5),
    updatedAt: dk(60 * 24 * 5 - 30),
    mesajlar: [
      mesaj('c7m1', 'c7', 'user', 'Ayşegül Kaya’nın Ağustos işletme defteri Luca’ya aktarıldı mı?', 60 * 24 * 5),
      mesaj('c7m2', 'c7', 'assistant', 'Evet, 17 Ağustos’ta 42 kayıt hızlı fiş CSV ile aktarıldı; 2 kayıt "Soyadı Ünvan" alanı yüzünden elle düzeltildi. Defter-Beyan tarafında onay bekliyor.', 60 * 24 * 5 - 30),
    ],
  },
  {
    id: 'c8',
    title: 'Ofis WhatsApp şablonları',
    taxpayerId: null,
    createdAt: dk(60 * 24 * 9),
    updatedAt: dk(60 * 24 * 9 - 10),
    mesajlar: [
      mesaj('c8m1', 'c8', 'user', 'Evrak hatırlatma şablonunu daha kısa yap.', 60 * 24 * 9),
      mesaj('c8m2', 'c8', 'assistant', 'Kısaltılmış şablon:\n\n> Merhaba, {ay} evraklarınızı {tarih} tarihine kadar portala yüklemenizi rica ederiz. Teşekkürler — MOREN\n\nŞablonlar ekranına kaydettim.', 60 * 24 * 9 - 10),
    ],
  },
];

let mesajSayaci = 500;
const HAFIZA = [
  { id: 'h1', title: 'Öz Ela kira faturası', content: 'Kira faturası her ayın 10’undan sonra geliyor; hatırlatma 5’inde gidiyor, ikinci hatırlatma elle.', scope: 'taxpayer', taxpayerId: 'm1', createdAt: dk(60 * 24 * 2) },
  { id: 'h2', title: 'Tevkifat oranı — Balçık', content: 'Balçık İnşaat inşaat işlerinde 7/10 tevkifat uygular; cari kart 5/10 kalmış, düzeltilecek.', scope: 'office', taxpayerId: null, createdAt: dk(60 * 5) },
  { id: 'h3', title: 'Beyan son günü', content: 'KDV beyanı son gün 26’sı; 24’ünde evrak eksik olanlara son hatırlatma.', scope: 'office', taxpayerId: null, createdAt: dk(60 * 24 * 12) },
];

function ozet(c) {
  const girdi = c.mesajlar.reduce((t, m) => t + (m.inputTokens || 0), 0);
  const cikti = c.mesajlar.reduce((t, m) => t + (m.outputTokens || 0), 0);
  const maliyet = c.mesajlar.reduce((t, m) => t + (m.costUsd || 0), 0);
  return { id: c.id, title: c.title, taxpayerId: c.taxpayerId, createdAt: c.createdAt, updatedAt: c.updatedAt, totalCostUsd: Number(maliyet.toFixed(4)), totalInputTokens: girdi, totalOutputTokens: cikti };
}
const sirali = () => [...SOHBETLER].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

function uclar(yol, yontem, q, govde, jsonGonder, res) {
  // Liste (yerleşik uç boş döndüğü için ayrı yol; önizleme betiği page.route ile buraya yönlendirir)
  if (yontem === 'GET' && yol === '/moren-ai-sahte/conversations') return jsonGonder(res, 200, sirali().slice(0, Number(q.limit) || 30).map(ozet));

  const tek = /^\/moren-ai\/conversations\/([^/]+)$/.exec(yol);
  if (tek) {
    const c = SOHBETLER.find((x) => x.id === decodeURIComponent(tek[1]));
    if (!c) return jsonGonder(res, 404, { message: 'Sohbet bulunamadı' });
    if (yontem === 'GET') return jsonGonder(res, 200, { ...ozet(c), messages: c.mesajlar });
    if (yontem === 'PATCH') { if (govde.title) c.title = String(govde.title); return jsonGonder(res, 200, ozet(c)); }
    if (yontem === 'DELETE') { SOHBETLER.splice(SOHBETLER.indexOf(c), 1); return jsonGonder(res, 200, { ok: true }); }
  }

  if (yontem === 'POST' && yol === '/moren-ai/chat') {
    let c = govde.conversationId ? SOHBETLER.find((x) => x.id === govde.conversationId) : null;
    if (!c) {
      c = { id: `c${Date.now()}`, title: String(govde.message || 'Yeni konuşma').slice(0, 48), taxpayerId: govde.taxpayerId || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), mesajlar: [] };
      SOHBETLER.unshift(c);
    }
    const soru = String(govde.message || '');
    c.mesajlar.push(mesaj(`m${++mesajSayaci}`, c.id, 'user', soru, 0));
    const cevap = `Anladım — "${soru.slice(0, 60)}" için verileri topladım.\n\n- Mükellef kayıtları ve son beyan durumu kontrol edildi.\n- Eksik görünen **2 kalem** var; ayrıntıyı Görevler’e not düştüm.\n\nBaşka bir şey ister misiniz?`;
    c.mesajlar.push(mesaj(`m${++mesajSayaci}`, c.id, 'assistant', cevap, 0, { inputTokens: 1420, outputTokens: 210, costUsd: 0.0031 }));
    c.updatedAt = new Date().toISOString();
    return jsonGonder(res, 200, {
      conversationId: c.id,
      assistantMessage: cevap,
      toolUses: [],
      usage: { inputTokens: 1420, outputTokens: 210, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.0031, durationMs: 1800, model: 'sahte' },
    });
  }

  if (yontem === 'GET' && yol === '/moren-ai/office-brain')
    return jsonGonder(res, 200, { generatedAt: new Date().toISOString(), briefing: { ozet: { evrakEksik: 9, kdvKontrolEksik: 4, bankaEksik: 3, bankaHesapsiz: 2, borcluMukellef: 7 } } });

  if (yontem === 'GET' && yol === '/moren-ai/memories') {
    const liste = HAFIZA.filter((h) => (q.taxpayerId ? h.taxpayerId === q.taxpayerId : true)).slice(0, Number(q.limit) || 6);
    return jsonGonder(res, 200, { memories: liste });
  }
  if (yontem === 'POST' && yol === '/moren-ai/memories') {
    const kayit = { id: `h${Date.now()}`, title: govde.title || 'Not', content: govde.content || '', scope: govde.scope || 'office', taxpayerId: govde.taxpayerId || null, createdAt: new Date().toISOString() };
    HAFIZA.unshift(kayit);
    return jsonGonder(res, 200, kayit);
  }
  if (yontem === 'POST' && yol === '/moren-ai/agent-command/confirm') return jsonGonder(res, 200, { ok: true, queued: true });
  return false;
}

module.exports = { uclar, SOHBETLER, ozet };
