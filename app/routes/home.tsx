import { useEffect, useRef } from 'react';
import type { Route } from './+types/home';

import maplibregl, { Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { loader as apiLoader } from './api.data';
import classes from './home.module.css';
import { useLoaderData } from 'react-router';
import Color from 'colorjs.io';

import DOMPurify from 'dompurify';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'Roteiro PTChat' }];
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  return {
    table: await apiLoader({
      context,
      params,
      request,
    }),
  };
}

function Filters({
  filters,
}: {
  filters: Array<{
    label: string;
    color: string;
  }>;
}) {
  return (
    <div className={classes.filters}>
      {filters.map(({ label, color }) => (
        <div className={classes.filter}>
          <span
            className={classes.filterColor}
            style={{ backgroundColor: color }}
          />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const data = useLoaderData<typeof loader>();
  const mapDivRef = useRef<HTMLDivElement>(null);

  const placeTypes = Object.fromEntries(
    data.table.placeTypes.map((name, i) => {
      const color = new Color('OKLCH', [
        0.7,
        0.15,
        320 * (i / (data.table.placeTypes.length - 1)),
      ]).toString({ format: 'hex' });

      return [
        name,
        {
          name,
          color,
        },
      ];
    })
  );

  useEffect(() => {
    if (mapDivRef.current === null) return;

    const map = new maplibregl.Map({
      style: 'https://tiles.openfreemap.org/styles/liberty',
      //center: [13.388, 52.517],
      zoom: 1,
      container: mapDivRef.current,
    });

    let min = {
      lat: Number.POSITIVE_INFINITY,
      lng: Number.POSITIVE_INFINITY,
    };
    let max = {
      lat: Number.NEGATIVE_INFINITY,
      lng: Number.NEGATIVE_INFINITY,
    };

    for (const row of data.table.rows) {
      const { latitude, longitude } = row.location.metadata.location!;
      min.lat = Math.min(min.lat, latitude!);
      min.lng = Math.min(min.lng, longitude!);
      max.lat = Math.max(max.lat, latitude!);
      max.lng = Math.max(max.lng, longitude!);

      const el = document.createElement('div');
      el.className = classes.marker;

      const gradientColors = row.types.flatMap((typeName, i) => {
        const typ = placeTypes[typeName];
        const pctStep = 100 / row.types.length;

        const pctStart = pctStep * i;
        const pctEnd = pctStep * (i + 1);

        if (i < row.types.length - 1) {
          const borderPct = 10;
          return [
            `${typ.color} ${pctStart}%`,
            `${typ.color} ${pctEnd - borderPct}%`,
            `black ${pctEnd - borderPct}%`,
            `black ${pctEnd}%`,
          ];
        } else {
          return [`${typ.color} ${pctStart}%`, `${typ.color} ${pctEnd}%`];
        }
      });

      const gradient = `linear-gradient(45deg, ${gradientColors.join(', ')})`;

      el.style.background = gradient;

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
        `<div class="${classes.popup}">
            <div class="name"><a href="${row.location.url!}">${DOMPurify.sanitize(row.location.name)}</a></div>
            <div class="user">${DOMPurify.sanitize(row.user)}</div>
            <hr />
            <div class="notes}">${DOMPurify.sanitize(row.notes!)}</div>
        </div>`
      );

      const marker = new Marker({
        element: el,
      })
        .setLngLat([longitude!, latitude!])
        .setPopup(popup)
        .addTo(map);
    }

    map.fitBounds(
      [
        [min.lng, min.lat],
        [max.lng, max.lat],
      ],
      {
        animate: false,
        maxZoom: 6,
      }
    );

    return () => {
      // cleanup
      map.remove();
    };
  }, [mapDivRef]);

  return (
    <div className={classes.wrapper}>
      <Filters
        filters={Object.values(placeTypes).map((typ) => ({
          label: typ.name,
          color: typ.color,
        }))}
      />
      <div className={classes.map} ref={mapDivRef}></div>
    </div>
  );
}
