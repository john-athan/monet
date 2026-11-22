// server/docsniff.ts is pure: the zip directory, magic bytes, the text rule, refused names, CSV and the sheet cover.
import { describe, expect, test } from "bun:test";
import { CsvReader, decodeText, detectDelimiter, extOf, isTextName, parseCsv, sheetSvg, sniffDoc, sniffKnown, splitName, toGrid, zipEntries, zipRead, type DocSource } from "../server/docsniff";

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
  test("other zips, and iWork without its extension, are kept as 'other'", () => {
    expect(sniff(zip([["a.txt", "x"]]), "a.zip")).toMatchObject({ format: "zip", kind: "other", isText: false });
    expect(sniff(zip([["a.txt", "x"]]), "a.docx")).toMatchObject({ format: "docx", kind: "other" });
    expect(sniff(zip([["Index/Document.iwa", ""]]), "a.docx")).toMatchObject({ kind: "other" });
    expect(sniffKnown(src(zip([["a.txt", "x"]])), "a.zip")).toBeNull();
  });
  test("epub: the stored mimetype, or container.xml with an .epub name", () => {
    expect(sniff(zip([["mimetype", "application/epub+zip"], ["META-INF/container.xml", ""]]), "b.epub")).toMatchObject({ format: "epub", kind: "book", mime: "application/epub+zip" });
    expect(sniff(zip([["mimetype", "application/epub+zip"]]), "b")?.format).toBe("epub"); // the bytes decide
    expect(sniff(zip([["META-INF/container.xml", ""], ["OEBPS/c.xhtml", ""]]), "b.EPUB")?.format).toBe("epub");
    expect(sniff(zip([["META-INF/container.xml", ""]]), "b.zip")?.kind).toBe("other");
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
    expect(sniff(ole, "a.docx")).toMatchObject({ kind: "other", format: "docx", isText: false });
    expect(sniff(ole, null)).toMatchObject({ kind: "other", format: "bin" });
  });
  test("text: no NUL in the first 64 KiB and a name from the text list", () => {
    expect(sniff("Hallo Welt\n", "n.txt")).toMatchObject({ format: "txt", kind: "doc" });
    expect(sniff("# T", "n.markdown")?.format).toBe("md");
    expect(sniff("a;b\n1;2\n", "t.CSV")).toMatchObject({ format: "csv", kind: "sheet" });
    expect(sniff("a\tb\n", "t.tsv")?.format).toBe("tsv");
    expect(sniff("\\section{x}", "a.tex")?.format).toBe("tex");
    expect(sniff("Hallo", "n.docx")).toMatchObject({ kind: "other", format: "docx", isText: true }); // text under an office name
    const nul = enc.encode("abc\0def");
    expect(sniff(nul, "n.txt")).toMatchObject({ kind: "other", format: "txt", isText: false });
    const late = new Uint8Array(70000).fill(65); late[69000] = 0; // beyond the first 64 KiB: still text
    expect(sniff(late, "n.txt")?.format).toBe("txt");
    expect(sniff(late, "n.txt")?.kind).toBe("doc");
    late[100] = 0;
    expect(sniff(late, "n.txt")?.kind).toBe("other");
  });
  test("other: the lower case extension, 'bin' without one; text means no NUL and valid UTF-8 in the first 64 KiB", () => {
    expect(sniff("%PDF-1.4", "x.exe")?.kind).toBe("doc"); // the bytes win
    expect(sniff("Hallo", "x.html")).toEqual({ format: "html", kind: "other", mime: "text/plain", isText: true });
    expect(sniff("key: value\n", "Config.YAML")).toMatchObject({ format: "yaml", kind: "other", isText: true });
    expect(sniff("Grüße", "x.log")?.isText).toBe(true);
    expect(sniff(new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65]), "x.log")).toMatchObject({ kind: "other", isText: false }); // windows-1252 is not UTF-8
    expect(sniff(new Uint8Array([1, 2, 0, 4]), "blob")).toEqual({ format: "bin", kind: "other", mime: "application/octet-stream", isText: false });
    expect(sniff(new Uint8Array([1, 2, 3, 4]), "x.weirdext")?.format).toBe("weirdext");
    expect(sniff("", "x.txt")).toBeNull(); // empty files are still refused
    const cut = new Uint8Array(70000).fill(65); cut.set(enc.encode("ü"), 65535); // a character cut at 64 KiB is no error
    expect(sniff(cut, "x.dat")?.isText).toBe(true);
  });
  test("audio: ID3, an MPEG sync with an .mp3 name, fLaC, OggS, RIFF WAVE and the ftyp brands M4A, M4B, M4P", () => {
    const pad = (a: number[]) => new Uint8Array([...a, ...new Uint8Array(64)]);
    const asc = (t: string) => [...enc.encode(t)];
    expect(sniff(pad([...asc("ID3"), 4, 0]), "a.mp3")).toMatchObject({ format: "mp3", kind: "audio", mime: "audio/mpeg" });
    expect(sniff(pad(asc("ID3")), "a")?.format).toBe("mp3");
    expect(sniff(pad([0xff, 0xfb, 0x90, 0x00]), "a.MP3")).toMatchObject({ format: "mp3", kind: "audio" });
    expect(sniff(pad([0xff, 0xfb, 0x90, 0x00]), "a.bin")?.kind).toBe("other"); // two bytes without the name decide nothing
    expect(sniff(pad([0xff, 0xf1, 0x50, 0x80]), "a.aac")).toMatchObject({ format: "aac", kind: "audio", mime: "audio/aac" });
    expect(sniff(pad(asc("fLaC")), "a.flac")).toMatchObject({ format: "flac", mime: "audio/flac" });
    expect(sniff(pad(asc("OggS")), "a.ogg")?.format).toBe("ogg");
    expect(sniff(pad(asc("OggS")), "a.opus")?.format).toBe("opus");
    expect(sniff(pad(asc("OggS")), "a.oga")?.format).toBe("oga");
    expect(sniff(pad(asc("OggS")), "a")?.format).toBe("ogg");
    expect(sniff(pad([...asc("RIFF"), 1, 2, 3, 4, ...asc("WAVE")]), "a.wav")).toMatchObject({ format: "wav", mime: "audio/wav" });
    expect(sniff(pad([...asc("RIFF"), 1, 2, 3, 4, ...asc("WEBP")]), "a.wav")?.kind).toBe("other"); // a photo goes elsewhere; here it is just not audio
    const ftyp = (brand: string) => pad([0, 0, 0, 32, ...asc("ftyp"), ...asc(brand)]);
    expect(sniff(ftyp("M4A "), "a.m4a")).toMatchObject({ format: "m4a", kind: "audio", mime: "audio/mp4" });
    expect(sniff(ftyp("M4A "), "x.mp4")?.format).toBe("m4a"); // the brand decides
    expect(sniff(ftyp("M4B "), "book.m4b")?.format).toBe("m4b");
    expect(sniff(ftyp("M4P "), "a.m4p")?.format).toBe("m4a");
    // an mp4 video is not audio here (the upload hands it to the video pipeline before it ever gets this far)
    expect(sniff(ftyp("isom"), "a.mp4")?.kind).toBe("other");
  });
  test("names", () => {
    expect(extOf("A.B.Docx")).toBe("docx");
    expect(isTextName("x.CSV")).toBe(true);
    expect(isTextName("x.docx")).toBe(false);
    expect(splitName("Studienplan v1.2.xlsx")).toEqual({ title: "Studienplan v1.2", ext: "xlsx" });
    expect(splitName("Bericht v1.2")).toEqual({ title: "Bericht v1.2", ext: null });
    expect(splitName("")).toEqual({ title: "Ohne Titel", ext: null });
    expect(splitName("dir/sub/Notiz.TXT").title).toBe("Notiz");
    expect(splitName("config.yaml")).toEqual({ title: "config", ext: null }); // any real extension is cut from the title
    expect(splitName("Rechnung 2026.11").title).toBe("Rechnung 2026.11");
  });
});

describe("zip entries", () => {
  /** a zip with one deflated entry (method 8) and one stored */
  function zipDeflated(name: string, data: Uint8Array, stored: [string, string]): Uint8Array {
    const out: number[] = [], cd: number[] = [], rows: [string, Uint8Array, Uint8Array, number][] = [
      [name, data, Bun.deflateSync(data), 8], [stored[0], enc.encode(stored[1]), enc.encode(stored[1]), 0]];
    for (const [n, d, c, m] of rows) {
      const nb = enc.encode(n), off = out.length;
      out.push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(m), ...u16(0), ...u16(0), ...u32(0), ...u32(c.length), ...u32(d.length), ...u16(nb.length), ...u16(0), ...nb, ...c);
      cd.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(m), ...u16(0), ...u16(0), ...u32(0), ...u32(c.length), ...u32(d.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off), ...nb);
    }
    const cdOff = out.length;
    out.push(...cd, ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(2), ...u16(2), ...u32(cd.length), ...u32(cdOff), ...u16(0));
    return new Uint8Array(out);
  }
  test("zipRead inflates method 8 and returns stored entries as they are; a lying size or a cap is null", () => {
    const text = enc.encode("<p>Kapitel eins</p>".repeat(50));
    const z = src(zipDeflated("OEBPS/c1.xhtml", text, ["mimetype", "application/epub+zip"])), es = zipEntries(z)!;
    expect(es.map(e => [e.name, e.method])).toEqual([["OEBPS/c1.xhtml", 8], ["mimetype", 0]]);
    expect(es[0].size).toBe(text.length);
    expect(new TextDecoder().decode(zipRead(z, es[0])!)).toBe(new TextDecoder().decode(text));
    expect(new TextDecoder().decode(zipRead(z, es[1])!)).toBe("application/epub+zip");
    expect(zipRead(z, es[0], 100)).toBeNull();
    expect(zipRead(z, { ...es[0], size: es[0].size + 1 })).toBeNull();
    expect(zipRead(z, { ...es[0], method: 12 })).toBeNull();
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

describe("csv in pieces", () => {
  test("CsvReader gives the rows of parseCsv however the text is cut, quotes and CRLF included", () => {
    const text = 'a,"b,c","say ""hi""","l1\nl2"\r\nx,,z\r\n"q"\n\nlast';
    const whole = parseCsv(text, ",");
    for (const cut of [1, 2, 3, 5, 7, 13]) {
      const rows: string[][] = [], r = new CsvReader(",", row => { rows.push(row); });
      for (let i = 0; i < text.length; i += cut) r.feed(text.slice(i, i + cut));
      r.end();
      expect(rows).toEqual(whole);
    }
    expect(whole.length).toBe(5);
  });
  test("onRow returning false stops the reader", () => {
    const rows: string[][] = [], r = new CsvReader(",", row => { rows.push(row); return rows.length < 2; });
    r.feed("a\nb\nc\nd\n"); r.end();
    expect(rows).toEqual([["a"], ["b"]]);
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
