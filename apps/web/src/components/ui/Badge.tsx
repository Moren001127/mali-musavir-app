import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'navy' | 'gold' | 'teal' | 'purple' | 'orange';

const variants: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-600',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger:  'bg-red-50 text-red-700',
  info:    'bg-blue-50 text-blue-700',
  navy:    'bg-[#0A1628] text-white',
  gold:    'bg-[#FBF0D6] text-[#8B6510]',
  teal:    'bg-teal-50 text-teal-700',
  purple:  'bg-purple-50 text-purple-700',
  orange:  'bg-orange-50 text-orange-700',
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  className?: string;
}

export function Badge({ children, variant = 'default', dot, className = '' }: BadgeProps) {
  return (
    <span className={`badge ${variants[variant]} ${className}`}>
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full inline-block"
          style={{ background: 'currentColor' }}
        />
      )}
      {children}
    </span>
  );
}
