import Foundation

/// The pure parts: no network, no disk, no UI. Everything in here is tested.

// MARK: Chunks

/// Splits a file into PUT chunks. The server accepts up to 32 MiB; the agent sends 16 MiB.
enum ChunkPlanner {
    static let chunkSize = 16 * 1024 * 1024

    /// Bytes to send when the server already has `offset` of `total`.
    /// An empty file still gets one (empty) request so the server can finish it.
    static func length(offset: Int, total: Int, chunk: Int = chunkSize) -> Int {
        max(0, min(chunk, total - offset))
    }

    /// All (offset, length) pairs from the start.
    static func plan(total: Int, chunk: Int = chunkSize) -> [(offset: Int, length: Int)] {
        if total == 0 { return [(0, 0)] }
        var out: [(Int, Int)] = []
        var o = 0
        while o < total { let l = length(offset: o, total: total, chunk: chunk); out.append((o, l)); o += l }
        return out
    }

    /// True when a request starting at `offset` is the final one.
    static func isFinal(offset: Int, total: Int, chunk: Int = chunkSize) -> Bool {
        offset + length(offset: offset, total: total, chunk: chunk) >= total
    }
}

/// What to do with an answer of the upload endpoint.
enum ResumePlanner {
    enum Step: Equatable {
        case next(offset: Int)
        case restart
        case fail
    }

    /// `received` is the server's idea of how many bytes it holds (from a 200 or a 409 body).
    /// `sentUpTo` is the offset we believed we had reached. A 409 may move us backwards or
    /// forwards. A server number outside 0...total is garbage and restarts from zero once;
    /// a second time in a row is a failure so we never loop forever.
    static func afterConflict(serverOffset: Int?, total: Int, restartsSoFar: Int) -> Step {
        guard let s = serverOffset, s >= 0, s <= total else {
            return restartsSoFar >= 1 ? .fail : .restart
        }
        return .next(offset: s)
    }

    /// A 409 that sends us to the same offset we just tried more than `maxSame` times is stuck.
    static func isStuck(tried: Int, resumed: Int, repeats: Int, maxSame: Int = 2) -> Bool {
        tried == resumed && repeats >= maxSame
    }
}

// MARK: Light

enum Light: String, CaseIterable { case morgen, mittag, abend, nacht }

/// The light follows the clock like the web client: morgen 6 to 10, mittag 10 to 17,
/// abend 17 to 21, nacht 21 to 6. A dark system appearance forces nacht.
enum LightClock {
    static func light(hour: Int, darkAppearance: Bool) -> Light {
        if darkAppearance { return .nacht }
        switch hour {
        case 6..<10: return .morgen
        case 10..<17: return .mittag
        case 17..<21: return .abend
        default: return .nacht
        }
    }
}

// MARK: Archive paths and schedule

enum ArchivePath {
    /// <root>/<yyyy>/<mm>/<sha256>.<ext>, by taken date in UTC (the server files originals the same way).
    static func build(root: URL, takenAtMs: Int64?, sha256: String, ext: String, fallback: Date = Date()) -> URL {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let date = takenAtMs.map { Date(timeIntervalSince1970: Double($0) / 1000) } ?? fallback
        let c = cal.dateComponents([.year, .month], from: date)
        let cleanExt = ext.lowercased().filter { $0.isLetter || $0.isNumber }
        let name = cleanExt.isEmpty ? sha256 : "\(sha256).\(cleanExt)"
        return root
            .appendingPathComponent(String(format: "%04d", c.year ?? 1970), isDirectory: true)
            .appendingPathComponent(String(format: "%02d", c.month ?? 1), isDirectory: true)
            .appendingPathComponent(name)
    }

    /// A sha256 from the server ends up in a path, so only 64 hex digits are accepted.
    static func isValidSha(_ s: String) -> Bool {
        s.count == 64 && s.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }
}

enum NightlySchedule {
    /// The next 23:00 strictly after `date`.
    static func next(after date: Date, hour: Int = 23, calendar: Calendar = .current) -> Date {
        let today = calendar.date(bySettingHour: hour, minute: 0, second: 0, of: date)!
        if today > date { return today }
        return calendar.date(byAdding: .day, value: 1, to: today)!
    }
}

enum Phrase {
    /// "heute, 23:10", "gestern, 23:10", "12.11., 23:10", with the year when it is not this one.
    static func lastCopy(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE"); f.calendar = calendar; f.timeZone = calendar.timeZone
        f.dateFormat = "HH:mm"
        let time = f.string(from: date)
        if calendar.isDate(date, inSameDayAs: now) { return "heute, \(time)" }
        if let y = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: y) {
            return "gestern, \(time)"
        }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: now)
        f.dateFormat = sameYear ? "d.M., HH:mm" : "d.M.yyyy, HH:mm"
        return f.string(from: date)
    }

    /// German number words for small counts: "drei Fotos", "ein Foto", "17 Fotos".
    static func photos(_ n: Int) -> String {
        let words = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"]
        if n == 1 { return "ein Foto" }
        if n >= 0 && n < words.count { return "\(words[n]) Fotos" }
        return "\(n) Fotos"
    }

    /// 52310 -> "52.310"
    static func count(_ n: Int) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "de_DE"); f.numberStyle = .decimal
        f.usesGroupingSeparator = true
        return f.string(from: NSNumber(value: n)) ?? "\(n)"
    }
}

// MARK: Pausing

enum PausePolicy {
    enum Reason: Equatable { case user, battery, lowPower }

    /// Pause when the user asked to, when Low Power Mode is on, or when running on
    /// battery below 20 percent. `batteryPercent` is nil on a desktop Mac.
    static func reason(userPaused: Bool, onBattery: Bool, batteryPercent: Int?, lowPower: Bool) -> Reason? {
        if userPaused { return .user }
        if lowPower { return .lowPower }
        if onBattery, let p = batteryPercent, p < 20 { return .battery }
        return nil
    }
}

// MARK: Input

enum ServerURL {
    /// Accepts "monet.kaleve.dev", "https://monet.kaleve.dev/geraete" and returns the origin.
    /// Plain http is only allowed for localhost and loopback (local tests).
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.contains("://") { s = "https://" + s }
        guard var c = URLComponents(string: s), let host = c.host, !host.isEmpty else { return nil }
        let local = host == "localhost" || host == "127.0.0.1" || host == "::1"
        guard c.scheme == "https" || (c.scheme == "http" && local) else { return nil }
        c.path = ""; c.query = nil; c.fragment = nil; c.user = nil; c.password = nil
        return c.url
    }
}

enum PairingCode {
    /// Uppercase, drop spaces and dashes, and require exactly 8 letters or digits.
    static func normalize(_ raw: String) -> String? {
        let s = raw.uppercased().filter { $0.isLetter || $0.isNumber }
        return s.count == 8 ? s : nil
    }
}

enum MediaFile {
    static let photoExt: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tif", "tiff", "bmp",
                                        "dng", "arw", "cr2", "cr3", "nef", "orf", "raf", "rw2"]
    static let videoExt: Set<String> = ["mp4", "mov", "m4v", "avi", "mkv", "3gp", "webm", "mts", "m2ts"]

    static func isMedia(_ url: URL) -> Bool {
        let e = url.pathExtension.lowercased()
        return photoExt.contains(e) || videoExt.contains(e)
    }
    /// Hidden files and macOS resource forks are never uploaded.
    static func isSkippedName(_ name: String) -> Bool { name.hasPrefix(".") }
}

enum OcrWanted {
    /// Items the agent should run OCR for: needs contains 'ocr' and it is a photo.
    static func filter(_ pending: [PendingItem]) -> [PendingItem] {
        pending.filter { $0.needs.contains("ocr") && $0.kind != "video" }
    }
}

struct PendingItem: Codable, Equatable { let id: Int; let kind: String; let needs: [String] }
