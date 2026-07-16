export type LaunchImportRow = {
  id: number;
  name: string;
  longitude: number;
  latitude: number;
  country: string;
  state: string;
  city: string;
  description: string;
  xcByMonth: string;
  timezoneOffset: number;
  xcByYear: string;
  rank: number;
  elevation: number;
  rank1: number;
  rank2: number;
  rank3: number;
  rank4: number;
  rank5: number;
  rank6: number;
  rank7: number;
  rank8: number;
  rank9: number;
  rank10: number;
  rank11: number;
  rank12: number;
  xcontestLaunchSite: number;
};

const columnNames: (keyof LaunchImportRow)[] = [
  'id',
  'name',
  'longitude',
  'latitude',
  'country',
  'state',
  'city',
  'description',
  'xcByMonth',
  'timezoneOffset',
  'xcByYear',
  'rank',
  'elevation',
  'rank1',
  'rank2',
  'rank3',
  'rank4',
  'rank5',
  'rank6',
  'rank7',
  'rank8',
  'rank9',
  'rank10',
  'rank11',
  'rank12',
  'xcontestLaunchSite',
];

const stringColumns = new Set<keyof LaunchImportRow>([
  'name',
  'country',
  'state',
  'city',
  'description',
  'xcByMonth',
  'xcByYear',
]);

function unescapeMysqlCharacter(character: string): string {
  switch (character) {
    case '0': return '\0';
    case 'b': return '\b';
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'Z': return '\x1a';
    default: return character;
  }
}

function parseValues(valuesSql: string): (string | number)[][] {
  const rows: (string | number)[][] = [];
  let row: (string | number)[] | undefined;
  let token = '';
  let quoted = false;
  let escaped = false;

  const finishValue = () => {
    if (!row) throw new Error('Found a launch value outside a row.');
    if (quoted) throw new Error('The launch dump contains an unterminated string.');

    const trimmed = token.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NULL') {
      throw new Error('The launches table contains a missing value, but all destination columns are required.');
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric launch value: ${trimmed}`);
    row.push(value);
    token = '';
  };

  for (let index = 0; index < valuesSql.length; index += 1) {
    const character = valuesSql[index];
    if (character === undefined) break;

    if (quoted) {
      if (escaped) {
        token += unescapeMysqlCharacter(character);
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === "'") {
        quoted = false;
        row?.push(token);
        token = '';
      } else {
        token += character;
      }
      continue;
    }

    if (character === "'") {
      if (token.trim() !== '') throw new Error('Unexpected quote in numeric launch value.');
      quoted = true;
    } else if (character === '(') {
      if (row) throw new Error('Unexpected nested row in launch dump.');
      row = [];
    } else if (character === ',') {
      if (token.trim() !== '') finishValue();
    } else if (character === ')') {
      if (token.trim() !== '') finishValue();
      if (!row) throw new Error('Unexpected row ending in launch dump.');
      rows.push(row);
      row = undefined;
    } else if (character === ';') {
      break;
    } else {
      token += character;
    }
  }

  if (quoted || row) throw new Error('The launch dump ended before its final row was complete.');
  return rows;
}

export function parseMysqlLaunchDump(sql: string): LaunchImportRow[] {
  const insertPrefix = 'INSERT INTO `launches` VALUES ';
  const valuesRows: (string | number)[][] = [];
  let searchStart = 0;
  let insertStart = sql.indexOf(insertPrefix, searchStart);
  while (insertStart !== -1) {
    valuesRows.push(...parseValues(sql.slice(insertStart + insertPrefix.length)));
    searchStart = insertStart + insertPrefix.length;
    insertStart = sql.indexOf(insertPrefix, searchStart);
  }
  if (valuesRows.length === 0) throw new Error('Could not find an INSERT INTO `launches` VALUES statement.');

  return valuesRows.map((values, rowIndex) => {
    if (values.length !== columnNames.length) {
      throw new Error(`Launch row ${rowIndex + 1} has ${values.length} values; expected ${columnNames.length}.`);
    }

    const row = {} as Record<keyof LaunchImportRow, string | number>;
    for (const [columnIndex, column] of columnNames.entries()) {
      const value = values[columnIndex];
      if (value === undefined || (stringColumns.has(column) && typeof value !== 'string') || (!stringColumns.has(column) && typeof value !== 'number')) {
        throw new Error(`Launch row ${rowIndex + 1} has an invalid ${column} value.`);
      }
      row[column] = value;
    }
    return row as LaunchImportRow;
  });
}
