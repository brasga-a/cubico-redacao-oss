import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import type { User } from '@/lib/workbench/types'

export function UserAvatar({ user }: { user: Pick<User, 'image'> }) {
  return (
    <Avatar>
      {user.image && <AvatarImage src={user.image} alt="" />}
      <AvatarFallback className="bg-transparent">
        <Skeleton className="size-full rounded-full motion-reduce:animate-none" />
      </AvatarFallback>
    </Avatar>
  )
}
