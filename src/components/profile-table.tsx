import {
  type CellContext,
  type ColumnDef,
  type HeaderContext,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, PlayIcon, SquareIcon, Trash2Icon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { PlatformIcon } from "@/components/platform-icon";
import { ProfileActions, type ProfileHandlers } from "@/components/profile-actions";
import { StatusIndicator } from "@/components/status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { presets } from "@/lib/presets";
import { dataDirName, groupOf, labelOf } from "@/lib/profile-utils";
import type { Profile, RunningStatusMap } from "@/lib/types";

/** 操作列固定在右侧，窄窗口横向滚动时仍可见 */
const STICKY_ACTIONS =
  "sticky right-0 bg-background shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.15)] in-data-[state=selected]:bg-muted";

/** 列宽（px）：默认窗口（1280 宽含侧栏）下含分组列的总宽 ≤ 内容区，次要列靠截断适配 */
const COLUMN_SIZES = {
  select: 40,
  name: 160,
  group: 90,
  status: 130,
  platform: 95,
  fingerprint: 85,
  hardware: 120,
  proxy: 120,
  actions: 112,
} as const;

/** 表格行：附带运行标记以支持按状态排序 */
type ProfileRow = Profile & { running: boolean };

/** 随轮询变化的数据经 table meta 传入，保持列定义稳定，避免单元格每次轮询都重新挂载 */
interface TableMeta {
  status: RunningStatusMap;
  pending: ReadonlySet<string>;
  handlers: ProfileHandlers;
}

const metaOf = (ctx: { table: { options: { meta?: unknown } } }) => ctx.table.options.meta as TableMeta;

function SortHeader({ ctx, label }: { ctx: HeaderContext<ProfileRow, unknown>; label: string }) {
  const sorted = ctx.column.getIsSorted();
  const Icon = sorted === "asc" ? ArrowUpIcon : sorted === "desc" ? ArrowDownIcon : ArrowUpDownIcon;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2"
      onClick={() => ctx.column.toggleSorting(sorted === "asc")}
      data-testid={`sort-${ctx.column.id}`}
      data-sorted={sorted || "none"}
    >
      {label}
      <Icon className={sorted ? undefined : "opacity-40"} />
    </Button>
  );
}

const hardwareText = (profile: Profile) =>
  `${profile.gpu_renderer || "自动"} · ${profile.hardware_concurrency || "自动"} 核`;

const sortable = (label: string) => (ctx: HeaderContext<ProfileRow, unknown>) => <SortHeader ctx={ctx} label={label} />;

const COLUMNS: ColumnDef<ProfileRow>[] = [
  {
    id: "select",
    size: COLUMN_SIZES.select,
    header: ({ table }) => (
      <Checkbox
        aria-label="全选"
        checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
        onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
        data-testid="select-all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="选择"
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(value === true)}
        data-testid={`select-${row.id}`}
      />
    ),
    enableSorting: false,
  },
  {
    id: "name",
    size: COLUMN_SIZES.name,
    accessorKey: "name",
    header: sortable("名称"),
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium" title={row.original.name}>
          {row.original.name}
        </div>
        <div className="font-mono text-xs text-muted-foreground">{dataDirName(row.original.id)}</div>
      </div>
    ),
  },
  {
    id: "group",
    size: COLUMN_SIZES.group,
    accessorFn: (profile) => groupOf(profile),
    header: sortable("分组"),
    cell: ({ getValue }) => <Badge variant="secondary">{getValue<string>()}</Badge>,
  },
  {
    id: "status",
    size: COLUMN_SIZES.status,
    accessorFn: (row) => (row.running ? 1 : 0),
    header: sortable("状态"),
    cell: (ctx: CellContext<ProfileRow, unknown>) => (
      <StatusIndicator id={ctx.row.original.id} status={metaOf(ctx).status[ctx.row.original.id]} />
    ),
  },
  {
    id: "platform",
    size: COLUMN_SIZES.platform,
    accessorKey: "platform",
    header: sortable("平台"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <PlatformIcon platform={row.original.platform} className="size-4" />
        {labelOf(presets.platforms, row.original.platform).split(" ")[0]}
      </span>
    ),
  },
  {
    id: "fingerprint",
    size: COLUMN_SIZES.fingerprint,
    accessorKey: "fingerprint",
    header: sortable("种子"),
    cell: ({ row }) => <span className="font-mono">{row.original.fingerprint}</span>,
  },
  {
    id: "hardware",
    size: COLUMN_SIZES.hardware,
    header: "硬件",
    cell: ({ row }) => (
      <span className="block truncate" title={hardwareText(row.original)}>
        {row.original.gpu_renderer || "自动"}
        <span className="text-muted-foreground"> · {row.original.hardware_concurrency || "自动"} 核</span>
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "proxy",
    size: COLUMN_SIZES.proxy,
    header: "代理",
    cell: ({ row }) =>
      row.original.proxy_server ? (
        <span
          className="block truncate font-mono text-xs text-amber-600 dark:text-amber-400"
          title={row.original.proxy_server}
        >
          {row.original.proxy_server}
        </span>
      ) : (
        <span className="text-muted-foreground">直连</span>
      ),
    enableSorting: false,
  },
  {
    id: "actions",
    size: COLUMN_SIZES.actions,
    header: () => <span className="sr-only">操作</span>,
    cell: (ctx: CellContext<ProfileRow, unknown>) => {
      const { status, pending, handlers } = metaOf(ctx);
      const profile = ctx.row.original;
      return (
        <ProfileActions
          compact
          profile={profile}
          running={Boolean(status[profile.id])}
          pending={pending.has(profile.id)}
          {...handlers}
        />
      );
    },
    enableSorting: false,
  },
];

const COLUMNS_WITHOUT_GROUP = COLUMNS.filter((column) => column.id !== "group");

interface ProfileTableProps extends ProfileHandlers {
  profiles: Profile[];
  status: RunningStatusMap;
  pending: ReadonlySet<string>;
  showGroup: boolean;
  rowSelection: RowSelectionState;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  onBatchLaunch: (ids: string[]) => void;
  onBatchStop: (ids: string[]) => void;
}

/** 列表视图：可排序、可多选并批量启动 / 停止 / 删除 */
export function ProfileTable({
  profiles,
  status,
  pending,
  showGroup,
  rowSelection,
  onRowSelectionChange,
  onBatchLaunch,
  onBatchStop,
  ...handlers
}: ProfileTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const { onLaunch, onStop, onEdit, onDuplicate, onDelete } = handlers;
  const meta = useMemo<TableMeta>(
    () => ({ status, pending, handlers: { onLaunch, onStop, onEdit, onDuplicate, onDelete } }),
    [status, pending, onLaunch, onStop, onEdit, onDuplicate, onDelete],
  );
  const data = useMemo<ProfileRow[]>(
    () => profiles.map((profile) => ({ ...profile, running: Boolean(status[profile.id]) })),
    [profiles, status],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table 返回的函数不可被 React Compiler 记忆化
  const table = useReactTable({
    data,
    columns: showGroup ? COLUMNS : COLUMNS_WITHOUT_GROUP,
    meta,
    state: { sorting, rowSelection },
    getRowId: (profile) => profile.id,
    onSortingChange: setSorting,
    onRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.original.id);
  const selectedRunning = selectedIds.filter((id) => status[id]);
  const selectedStopped = selectedIds.filter((id) => !status[id]);

  return (
    <div className="space-y-3">
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm" data-testid="batch-bar">
          <span className="mr-auto">已选择 {selectedIds.length} 个环境</span>
          <Button
            size="sm"
            disabled={selectedStopped.length === 0}
            onClick={() => onBatchLaunch(selectedStopped)}
            data-testid="batch-launch"
          >
            <PlayIcon />
            启动所选
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedRunning.length === 0}
            onClick={() => onBatchStop(selectedRunning)}
            data-testid="batch-stop"
          >
            <SquareIcon />
            停止所选
          </Button>
          <Button size="sm" variant="destructive" onClick={() => onDelete(selectedIds)} data-testid="batch-delete">
            <Trash2Icon />
            删除所选
          </Button>
          <Button size="icon-sm" variant="ghost" title="清除选择" onClick={() => onRowSelectionChange({})}>
            <XIcon />
          </Button>
        </div>
      )}
      <div className="rounded-lg border">
        <Table className="table-fixed" data-testid="profile-table">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className={header.column.id === "actions" ? STICKY_ACTIONS : undefined}
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                data-testid={`profile-row-${row.id}`}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className={cell.column.id === "actions" ? STICKY_ACTIONS : undefined}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
