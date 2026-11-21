import React, { useMemo, useRef, useState } from 'react';
import { CopyCheck, Search, X } from 'lucide-react';
import { CATEGORY_ORDER, type Card, type Category } from '../../domain/types';
import { hexColorDistance } from '../../domain/paletteExtract';
import { getCategoryLabel, type I18nDict } from '../../i18n';

export interface BoardFilterState {
  category: Category | null;
  colorHex: string | null;
  duplicatesOnly: boolean;
}

interface SearchBarProps {
  cards: Card[];
  dict: I18nDict;
  filter: BoardFilterState;
  duplicateIds: Set<string>;
  onChangeFilter: (next: BoardFilterState) => void;
  onSelectResult: (card: Card) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  cards,
  dict,
  filter,
  duplicateIds,
  onChangeFilter,
  onSelectResult,
}) => {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const boardCards = useMemo(() => cards.filter((c) => !c.inbox && c.kind !== 'frame'), [cards]);

  const activeCategories = useMemo(() => {
    const present = new Set(boardCards.map((c) => c.category));
    return CATEGORY_ORDER.filter((cat) => present.has(cat));
  }, [boardCards]);

  const distinctColors = useMemo(() => {
    const raw: string[] = [];
    for (const c of boardCards) {
      const hex = c.kind === 'color' ? c.color : c.dominantHex || c.color;
      if (!hex) continue;
      const upper = hex.toUpperCase();
      if (upper === '#FAF7EE' || upper === '#FFFFFF') continue;
      if (raw.every((existing) => hexColorDistance(existing, upper) > 36)) {
        raw.push(upper);
        if (raw.length >= 8) break;
      }
    }
    return raw;
  }, [boardCards]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cards
      .filter((c) => {
        const hay = [
          c.title,
          c.text,
          c.color,
          c.dominantHex,
          c.spec?.code,
          c.spec?.price,
          getCategoryLabel(dict, c.category),
          c.category,
          c.source?.pageUrl,
          c.source?.imageUrl,
          c.source?.fileName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
  }, [cards, dict, query]);

  const hasActiveFilter = Boolean(filter.category || filter.colorHex || filter.duplicatesOnly);

  const selectResult = (card: Card) => {
    onSelectResult(card);
    inputRef.current?.focus();
    setFocused(false);
  };

  return (
    <div
      className="search-anchor"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
        if (query || hasActiveFilter) {
          e.stopPropagation();
          setQuery('');
          onChangeFilter({ category: null, colorHex: null, duplicatesOnly: false });
          inputRef.current?.focus();
        }
      }}
    >
      <div className={`search-pill ${hasActiveFilter ? 'has-active-filter' : ''}`}>
        <Search size={16} className="muted-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="search-input"
          aria-label={dict.searchPlaceholder}
          placeholder={dict.searchPlaceholder}
          value={query}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocused(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && results.length > 0) {
              e.preventDefault();
              selectResult(results[0]);
            }
          }}
        />
        {filter.colorHex && (
          <span
            className="search-filter-dot"
            style={{ backgroundColor: filter.colorHex }}
            title={filter.colorHex}
          />
        )}
        {(query || hasActiveFilter) && (
          <button
            type="button"
            className="search-clear"
            aria-label={dict.clearSearch}
            title={dict.filterClear}
            onClick={() => {
              inputRef.current?.focus();
              setQuery('');
              onChangeFilter({ category: null, colorHex: null, duplicatesOnly: false });
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {focused && (
        <div className="search-dropdown">
          {/* Eagle-style Instant Category & Color Tone Filter Bar */}
          {(activeCategories.length > 1 || distinctColors.length > 0 || duplicateIds.size > 0) && (
            <div className="search-filter-box">
              <div className="search-filter-chips">
                {activeCategories.map((cat) => {
                  const active = filter.category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      className={`filter-chip ${active ? 'is-active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        onChangeFilter({
                          ...filter,
                          category: active ? null : cat,
                        })
                      }
                    >
                      {getCategoryLabel(dict, cat)}
                    </button>
                  );
                })}
                {duplicateIds.size > 0 && (
                  <button
                    type="button"
                    className={`filter-chip ${filter.duplicatesOnly ? 'is-active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      onChangeFilter({
                        ...filter,
                        duplicatesOnly: !filter.duplicatesOnly,
                      })
                    }
                  >
                    <CopyCheck size={11} />
                    <span>{dict.filterDuplicateChip} ({duplicateIds.size})</span>
                  </button>
                )}
              </div>

              {distinctColors.length > 0 && (
                <div className="search-color-row">
                  {distinctColors.map((hex) => {
                    const active = filter.colorHex === hex;
                    return (
                      <button
                        key={hex}
                        type="button"
                        title={hex}
                        className={`filter-color-dot ${active ? 'is-active' : ''}`}
                        style={{ backgroundColor: hex }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                          onChangeFilter({
                            ...filter,
                            colorHex: active ? null : hex,
                          })
                        }
                      />
                    );
                  })}
                  {hasActiveFilter && (
                    <button
                      type="button"
                      className="btn-link-xs"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        onChangeFilter({ category: null, colorHex: null, duplicatesOnly: false })
                      }
                    >
                      {dict.filterClear}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {query.trim().length > 0 && (
            <>
              {results.length === 0 ? (
                <div className="search-empty" role="status">
                  {dict.searchEmpty}
                </div>
              ) : (
                results.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="search-result-row"
                    onClick={() => selectResult(card)}
                  >
                    <span className="truncate">
                      {card.title || card.text.slice(0, 32) || card.kind}
                    </span>
                    <span className="search-result-tag">
                      {card.inbox ? dict.inInboxTag : getCategoryLabel(dict, card.category)}
                    </span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
