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

  return (
    <div className="search-anchor">
      <div className={`search-pill ${focused ? 'is-focused' : ''}`}>
        <Search size={14} className="muted-icon" />
        <input
          ref={inputRef}
          className="search-input"
          placeholder={dict.searchPlaceholder}
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 160)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('');
              inputRef.current?.blur();
            } else if (e.key === 'Enter' && results.length > 0) {
              e.preventDefault();
              onSelectResult(results[0]);
              setFocused(false);
              inputRef.current?.blur();
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            aria-label={dict.close}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setQuery('')}
          >
            <X size={13} />
          </button>
        )}
      </div>

      {focused && query.trim().length > 0 && (
        <div className="search-dropdown">
          {results.length === 0 ? (
            <div className="search-empty">{dict.searchEmpty}</div>
          ) : (
            results.map((card) => (
              <button
                key={card.id}
                type="button"
                className="search-result-row"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectResult(card);
                  setFocused(false);
                }}
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
