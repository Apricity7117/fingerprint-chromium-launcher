import { FingerprintIcon, FolderIcon, LayersIcon, SettingsIcon } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ALL_GROUPS, type GroupSummary } from "@/lib/profile-utils";

interface AppSidebarProps {
  groups: GroupSummary[];
  total: number;
  active: string;
  runningCount: number;
  onSelect: (group: string) => void;
  onOpenSettings: () => void;
}

/** 左侧导航：全部环境 + 分组列表（含数量），底部为运行数、设置与主题 */
export function AppSidebar({ groups, total, active, runningCount, onSelect, onOpenSettings }: AppSidebarProps) {
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FingerprintIcon className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">指纹浏览器启动器</div>
            <div className="text-xs text-muted-foreground">fingerprint-chromium</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={active === ALL_GROUPS}
                  onClick={() => onSelect(ALL_GROUPS)}
                  data-testid="group-all"
                >
                  <LayersIcon />
                  <span>全部环境</span>
                </SidebarMenuButton>
                <SidebarMenuBadge data-testid="group-count-all">{total}</SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>分组</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {groups.map((group) => (
                <SidebarMenuItem key={group.name}>
                  <SidebarMenuButton
                    isActive={active === group.name}
                    onClick={() => onSelect(group.name)}
                    data-testid={`group-${group.name}`}
                  >
                    <FolderIcon />
                    <span className="truncate">{group.name}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge data-testid={`group-count-${group.name}`}>{group.count}</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 px-2">
          <span className="mr-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span className={runningCount > 0 ? "size-2 rounded-full bg-emerald-500" : "size-2 rounded-full bg-muted-foreground/40"} />
            <span data-testid="running-count">{runningCount}</span> 个运行中
          </span>
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" title="全局设置" onClick={onOpenSettings} data-testid="open-settings">
            <SettingsIcon />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
