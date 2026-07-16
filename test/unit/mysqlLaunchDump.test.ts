import { describe, expect, it } from 'vitest';
import { parseMysqlLaunchDump } from '../../src/domain/launch/mysqlLaunchDump.js';

describe('parseMysqlLaunchDump', () => {
  it('converts MySQL launch rows and escape sequences', () => {
    const sql = "INSERT INTO `launches` VALUES (745,'Val d\\'Illiez',-123.003,42.2319,'United States','Oregon','Jacksonville','line 1\\nline 2','month \\\"data\\\"',-28800,'year data',1,1234,1,2,3,4,5,6,7,8,9,10,11,12,3062);";

    expect(parseMysqlLaunchDump(sql)).toEqual([{
      id: 745,
      name: "Val d'Illiez",
      longitude: -123.003,
      latitude: 42.2319,
      country: 'United States',
      state: 'Oregon',
      city: 'Jacksonville',
      description: 'line 1\nline 2',
      xcByMonth: 'month "data"',
      timezoneOffset: -28800,
      xcByYear: 'year data',
      rank: 1,
      elevation: 1234,
      rank1: 1,
      rank2: 2,
      rank3: 3,
      rank4: 4,
      rank5: 5,
      rank6: 6,
      rank7: 7,
      rank8: 8,
      rank9: 9,
      rank10: 10,
      rank11: 11,
      rank12: 12,
      xcontestLaunchSite: 3062,
    }]);
  });

  it('combines rows from batched INSERT statements', () => {
    const row = "(745,'Name',1,2,'Country','State','City','','month',0,'year',1,2,1,2,3,4,5,6,7,8,9,10,11,12,13)";
    const sql = `INSERT INTO \`launches\` VALUES ${row};\nINSERT INTO \`launches\` VALUES ${row.replace('745', '746')};`;

    expect(parseMysqlLaunchDump(sql).map(({ id }) => id)).toEqual([745, 746]);
  });

  it('rejects rows with the wrong number of source columns', () => {
    expect(() => parseMysqlLaunchDump("INSERT INTO `launches` VALUES (1,'incomplete');"))
      .toThrow('has 2 values; expected 26');
  });
});
