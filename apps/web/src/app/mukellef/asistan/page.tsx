'use client';
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { taxpayerApi } from '@/lib/taxpayer-api';
import { Sparkles, Send, Loader2 } from 'lucide-react';
import { GOLD, PageTitle } from '../_lib/shared';

type ChatMsg = { role: 'user' | 'assistant'; text: string };

export default function MukellefAsistan() {
  const { data: me } = useQuery({ queryKey: ['portal-me'], queryFn: () => taxpayerApi.get('/portal/me').then((r) => r.data) });
  const ad = me?.companyName || [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'Mükellef';

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: 'assistant', text: `Merhaba! Ben MOREN AI. ${ad} için beyanname, cari bakiye, faturalar, KDV, SGK, e-Tebligat ve evraklarınız hakkında soru sorabilirsiniz.` }]);
  }, [ad]);

  const chatMut = useMutation({
    mutationFn: ({ message, history }: { message: string; history: ChatMsg[] }) =>
      taxpayerApi.post('/portal/ai/chat', { message, history }).then((r) => r.data),
    onSuccess: (res) => setMessages((m) => [...m, { role: 'assistant', text: res.reply || '...' }]),
    onError: () => setMessages((m) => [...m, { role: 'assistant', text: 'Şu anda yanıt veremiyorum, lütfen birazdan tekrar deneyin.' }]),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, chatMut.isPending]);

  function ask(q: string) {
    if (!q || chatMut.isPending) return;
    // Hafıza: o ana kadarki son 8 mesajı (selamlama hariç) geçmiş olarak yolla.
    const history = messages.filter((m, i) => !(i === 0 && m.role === 'assistant')).slice(-8);
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setInput('');
    chatMut.mutate({ message: q, history });
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    ask(input.trim());
  }

  const sorular = [
    'Bu ay ne kadar KDV ödeyeceğim?',
    'Bekleyen beyannamem var mı?',
    'Cari bakiyem ne kadar?',
    'Son e-Tebligatım ne hakkında?',
    'Bu ay satış toplamım ne kadar?',
    'SGK tahakkukum geldi mi?',
  ];

  return (
    <div>
      <PageTitle ust="Size özel asistan" baslik="MOREN AI" icon={Sparkles} />
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(184,160,111,0.2)', height: '68vh', minHeight: 460 }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(180deg, rgba(184,160,111,0.1), transparent)' }}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}><Sparkles size={16} /></div>
          <div><p className="text-[13px] font-semibold" style={{ color: '#fafaf9' }}>MOREN AI</p><p className="text-[10.5px]" style={{ color: 'rgba(250,250,249,0.4)' }}>Yalnız sizin verinize göre yanıtlar</p></div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                style={m.role === 'user'
                  ? { background: `linear-gradient(135deg, ${GOLD}, #b8a06f)`, color: '#0f0d0b', borderRadius: '14px 14px 4px 14px' }
                  : { background: 'rgba(255,255,255,0.05)', color: '#fafaf9', borderRadius: '14px 14px 14px 4px', border: '1px solid rgba(255,255,255,0.06)' }}>
                {m.text}
              </div>
            </div>
          ))}
          {chatMut.isPending && <div className="flex justify-start"><div className="px-3.5 py-2.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.05)' }}><Loader2 size={15} className="animate-spin" style={{ color: GOLD }} /></div></div>}
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {sorular.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}
                  className="text-[12px] px-3 py-1.5 rounded-full" style={{ background: 'rgba(184,160,111,0.08)', border: '1px solid rgba(184,160,111,0.2)', color: 'rgba(250,250,249,0.75)' }}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={send} className="flex items-center gap-2 p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Sorunuzu yazın…"
            className="flex-1 px-3.5 py-2.5 text-[13.5px] rounded-xl outline-none" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#fafaf9' }} />
          <button type="submit" disabled={!input.trim() || chatMut.isPending} className="flex h-10 w-10 items-center justify-center rounded-xl disabled:opacity-40" style={{ background: `linear-gradient(135deg, ${GOLD}, #8b7649)`, color: '#0f0d0b' }}><Send size={16} /></button>
        </form>
      </div>
    </div>
  );
}
