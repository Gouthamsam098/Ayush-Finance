import type { CSSProperties, ReactNode } from 'react';
import { initials } from '@/lib/format';
import { customerAvatarColor } from '@/lib/customerPhoto';
import { useCustomerPhotoUrl } from '@/hooks/useCustomerPhotoUrl';
import { cn } from '@/lib/utils';

interface Props {
  customerId?: number | null;
  name: string;
  className?: string;
  imgClassName?: string;
  textClassName?: string;
  /** When no photo — defaults to name gradient. */
  fallbackStyle?: CSSProperties;
  children?: ReactNode;
}

export function CustomerAvatar({
  customerId,
  name,
  className,
  imgClassName,
  textClassName,
  fallbackStyle,
  children,
}: Props) {
  const photoUrl = useCustomerPhotoUrl(customerId);
  const label = name.trim() || 'Customer';

  const defaultFallback: CSSProperties = fallbackStyle ?? {
    background: `linear-gradient(145deg, ${customerAvatarColor(label)}, ${customerAvatarColor(label)}bb)`,
    color: '#fff',
  };

  return (
    <div className={cn('relative shrink-0 overflow-hidden', className)}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn('h-full w-full object-cover', imgClassName)}
        />
      ) : (
        <div
          className={cn('grid h-full w-full place-items-center font-bold', textClassName ?? 'text-[13px]')}
          style={defaultFallback}
        >
          {initials(label)}
        </div>
      )}
      {children}
    </div>
  );
}
