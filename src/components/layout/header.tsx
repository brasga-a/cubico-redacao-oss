import { useNavigate } from '@tanstack/react-router'
import { Eraser, LogOut, PencilSparkles, Settings, SunMoon } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import type { User } from '@/lib/workbench/types'
import { useTheme } from '@/components/theme-provider'
import { MobileNavigation } from './mobile-navigation'
import type { HeaderAction } from './mobile-navigation'
import { UserAvatar } from './user-avatar'
import {
  NavigationMenu,
  NavigationMenuList,
  navigationMenuTriggerStyle,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu'

type Props = {
  user: User
  historyCount: number
  onSignOut: () => void
  onClearData: () => void
}

export function Header({ user, historyCount, onSignOut, onClearData }: Props) {
  const firstName = user.name.trim().split(/\s+/)[0] || 'Conta'
  const navigate = useNavigate()
  const items: {
    to: '/editor' | '/historico'
    label: string
    count?: number
  }[] = [
    { to: '/editor', label: 'Escrever' },
    { to: '/historico', label: 'Correções', count: historyCount },
  ]

  const { theme, setTheme } = useTheme()

  function handleTheme() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const actions: HeaderAction[] = [
    {
      id: 'settings',
      label: 'Configurações',
      icon: Settings,
      onSelect: () => void navigate({ to: '/configuracoes' }),
    },
    {
      id: 'clear',
      label: 'Apagar rascunho e histórico',
      icon: Eraser,
      onSelect: onClearData,
    },
    { id: 'theme', label: 'Mudar tema', icon: SunMoon, onSelect: handleTheme },
    { id: 'sign-out', label: 'Sair', icon: LogOut, onSelect: onSignOut },
  ]

  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-6 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center justify-center gap-2 sm:gap-4">
          <a
            className="flex items-center justify-center gap-2 cursor-pointer"
            href="/editor"
          >
            <div className="p-1 bg-foreground rounded-md">
              <PencilSparkles className="size-5 text-background" />
            </div>
            <div className="flex flex-col items-start -space-y-2">
              <span className="font-semibold text-lg">cubico</span>
              <span className="text-sm font-light">redação</span>
            </div>
          </a>

          <NavigationMenu
            aria-label="Principal"
            className="hidden items-center gap-1 md:flex"
          >
            <NavigationMenuList className={'gap-2'}>
              {items.map((item) => (
                <NavigationMenuLink
                  key={item.to}
                  className={navigationMenuTriggerStyle()}
                  render={
                    <button
                      type="button"
                      onClick={() => void navigate({ to: item.to })}
                    >
                      {item.label}
                    </button>
                  }
                />
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        <MobileNavigation user={user} items={items} actions={actions} />

        <div className="hidden md:block">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Conta de ${user.name}`}
            >
              <span className="max-w-20 truncate text-sm font-medium sm:max-w-32">
                {firstName}
              </span>
              <UserAvatar user={user} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="px-2 py-2">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {actions
                  .slice(0, -1)
                  .map(({ id, label, icon: Icon, onSelect }) => (
                    <DropdownMenuItem key={id} onClick={onSelect}>
                      <Icon aria-hidden />
                      {label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuGroup>

              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSignOut}>
                <LogOut />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
