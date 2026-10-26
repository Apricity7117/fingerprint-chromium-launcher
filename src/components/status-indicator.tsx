import { formatUptime } from "@/lib/profile-utils";
import type { InstanceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 运行状态：运行中显示绿色脉冲点与运行时长 */
export function StatusIndicator({ id, status }: { id: string; status?: InstanceStatus }) {
  const running = Boolean(status);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`status-${id}`}>
      <span className="relative flex size-2">
        {running && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", running ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      </span>
      <span data-state={running ? "running" : "stopped"}>
        {status ? `运行中 · ${formatUptime(status.uptime_seconds)}` : "已停止"}
      </span>
    </span>
  );
}
