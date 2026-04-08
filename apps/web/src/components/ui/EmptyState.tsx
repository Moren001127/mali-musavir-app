import { ReactNode } from 'react';
import Link from 'next/link';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      {description && (
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4">
          {action.href ? (
            <Link href={action.href} className="btn-primary text-sm px-4 py-2">
              {action.label}
            </Link>
          ) : (
            <button onClick={action.onClick} className="btn-primary text-sm px-4 py-2">
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
