import { useCallback, useEffect, useState } from 'react';

import classes from './filter-sidebar.module.css';
import Spinner from './spinner';

import { LibraryBig, Star, UserRoundPen } from 'lucide-react';
import { cn } from '~/lib/styles';

export type FilterState = {
  types: Set<string>;
  users: Set<string>;
  cities: Set<string>;
  ratings: Set<number>;
};

export type FilterMode = keyof FilterState;

export type FilterOptions = {
  types: Array<{
    value: string;
    color: string;
  }>;
  users: Array<{
    value: string;
  }>;
  cities: Array<{
    value: string;
  }>;
  ratings: {
    maxStars: number;
  };
};

export type FilterStateOld = Set<string>;

export type FilterChangeTarget =
  | { mode: 'types' | 'users'; key: string }
  | { mode: 'ratings'; key: number };

export function useFilters(options?: FilterOptions) {
  const [state, setState] = useState<FilterState>({
    types: new Set(),
    users: new Set(),
    cities: new Set(),
    ratings: new Set(),
  });

  const possibleRatings = !options
    ? []
    : Array(options.ratings.maxStars + 1)
        .fill(undefined)
        .map((_, idx) => idx);

  const reset = useCallback(
    (mode?: FilterMode) => {
      if (!options) {
        setState({
          types: new Set(),
          users: new Set(),
          cities: new Set(),
          ratings: new Set(),
        });
      } else {
        if (mode) {
          setState((curr) => {
            const next = {
              types: new Set(options.types.map((opt) => opt.value)),
              users: new Set(options.users.map((opt) => opt.value)),
              cities: new Set(options.cities.map((opt) => opt.value)),
              ratings: new Set(possibleRatings),
            };

            return {
              ...curr,
              [mode]: next[mode],
            };
          });
        } else {
          setState({
            types: new Set(options.types.map((opt) => opt.value)),
            users: new Set(options.users.map((opt) => opt.value)),
            cities: new Set(options.cities.map((opt) => opt.value)),
            ratings: new Set(possibleRatings),
          });
        }
      }
    },
    [options]
  );

  useEffect(() => {
    reset();
  }, [options]);

  const toggle = useCallback(
    (target: FilterChangeTarget) => {
      if (!options) return;

      const mutate = (curr: FilterState, target: FilterChangeTarget) => {
        if (!options) return;

        const isFull =
          target.mode === 'ratings'
            ? curr[target.mode].size === options.ratings.maxStars + 1
            : curr[target.mode].size === options[target.mode].length;

        let copy = new Set<typeof target.key>(curr[target.mode]);

        if (isFull) {
          // when an item is toggled with every option visible,
          // toggle all the remaining options off
          copy.clear();
        }

        if (copy.has(target.key)) {
          copy.delete(target.key);
        } else {
          copy.add(target.key);
        }

        if (copy.size === 0) {
          // when an item is untoggled with every other option
          // hidden, turn all the options on
          copy =
            target.mode === 'ratings'
              ? new Set(possibleRatings)
              : new Set(options[target.mode].map((opt) => opt.value));
        }

        const next = {
          ...curr,
          [target.mode]: copy,
        };

        return next;
      };

      setState((curr) => {
        return mutate(curr, target)!;
      });
    },
    [options]
  );

  return { state, toggle, reset };
}

export function FilterSidebar({
  options,
  state,
  toggle,
  reset,
  isLoading,
}: {
  options?: FilterOptions;
  state: FilterState;
  toggle: (target: FilterChangeTarget) => void;
  reset: (mode?: FilterMode) => void;
  isLoading: boolean;
}) {
  const [tab, setTab] = useState<FilterMode>('types');

  function activeClass(mode: string) {
    if (tab === mode) {
      return classes.active;
    }
  }

  const possibleRatings = !options
    ? []
    : Array(options.ratings.maxStars + 1)
        .fill(undefined)
        .map((_, idx) => idx);

  return (
    <div className={classes.wrapper}>
      {isLoading ? (
        <span
          style={{ display: 'flex', alignItems: 'center', columnGap: '.5em' }}
        >
          <Spinner /> <span>Loading...</span>
        </span>
      ) : (
        <>
          <div className={classes.filters}>
            {!options ? null : tab === 'types' ? (
              options.types.map(({ value, color }) => {
                const isSelected = state.types.has(value);

                return (
                  <div
                    className={cn(
                      classes.typeFilter,
                      isSelected && classes.selected
                    )}
                    key={value}
                    onClick={() => {
                      toggle({
                        mode: 'types',
                        key: value,
                      });
                    }}
                  >
                    <span
                      className={classes.filterIcon}
                      style={{
                        backgroundColor: color,
                      }}
                    />
                    <span>{value}</span>
                  </div>
                );
              })
            ) : tab === 'ratings' ? (
              possibleRatings.toReversed().map((value) => {
                const isSelected = state.ratings.has(value);

                return (
                  <div
                    className={cn(
                      classes.starFilter,
                      isSelected && classes.selected
                    )}
                    key={value}
                    onClick={() => {
                      toggle({
                        mode: 'ratings',
                        key: value,
                      });
                    }}
                  >
                    {Array(value)
                      .fill(undefined)
                      .map((_, i) => (
                        <Star key={i} className={classes.filled} />
                      ))}
                    {Array(options.ratings.maxStars - value)
                      .fill(undefined)
                      .map((_, i) => (
                        <Star key={i} />
                      ))}
                  </div>
                );
              })
            ) : (
              <div>
                {options.users.map(({ value }) => {
                  const isSelected = state.users.has(value);

                  return (
                    <div
                      className={cn(
                        classes.userFilter,
                        isSelected && classes.selected
                      )}
                      onClick={() => {
                        toggle({
                          mode: 'users',
                          key: value,
                        });
                      }}
                    >
                      <div
                        className={cn(
                          classes.filterIcon,
                          isSelected && classes.selected
                        )}
                      />
                      <span>{value}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <button className={classes.cleanButton} onClick={() => reset(tab)}>
              Todos
            </button>
            <button className={classes.cleanButton} onClick={() => reset()}>
              Estado Inicial
            </button>
          </div>
          <div className={classes.tabs}>
            <LibraryBig
              onClick={() => setTab('types')}
              className={activeClass('types')}
            />
            <Star
              onClick={() => setTab('ratings')}
              className={activeClass('ratings')}
            />
            <UserRoundPen
              onClick={() => setTab('users')}
              className={activeClass('users')}
            />
          </div>
        </>
      )}
    </div>
  );
}
