import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { PlatformIcon } from "@/components/platform-icon";
import { ProfileActions, type ProfileHandlers } from "@/components/profile-actions";
import { StatusIndicator } from "@/components/status-indicator";
import { dataDirName, groupOf } from "@/lib/profile-utils";
import type { Profile, RunningStatusMap } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ProfileGridProps extends ProfileHandlers {
  profiles: Profile[];
  status: RunningStatusMap;
  pending: ReadonlySet<string>;
  showGroup: boolean;
}

function InfoRow({ label, value, mono = false, highlight = false }: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 last:border-none">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate text-right",
          mono && "font-mono text-xs",
          highlight && "text-amber-600 dark:text-amber-400",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/** 卡片视图：保留旧版卡片展示的信息与操作 */
export function ProfileGrid({ profiles, status, pending, showGroup, ...handlers }: ProfileGridProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-4" data-testid="profile-grid">
      {profiles.map((profile) => (
        <Card key={profile.id} className="gap-3 py-4" data-testid={`profile-card-${profile.id}`}>
          <CardHeader className="flex items-start gap-3 px-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/80">
              <PlatformIcon platform={profile.platform} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold" title={profile.name}>
                  {profile.name}
                </h3>
                {showGroup && (
                  <Badge variant="secondary" className="shrink-0">
                    {groupOf(profile)}
                  </Badge>
                )}
              </div>
              <StatusIndicator id={profile.id} status={status[profile.id]} />
            </div>
          </CardHeader>
          <CardContent className="px-4 text-sm">
            <InfoRow label="数据目录" value={dataDirName(profile.id)} mono />
            <InfoRow label="指纹种子" value={String(profile.fingerprint)} mono />
            <InfoRow label="GPU 芯片" value={profile.gpu_renderer || "自动"} />
            <InfoRow label="处理器核心" value={profile.hardware_concurrency ? String(profile.hardware_concurrency) : "自动"} />
            <InfoRow
              label="代理连接"
              value={profile.proxy_server || "直连"}
              mono={Boolean(profile.proxy_server)}
              highlight={Boolean(profile.proxy_server)}
            />
          </CardContent>
          <CardFooter className="px-4">
            <div className="w-full">
              <ProfileActions
                profile={profile}
                running={Boolean(status[profile.id])}
                pending={pending.has(profile.id)}
                {...handlers}
              />
            </div>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
