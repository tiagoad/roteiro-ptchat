import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from './+types/home';

import maplibregl, { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { loader as apiLoader } from './api.data';
import classes from './home.module.css';
import { useFetcher, useLoaderData } from 'react-router';

import DOMPurify from 'dompurify';
import Spinner from '~/components/spinner';

const COLOR_SCALE = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
  '#8dd3c7',
  '#ffffb3',
  '#bebada',
  '#fb8072',
  '#80b1d3',
  '#fdb462',
  '#b3de69',
  '#fccde5',
  '#d9d9d9',
  '#bc80bd',
  '#ccebc5',
  '#ffed6f',
];

export function meta({}: Route.MetaArgs) {
  return [{ title: 'Roteiro PTChat' }];
}

export const links = (() => [
  { rel: 'icon', href: '/favicon.png' },
]) satisfies Route.LinksFunction;

type FilterState = Set<string>;

function Filters({
  filters,
  state,
  onChange,
  isLoading,
}: {
  filters: Array<{
    label: string;
    color: string;
  }>;
  state: FilterState;
  onChange: (state: FilterState) => void;
  isLoading: boolean;
}) {
  const toggleFilter = useCallback(
    (typ: string) => {
      let newState = new Set(state);

      if (state.size === filters.length) {
        newState.clear();
        newState.add(typ);
      } else if (state.has(typ)) {
        newState.delete(typ);
      } else {
        newState.add(typ);
      }

      if (newState.size === 0) {
        newState = new Set(filters.map((f) => f.label));
      }

      onChange(newState);
    },
    [filters, state]
  );

  return (
    <div className={classes.filters}>
      {isLoading ? (
        <span
          style={{ display: 'flex', alignItems: 'center', columnGap: '.5em' }}
        >
          <Spinner /> <span>Loading...</span>
        </span>
      ) : (
        <>
          <div
            className={classes.filter}
            style={{ opacity: state.size === filters.length ? 1.0 : 0.5 }}
            onClick={() => {
              onChange(
                state.size === filters.length
                  ? new Set([])
                  : new Set(filters.map((f) => f.label))
              );
            }}
          >
            <span
              className={classes.filterColor}
              style={{
                backgroundColor: 'white',
              }}
            />
            <span>Todos</span>
          </div>

          <hr />

          {filters.map(({ label, color }) => {
            const isSelected = state.has(label);

            return (
              <div
                className={classes.filter}
                style={{ opacity: isSelected ? 1.0 : 0.5 }}
                key={label}
                onClick={() => {
                  toggleFilter(label);
                }}
              >
                <span
                  className={classes.filterColor}
                  style={{
                    backgroundColor: color,
                  }}
                />
                <span>{label}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(undefined);

  const [filterState, setFilterState] = useState<FilterState>(new Set());

  const fetcher = useFetcher<Awaited<ReturnType<typeof apiLoader>>>();

  useEffect(() => {
    fetcher.load('/api/data');
  }, []);

  const data = fetcher.data;
  const isLoading = fetcher.state !== 'idle' || !data;

  const placeTypes = useMemo(() => {
    if (!data || isLoading) return undefined;

    const newTypes = Object.fromEntries(
      data.placeTypes?.map((name, i) => {
        const color = COLOR_SCALE[i];

        return [
          name,
          {
            name,
            color,
          },
        ];
      })
    );

    setFilterState(new Set(Object.keys(newTypes)));

    return newTypes;
  }, [data]);

  const { markers, bounds } = useMemo(() => {
    if (!data || !placeTypes || typeof document === 'undefined') return {};

    let min = {
      lat: Number.POSITIVE_INFINITY,
      lng: Number.POSITIVE_INFINITY,
    };
    let max = {
      lat: Number.NEGATIVE_INFINITY,
      lng: Number.NEGATIVE_INFINITY,
    };

    const markers = data.rows.map((row) => {
      const { latitude, longitude } = row.location.metadata.location!;
      min.lat = Math.min(min.lat, latitude!);
      min.lng = Math.min(min.lng, longitude!);
      max.lat = Math.max(max.lat, latitude!);
      max.lng = Math.max(max.lng, longitude!);

      const el = document.createElement('div');
      el.className = classes.marker;
      el.textContent = row.reviews.length === 1 ? '' : `${row.reviews.length}`;

      const gradientSteps = (() => {
        const BORDER_COLOR = 'white';
        const BORDER_PCT = 4;

        const count = row.types.length;
        const stepColorPct = (100 - BORDER_PCT * (count - 1)) / count;

        console.log({ count, stepColorPct });

        const steps = [];
        let curr = 0;
        for (let i = 0; i < count; i++) {
          const color = placeTypes[row.types[i]].color;

          steps.push(`${color} ${curr}%`);
          curr += stepColorPct;
          steps.push(`${color} ${curr}%`);

          if (i < count - 1) {
            steps.push(`${BORDER_COLOR} ${curr}%`);
            curr += BORDER_PCT;
            steps.push(`${BORDER_COLOR} ${curr}%`);
          }
        }

        return steps;
      })();

      const gradient = `linear-gradient(to right, ${gradientSteps.join(', ')})`;

      el.style.background = gradient;

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
        `<div class="${classes.popup}">
            <div class="name"><a target="_blank" href="${row.location.url!}">${DOMPurify.sanitize(row.location.name)}</a></div>
            <hr/>
            <div class="types">${row.types.map((typ) => `<div style="background-color: ${placeTypes[typ].color}">${typ}</div>`).join('')}</div>

            ${row.reviews
              .map(
                (r) => `
                <hr />
                <div class="review">
                <div class="user">
                    ${DOMPurify.sanitize(r.user)}
                    <span class="stars">
                        ${Array(5)
                          .fill(undefined)
                          .map(
                            (_, i) =>
                              `<span class="star ${i < r.ranking! ? 'normal' : 'dimmed'}">★</span>`
                          )
                          .join('')}
                        ${
                          !r.ranking
                            ? 'Not ranked'
                            : `${Array(5)
                                .map((_, i) => {
                                  return <span>STAR</span>;
                                })
                                .join('')}`
                        }
                    </span>
                </div>
                <div class="notes">${DOMPurify.sanitize(r.notes!)}</div>
                </div>
            `
              )
              .join('\n')}
        </div>`
      );

      const marker = new Marker({
        element: el,
      })
        .setLngLat([longitude!, latitude!])
        .setPopup(popup);

      return {
        marker,
        types: new Set(row.types),
      };
    });

    return {
      markers,
      bounds: {
        min,
        max,
      },
    };
  }, [data]);

  useEffect(() => {
    if (mapDivRef.current === null) return;

    const map = new maplibregl.Map({
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [13.388, 52.517],
      zoom: 1,
      container: mapDivRef.current,
      attributionControl: {
        compact: true,
        customAttribution: [
          '<a target="_blank" href="https://github.com/tiagoad/roteiro-ptchat">tiagoad@github/roteiro-ptchat</a>',
        ],
      },
    });

    mapRef.current = map;

    return () => {
      // cleanup
      map.remove();
    };
  }, [mapDivRef]);

  useEffect(() => {
    if (!mapRef.current || !bounds) return;

    mapRef.current.fitBounds(
      [
        [bounds.min.lng, bounds.min.lat],
        [bounds.max.lng, bounds.max.lat],
      ],

      {
        animate: false,
        duration: 200,
        maxZoom: 9,
        padding: 150,
      }
    );
  }, [bounds]);

  useEffect(() => {
    if (!markers || !mapRef.current) return;

    for (const { marker, types } of markers) {
      const isVisible = types.intersection(filterState).size > 0;

      if (isVisible && !marker._map) {
        marker.addTo(mapRef.current);
      } else if (!isVisible && marker._map) {
        marker.remove();
      }
    }
  }, [markers, filterState]);

  return (
    <div className={classes.wrapper}>
      <Filters
        filters={Object.values(placeTypes || []).map((typ) => ({
          label: typ.name,
          color: typ.color,
        }))}
        state={filterState}
        onChange={setFilterState}
        isLoading={isLoading}
      />
      <div className={classes.map} ref={mapDivRef}></div>
    </div>
  );
}
