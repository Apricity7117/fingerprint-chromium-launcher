import { CopyIcon, Loader2Icon, MoreHorizontalIcon, PencilIcon, PlayIcon, SquareIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Profile } from "@/lib/types";

/** 卡片与列表共用的环境操作回调 */
export interface ProfileHandlers {
  onLaunch: (id: string) => void;
  onStop: (id: string) => void;
  onEdit: (profile: Profile) => void;
  onDuplicate: (id: string) => void;
  onDelete: (ids: string[]) => void;
}

interface ProfileActionsProps extends ProfileHandlers {
  profile: Profile;
  running: boolean;
  pending: boolean;
  /** compact：列表视图中的紧凑样式 */
  compact?: boolean;
}

export function ProfileActions({
  profile,
  running,
  pending,
  compact = false,
  onLaunch,
  onStop,
  onEdit,
  onDuplicate,
  onDelete,
}: ProfileActionsProps) {
  return (
    <div className="flex items-center gap-1.5">
      {running ? (
        <Button
          variant="destructive"
          size={compact ? "icon-sm" : "default"}
          className={compact ? undefined : "flex-1"}
          title="停止"
          disabled={pending}
          onClick={() => onStop(profile.id)}
          data-testid={`stop-${profile.id}`}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <SquareIcon />}
          {!compact && "停止"}
        </Button>
      ) : (
        <Button
          size={compact ? "icon-sm" : "default"}
          className={compact ? undefined : "flex-1"}
          title="启动"
          disabled={pending}
          onClick={() => onLaunch(profile.id)}
          data-testid={`launch-${profile.id}`}
        >
          {pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
          {!compact && "启动"}
        </Button>
      )}
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "icon"}
        title="编辑配置"
        onClick={() => onEdit(profile)}
        data-testid={`edit-${profile.id}`}
      >
        <PencilIcon />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size={compact ? "icon-sm" : "icon"}
            title="更多操作"
            data-testid={`more-${profile.id}`}
          >
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onDuplicate(profile.id)} data-testid={`duplicate-${profile.id}`}>
            <CopyIcon />
            克隆环境
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete([profile.id])}
            data-testid={`delete-${profile.id}`}
          >
            <Trash2Icon />
            删除环境
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
