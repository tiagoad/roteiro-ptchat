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

export async function loader(props: Route.LoaderArgs) {
  const url = new URL(props.request.url);
  const force = url.searchParams.has('force');

  const existing = !force
    ? await props.context.cloudflare.env.KV.get('sheets-data')
    : null;

  if (existing != null) {
    return JSON.parse(existing) as Awaited<ReturnType<typeof fetchData>>;
  } else {
    const output = await fetchData({
      googleApiKey: props.context.cloudflare.env.GOOGLE_API_KEY,
      googleSheetId: props.context.cloudflare.env.GOOGLE_SHEET_ID,
    });
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

type Error = {
  error: string;
  meta?: any;
};

type Place = {
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
};

async function fetchData({
  googleSheetId,
  googleApiKey,
}: {
  googleSheetId: string;
  googleApiKey: string;
}) {
  const tableRange = await getTableRange({
    sheetId: googleSheetId,
    apiKey: googleApiKey,
  });

  const apiURL = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${googleSheetId}`
  );

  apiURL.searchParams.set('key', googleApiKey);
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

  // process all row data in parallel
  const rows = await Promise.all(
    rowData.slice(2).map((row, rowIdx) =>
      processRow({
        row,
        rowIdx,
        columnProperties,
        googleApiKey,
      })
    )
  );

  // merge all the rows
  const { places, errors, uniques } = rows.reduce<{
    places: Map<string, Place>;
    errors: Error[];
    uniques: {
      types: Set<string>;
      users: Set<string>;
      cities: Set<string>;
    };
  }>(
    (agg, row) => {
      if (!row.ok) {
        agg.errors.push(row.data);
      } else {
        const data = row.data;
        const placeId = data.location.placeId;

        // add data to unique sets
        data.types.forEach((t) => agg.uniques.types.add(t));
        data.reviews.forEach((r) => agg.uniques.users.add(r.user));
        agg.uniques.cities.add(data.location.city);

        // find if there is an existing record for this placeId
        const dupe = agg.places.get(placeId);
        if (dupe !== undefined) {
          // merge this record into the existing one
          dupe.reviews.push(data.reviews[0]);
          dupe.types = Array.from(new Set([...dupe.types, ...data.types]));
        } else {
          agg.places.set(placeId, data);
        }
      }

      return agg;
    },
    {
      places: new Map(),
      errors: [],
      uniques: {
        types: new Set(),
        users: new Set(),
        cities: new Set(),
      },
    }
  );

  return {
    places: Array.from(places.values()),
    uniques: {
      types: Array.from(uniques.types.values()),
      users: Array.from(uniques.users.values()),
      cities: Array.from(uniques.cities.values()),
    },
    rows,
    errors,
  };
}

async function getTableRange({
  sheetId,
  apiKey,
  sheetIndex = 0,
  tableIndex = 0,
}: {
  sheetId: string;
  apiKey: string;
  sheetIndex?: number;
  tableIndex?: number;
}) {
  const apiURL = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`
  );
  apiURL.searchParams.set('key', apiKey);

  const res = await fetch(apiURL, {
    cf: {
      cacheTtl: CACHE_SHEETS_SECONDS,
      cacheEverything: true,
    },
  });
  if (!res.ok) {
    throw new Error('Failed to read sheet metadata.');
  }
  const data = await res.json<sheets_v4.Schema$Spreadsheet>();

  const table = data.sheets?.[sheetIndex]?.tables?.[tableIndex];
  if (!table) {
    throw new Error(`Table #${tableIndex} not found in sheet #${sheetIndex}`);
  }

  const range = table?.range;
  if (!range) {
    throw new Error(`Table has no defined range. Should be unreachable.`);
  }

  return `${indexToSheetsColumn(range.startColumnIndex!)}${range?.startRowIndex}:${indexToSheetsColumn(range.endColumnIndex!)}${range?.endRowIndex}`;
}

async function processRow({
  row,
  columnProperties,
  rowIdx,
  googleApiKey,
}: {
  row: sheets_v4.Schema$RowData;
  rowIdx: number;
  columnProperties: sheets_v4.Schema$TableColumnProperties[];
  googleApiKey: string;
}): Promise<
  | {
      ok: true;
      data: Place;
    }
  | {
      ok: false;
      data: Error;
    }
> {
  type ColumnName =
    | 'Tipo'
    | 'Cidade'
    | 'Google Maps'
    | 'User'
    | 'Rank'
    | 'Notas';

  // turn array of columns into an object
  const data = Object.fromEntries(
    row.values!.map((v, colIdx) => {
      const props = columnProperties[colIdx];
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

  // extract Google Maps URL from the "Smart Chip"
  const mapsUrl =
    data['Google Maps'].data.chipRuns?.[0]?.chip?.richLinkProperties?.uri;
  if (!mapsUrl) {
    return {
      ok: false,
      data: {
        error: `No maps URL in row ${rowIdx}`,
        meta: {
          rowData: data,
        },
      },
    };
  }

  // extract place name from the Google Maps URL
  const placeMatch = PLACE_REGEXP.exec(mapsUrl);
  if (!placeMatch) {
    console.warn(`No maps place ID in url ${mapsUrl}`);
    return {
      ok: false,
      data: {
        error: `No maps place ID in url ${mapsUrl}`,
        meta: {
          rowData: data,
        },
      },
    };
  }

  const placeId = PLACE_REGEXP.exec(mapsUrl)![1];
  const placesURL = new URL(
    `https://places.googleapis.com/v1/places/${placeId}`
  );
  placesURL.searchParams.set('key', googleApiKey);
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
      ok: false,
      data: {
        error: `No place information for ${mapsUrl}`,
        meta: {
          placeId: placeId,
          rowData: data,
        },
      },
    };
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
    ok: true,
    data: {
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
    },
  };
}
