import { useImage } from '../hooks/useImage'

interface AvatarProps {
  name: string
  imageId?: string | null
  size?: 'sm' | 'md' | 'lg'
  variant?: 'direct' | 'group'
}

const SIZE_CLASSES = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-9 w-9 text-[13px]',
  lg: 'h-12 w-12 text-lg',
} as const

const VARIANT_CLASSES = {
  direct: 'bg-linear-to-br from-accent to-accent-blue',
  group: 'bg-linear-to-br from-accent-pink to-accent',
} as const

export function Avatar({ name, imageId, size = 'sm', variant = 'direct' }: AvatarProps) {
  const { url } = useImage(imageId ?? '')
  const initial = name.charAt(0).toUpperCase() || '?'
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${
        url ? '' : VARIANT_CLASSES[variant]
      } ${SIZE_CLASSES[size]}`}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </div>
  )
}