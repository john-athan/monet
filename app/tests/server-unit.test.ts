// Pure logic: no server, no database. Dates, titles, colours, EXIF text, query parsing, clustering arithmetic.
import { describe, expect, test } from "bun:test";
import { contrast, dayTitle, daySign, DAY_BG, hexToRgb, kmeans, monthPalette, NIGHT_BG, readPpm } from "../server/calc";
import { bestMatch, addTo, SAME_PERSON, type Group } from "../server/cluster";
import { dateFromName, metaFromFfprobe, metaFromVips, parseIso6709 } from "../server/exif";
import { parseQuery } from "../server/parse";
import { berlinOffsetMin, berlinWallToUtc, localDay } from "../server/util";

const iso = (ms: number) => new Date(ms).toISOString();

describe("dates from file names", () => {
  test("the patterns the spec lists", () => {
    // phones write their own wall clock, which is Europe/Berlin here: summer is UTC+2, winter UTC+1
    expect(iso(dateFromName("IMG_20190806_180121.jpg")!.utc)).toBe("2019-08-06T16:01:21.000Z");
    expect(iso(dateFromName("20201101_133230.jpg")!.utc)).toBe("2020-11-01T12:32:30.000Z");
    expect(iso(dateFromName("Screenshot_20200107-220711.jpg")!.utc)).toBe("2020-01-07T21:07:11.000Z");
    expect(iso(dateFromName("Screenshot_20200625-080315_Chrome.jpg")!.utc)).toBe("2020-06-25T06:03:15.000Z");
    expect(iso(dateFromName("IMG_20170923_163506_01.jpg")!.utc)).toBe("2017-09-23T14:35:06.000Z");
  });
  test("Pixel names are UTC, WhatsApp names have a date only", () => {
    expect(iso(dateFromName("PXL_20150214_102000.jpg")!.utc)).toBe("2015-02-14T10:20:00.000Z");
    const wa = dateFromName("IMG-20191128-WA0000.jpg")!;
    expect(wa.hasTime).toBe(false);
    expect(localDay(wa.utc, null)).toBe("2019-11-28"); // noon, so no zone can move it to another day
  });
  test("separated dates, with single digits", () => {
    expect(iso(dateFromName("DALL_E 2022-10-06 23.25.37 - Vlad the Impaler.png")!.utc)).toBe("2022-10-06T21:25:37.000Z");
    expect(iso(dateFromName("dallemini_2022-8-5_20-49-7.png")!.utc)).toBe("2022-08-05T18:49:07.000Z");
  });
  test("things that are not dates", () => {
    for (const n of ["IMG_0195.HEIC", "photo_99999999.jpg", "20211340_121212.jpg", "IMG_1234567890123.jpg", "20190231_120000.jpg"]) expect(dateFromName(n)).toBeNull();
  });
  test("Berlin offsets across the DST change", () => {
    expect(berlinOffsetMin(Date.UTC(2020, 0, 15))).toBe(60);
    expect(berlinOffsetMin(Date.UTC(2020, 6, 15))).toBe(120);
    expect(iso(berlinWallToUtc(2021, 3, 28, 12, 0, 0))).toBe("2021-03-28T10:00:00.000Z");
    expect(localDay(Date.UTC(2020, 5, 30, 22, 30), null)).toBe("2020-07-01"); // 00:30 in Berlin
    expect(localDay(Date.UTC(2020, 5, 30, 22, 30), -300)).toBe("2020-06-30"); // 17:30 at UTC-5
  });
});

const HEIC = `width: 3024
height: 4032
exif-ifd0-Make: Apple (Apple, ASCII, 6 components, 6 bytes)
exif-ifd0-Model: iPhone 13 Pro (iPhone 13 Pro, ASCII, 14 components, 14 bytes)
exif-ifd2-ExposureTime: 1/33 (1/33 sec., Rational, 1 components, 8 bytes)
exif-ifd2-FNumber: 3/2 (f/1.5, Rational, 1 components, 8 bytes)
exif-ifd2-ISOSpeedRatings: 500 (500, Short, 1 components, 2 bytes)
exif-ifd2-DateTimeOriginal: 2021:06:12 14:30:05 (2021:06:12 14:30:05, ASCII, 20 components, 20 bytes)
exif-ifd2-OffsetTimeOriginal: +02:00 (+02:00, ASCII, 7 components, 7 bytes)
exif-ifd2-FocalLength: 57/10 (5.7 mm, Rational, 1 components, 8 bytes)
exif-ifd3-GPSLatitudeRef: N (N, ASCII, 2 components, 2 bytes)
exif-ifd3-GPSLatitude: 48/1 8/1 1464/100 (48,  8, 14.64, Rational, 3 components, 24 bytes)
exif-ifd3-GPSLongitudeRef: E (E, ASCII, 2 components, 2 bytes)
exif-ifd3-GPSLongitude: 11/1 34/1 3180/100 (11, 34, 31.80, Rational, 3 components, 24 bytes)`;
describe("EXIF from vipsheader -a", () => {
  test("HEIC with GPS and zone offset", () => {
    const m = metaFromVips(HEIC);
    expect(iso(m.taken!.utc)).toBe("2021-06-12T12:30:05.000Z");
    expect(m.taken!.tzMin).toBe(120);
    expect(m.lat).toBeCloseTo(48.1374, 3); expect(m.lon).toBeCloseTo(11.5755, 3);
    expect([m.camera, m.exposure, m.fnumber, m.iso, m.focal]).toEqual(["Apple iPhone 13 Pro", "1/33", 1.5, 500, 5.7]);
  });
  test("EXIF orientation 6 swaps the stored size; southern and western references are negative", () => {
    const m = metaFromVips(`width: 4000\nheight: 3000\norientation: 6\nexif-ifd3-GPSLatitudeRef: S (S, ASCII, 2 components, 2 bytes)\nexif-ifd3-GPSLatitude: 10/1 30/1 0/1 (10, 30, 0, Rational, 3 components, 24 bytes)\nexif-ifd3-GPSLongitudeRef: W (W, ASCII, 2 components, 2 bytes)\nexif-ifd3-GPSLongitude: 70/1 0/1 0/1 (70, 0, 0, Rational, 3 components, 24 bytes)`);
    expect([m.width, m.height, m.lat, m.lon]).toEqual([3000, 4000, -10.5, -70]);
  });
  test("a date with no zone is read as Berlin and a zero date is ignored", () => {
    expect(iso(metaFromVips("exif-ifd2-DateTimeOriginal: 2019:08:06 18:01:21 (x, ASCII, 20 components, 20 bytes)").taken!.utc)).toBe("2019-08-06T16:01:21.000Z");
    expect(metaFromVips("exif-ifd2-DateTimeOriginal: 0000:00:00 00:00:00 (x, ASCII, 20 components, 20 bytes)").taken).toBeNull();
  });
  test("video: Apple creation date with offset, ISO 6709 location, rotation", () => {
    const m = metaFromffprobe();
    expect(iso(m.taken!.utc)).toBe("2020-08-01T08:00:00.000Z"); expect(m.taken!.tzMin).toBe(120);
    expect([m.width, m.height, m.durationMs, m.lat, m.lon]).toEqual([1080, 1920, 12500, 48.1371, 11.5754]);
    expect(parseIso6709("+48.1371+011.5754+517.2/")).toEqual({ lat: 48.1371, lon: 11.5754 });
  });
  test("video: 0°/0° is a phone without a fix, not a place", () => {
    expect(parseIso6709("+00.0000+000.0000/")).toBeNull();
    expect(parseIso6709("+00.0000-000.0000+000.000/")).toBeNull();
    expect(parseIso6709("+00.0000+023.7280/")).toEqual({ lat: 0, lon: 23.728 }); // the equator alone is a real place
  });
});
function metaFromffprobe() {
  return metaFromFfprobe({ format: { duration: "12.5", tags: { "com.apple.quicktime.creationdate": "2020-08-01T10:00:00+0200", "com.apple.quicktime.location.ISO6709": "+48.1371+011.5754+517.2/" } },
    streams: [{ codec_type: "video", width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }] });
}
import { metaFromFfprobe } from "../server/exif";

describe("day titles", () => {
  const today = "2026-11-21";
  test("Heute, Gestern", () => { expect(dayTitle("2026-11-21", today)).toBe("Heute"); expect(dayTitle("2026-11-20", today)).toBe("Gestern"); });
  test("weekday, day, month; the year only when it differs", () => {
    expect(dayTitle("2025-11-16", "2025-12-01")).toBe("Sonntag, 16. November");
    expect(dayTitle("2015-02-14", today)).toBe("Samstag, 14. Februar 2015");
    expect(dayTitle("2026-03-01", today)).toBe("Sonntag, 1. März");
  });
  test("Gestern across a month and a year border", () => { expect(dayTitle("2025-12-31", "2026-01-01")).toBe("Gestern"); expect(dayTitle("2026-02-28", "2026-03-01")).toBe("Gestern"); });
});

describe("day colour", () => {
  test("sign reaches 4.5:1 on the day background, signNight on the night background, hue stays", () => {
    for (const set of [["#f2c94c", "#88776e", "#ffffff"], ["#19130f", "#1e90ff", "#444444"], ["#ff69b4", "#ffd700", "#00ffff"], ["#888888"], []]) {
      const { sign, signNight } = daySign(set);
      expect(contrast(hexToRgb(sign), hexToRgb(DAY_BG))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hexToRgb(signNight), hexToRgb(NIGHT_BG))).toBeGreaterThanOrEqual(4.5);
    }
    // the most saturated entry wins: the blue, not the grey
    const { sign } = daySign(["#808080", "#1e90ff", "#999999"]); const [r, , b] = hexToRgb(sign);
    expect(b).toBeGreaterThan(r);
  });
  test("k-means finds two clear colours and the mean; PPM parsing skips the comment line", () => {
    const px = [...Array(10).fill([255, 0, 0]), ...Array(10).fill([0, 0, 255])] as [number, number, number][];
    const { mean, centres } = kmeans(px, 3);
    expect(mean.map(Math.round)).toEqual([128, 0, 128]);
    expect(centres.some(c => c[0] > 250)).toBe(true); expect(centres.some(c => c[2] > 250)).toBe(true);
    const ppm = new Uint8Array([...new TextEncoder().encode("P6\n#vips2ppm - today\n2 1\n255\n"), 1, 2, 3, 4, 5, 6]);
    expect(readPpm(ppm)).toEqual([[1, 2, 3], [4, 5, 6]]);
  });
});

describe("search parse", () => {
  const ctx = { people: [{ id: 7, name: "Oma" }, { id: 8, name: "Tante Gerda" }], places: [{ id: 2867714, name: "München" }, { id: 5, name: "Garmisch-Partenkirchen" }] };
  const kinds = (q: string, c = ctx) => parseQuery(q, c).chips.map(x => `${x.kind}:${x.value}`);
  test("the example: person chip only when the person exists, year chip, rest is content", () => {
    expect(kinds("oma im schnee 2019")).toEqual(["person:7", "date:y:2019", "content:im schnee"]);
    expect(kinds("oma im schnee 2019", { people: [], places: [] })).toEqual(["date:y:2019", "content:oma im schnee"]);
    expect(parseQuery("oma im schnee 2019", ctx).rest).toBe("im schnee");
  });
  test("months, seasons, Weihnachten in German and English", () => {
    expect(kinds("Strand August")).toEqual(["date:m:8", "content:Strand"]);
    expect(kinds("im Frühling")).toEqual(["date:s:fruehling", "content:im"]);
    expect(kinds("summer")).toEqual(["date:s:sommer"]);
    expect(kinds("Weihnachten 2020")).toEqual(["date:r:12-20..12-26", "date:y:2020"]);
    expect(kinds("März")).toEqual(["date:m:3"]);
  });
  test("places, also by the English name, and multi-word names", () => {
    expect(kinds("Berge in Garmisch-Partenkirchen")).toEqual(["place:5", "content:Berge in"]);
    expect(kinds("munich 2021")).toEqual(["place:2867714", "date:y:2021"]);
  });
  test("a first name finds a full name when only one person has it", () => {
    expect(kinds("Gerda im Garten")).toEqual(["person:8", "content:im Garten"]);
    expect(kinds("Tante Gerda")).toEqual(["person:8"]);
    expect(kinds("gerda", { people: [{ id: 1, name: "Gerda Müller" }, { id: 2, name: "Gerda Schulz" }], places: [] })).toEqual(["content:gerda"]);
  });
  test("an empty line gives no chips", () => { expect(parseQuery("   ", ctx)).toEqual({ chips: [], rest: "" }); });
});

describe("clustering arithmetic", () => {
  const at = (deg: number) => { const v = new Float32Array(128); v[0] = Math.cos(deg * Math.PI / 180); v[1] = Math.sin(deg * Math.PI / 180); return v; };
  const group = (id: number, ...vs: Float32Array[]): Group => { const g = { id, sum: new Float32Array(128), n: 0 }; vs.forEach(v => addTo(g, v)); return g; };
  test("threshold: cos 0.42 is about 65.2 degrees", () => {
    const g = [group(1, at(0))];
    expect(bestMatch(at(60), g)?.id).toBe(1);   // cos 0.5
    expect(bestMatch(at(64), g)?.id).toBe(1);   // cos 0.438, above
    expect(bestMatch(at(66), g)).toBeNull();    // cos 0.407, below
    expect(SAME_PERSON).toBe(0.42);
  });
  test("the best of several groups wins, a centroid averages its faces", () => {
    const gs = [group(1, at(0), at(20)), group(2, at(100))]; // centroid of group 1 is at 10 degrees
    expect(bestMatch(at(15), gs)?.id).toBe(1);
    expect(bestMatch(at(95), gs)?.id).toBe(2);
    expect(bestMatch(at(180), gs)).toBeNull();
  });
  test("an empty group never matches", () => { expect(bestMatch(at(0), [group(1)])).toBeNull(); });
});

describe("month palette", () => {
  test("the saturated colours win over the greys, one per hue", () => {
    const greys = ["#808080", "#7a7d80", "#9a9a98", "#6e6e70"];
    const p = monthPalette([...greys, "#1f5fa8", "#2565b0", "#d98a2a", "#c9b27a"]);
    expect(p[0]).toBe("#d98a2a");             // the sunset orange is the strongest colour
    expect(p.filter(x => x === "#1f5fa8" || x === "#2565b0").length).toBe(1); // one sea blue, not two
    expect(p).toContain("#c9b27a");           // sandstone shares the orange's hue but is its own colour
    expect(p.filter(x => greys.includes(x)).length).toBeLessThanOrEqual(0);
  });
  test("a month with only grey photos stays grey, never empty", () => {
    expect(monthPalette(["#808080", "#7f7f7f"]).length).toBeGreaterThan(0);
  });
});
