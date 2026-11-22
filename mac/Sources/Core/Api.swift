import Foundation

struct ApiError: Error, CustomStringConvertible {
    let status: Int
    let message: String
    var description: String { "HTTP \(status): \(message)" }
}

enum PutResult: Equatable {
    case received(Int)
    case complete(itemId: Int?, duplicate: Bool)
    case conflict(offset: Int?)
}

struct ExportEntry: Codable, Equatable { let id: Int; let sha256: String; let ext: String; let bytes: Int64?; let takenAt: Int64? }

/// The HTTP side of the contract in docs/spec.md. The bearer token is only ever put in an
/// Authorization header; no error, log line or description contains it.
final class Api: @unchecked Sendable {
    let base: URL
    private let token: String?
    let session: URLSession

    init(base: URL, token: String?) {
        self.base = base
        self.token = token
        let c = URLSessionConfiguration.ephemeral
        c.waitsForConnectivity = true
        c.httpShouldSetCookies = false
        c.httpCookieAcceptPolicy = .never
        c.timeoutIntervalForRequest = 300
        c.timeoutIntervalForResource = 24 * 3600
        c.httpMaximumConnectionsPerHost = 4
        session = URLSession(configuration: c)
    }

    private func url(_ path: String, _ query: [URLQueryItem] = []) -> URL {
        var c = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        c.percentEncodedPath = path
        c.queryItems = query.isEmpty ? nil : query
        return c.url!
    }

    func request(_ method: String, _ path: String, query: [URLQueryItem] = [], json: Any? = nil) -> URLRequest {
        var r = URLRequest(url: url(path, query))
        r.httpMethod = method
        if let t = token { r.setValue("Bearer \(t)", forHTTPHeaderField: "Authorization") }
        if let j = json {
            r.httpBody = try? JSONSerialization.data(withJSONObject: j)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    private func send(_ r: URLRequest, body: Data? = nil) async throws -> (Data, HTTPURLResponse) {
        let (d, resp) = body == nil ? try await session.data(for: r) : try await session.upload(for: r, from: body!)
        guard let h = resp as? HTTPURLResponse else { throw ApiError(status: 0, message: "no response") }
        return (d, h)
    }

    private func jsonObject(_ d: Data) -> [String: Any]? { (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] }

    private func check(_ d: Data, _ h: HTTPURLResponse) throws {
        guard (200..<300).contains(h.statusCode) else {
            let m = (jsonObject(d)?["error"] as? String) ?? String(data: d.prefix(200), encoding: .utf8) ?? ""
            throw ApiError(status: h.statusCode, message: m)
        }
    }

    // MARK: Pairing and session

    func claim(code: String, name: String) async throws -> (token: String, deviceId: String) {
        let (d, h) = try await send(request("POST", "/api/devices/claim", json: ["code": code, "name": name, "kind": "mac"]))
        try check(d, h)
        guard let o = jsonObject(d), let t = o["token"] as? String, !t.isEmpty else { throw ApiError(status: h.statusCode, message: "no token in answer") }
        let id = o["deviceId"].map { "\($0)" } ?? ""
        return (t, id)
    }

    /// POST /api/devices/session with the bearer; returns the cookie from Set-Cookie.
    func deviceSession() async throws -> HTTPCookie {
        let (d, h) = try await send(request("POST", "/api/devices/session"))
        try check(d, h)
        var fields: [String: String] = [:]
        for (k, v) in h.allHeaderFields { if let k = k as? String, let v = v as? String { fields[k] = v } }
        guard let c = HTTPCookie.cookies(withResponseHeaderFields: fields, for: base).first else {
            throw ApiError(status: h.statusCode, message: "no session cookie")
        }
        return c
    }

    /// GET /api/status: the server's own facts; the panel only reads `theme` (the owner's style).
    func status() async throws -> [String: Any] {
        let (d, h) = try await send(request("GET", "/api/status"))
        try check(d, h)
        return jsonObject(d) ?? [:]
    }

    // MARK: Upload

    func check(hashes: [String]) async throws -> Set<String> {
        let (d, h) = try await send(request("POST", "/api/upload/check", json: ["hashes": hashes]))
        try check(d, h)
        return Set((jsonObject(d)?["missing"] as? [String]) ?? [])
    }

    func put(sha: String, offset: Int, total: Int, name: String, mtimeMs: Int64, source: String, chunk: Data) async throws -> PutResult {
        let q = [URLQueryItem(name: "offset", value: "\(offset)"), URLQueryItem(name: "total", value: "\(total)"),
                 URLQueryItem(name: "name", value: name), URLQueryItem(name: "mtime", value: "\(mtimeMs)"),
                 URLQueryItem(name: "source", value: source)]
        var r = request("PUT", "/api/upload/\(sha)", query: q)
        r.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let (d, h) = try await send(r, body: chunk)
        return try Self.parsePut(status: h.statusCode, body: d)
    }

    static func parsePut(status: Int, body: Data) throws -> PutResult {
        let o = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        if status == 409 {
            let off = (o?["received"] ?? o?["offset"] ?? o?["expected"]).flatMap { ($0 as? NSNumber)?.intValue }
            return .conflict(offset: off)
        }
        guard (200..<300).contains(status) else {
            throw ApiError(status: status, message: (o?["error"] as? String) ?? "")
        }
        if let item = o?["item"] as? [String: Any] {
            return .complete(itemId: (item["id"] as? NSNumber)?.intValue, duplicate: (o?["duplicate"] as? Bool) ?? false)
        }
        return .received((o?["received"] as? NSNumber)?.intValue ?? 0)
    }

    // MARK: Index

    func pending(limit: Int = 20) async throws -> [PendingItem] {
        let (d, h) = try await send(request("GET", "/api/index/pending", query: [URLQueryItem(name: "limit", value: "\(limit)"), URLQueryItem(name: "needs", value: "ocr")]))
        try check(d, h)
        return (try? JSONDecoder().decode([PendingItem].self, from: d)) ?? []
    }

    /// The model name sent with OCR text. The spec says "vision-ocr"; the server of 2026-11-21 only knows
    /// the CLIP model id for every index post and answers 400, so on a 400 the post is repeated once with
    /// that id and the working name is remembered.
    nonisolated(unsafe) static var ocrModel = "vision-ocr"
    static let fallbackModel = "clip-vit-b32"

    func postOcr(id: Int, text: String) async throws {
        var (d, h) = try await send(request("POST", "/api/index/\(id)", json: ["model": Self.ocrModel, "ocr": text]))
        if h.statusCode == 400 && Self.ocrModel != Self.fallbackModel {
            (d, h) = try await send(request("POST", "/api/index/\(id)", json: ["model": Self.fallbackModel, "ocr": text]))
            if (200..<300).contains(h.statusCode) { Self.ocrModel = Self.fallbackModel }
        }
        try check(d, h)
    }

    /// Tells the server these items are on the second copy (sets secondCopyAt).
    func exportAck(ids: [Int]) async {
        guard !ids.isEmpty else { return }
        for start in stride(from: 0, to: ids.count, by: 5000) {
            let part = Array(ids[start..<min(start + 5000, ids.count)])
            _ = try? await send(request("POST", "/api/export/ack", json: ["ids": part]))
        }
    }

    /// A small picture for the panel. The server lets a device token read only "l" (and "o"), so when
    /// "s" is refused the viewer size is used.
    func thumbnail(id: Int) async throws -> Data {
        do { return try await media(id: id, size: "s") }
        catch let e as ApiError where e.status == 403 { return try await media(id: id, size: "l") }
    }

    /// Thumbnails and the viewer size, also the original ("o") for the archive.
    func media(id: Int, size: String) async throws -> Data {
        let (d, h) = try await send(request("GET", "/media/\(id)/\(size)"))
        try check(d, h)
        return d
    }

    /// Streams /media/:id/o to a temporary file and returns its URL (the caller moves or deletes it).
    func downloadOriginal(id: Int) async throws -> URL {
        let (tmp, resp) = try await session.download(for: request("GET", "/media/\(id)/o"))
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            try? FileManager.default.removeItem(at: tmp)
            throw ApiError(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, message: "download failed")
        }
        return tmp
    }

    func exportList(after: Int) async throws -> [ExportEntry] {
        let (d, h) = try await send(request("GET", "/api/export/list", query: [URLQueryItem(name: "after", value: "\(after)")]))
        try check(d, h)
        return (try? JSONDecoder().decode([ExportEntry].self, from: d)) ?? []
    }
}
