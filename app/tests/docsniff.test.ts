// server/docsniff.ts is pure: the zip directory, magic bytes, the text rule, refused names, CSV and the sheet cover.
import { describe, expect, test } from "bun:test";
import { decodeText, detectDelimiter, docCandidate, extOf, isTextName, parseCsv, sheetSvg, sniffDoc, splitName, toGrid, zipEntries, type DocSource } from "../server/docsniff";

const enc = new TextEncoder();
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u16 = (n: number) => [n & 255, (n >> 8) & 255];
/** A zip written by hand: stored entries, a central directory, an end record. */
function zip(entries: [string, string][], comment = ""): Uint8Array {
  const out: number[] = [], cd: number[] = [];
  for (const [name, data] of entries) {
    const n = enc.encode(name), d = enc.encode(data), off = out.length;
    out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...n, ...d);
    cd.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...n);
  }
  const cdOff = out.length, c = enc.encode(comment);
  out.push(...cd, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cd.length), ...u32(cdOff), ...u16(c.length), ...c);
  return new Uint8Array(out);
}
const src = (b: Uint8Array): DocSource => ({ size: b.length, read: (off, len) => b.subarray(off, off + len) });
const sniff = (b: Uint8Array | string, name: string | null) => sniffDoc(src(typeof b === "string" ? enc.encode(b) : b), name);

describe("zip directory", () => {
  test("lists the entries, also behind a long end comment", () => {
    const z = zip([["a.txt", "hi"], ["dir/b.xml", "<x/>"]], "c".repeat(500));
    expect(zipEntries(src(z))!.map(e => e.name)).toEqual(["a.txt", "dir/b.xml"]);
  });
  test("a file that is no zip, or one cut short, has no directory", () => {
    expect(zipEntries(src(enc.encode("PK\x03\x04 and then nothing useful at all, no end record here")))).toBeNull();
    expect(zipEntries(src(zip([["a", "b"]]).subarray(0, 40)))).toBeNull();
  });
});

describe("sniffDoc", () => {
  test("zips: OOXML by folder, ODF by the stored mimetype, iWork by its index", () => {
    expect(sniff(zip([["[Content_Types].xml", ""], ["word/document.xml", ""]]), "bericht.docx")).toMatchObject({ format: "docx", kind: "doc" });
    expect(sniff(zip([["xl/workbook.xml", ""]]), "t.xlsx")).toMatchObject({ format: "xlsx", kind: "sheet" });
    expect(sniff(zip([["xl/workbook.xml", ""]]), "t.xlsm")?.format).toBe("xlsm");
    expect(sniff(zip([["xl/workbook.xml", ""]]), "t")?.format).toBe("xlsx"); // no name: the default
    expect(sniff(zip([["ppt/presentation.xml", ""]]), "s.pptx")).toMatchObject({ format: "pptx", kind: "slides" });
    expect(sniff(zip([["mimetype", "application/vnd.oasis.opendocument.text"], ["content.xml", ""]]), "a.odt")?.format).toBe("odt");
    expect(sniff(zip([["mimetype", "application/vnd.oasis.opendocument.spreadsheet"]]), "a.ods")?.format).toBe("ods");
    expect(sniff(zip([["mimetype", "application/vnd.oasis.opendocument.presentation"]]), "a.odp")?.format).toBe("odp");
    expect(sniff(zip([["Index/Document.iwa", ""]]), "a.numbers")?.format).toBe("numbers");
    expect(sniff(zip([["index.xml", ""]]), "a.key")?.format).toBe("key");
    expect(sniff(zip([["Index/Document.iwa", ""]]), "a.pages")?.format).toBe("pages");
  });
  test("other zips, and iWork without its extension, are refused", () => {
    expect(sniff(zip([["a.txt", "x"]]), "a.zip")).toBeNull();
    expect(sniff(zip([["a.txt", "x"]]), "a.docx")).toBeNull();
    expect(sniff(zip([["Index/Document.iwa", ""]]), "a.docx")).toBeNull();
    expect(sniff(zip([["mimetype", "application/epub+zip"]]), "a.epub")).toBeNull();
  });
  test("pdf and rtf by their first bytes, whatever the name says within the table", () => {
    expect(sniff("%PDF-1.4\n...", "x.pdf")).toMatchObject({ format: "pdf", kind: "doc", mime: "application/pdf" });
    expect(sniff("%PDF-1.4\n...", "x.txt")?.format).toBe("pdf");
    expect(sniff("{\\rtf1\\ansi hallo}", "x.rtf")?.format).toBe("rtf");
  });
  test("OLE: doc, xls or ppt by the name, nothing else", () => {
    const ole = new Uint8Array(600); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(sniff(ole, "a.doc")).toMatchObject({ format: "doc", kind: "doc" });
    expect(sniff(ole, "a.XLS")).toMatchObject({ format: "xls", kind: "sheet" });
    expect(sniff(ole, "a.ppt")).toMatchObject({ format: "ppt", kind: "slides" });
    expect(sniff(ole, "a.docx")).toBeNull();
    expect(sniff(ole, null)).toBeNull();
  });
  test("text: no NUL in the first 64 KiB and a name from the text list", () => {
    expect(sniff("Hallo Welt\n", "n.txt")).toMatchObject({ format: "txt", kind: "doc" });
    expect(sniff("# T", "n.markdown")?.format).toBe("md");
    expect(sniff("a;b\n1;2\n", "t.CSV")).toMatchObject({ format: "csv", kind: "sheet" });
    expect(sniff("a\tb\n", "t.tsv")?.format).toBe("tsv");
    expect(sniff("\\section{x}", "a.tex")?.format).toBe("tex");
    expect(sniff("Hallo", "n.docx")).toBeNull(); // text under an office name
    expect(sniff("Hallo", null)).toBeNull();
    expect(sniff("Hallo", "n.html")).toBeNull();
    const nul = enc.encode("abc\0def");
    expect(sniff(nul, "n.txt")).toBeNull();
    const late = new Uint8Array(70000).fill(65); late[69000] = 0; // beyond the first 64 KiB: still text
    expect(sniff(late, "n.txt")?.format).toBe("txt");
    late[100] = 0;
    expect(sniff(late, "n.txt")).toBeNull();
  });
  test("a name with an extension outside the table is refused, even when the bytes are fine", () => {
    expect(sniff("%PDF-1.4", "x.exe")).toBeNull();
    expect(sniff("Hallo", "x.html")).toBeNull();
    expect(sniff("", "x.txt")).toBeNull();
  });
});

describe("candidates at the first chunk", () => {
  test("magic bytes, or text by name; an unknown extension never", () => {
    expect(docCandidate(enc.encode("%PDF-1.7"), "a.pdf")).toBe(true);
    expect(docCandidate(enc.encode("{\\rtf1"), null)).toBe(true);
    expect(docCandidate(new Uint8Array([0x50, 0x4b, 3, 4, 0]), "a.docx")).toBe(true);
    expect(docCandidate(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "a.doc")).toBe(true);
    expect(docCandidate(enc.encode("hallo"), "a.md")).toBe(true);
    expect(docCandidate(enc.encode("hallo"), "a")).toBe(false);
    expect(docCandidate(enc.encode("ha\0llo"), "a.txt")).toBe(false);
    expect(docCandidate(enc.encode("%PDF-1.7"), "a.exe")).toBe(false);
    expect(docCandidate(new Uint8Array([1, 2, 3, 4]), "a.pdf")).toBe(false);
  });
  test("names", () => {
    expect(extOf("A.B.Docx")).toBe("docx");
    expect(isTextName("x.CSV")).toBe(true);
    expect(isTextName("x.docx")).toBe(false);
    expect(splitName("Studienplan v1.2.xlsx")).toEqual({ title: "Studienplan v1.2", ext: "xlsx" });
    expect(splitName("Bericht v1.2")).toEqual({ title: "Bericht v1.2", ext: null });
    expect(splitName("")).toEqual({ title: "Ohne Titel", ext: null });
    expect(splitName("dir/sub/Notiz.TXT").title).toBe("Notiz");
  });
});

describe("text and csv", () => {
  test("UTF-8 with or without BOM, else windows-1252", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode("Grüße")]))).toBe("Grüße");
    expect(decodeText(enc.encode("Grüße"))).toBe("Grüße");
    expect(decodeText(new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x80]))).toBe("Grüße€"); // ü ß and the euro sign in 1252
    const cut = enc.encode("ü").subarray(0, 1); // half a character at the end of a long file is not an error
    expect(decodeText(new Uint8Array([...enc.encode("ab"), ...cut]))).toBe("ab");
  });
  test("quoted fields: delimiters, doubled quotes and line breaks inside quotes", () => {
    expect(parseCsv('a,"b,c","say ""hi""","line1\nline2"\r\nx,,z\r\n', ",")).toEqual([["a", "b,c", 'say "hi"', "line1\nline2"], ["x", "", "z"]]);
    expect(parseCsv("a;b\n1;2", ";")).toEqual([["a", "b"], ["1", "2"]]); // no final line break
    expect(parseCsv('"";"x"\n', ";")).toEqual([["", "x"]]);
    expect(parseCsv("a\nb\nc\nd", ",", 2)).toEqual([["a"], ["b"]]);
  });
  test("the delimiter: tab for tsv, else the most frequent of , ; tab in the first line", () => {
    expect(detectDelimiter("a,b;c;d;e\n", "csv")).toBe(";");
    expect(detectDelimiter("a\tb\tc,d\n", "csv")).toBe("\t");
    expect(detectDelimiter("abc\n", "csv")).toBe(",");
    expect(detectDelimiter("a,b,c\n", "tsv")).toBe("\t");
  });
  test("the grid drops trailing empty rows and columns, pads, and says when it cut", () => {
    expect(toGrid([["a", "b", ""], ["c"], ["", "", ""], []])).toEqual({ rows: [["a", "b"], ["c", ""]], cols: 2, truncated: false });
    expect(toGrid([["a", "b", "c"], ["d"], ["e"]], 2, 2)).toEqual({ rows: [["a", "b"], ["d", ""]], cols: 2, truncated: true });
    expect(toGrid([[""], [""]])).toEqual({ rows: [], cols: 0, truncated: false });
  });
});

describe("sheet cover", () => {
  test("a well-formed SVG with the cells escaped and cut", () => {
    const svg = sheetSvg([["Name", "A & B <x>"], ["ein sehr langer Zellentext", "\u0001ok"]]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("A &amp; B &lt;x&gt;");
    expect(svg).toContain("ein sehr l...");
    expect(svg).not.toContain("\u0001");
    // balanced: every <text> closes
    expect((svg.match(/<text /g) ?? []).length).toBe((svg.match(/<\/text>/g) ?? []).length);
  });
});
