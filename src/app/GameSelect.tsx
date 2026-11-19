import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';

export interface GameSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface GameSelectProps {
  id: string;
  label: string;
  value: string;
  options: GameSelectOption[];
  onChange: (value: string) => void;
}

function nextEnabledIndex(options: GameSelectOption[], start: number, direction: 1 | -1): number {
  if (options.length === 0) return -1;
  let index = Math.min(Math.max(start, 0), options.length - 1);
  for (let attempts = 0; attempts < options.length; attempts += 1) {
    if (!options[index]?.disabled) return index;
    index = (index + direction + options.length) % options.length;
  }
  return -1;
}

export function GameSelect({ id, label, value, options, onChange }: GameSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const container = useRef<HTMLDivElement>(null);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  const move = (direction: 1 | -1) => {
    const candidate = nextEnabledIndex(options, activeIndex + direction, direction);
    if (candidate >= 0) setActiveIndex(candidate);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
  };

  return (
    <div className="game-select-field">
      <span className="control-label" id={`${id}-label`}>
        {label}
      </span>
      <div className="game-select" ref={container}>
        <button
          id={id}
          className="game-select-trigger"
          type="button"
          role="combobox"
          aria-label={`${label}: ${selected?.label ?? t('common.selectOption')}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          onClick={() => {
            setOpen((current) => !current);
            if (!open) setActiveIndex(nextEnabledIndex(options, selectedIndex, 1));
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                setActiveIndex(nextEnabledIndex(options, selectedIndex, 1));
              } else move(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) {
                setOpen(true);
                setActiveIndex(nextEnabledIndex(options, selectedIndex, -1));
              } else move(-1);
            } else if (event.key === 'Home' && open) {
              event.preventDefault();
              setActiveIndex(nextEnabledIndex(options, 0, 1));
            } else if (event.key === 'End' && open) {
              event.preventDefault();
              setActiveIndex(nextEnabledIndex(options, options.length - 1, -1));
            } else if ((event.key === 'Enter' || event.key === ' ') && open) {
              event.preventDefault();
              choose(activeIndex);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <span>{selected?.label ?? t('common.selectOption')}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="select-chevron">
            <path d="m5 7 5 5 5-5" />
          </svg>
        </button>
        {open && (
          <div
            className="game-select-menu"
            id={`${id}-listbox`}
            role="listbox"
            aria-labelledby={`${id}-label`}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-option-${index}`}
                className={
                  index === activeIndex ? 'game-select-option active' : 'game-select-option'
                }
                type="button"
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled ?? false}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
