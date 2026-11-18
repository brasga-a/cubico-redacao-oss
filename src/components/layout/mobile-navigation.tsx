import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { useIsMobile } from '@/hooks/use-mobile'
import type { User } from '@/lib/workbench/types'
import { UserAvatar } from './user-avatar'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu'

export type HeaderAction = {
  id: string
  label: string
  icon: LucideIcon
  onSelect: () => void
}
export type HeaderNavigationItem = {
  to: '/editor' | '/historico'
  label: string
  count?: number
}

export function MobileNavigation({
  user,
  items,
  actions,
}: {
  user: User
  items: HeaderNavigationItem[]
  actions: HeaderAction[]
}) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const pendingAction = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!isMobile) setOpen(false)
  }, [isMobile])

  return (
    <Drawer
      open={open}
      onOpenChange={setOpen}
      swipeDirection="up"
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) {
          const action = pendingAction.current
          pendingAction.current = null
          action?.()
        }
      }}
    >
      <DrawerTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-11 rounded-full md:hidden"
            aria-label="Abrir menu de navegação"
          />
        }
      >
        <UserAvatar user={user} />
      </DrawerTrigger>
      {/* Release the transformed text layer at rest; keep transforms for transitions and swiping. */}
      <DrawerContent className="shadow-lg motion-reduce:transition-none data-[swipe-axis=y]:[--drawer-content-max-height:calc(100dvh-4rem)] [&:not([data-starting-style],[data-ending-style],[data-swiping],[data-nested-drawer-open])]:transform-none [&:not([data-starting-style],[data-ending-style],[data-swiping],[data-nested-drawer-open])]:will-change-auto">
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-4">
            <DrawerTitle>Menu</DrawerTitle>
            <DrawerClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label="Fechar menu"
                />
              }
            >
              <X aria-hidden />
            </DrawerClose>
          </div>
          <DrawerDescription className="sr-only">
            Navegação e opções da sua conta
          </DrawerDescription>
          <NavigationMenu
            aria-label="Principal"
            className="mt-3 w-full max-w-none"
          >
            <NavigationMenuList className="w-full flex-col items-stretch gap-1">
              {items.map((item) => (
                <NavigationMenuLink
                  key={item.to}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium hover:bg-muted data-[status=active]:bg-muted"
                  render={<Link to={item.to} onClick={() => setOpen(false)} />}
                >
                  {item.label}
                  {!!item.count && (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {item.count}
                    </span>
                  )}
                </NavigationMenuLink>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
          <Separator className="my-4 block h-px w-full" />
          <div className="flex min-w-0 items-center gap-3 px-2">
            <UserAvatar user={user} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-1">
            {actions.map(({ id, label, icon: Icon, onSelect }) => (
              <Button
                key={id}
                variant="ghost"
                className="h-11 w-full justify-start"
                onClick={() => {
                  pendingAction.current = onSelect
                  setOpen(false)
                }}
              >
                <Icon aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
