import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'info' | 'warning' | 'error' | 'success';
}

export function Badge({ className, variant = 'info', children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        {
          'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300': variant === 'info',
          'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300': variant === 'warning',
          'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300': variant === 'error',
          'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300': variant === 'success',
        },
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
