import React, { useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Card } from '../../domain/types';
import { getCategoryLabel, type I18nDict } from '../../i18n';

interface SearchBarProps {
  cards: Card[];
  dict: I18nDict;
  onSelectResult: (card: Card) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({ cards, dict, onSelectResult }) => {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return cards
      .filter((c) => {
        const hay = [
          c.title,
          c.text,
          c.color,
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
        if (e.key !== 'Escape' || e.nativeEvent.isComposing || !query) return;
        e.stopPropagation();
        setQuery('');
        inputRef.current?.focus();
      }}
    >
      <div className="search-pill">
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
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label={dict.clearSearch}
            onClick={() => {
              inputRef.current?.focus();
              setQuery('');
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {focused && query.trim().length > 0 && (
        <div className="search-dropdown">
          {results.length === 0 ? (
            <div className="search-empty" role="status">{dict.searchEmpty}</div>
          ) : (
            results.map((card) => (
              <button
                key={card.id}
                type="button"
                className="search-result-row"
                onClick={() => selectResult(card)}
              >
                <span className="truncate">{card.title || card.text.slice(0, 32) || card.kind}</span>
                <span className="search-result-tag">
                  {card.inbox ? dict.inInboxTag : getCategoryLabel(dict, card.category)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
