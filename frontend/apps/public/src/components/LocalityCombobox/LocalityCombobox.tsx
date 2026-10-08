import { useEffect, useMemo, useRef, useState } from 'react';
import type { LocalityChoice } from '@/utils/localitySearch';
import { rankLocalityMatches } from '@/utils/localitySearch';
import styles from './LocalityCombobox.module.css';

const VISIBLE_OPTION_LIMIT = 8;

interface LocalityComboboxProps {
  id: string;
  value: string;
  choices: readonly LocalityChoice[];
  resetKey: string | null;
  placeholder: string;
  noMatchesText: string;
  listboxLabel: string;
  selectionHint: string;
  describedBy?: string;
  invalid?: boolean;
  onEdit: () => void;
  onSelect: (canonicalValue: string) => void;
}

export function LocalityCombobox({
  id,
  value,
  choices,
  resetKey,
  placeholder,
  noMatchesText,
  listboxLabel,
  selectionHint,
  describedBy,
  invalid = false,
  onEdit,
  onSelect,
}: LocalityComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const suppressEmptySync = useRef(false);
  const previousValue = useRef(value);
  const valueRef = useRef(value);
  valueRef.current = value;

  // This picker only filters the bundled canonical locality choices; address suggestions use a separate explicit action.
  const options = useMemo(
    () => rankLocalityMatches(query, choices, VISIBLE_OPTION_LIMIT),
    [choices, query]
  );
  const listboxId = `${id}-listbox`;

  useEffect(() => {
    if (activeIndex < 0) return;
    const activeOption = listboxRef.current?.children.item(activeIndex) as HTMLElement | null;
    activeOption?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    if (value === previousValue.current) return;
    previousValue.current = value;
    if (!value && suppressEmptySync.current) {
      suppressEmptySync.current = false;
      return;
    }
    const selected = choices.find((choice) => choice.value === value);
    setQuery(selected?.label ?? '');
    setOpen(false);
    setActiveIndex(-1);
  }, [choices, value]);

  useEffect(() => {
    setQuery(choices.find((choice) => choice.value === valueRef.current)?.label ?? '');
    setOpen(false);
    setActiveIndex(-1);
    suppressEmptySync.current = false;
  }, [resetKey, choices]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    inputRef.current?.focus();
    suppressEmptySync.current = false;
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(-1);
    onSelect(option.value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLUListElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => options.length === 0 ? -1 : (index + 1 + options.length) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => options.length === 0 ? -1 : (index <= 0 ? options.length - 1 : index - 1));
    } else if (event.key === 'Enter' && open) {
      const normalizedQuery = query.trim().toLocaleLowerCase('sk');
      const exactIndex = options.findIndex((option) => option.label.toLocaleLowerCase('sk') === normalizedQuery);
      const selectionIndex = activeIndex >= 0 ? activeIndex : exactIndex >= 0 ? exactIndex : options.length === 1 ? 0 : -1;
      if (selectionIndex >= 0) {
        event.preventDefault();
        choose(selectionIndex);
      }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const closeWhenFocusLeaves = (relatedTarget: EventTarget | null) => {
    const wrapper = inputRef.current?.parentElement;
    if (relatedTarget && wrapper?.contains(relatedTarget as Node)) return;
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div className={styles.wrapper}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-required="true"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open && options.length > 0}
        aria-controls={open && options.length > 0 ? listboxId : undefined}
        aria-activedescendant={open && options.length > 0 && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-invalid={invalid}
        aria-describedby={[describedBy, `${id}-selection-hint`].filter(Boolean).join(' ') || undefined}
        autoComplete="off"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={(event) => closeWhenFocusLeaves(event.relatedTarget)}
        onChange={(event) => {
          suppressEmptySync.current = true;
          setQuery(event.currentTarget.value);
          setOpen(true);
          setActiveIndex(-1);
          onEdit();
        }}
        onKeyDown={onKeyDown}
      />
      <p className={styles.srOnly} id={`${id}-selection-hint`}>{selectionHint}</p>
      {open && (
        <div className={styles.popup}>
          {options.length > 0 ? (
            <ul
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label={listboxLabel}
              aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
              tabIndex={0}
              className={styles.listbox}
              onKeyDown={onKeyDown}
              onBlur={(event) => closeWhenFocusLeaves(event.relatedTarget)}
            >
              {options.map((option, index) => (
                <li
                  id={`${listboxId}-option-${index}`}
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={index === activeIndex ? styles.activeOption : styles.option}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  {option.label}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noMatches} role="status">{noMatchesText}</p>
          )}
        </div>
      )}
    </div>
  );
}
