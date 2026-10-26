import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UNGROUPED } from "@/lib/profile-utils";

interface GroupComboboxProps {
  value: string;
  groups: string[];
  onChange: (group: string) => void;
}

/** 分组选择：可选已有分组，也可直接输入新分组名 */
export function GroupCombobox({ value, groups, onChange }: GroupComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const keyword = search.trim();
  const canCreate = keyword !== "" && keyword !== UNGROUPED && !groups.includes(keyword);

  const select = (group: string) => {
    onChange(group);
    setSearch("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" data-testid="form-group">
          {value ? <span className="truncate">{value}</span> : <span className="text-muted-foreground">{UNGROUPED}</span>}
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput
            placeholder="搜索或输入新分组…"
            value={search}
            onValueChange={setSearch}
            data-testid="form-group-input"
          />
          <CommandList>
            <CommandEmpty>无匹配分组</CommandEmpty>
            <CommandGroup>
              {canCreate && (
                <CommandItem value={`新建 ${keyword}`} onSelect={() => select(keyword)} data-testid="form-group-create">
                  <PlusIcon />
                  新建分组「{keyword}」
                </CommandItem>
              )}
              <CommandItem value={UNGROUPED} onSelect={() => select("")}>
                {UNGROUPED}
                {!value && <CheckIcon className="ml-auto" />}
              </CommandItem>
              {groups.map((group) => (
                <CommandItem key={group} value={group} onSelect={() => select(group)}>
                  <span className="truncate">{group}</span>
                  {value === group && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
