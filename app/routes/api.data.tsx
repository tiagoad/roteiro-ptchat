import { useEffect, useRef } from 'react';
import type { Route } from './+types/api.data';
import type { sheets_v4, places_v1 } from 'googleapis';
import { indexToSheetsColumn } from '~/lib/encode';

const CACHE_OUTPUT_SECONDS = 60;
const CACHE_SHEETS_SECONDS = 60; // 1 minute
const CACHE_PLACES_LOOKUP_SECONDS = 60 * 60; // 1 day

const PLACE_REGEXP = new RegExp(
  /https:\/\/www.google.com\/maps\/place\/.+\/data=!.+!.+![0-9]+s([0-9A-Za-z-_]+)/
);

type Place =
  | {
      status: 'ok';
      types: string[];
      location: {
        city: string;
        name: string;
        metadata: {
          location: {
            latitude: number;
            longitude: number;
          };
          displayName: {
            text: string;
            languageCode: string;
          };
        };
        url: string;
        placeId: string;
      };
      reviews: Array<{
        user: string;
        ranking: number;
        notes: string;
      }>;
    }
  | {
      status: 'error';
      error: string;
      meta: any;
    };

async function uncachedLoader({ context }: Route.LoaderArgs) {
  const sheetId = '1jGBpghcuheyLSHMmsIEGt106p-SerbnBbOkZlOpW3lI';
  const apiURL = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
  );

  const tableRange = await (async () => {
    const apiURL = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
    );
    apiURL.searchParams.set('key', context.cloudflare.env.GOOGLE_API_KEY);
    const res = await fetch(apiURL, {
      cf: {
        cacheTtl: CACHE_SHEETS_SECONDS,
        cacheEverything: true,
      },
    });
    if (!res.ok) {
      throw new Response(`Failed to read sheet metadata: ${await res.text()}`, {
        status: 400,
      });
    }
    const data = await res.json<sheets_v4.Schema$Spreadsheet>();
    const table = data.sheets?.[0]?.tables?.[0];
    const range = table?.range;
    if (!range) {
      throw new Response('Failed to read table range', { status: 400 });
    }

    return `${indexToSheetsColumn(range.startColumnIndex!)}${range?.startRowIndex}:${indexToSheetsColumn(range.endColumnIndex!)}${range?.endRowIndex}`;
  })();

  apiURL.searchParams.set('key', context.cloudflare.env.GOOGLE_API_KEY);
  apiURL.searchParams.set('ranges', tableRange);
  apiURL.searchParams.set('includeGridData', 'true');
  apiURL.searchParams.set('fields', '*');
  apiURL.searchParams.set('excludeTablesInBandedRanges', 'false');

  const res = await fetch(apiURL, {
    cf: {
      cacheTtl: CACHE_SHEETS_SECONDS,
      cacheEverything: true,
    },
  });

  if (!res.ok) {
    throw new Response(
      `error retrieving google sheets data:\n${await res.text()}`,
      {
        status: 500,
      }
    );
  }

  const data = await res.json<sheets_v4.Schema$Spreadsheet>();
  const sheet = data.sheets![0];
  const table = sheet?.tables?.[0];
  const columnProperties = table?.columnProperties;
  const rowData = sheet?.data?.[0]?.rowData;

  const typeColumn = table?.columnProperties?.find(
    (c) => c.columnName === 'Tipo'
  );
  const typeConditions = typeColumn?.dataValidationRule?.condition;
  const placeTypes = typeConditions!.values?.map((v) => v.userEnteredValue!);

  if (!table || !rowData || !columnProperties || !placeTypes) {
    throw new Response(`expected data not found`, {
      status: 500,
    });
  }

  type ColumnName =
    | 'Tipo'
    | 'Cidade'
    | 'Google Maps'
    | 'User'
    | 'Rank'
    | 'Notas';

  const header = table.columnProperties!;

  const rows = await Promise.all(
    rowData.slice(2).map<Promise<Place>>(async (row, i) => {
      const data = Object.fromEntries(
        row.values!.map((v, colIdx) => {
          const props = header![colIdx]!;
          return [
            props.columnName!,
            {
              data: v,
              props,
            },
          ];
        })
      ) as {
        [k in ColumnName]: {
          data: sheets_v4.Schema$CellData;
          props: sheets_v4.Schema$TableColumnProperties;
        };
      };

      const mapsUrl =
        data['Google Maps'].data.chipRuns?.[0]?.chip?.richLinkProperties?.uri!;

      if (!mapsUrl) {
        console.warn(`No maps URL in row ${i}`);
        return {
          status: 'error' as const,
          error: `No maps URL in row ${i}`,
          meta: {
            rowData: data,
          },
        } satisfies Place;
      }

      const placeMatch = PLACE_REGEXP.exec(mapsUrl);
      if (!placeMatch) {
        console.warn(`No maps place ID in url ${mapsUrl}`);
        return {
          status: 'error' as const,
          error: `No maps place ID in url ${mapsUrl}`,
          meta: {
            rowData: data,
          },
        } satisfies Place;
      }

      const placeId = PLACE_REGEXP.exec(mapsUrl)![1];
      const placesURL = new URL(
        `https://places.googleapis.com/v1/places/${placeId}`
      );
      placesURL.searchParams.set('key', context.cloudflare.env.GOOGLE_API_KEY);
      placesURL.searchParams.set('fields', 'location,displayName');
      const placeRes = await fetch(placesURL, {
        cf: {
          cacheTtl: CACHE_PLACES_LOOKUP_SECONDS,
          cacheEverything: true,
        },
      });

      if (!placeRes.ok) {
        console.warn(
          `Failed to get place information for ${mapsUrl} (placeId=${placeId})`
        );

        return {
          status: 'error' as const,
          error: `No place information for ${mapsUrl}`,
          meta: {
            placeId: placeId,
            rowData: data,
          },
        } satisfies Place;
        //throw new Response('Failed to read place metadata', { status: 400 });
      }

      const placeMetadata = await placeRes.json<{
        location: {
          latitude: number;
          longitude: number;
        };
        displayName: {
          text: string;
          languageCode: string;
        };
      }>();

      return {
        status: 'ok' as const,
        types: data.Tipo.data.formattedValue?.split(', ') || [],
        location: {
          city: data.Cidade.data.formattedValue!,
          name: data['Google Maps'].data.formattedValue!,
          metadata: placeMetadata,
          url: mapsUrl,
          placeId: placeId,
        },
        reviews: [
          {
            user: data.User.data.formattedValue!,
            ranking: data.Rank.data.effectiveValue!.numberValue || 0,
            notes: data.Notas.data.formattedValue || '',
          },
        ],
      } satisfies Place;
    })
  );

  const rowIndex = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (row.status === 'error') {
      continue;
    }

    const existing = rowIndex.get(row.location!.placeId);
    if (existing !== undefined && existing.status !== 'error') {
      existing.reviews.push(row.reviews[0]);
      for (const typ of row.types) {
        if (existing.types.indexOf(typ) === -1) {
          existing.types.push(typ);
        }
      }
    } else {
      rowIndex.set(row.location.placeId, row);
    }
  }
  const mergedRows = Array.from(rowIndex.values());

  const errorRows = rows.filter((r) => r.status === 'error');

  return { errorRows, rows: mergedRows, placeTypes };
}

export async function loader(props: Route.LoaderArgs) {
  const url = new URL(props.request.url);
  const force = url.searchParams.has('force');

  const existing = !force
    ? await props.context.cloudflare.env.KV.get('sheets-data')
    : null;

  if (existing != null) {
    return JSON.parse(existing) as Awaited<ReturnType<typeof uncachedLoader>>;
  } else {
    const output = await uncachedLoader(props);
    await props.context.cloudflare.env.KV.put(
      'sheets-data',
      JSON.stringify(output),
      {
        expirationTtl: CACHE_OUTPUT_SECONDS,
      }
    );
    return output;
  }
}
