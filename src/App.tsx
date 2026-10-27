import type { RowSelectionState } from "@tanstack/react-table";
import { ImportIcon, LayoutGridIcon, ListIcon, PlusIcon, RotateCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppSidebar } from "@/components/app-sidebar";
import { DeleteProfilesDialog } from "@/components/delete-profiles-dialog";
import type { ProfileHandlers } from "@/components/profile-actions";
import { ProfileFormDialog } from "@/components/profile-form-dialog";
import { ProfileGrid } from "@/components/profile-grid";
import { ProfileTable } from "@/components/profile-table";
import { SettingsDialog } from "@/components/settings-dialog";
import { ThemeProvider } from "@/components/theme-provider";
import { TitleBarDragRegion } from "@/components/title-bar-drag-region";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useProfiles } from "@/hooks/use-profiles";
import { useRunningStatus } from "@/hooks/use-running-status";
import { useSettings } from "@/hooks/use-settings";
import { api, errorMessage } from "@/lib/api";
import { defaults } from "@/lib/presets";
import { ALL_GROUPS, filterProfiles, groupOf, summarizeGroups, UNGROUPED } from "@/lib/profile-utils";
import type { Profile, ViewMode } from "@/lib/types";

function summarize(action: string, results: PromiseSettledResult<unknown>[]) {
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  const succeeded = results.length - failed.length;
  if (failed.length === 0) {
    toast.success(`已${action} ${succeeded} 个环境`);
  } else {
    toast.error(`${action}完成 ${succeeded} 个，失败 ${failed.length} 个：${errorMessage(failed[0].reason)}`);
  }
}

function LauncherPage() {
  const { profiles, loading, error, reload, retry } = useProfiles();
  const { status, refresh: refreshStatus } = useRunningStatus();
  const { settings, chromiumInfo, reload: reloadSettings } = useSettings();

  const [storedGroup, setStoredGroup] = useLocalStorage<string>("fcl-active-group", ALL_GROUPS);
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>("fcl-view-mode", "card");
  const [query, setQuery] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [form, setForm] = useState<{ open: boolean; editing: Profile | null }>({ open: false, editing: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<Profile[]>([]);

  const groups = useMemo(() => summarizeGroups(profiles), [profiles]);
  // 记住的分组已不存在时回退到「全部环境」
  const activeGroup =
    storedGroup === ALL_GROUPS || groups.some((group) => group.name === storedGroup) ? storedGroup : ALL_GROUPS;
  const visible = useMemo(() => filterProfiles(profiles, activeGroup, query), [profiles, activeGroup, query]);
  const runningCount = profiles.filter((profile) => status[profile.id]).length;

  const selectGroup = (group: string) => {
    setStoredGroup(group);
    setRowSelection({});
  };
  const changeQuery = (value: string) => {
    setQuery(value);
    setRowSelection({});
  };

  const withPending = useCallback(
    async (ids: string[], task: () => Promise<void>) => {
      setPending((prev) => new Set([...prev, ...ids]));
      try {
        await task();
      } finally {
        setPending((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
        void refreshStatus();
        window.setTimeout(() => void refreshStatus(), defaults.status_refresh_delay_ms);
      }
    },
    [refreshStatus],
  );

  const batchLaunch = useCallback(
    (ids: string[]) =>
      void withPending(ids, async () => {
        summarize("启动", await Promise.allSettled(ids.map((id) => api.launchProfile(id))));
      }),
    [withPending],
  );

  const batchStop = useCallback(
    (ids: string[]) =>
      void withPending(ids, async () => {
        summarize("停止", await Promise.allSettled(ids.map((id) => api.stopProfile(id))));
      }),
    [withPending],
  );

  const handlers = useMemo<ProfileHandlers>(
    () => ({
      onLaunch: (id) => batchLaunch([id]),
      onStop: (id) => batchStop([id]),
      onEdit: (profile) => setForm({ open: true, editing: profile }),
      onDuplicate: (id) => {
        api
          .duplicateProfile(id)
          .then(async (copy) => {
            await reload();
            toast.success(`已克隆为「${copy.name}」`);
          })
          .catch((err: unknown) => toast.error(errorMessage(err)));
      },
      onDelete: (ids) => setDeleteTargets(profiles.filter((profile) => ids.includes(profile.id))),
    }),
    [batchLaunch, batchStop, profiles, reload],
  );

  const confirmDelete = async (ids: string[], deleteData: boolean) => {
    setDeleteTargets([]);
    try {
      const result = await api.deleteProfiles(ids, deleteData);
      if (result.errors.length > 0) {
        toast.error(`部分删除失败：${result.errors.join("；")}`);
      } else {
        toast.success(deleteData ? "环境与本地数据已删除" : "环境配置已删除");
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
    setRowSelection({});
    await reload();
    void refreshStatus();
  };

  const onSaved = async (saved: Profile, created: boolean) => {
    setForm({ open: false, editing: null });
    await reload();
    // 新环境不在当前分组时切换过去，便于立即看到
    if (activeGroup !== ALL_GROUPS && groupOf(saved) !== activeGroup) selectGroup(groupOf(saved));
    toast.success(created ? `已创建「${saved.name}」` : "环境已更新");
  };

  const title = activeGroup === ALL_GROUPS ? "全部环境" : activeGroup;
  const showGroup = activeGroup === ALL_GROUPS;
  const groupNames = groups.map((group) => group.name).filter((name) => name !== UNGROUPED);

  let content;
  if (loading && profiles.length === 0) {
    content = (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4" data-testid="profiles-loading">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-60 rounded-xl" />
        ))}
      </div>
    );
  } else if (error && profiles.length === 0) {
    content = (
      <div className="flex flex-col items-center gap-3 py-24 text-center" data-testid="profiles-error">
        <p className="text-sm text-muted-foreground">环境列表加载失败：{error}</p>
        <Button variant="outline" onClick={retry}>
          <RotateCwIcon />
          重新加载
        </Button>
      </div>
    );
  } else if (profiles.length === 0) {
    content = (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-24 text-center" data-testid="empty-state">
        <h3 className="text-lg font-medium">暂无环境</h3>
        <p className="text-sm text-muted-foreground">新建一个浏览器环境，或从旧版启动器导入已有数据。</p>
        <div className="flex gap-2">
          <Button onClick={() => setForm({ open: true, editing: null })}>
            <PlusIcon />
            新建环境
          </Button>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <ImportIcon />
            导入旧版数据
          </Button>
        </div>
      </div>
    );
  } else if (visible.length === 0) {
    content = (
      <p className="py-24 text-center text-sm text-muted-foreground" data-testid="no-match">
        没有匹配的环境
      </p>
    );
  } else if (viewMode === "list") {
    content = (
      <ProfileTable
        profiles={visible}
        status={status}
        pending={pending}
        showGroup={showGroup}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onBatchLaunch={batchLaunch}
        onBatchStop={batchStop}
        {...handlers}
      />
    );
  } else {
    content = <ProfileGrid profiles={visible} status={status} pending={pending} showGroup={showGroup} {...handlers} />;
  }

  return (
    <SidebarProvider>
      <AppSidebar
        groups={groups}
        total={profiles.length}
        active={activeGroup}
        runningCount={runningCount}
        onSelect={selectGroup}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <SidebarInset className="h-svh overflow-hidden">
        <TitleBarDragRegion />
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="data-vertical:h-4 data-vertical:self-auto" />
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate font-semibold" data-testid="page-title">
              {title}
            </h1>
            <span className="shrink-0 text-xs text-muted-foreground" data-testid="visible-count">
              {visible.length} 个环境
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <InputGroup className="w-56">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索名称 / 种子 / 代理"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                data-testid="search-input"
              />
            </InputGroup>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={viewMode}
              onValueChange={(value) => {
                if (value === "card" || value === "list") setViewMode(value);
              }}
            >
              <ToggleGroupItem value="card" title="卡片视图" data-testid="view-card">
                <LayoutGridIcon />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" title="列表视图" data-testid="view-list">
                <ListIcon />
              </ToggleGroupItem>
            </ToggleGroup>
            <Button onClick={() => setForm({ open: true, editing: null })} data-testid="new-profile">
              <PlusIcon />
              新建环境
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-6">{content}</div>
      </SidebarInset>

      <ProfileFormDialog
        open={form.open}
        editing={form.editing}
        profiles={profiles}
        groups={groupNames}
        chromiumInfo={chromiumInfo}
        onOpenChange={(open) => setForm((prev) => ({ ...prev, open }))}
        onSaved={(saved, created) => void onSaved(saved, created)}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        chromiumInfo={chromiumInfo}
        onOpenChange={setSettingsOpen}
        onSaved={() => void reloadSettings()}
        onImported={() => {
          void reload();
          void reloadSettings();
        }}
      />
      <DeleteProfilesDialog
        targets={deleteTargets}
        onCancel={() => setDeleteTargets([])}
        onConfirm={(ids, deleteData) => void confirmDelete(ids, deleteData)}
      />
    </SidebarProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <LauncherPage />
        <Toaster richColors position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
