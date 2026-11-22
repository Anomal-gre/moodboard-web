import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import type { Category } from '../domain/types';

export interface AppleSelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  dotColor?: string;
}

export const CATEGORY_DOT_COLORS: Record<Category, string> = {
  reference: '#007AFF',
  furniture: '#C5A47E',
  material: '#8D9A7C',
  palette: '#FF9500',
  sketch: '#5856D6',
  typography: '#AF52DE',
  other: '#8E8E93',
};

interface AppleSelectProps<T extends string> {
  value: T;
  options: AppleSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'md' | 'sm';
  ariaLabel?: string;
  disabled?: boolean;
}

export function AppleSelect<T extends string>({
  value,
  options,
  onChange,
  className = '',
  size = 'md',
  ariaLabel,
  disabled = false,
}: AppleSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    openUp: boolean;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((o) => o.value === value) ?? options[0];

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 6;
    const estimatedHeight = Math.min(280, options.length * 42 + 12);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(290, openUp ? spaceAbove - gap : spaceBelow - gap));
    const width = Math.max(rect.width, 150);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
    const top = openUp ? Math.max(10, rect.top - gap) : rect.bottom + gap;

    setMenuPos({ top, left, width, maxHeight, openUp });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value)
    );
    setActiveIndex(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const picked = options[activeIndex];
        if (picked) {
          onChange(picked.value);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    };
    const onReposition = () => updateMenuPosition();

    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex, options, onChange]);

  const handleSelect = (opt: AppleSelectOption<T>) => {
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`apple-select-trigger ${size === 'sm' ? 'is-sm' : ''} ${open ? 'is-open' : ''} ${className}`}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="apple-select-value">
          {selectedOption?.dotColor && (
            <span
              className="apple-select-dot"
              style={{ backgroundColor: selectedOption.dotColor }}
              aria-hidden="true"
            />
          )}
          <span className="truncate">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown
          size={14}
          className={`apple-select-chevron ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className={`apple-select-menu ${menuPos.openUp ? 'is-up' : ''}`}
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {options.map((opt, idx) => {
              const selected = opt.value === value;
              const highlighted = idx === activeIndex;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`apple-select-option ${selected ? 'is-selected' : ''} ${
                    highlighted ? 'is-highlighted' : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => {
                    // Prevent outside-click blur issues before click completes
                    e.preventDefault();
                  }}
                  onClick={() => handleSelect(opt)}
                >
                  <span className="apple-select-option-main">
                    {opt.dotColor && (
                      <span
                        className="apple-select-dot"
                        style={{ backgroundColor: opt.dotColor }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="apple-select-option-copy">
                      <span className="apple-select-option-label">{opt.label}</span>
                      {opt.description && (
                        <span className="apple-select-option-desc">{opt.description}</span>
                      )}
                    </span>
                  </span>
                  {selected && (
                    <Check size={14} className="apple-select-check" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
