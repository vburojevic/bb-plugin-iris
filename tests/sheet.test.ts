import { describe, expect, it } from "vitest";
import { address, colIndex, colName, computeSheet, isCellError, normalizeSheet, parseFormula, parsePaste, readInput, sheetCsv, sheetRows, shiftFormula, type CellValue } from "../core/sheet";

const sheet = (rows: unknown, columns?: unknown) => {
  const { data, problems } = normalizeSheet(rows, columns);
  return { data, problems, values: computeSheet(data) };
};
const code = (v: CellValue) => (isCellError(v) ? v.$error : v);

describe("addresses", () => {
  it("names columns like a spreadsheet", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(colName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
    expect(["A", "Z", "AA", "ba"].map(colIndex)).toEqual([0, 25, 26, 52]);
    expect(address(0, 1)).toBe("B2");
  });
});

describe("formulas", () => {
  const base = [
    ["Item", "Qty", "Price", "Total"],
    ["Pens", 4, 1.5, "=B2*C2"],
    ["Paper", 2, 6.25, "=B3*C3"],
    ["Ink", 1, 18, "=B4*C4"],
    ["Sum", "=SUM(B2:B4)", "", "=SUM(D2:D4)"],
  ];

  it("computes references, ranges and aggregates", () => {
    const { values } = sheet(base);
    expect(values.map((r) => r[3])).toEqual([6, 12.5, 18, 36.5]);
    expect(values[3][1]).toBe(7);
  });

  it("follows precedence, power, percent, unary minus and text joins", () => {
    const one = (f: string) => code(sheet([["a"], [f]]).values[0][0]);
    expect(one("=1+2*3")).toBe(7);
    expect(one("=(1+2)*3")).toBe(9);
    expect(one("=2^3^2")).toBe(512);
    expect(one("=-2^2")).toBe(4);
    expect(one("=50%*10")).toBe(5);
    expect(one('="a"&1&TRUE')).toBe("a1TRUE");
    expect(one("=3>2")).toBe(true);
    expect(one('="B"="b"')).toBe(true);
    expect(one("=1<>1")).toBe(false);
  });

  it("has the functions agents reach for", () => {
    const one = (f: string) => code(sheet([["a", "b"], [10, f], [20, ""], [30, "x"]]).values[0][1]);
    expect(one("=AVG(A2:A4)")).toBe(20);
    expect(one("=AVERAGE(A2:A4)")).toBe(20);
    expect(one("=MIN(A2:A4)")).toBe(10);
    expect(one("=MAX(A2:A4, 99)")).toBe(99);
    expect(one("=MEDIAN(A2:A4)")).toBe(20);
    expect(one("=COUNT(A2:B4)")).toBe(3);
    expect(one("=COUNTA(A2:B4)")).toBe(5);
    expect(one('=IF(A2>5, "big", "small")')).toBe("big");
    expect(one("=IF(A2>50, 1)")).toBe(false);
    expect(one("=ROUND(2.345, 2)")).toBe(2.35);
    expect(one("=ROUND(1.005, 2)")).toBe(1.01);
    expect(one("=ROUND(1234, -2)")).toBe(1200);
    expect(one("=ROUNDUP(1.21, 1)")).toBe(1.3);
    expect(one("=ROUNDDOWN(-1.29, 1)")).toBe(-1.2);
    expect(one('=SUMIF(A2:A4, ">15")')).toBe(50);
    expect(one('=COUNTIF(A2:A4, "<>20")')).toBe(2);
    expect(one("=IFERROR(1/0, -1)")).toBe(-1);
    expect(one("=AND(TRUE, A2>1)")).toBe(true);
    expect(one("=OR(FALSE, A2>100)")).toBe(false);
    expect(one("=MOD(-7, 3)")).toBe(2);
    expect(one('=UPPER("ab") & LEN("xyz")')).toBe("AB3");
    expect(one("=SUM(A:A)")).toBe(60);
    expect(one("=A1")).toBe("a");
    expect(one("=sum(a2:a3)")).toBe(30);
  });

  it("returns spreadsheet errors instead of throwing", () => {
    const one = (f: string) => code(sheet([["a"], [f]]).values[0][0]);
    expect(one("=1/0")).toBe("#DIV/0!");
    expect(one('="x"+1')).toBe("#VALUE!");
    expect(one("=NOPE(1)")).toBe("#NAME?");
    expect(one("=missing * 2")).toBe("#NAME?");
    expect(one("=1+")).toBe("#ERROR!");
    expect(one("=A2")).toBe("#CYCLE!");
    expect(one("=SQRT(-1)")).toBe("#NUM!");
    expect(one("=ROUND(1,2,3)")).toBe("#VALUE!");
    expect(one("=#REF!+1")).toBe("#REF!");
  });

  it("finds cycles through several cells and keeps other cells", () => {
    const { values } = sheet([["a", "b", "c"], ["=B2", "=A2", 5]]);
    expect(code(values[0][0])).toBe("#CYCLE!");
    expect(code(values[0][1])).toBe("#CYCLE!");
    expect(values[0][2]).toBe(5);
  });

  it("never evaluates JavaScript", () => {
    for (const f of ["=constructor", "=__proto__", "=globalThis", '=alert("x")', "=this"]) {
      const v = sheet([["a"], [f]]).values[0][0];
      expect(isCellError(v), f).toBe(true);
    }
    expect(() => parseFormula("=1;2")).toThrow();
  });

  it("stops formulas that take too long", () => {
    const rows: unknown[][] = [["a", "b"]];
    for (let k = 0; k < 2000; k++) rows.push([k, "=SUM(A:A)+SUM(A:A)+SUM(A:A)"]);
    const { values } = sheet(rows);
    expect(values.some((r) => isCellError(r[1]) && r[1].$error === "#NUM!")).toBe(true);
  });

  it("follows a long chain of references", () => {
    const rows: unknown[][] = [["a"], [1]];
    for (let k = 3; k <= 2001; k++) rows.push([`=A${k - 1}+1`]);
    const { values } = sheet(rows);
    expect(values[1999][0]).toBe(2000);
  });
});

describe("computed columns", () => {
  it("evaluates a per-row formula by column name", () => {
    const { values, data } = sheet(
      [
        { item: "Pens", qty: 4, price: 1.5 },
        { item: "Ink", qty: 1, price: 18 },
      ],
      ["item", "qty", { key: "price", format: "usd" }, { key: "total", label: "Total", formula: "qty * price", format: "usd" }],
    );
    expect(values.map((r) => r[3])).toEqual([6, 18]);
    expect(data.columns[3].formula).toBe("qty * price");
    expect(data.cells[0][3]).toBe(null);
  });

  it("reads bracketed and cell-shaped column names", () => {
    const { values } = sheet([{ q1: 2, q2: 3 }], ["q1", "q2", { key: "sum", formula: "[q1] + q2" }]);
    expect(values[0][2]).toBe(5);
  });

  it("lets cells reference computed columns", () => {
    const { values } = sheet([["a", "b"], [2, "=SUM(C2:C3)"], [3, null]], ["a", "b", { key: "c", formula: "a * 10" }]);
    expect(values[0][1]).toBe(50);
  });

  it("lets a cell's own formula override its column's", () => {
    const { values } = sheet(
      [["Item", "Qty", "Price", "Cost"], ["a", 2, 3, null], ["b", 1, 4, null], ["Total", "=SUM(B2:B3)", null, "=SUM(D2:D3)"]],
      ["Item", "Qty", "Price", { key: "Cost", formula: "Qty * Price" }],
    );
    expect(values.map((r) => r[3])).toEqual([6, 4, 10]);
  });

  it("reports a bad column formula", () => {
    expect(sheet([{ a: 1 }], ["a", { key: "b", formula: "a +" }]).problems[0]).toMatch(/column b formula/);
  });
});

describe("input shapes", () => {
  it("reads CSV text, {columns, rows} and objects", () => {
    expect(sheet("a,b\n1,=A2*2\n").values[0]).toEqual([1, 2]);
    expect(sheet({ columns: ["x", "y"], rows: [[1, 2]] }).data.columns.map((c) => c.key)).toEqual(["x", "y"]);
    expect(sheet([{ a: 1 }, { a: 2, b: 3 }]).data.columns.map((c) => c.key)).toEqual(["a", "b"]);
    expect(sheet(42).problems.length).toBe(1);
  });

  it("caps very large input", () => {
    const rows = [["a"], ...Array.from({ length: 2100 }, (_, k) => [k])];
    const s = sheet(rows);
    expect(s.data.cells.length).toBe(2000);
    expect(s.problems[0]).toMatch(/first 2000/);
  });

  it("reads typed input like a spreadsheet", () => {
    expect(readInput("12")).toBe(12);
    expect(readInput("1,200.5")).toBe(1200.5);
    expect(readInput("$5")).toBe(5);
    expect(readInput("12%")).toBe(0.12);
    expect(readInput("true")).toBe(true);
    expect(readInput("=A1")).toBe("=A1");
    expect(readInput("  ")).toBe(null);
    expect(readInput("v1.2")).toBe("v1.2");
  });

  it("parses pasted blocks from a spreadsheet or CSV", () => {
    expect(parsePaste("1\t2\n3\t4\n")).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(parsePaste('a,"b, c"\n1,2')).toEqual([
      ["a", "b, c"],
      [1, 2],
    ]);
    expect(parsePaste("hello, world")).toEqual([["hello, world"]]);
  });
});

describe("row moves", () => {
  it("shifts references when rows are inserted", () => {
    expect(shiftFormula("=SUM(B2:B5)+B6", 2, 1)).toBe("=SUM(B2:B6)+B7");
    expect(shiftFormula("=B2*C2", 0, 1)).toBe("=B3*C3");
    expect(shiftFormula("=$B$4", 1, 2)).toBe("=$B$6");
  });

  it("grows a totals range when a row goes in right above the totals row", () => {
    // Rows 2-3 are data, row 4 adds them up; a row inserted at data index 2 (sheet row 4) pushes the total to row 5.
    expect(shiftFormula("=SUM(B2:B3)", 2, 1, 3)).toBe("=SUM(B2:B4)");
    // A formula above the insertion keeps its range.
    expect(shiftFormula("=SUM(B2:B3)", 2, 1, 0)).toBe("=SUM(B2:B3)");
  });

  it("shrinks ranges and marks removed cells when rows are removed", () => {
    expect(shiftFormula("=SUM(B2:B5)", 1, -1)).toBe("=SUM(B2:B4)");
    expect(shiftFormula("=B3+B5", 1, -1)).toBe("=#REF!+B4");
    expect(shiftFormula("=SUM(B3:B3)", 1, -1)).toBe("=SUM(#REF!)");
    expect(shiftFormula("=SUM(B2:B5)", 0, -4)).toBe("=SUM(#REF!)");
    expect(shiftFormula("plain", 0, -1)).toBe("plain");
  });
});

describe("output", () => {
  it("gives rows with values and CSV", () => {
    const { data, values } = sheet([["Item", "Total"], ["a", "=2*3"], ["b", "=1/0"]]);
    expect(sheetRows(data, values)).toEqual([
      { Item: "a", Total: 6 },
      { Item: "b", Total: "#DIV/0!" },
    ]);
    expect(sheetCsv(data, values)).toBe("Item,Total\na,6\nb,#DIV/0!");
  });
});

describe("review fixes", () => {
  it("keeps the budget when a column range lies past the sheet", () => {
    const rows: unknown[][] = [["a", "b"]];
    for (let k = 0; k < 2000; k++) rows.push([k, "=SUM(A:A)+SUM(ZZZ:ZZZ)+SUM(A:A)+SUM(A:A)"]);
    const { values } = sheet(rows);
    expect(values.some((r) => isCellError(r[1]) && r[1].$error === "#NUM!")).toBe(true);
  });

  it("matches criteria across line breaks and never throws out of a cell", () => {
    const { values } = sheet([["a", "b"], ["x\ny", "=COUNTIF(A2:A2, A2)"]]);
    expect(values[0][1]).toBe(1);
  });

  it("leaves cell-shaped column keys alone when rows move", () => {
    const cols = [{ key: "q1", label: "q1" }, { key: "q2", label: "q2" }];
    expect(shiftFormula("=q1+q2+A3", 0, 1, undefined, cols)).toBe("=q1+q2+A4");
  });

  it("reads long input in linear time and keeps results finite", () => {
    const t = Date.now();
    expect(readInput(`${"1".repeat(20000)}x`)).toBe(`${"1".repeat(20000)}x`);
    expect(Date.now() - t).toBeLessThan(1000);
    const one = (f: string) => code(sheet([["a"], [f]]).values[0][0]);
    expect(one("=POWER(10, 400)")).toBe("#NUM!");
    expect(one("=ROUND(1, 400)")).toBe("#NUM!");
  });
});
