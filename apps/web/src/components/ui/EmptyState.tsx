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
        style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(250,250,249,0.45)' }}
      >
        {icon}
      </div>
      <h3 className="text-sm font-semibold" style={{ color: '#fafaf9' }}>
        {title}
      </h3>
      {description && (
        <p className="text-sm mt-1" style={{ color: 'rgba(250,250,249,0.45)' }}>
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
