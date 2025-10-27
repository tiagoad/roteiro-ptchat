import { useEffect, useRef } from 'react';
import type { Route } from './+types/api.data';
import type { sheets_v4, places_v1 } from 'googleapis';
import { indexToSheetsColumn } from '~/lib/encode';

const CACHE_SECONDS = 60;
const PLACE_REGEXP = new RegExp(
  /https:\/\/www.google.com\/maps\/place\/.+\/data=!.+!.+![0-9]+s([0-9A-Za-z-]+)/
);

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
    const res = await fetch(apiURL);
    if (!res.ok) {
      throw new Response('Failed to read sheet metadata', { status: 400 });
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

  const res = await fetch(apiURL);

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

  const rows = (
    await Promise.all(
      rowData.slice(2).map(async (row) => {
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
          data['Google Maps'].data.chipRuns?.[0]?.chip?.richLinkProperties
            ?.uri!;

        if (!mapsUrl) {
          return undefined;
        }

        const placeId = PLACE_REGEXP.exec(mapsUrl)![1];
        const placesURL = new URL(
          `https://places.googleapis.com/v1/places/${placeId}`
        );
        placesURL.searchParams.set(
          'key',
          context.cloudflare.env.GOOGLE_API_KEY
        );
        placesURL.searchParams.set('fields', 'location,displayName');
        const placeRes = await fetch(placesURL);

        if (!placeRes.ok) {
          return undefined;
          //throw new Response('Failed to read place metadata', { status: 400 });
        }

        const placeMetadata =
          await placeRes.json<places_v1.Schema$GoogleMapsPlacesV1Place>();

        return {
          types: data.Tipo.data.formattedValue?.split(', ') || [],
          location: {
            city: data.Cidade.data.formattedValue!,
            name: data['Google Maps'].data.formattedValue!,
            metadata: placeMetadata,
            url: mapsUrl,
          },
          user: data.User.data.formattedValue!,
          ranking: data.Rank.data.effectiveValue!.numberValue,
          notes: data.Notas.data.formattedValue,
        };
      })
    )
  ).filter((v) => !!v);

  return { rows, placeTypes };
}

export async function loader(props: Route.LoaderArgs) {
  const existing = await props.context.cloudflare.env.KV.get('sheets-data');
  if (existing != null) {
    return JSON.parse(existing) as Awaited<ReturnType<typeof uncachedLoader>>;
  } else {
    const output = await uncachedLoader(props);
    await props.context.cloudflare.env.KV.put(
      'sheets-data',
      JSON.stringify(output),
      {
        expirationTtl: CACHE_SECONDS,
      }
    );
    return output;
  }
}
