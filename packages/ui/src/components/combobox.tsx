import { Command as CommandPrimitive } from 'cmdk';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../cn';
import { buttonVariants } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popovers';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  /** Accessible name of the list (and of the trigger when no visible label points at it). */
  label: string;
  options: ComboboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Several values may be selected; the list stays open while choosing. */
  multiple?: boolean;
  /** Offers "Create …" for text that matches no option. */
  onCreate?: (text: string) => void | Promise<void>;
  createLabel?: (text: string) => string;
  /** Controlled search text; when set, options are not filtered locally (server search). */
  search?: string;
  onSearchChange?: (text: string) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Custom trigger content (e.g. chips); defaults to the selected labels. */
  renderValue?: (selected: ComboboxOption[]) => ReactNode;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** A searchable select (cmdk in a popover), single or multiple, optionally creating values. */
export function Combobox({
  label,
  options,
  value,
  onChange,
  multiple = false,
  onCreate,
  createLabel = (text) => `Create "${text}"`,
  search,
  onSearchChange,
  placeholder = '',
  searchPlaceholder,
  emptyText = 'No results',
  renderValue,
  id,
  disabled,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  const text = search ?? localSearch;
  const setText = (next: string) => {
    if (search === undefined) setLocalSearch(next);
    onSearchChange?.(next);
  };
  const selected = value.flatMap((v) => options.filter((option) => option.value === v));
  const trimmed = text.trim();
  const needle = trimmed.toLowerCase();
  const exists = options.some((option) => option.label.toLowerCase() === needle);
  // Filtered here (not by cmdk) so the "Create" row always comes after the matches.
  const visible =
    search === undefined && needle
      ? options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) ||
            option.value.toLowerCase().includes(needle),
        )
      : options;

  const choose = (optionValue: string) => {
    if (multiple) {
      onChange(
        value.includes(optionValue)
          ? value.filter((v) => v !== optionValue)
          : [...value, optionValue],
      );
      setText('');
    } else {
      onChange(value[0] === optionValue ? [] : [optionValue]);
      setOpen(false);
    }
  };

  const create = async () => {
    if (!onCreate || !trimmed) return;
    await onCreate(trimmed);
    setText('');
    if (!multiple) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText('');
      }}
    >
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={id ? undefined : label}
        className={cn(
          buttonVariants({ variant: 'outline' }),
          'h-auto min-h-9 w-full justify-between px-3 py-1.5 font-normal',
          className,
        )}
        {...aria}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-left">
          {selected.length === 0 ? (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          ) : renderValue ? (
            renderValue(selected)
          ) : (
            <span className="truncate">{selected.map((option) => option.label).join(', ')}</span>
          )}
        </span>
        <ChevronsUpDown className="text-muted-foreground" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <CommandPrimitive label={label} shouldFilter={false}>
          <CommandPrimitive.Input
            value={text}
            onValueChange={setText}
            placeholder={searchPlaceholder}
            className="h-10 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <CommandPrimitive.List className="max-h-64 overflow-y-auto p-1">
            <CommandPrimitive.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </CommandPrimitive.Empty>
            {visible.map((option) => {
              const isSelected = value.includes(option.value);
              return (
                <CommandPrimitive.Item
                  key={option.value}
                  value={`${option.label} ${option.value}`}
                  onSelect={() => choose(option.value)}
                  aria-selected={isSelected}
                  className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-muted"
                >
                  <Check
                    className={cn('size-4', isSelected ? 'opacity-100' : 'opacity-0')}
                    aria-hidden
                  />
                  <span className="truncate">{option.label}</span>
                </CommandPrimitive.Item>
              );
            })}
            {onCreate && trimmed && !exists ? (
              <CommandPrimitive.Item
                value={`__create__ ${trimmed}`}
                onSelect={() => void create()}
                className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-muted"
              >
                <Plus className="size-4" aria-hidden />
                {createLabel(trimmed)}
              </CommandPrimitive.Item>
            ) : null}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </PopoverContent>
    </Popover>
  );
}
