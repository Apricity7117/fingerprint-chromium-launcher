import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { Profile } from "@/lib/types";

interface DeleteProfilesDialogProps {
  /** 待删除的环境；为空时对话框关闭 */
  targets: Profile[];
  onCancel: () => void;
  onConfirm: (ids: string[], deleteData: boolean) => void;
}

/** 删除确认（单个与批量共用），可选同时删除本地数据目录 */
export function DeleteProfilesDialog({ targets, onCancel, onConfirm }: DeleteProfilesDialogProps) {
  const [deleteData, setDeleteData] = useState(false);
  const title = targets.length === 1 ? `删除环境「${targets[0].name}」` : `删除 ${targets.length} 个环境`;

  return (
    <AlertDialog
      open={targets.length > 0}
      onOpenChange={(open) => {
        if (!open) {
          setDeleteData(false);
          onCancel();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            将从列表中永久移除配置，运行中的浏览器会先被停止。该操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <Checkbox
            id="delete-data"
            checked={deleteData}
            onCheckedChange={(value) => setDeleteData(value === true)}
            data-testid="delete-data-checkbox"
          />
          <Label htmlFor="delete-data" className="flex-col items-start gap-1 font-normal">
            <span className="font-medium text-destructive">同时删除本地用户数据目录</span>
            <span className="text-xs text-muted-foreground">将擦除缓存、Cookie、历史记录等全部浏览器数据。</span>
          </Label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm(
                targets.map((profile) => profile.id),
                deleteData,
              );
              setDeleteData(false);
            }}
            data-testid="confirm-delete"
          >
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
