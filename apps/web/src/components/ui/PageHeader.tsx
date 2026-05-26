import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: ReactNode;
}

export function PageHeader({ title, subtitle, backHref, action }: PageHeaderProps) {
  return (
    <div
      className="mb-3 flex items-center justify-between rounded-2xl px-4 py-3"
      style={{
        background: 'linear-gradient(135deg, rgba(212,184,118,0.055), rgba(8,18,18,0.70))',
        border: '1px solid rgba(212,184,118,0.12)',
        boxShadow: '0 14px 34px rgba(0,0,0,0.14)',
      }}
    >
      <div className="flex items-center gap-3">
        {backHref && (
          <Link
            href={backHref}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
            style={{ border: '1px solid rgba(255,255,255,0.05)', color: 'rgba(250,250,249,0.7)' }}
          >
            <ArrowLeft size={16} />
          </Link>
        )}
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
