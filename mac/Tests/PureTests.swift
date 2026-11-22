import Foundation

// Nothing in Tests/ touches the real Photos library, the Keychain or a real
// server. Every suite runs on fixtures, temp directories and pure functions.

func runPureTests() {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "Europe/Berlin")!

    Check.suite("light by hour") {
        let expect: [(Int, Light)] = [(0, .nacht), (5, .nacht), (6, .morgen), (9, .morgen), (10, .mittag), (16, .mittag),
                                      (17, .abend), (20, .abend), (21, .nacht), (23, .nacht)]
        for (h, l) in expect { Check.equal(LightClock.light(hour: h, darkAppearance: false), l, "hour \(h)") }
        for h in 0..<24 { Check.equal(LightClock.light(hour: h, darkAppearance: true), .nacht, "dark forces nacht at \(h)") }
    }
    Check.suite("archive path") {
        let root = URL(fileURLWithPath: "/Volumes/Archiv")
        let sha = String(repeating: "ab", count: 32)
        // 2019-12-31 23:30 UTC
        let ms: Int64 = 1_577_835_000_000
        Check.equal(ArchivePath.build(root: root, takenAtMs: ms, sha256: sha, ext: "jpg").path, "/Volumes/Archiv/2019/12/\(sha).jpg", "year/month/sha.ext")
        Check.equal(ArchivePath.build(root: root, takenAtMs: ms + 3_600_000, sha256: sha, ext: "HEIC").path, "/Volumes/Archiv/2020/01/\(sha).heic", "UTC month rollover, lowercase ext")
        Check.equal(ArchivePath.build(root: root, takenAtMs: nil, sha256: sha, ext: "png", fallback: Date(timeIntervalSince1970: 0)).path, "/Volumes/Archiv/1970/01/\(sha).png", "no date: fallback")
        Check.equal(ArchivePath.build(root: root, takenAtMs: ms, sha256: sha, ext: "../x").lastPathComponent, "\(sha).x", "extension cannot escape")
        Check.that(ArchivePath.isValidSha(sha), "64 hex is valid")
        Check.that(!ArchivePath.isValidSha("../../etc/passwd"), "a path is not a sha")
        Check.that(!ArchivePath.isValidSha(String(repeating: "A", count: 64)), "uppercase is not what the server sends")
    }
    Check.suite("nightly schedule") {
        func d(_ h: Int, _ m: Int, day: Int = 5) -> Date { cal.date(from: DateComponents(year: 2026, month: 11, day: day, hour: h, minute: m))! }
        Check.equal(NightlySchedule.next(after: d(12, 0), calendar: cal), d(23, 0), "noon: tonight")
        Check.equal(NightlySchedule.next(after: d(23, 0), calendar: cal), d(23, 0, day: 6), "at 23:00 sharp: tomorrow")
        Check.equal(NightlySchedule.next(after: d(23, 40), calendar: cal), d(23, 0, day: 6), "after 23:00: tomorrow")
        Check.equal(NightlySchedule.next(after: d(0, 5), calendar: cal), d(23, 0), "just after midnight: tonight")
    }
    Check.suite("phrases") {
        let now = cal.date(from: DateComponents(year: 2026, month: 11, day: 21, hour: 12))!
        func at(_ day: Int, _ h: Int, _ m: Int, year: Int = 2026) -> Date { cal.date(from: DateComponents(year: year, month: 11, day: day, hour: h, minute: m))! }
        Check.equal(Phrase.lastCopy(at(20, 23, 10), now: now, calendar: cal), "gestern, 23:10", "yesterday")
        Check.equal(Phrase.lastCopy(at(21, 8, 5), now: now, calendar: cal), "heute, 08:05", "today")
        Check.equal(Phrase.lastCopy(at(12, 23, 10), now: now, calendar: cal), "12.11., 23:10", "this year")
        Check.equal(Phrase.lastCopy(at(12, 23, 10, year: 2025), now: now, calendar: cal), "12.11.2025, 23:10", "other year")
        Check.equal(Phrase.photos(1), "ein Foto", "one"); Check.equal(Phrase.photos(3), "drei Fotos", "three")
        Check.equal(Phrase.photos(17), "17 Fotos", "many")
        Check.equal(Phrase.count(52310), "52.310", "German thousands")
        Check.equal(PanelText.card(darkroom: DarkroomStatus(busy: true, label: "Gesichter im zweiten Foto", progress: 0.54, pending: 9, items: [.init(id: 1, done: true), .init(id: 2, done: false), .init(id: 3, done: false)]), uploading: nil).title,
                    "Analysiert drei Fotos", "card title as in the design")
        Check.equal(PanelText.header(paired: true, pause: nil, uploading: nil, offline: false).text, "Alles gesichert", "header idle")
        Check.equal(PanelText.header(paired: true, pause: .user, uploading: (1, 4), offline: false).text, "Pausiert", "pause beats upload")
        Check.equal(PanelText.header(paired: true, pause: nil, uploading: (1, 4), offline: false).text, "Sichert 2 von 4", "uploading")
        Check.equal(PanelText.source(kind: "folder", total: 1204, uploaded: 1204, scanning: false), "1.204 Dateien, aktuell", "folder line as in the design")
        Check.equal(PanelText.source(kind: "photos", total: 52310, uploaded: 52310, scanning: false), "52.310 Objekte, aktuell", "photos line as in the design")
    }
    Check.suite("pause policy") {
        Check.isNil(PausePolicy.reason(userPaused: false, onBattery: false, batteryPercent: nil, lowPower: false), "desktop runs")
        Check.equal(PausePolicy.reason(userPaused: true, onBattery: false, batteryPercent: nil, lowPower: false), .user, "user toggle")
        Check.equal(PausePolicy.reason(userPaused: false, onBattery: true, batteryPercent: 19, lowPower: false), .battery, "battery below 20")
        Check.isNil(PausePolicy.reason(userPaused: false, onBattery: true, batteryPercent: 20, lowPower: false), "battery at 20 runs")
        Check.isNil(PausePolicy.reason(userPaused: false, onBattery: false, batteryPercent: 5, lowPower: false), "low charge on the charger runs")
        Check.equal(PausePolicy.reason(userPaused: false, onBattery: false, batteryPercent: 90, lowPower: true), .lowPower, "low power mode")
    }
    Check.suite("input") {
        Check.equal(ServerURL.normalize("monet.kaleve.dev")?.absoluteString, "https://monet.kaleve.dev", "bare host")
        Check.equal(ServerURL.normalize(" https://monet.kaleve.dev/geraete?x=1 ")?.absoluteString, "https://monet.kaleve.dev", "path and query dropped")
        Check.isNil(ServerURL.normalize("http://monet.kaleve.dev"), "plain http to a real host is refused")
        Check.equal(ServerURL.normalize("http://127.0.0.1:4320")?.absoluteString, "http://127.0.0.1:4320", "loopback http is fine")
        Check.isNil(ServerURL.normalize(""), "empty")
        Check.isNil(ServerURL.normalize("ftp://x.de"), "other scheme")
        Check.equal(PairingCode.normalize("abcd-2345"), "ABCD2345", "code is uppercased and cleaned")
        Check.isNil(PairingCode.normalize("ABC"), "short code")
        Check.that(MediaFile.isMedia(URL(fileURLWithPath: "/x/IMG_1.HEIC")), "heic is media")
        Check.that(!MediaFile.isMedia(URL(fileURLWithPath: "/x/notes.txt")), "txt is not")
        Check.equal(OcrWanted.filter([PendingItem(id: 1, kind: "photo", needs: ["clip", "ocr"]), PendingItem(id: 2, kind: "photo", needs: ["clip"]),
                                      PendingItem(id: 3, kind: "video", needs: ["ocr"])]).map(\.id), [1], "only photos that need ocr")
    }
    Check.suite("darkroom status") {
        let s = DarkroomStatus.parse(#"{"busy":true,"label":"Gesichter","progress":1.7,"pending":4,"items":[{"id":5,"done":true},{"id":6},9],"extra":1}"#)
        Check.equal(s?.items.count, 3, "items parsed, ids alone accepted")
        Check.equal(s?.progress, 1.0, "progress clamped")
        Check.equal(s?.label, "Gesichter", "label")
        Check.isNil(DarkroomStatus.parse("null"), "null is no status")
        Check.isNil(DarkroomStatus.parse(nil), "nil is no status")
    }
}
