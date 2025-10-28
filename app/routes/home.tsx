import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from './+types/home';

import maplibregl, { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { loader as apiLoader } from './api.data';
import classes from './home.module.css';
import { useFetcher } from 'react-router';

import DOMPurify from 'dompurify';
import {
  FilterSidebar,
  useFilters,
  type FilterOptions,
} from '~/components/filter-sidebar';
import { average } from '~/lib/math';

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

const N_STARS = 5;

export default function Home({ loaderData }: Route.ComponentProps) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(undefined);

  const fetcher = useFetcher<Awaited<ReturnType<typeof apiLoader>>>();

  useEffect(() => {
    fetcher.load('/api/data');
  }, []);

  const data = fetcher.data;
  const isLoading = fetcher.state !== 'idle' || !data;

  const { filterOptions, typeColors } = useMemo(() => {
    if (data) {
      const filterOptions = {
        types: data.order.types
          .map((name, i) => ({
            value: name,
            color: COLOR_SCALE[i % COLOR_SCALE.length],
          }))
          .filter(({ value }) => {
            // this filtering is done later, to keep the colors fixed to the in-sheet order
            return data.uniques.types.indexOf(value) !== -1;
          }),
        users: data.uniques.users.map((value) => ({ value })),
        cities: data.uniques.cities.map((value) => ({ value })),
        ratings: {
          maxStars: N_STARS,
        },
      } satisfies FilterOptions;

      const typeColors = Object.fromEntries(
        filterOptions.types.map((t) => [t.value, t.color])
      );

      return {
        filterOptions,
        typeColors,
      };
    } else {
      return {};
    }
  }, [data]);

  const {
    state: filterState,
    toggle: filterToggle,
    reset: filterReset,
  } = useFilters(filterOptions);

  const { markers, bounds } = useMemo(() => {
    if (
      !data ||
      !filterOptions ||
      !typeColors ||
      typeof document === 'undefined'
    )
      return {};

    let min = {
      lat: Number.POSITIVE_INFINITY,
      lng: Number.POSITIVE_INFINITY,
    };
    let max = {
      lat: Number.NEGATIVE_INFINITY,
      lng: Number.NEGATIVE_INFINITY,
    };

    const markers = data.places.map((place) => {
      const { latitude, longitude } = place.location.metadata.location!;
      min.lat = Math.min(min.lat, latitude!);
      min.lng = Math.min(min.lng, longitude!);
      max.lat = Math.max(max.lat, latitude!);
      max.lng = Math.max(max.lng, longitude!);

      const el = document.createElement('div');
      el.className = classes.marker;
      /*el.textContent =
        place.reviews.length === 1 ? '' : `${place.reviews.length}`;
      el.title = place.location.name;*/

      const avgStars = average(place.reviews.map((r) => r.ranking));
      el.textContent = avgStars.toFixed(0);

      const opacity = avgStars >= 4 ? 1.0 : avgStars >= 3 ? 0.85 : 0.5;

      el.style.filter = `opacity(${opacity * 100}%)`;

      const gradientSteps = (() => {
        const BORDER_COLOR = 'white';
        const BORDER_PCT = 4;

        const count = place.types.length;
        const stepColorPct = (100 - BORDER_PCT * (count - 1)) / count;

        const steps = [];
        let curr = 0;
        for (let i = 0; i < count; i++) {
          const placeType = place.types[i];
          const color = typeColors[placeType];

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
            <div class="name"><a target="_blank" href="${place.location.url!}">${DOMPurify.sanitize(place.location.name)}</a></div>
            <hr/>
            <div class="types">${place.types.map((typ) => `<div style="background-color: ${typeColors[typ]}">${typ}</div>`).join('')}</div>

            ${place.reviews
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
                <div class="notes">${DOMPurify.sanitize(r.notes!)
                  .split('\n')
                  .map((line) => `<p>${line}</p>`)
                  .join('')}</div>
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
        avgStars,
        sets: {
          types: new Set(place.types),
          users: new Set(place.reviews.map((r) => r.user)),
          rankings: new Set(place.reviews.map((r) => r.ranking)),
        },
      };
    });

    markers.sort((a, b) => a.avgStars - b.avgStars);

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
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          '<a target="_blank" href="https://github.com/tiagoad/roteiro-ptchat">tiagoad@github/roteiro-ptchat</a>',
        ],
      }),
      'top-right'
    );

    mapRef.current = map;

    return () => {
      // cleanup
      markers?.forEach(({ marker }) => marker.remove());
      map.remove();
    };
  }, []);

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
    if (!markers || !filterState || !mapRef.current) return;

    markers.forEach(({ marker }) => marker.remove());
    for (const { marker, sets } of markers) {
      const isVisible =
        sets.rankings.intersection(filterState.ratings).size > 0 &&
        sets.users.intersection(filterState.users).size > 0 &&
        sets.types.intersection(filterState.types).size > 0;

      if (isVisible) {
        marker.addTo(mapRef.current);
      }
    }
  }, [markers, filterState]);

  return (
    <div className={classes.wrapper}>
      <FilterSidebar
        options={filterOptions}
        state={filterState}
        toggle={filterToggle}
        isLoading={isLoading}
        reset={filterReset}
      />
      <div className={classes.map} ref={mapDivRef}></div>
    </div>
  );
}
